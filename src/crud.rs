//! API générique des fichiers de base : liste, création, modification, suppression.
//!
//! Les noms de table et de colonne viennent uniquement de `schema::ENTITES` ; les valeurs passent
//! toujours en paramètres SQL (le corps JSON entier est lu par `json_populate_record`).

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Map, Value};
use tokio_postgres::error::SqlState;
use tokio_postgres::types::ToSql;

use crate::schema::{self, Entite, Genre};
use crate::Etat;

pub struct Erreur(pub StatusCode, pub String);

impl IntoResponse for Erreur {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "erreur": self.1 }))).into_response()
    }
}

impl From<tokio_postgres::Error> for Erreur {
    fn from(e: tokio_postgres::Error) -> Self {
        let Some(db) = e.as_db_error() else {
            return Erreur(StatusCode::SERVICE_UNAVAILABLE, format!("Base de données injoignable : {e}"));
        };
        let code = db.code();
        let table = db.table().unwrap_or("");
        let libelle = |col: &str| -> String {
            schema::ENTITES
                .iter()
                .find(|e| e.table == table)
                .and_then(|e| e.champ(col))
                .map(|c| c.libelle.to_string())
                .unwrap_or_else(|| col.to_string())
        };
        let (statut, msg) = if *code == SqlState::UNIQUE_VIOLATION {
            // Détail : « Key (col1, col2)=(v1, v2) already exists. »
            let detail = db.detail().unwrap_or("");
            let cles = detail.split_once('(').and_then(|(_, r)| r.split_once(')')).map(|(c, _)| c).unwrap_or("");
            let noms: Vec<String> = cles.split(", ").filter(|c| !c.is_empty()).map(libelle).collect();
            (StatusCode::CONFLICT, format!("Une fiche existe déjà avec la même valeur : {}", noms.join(", ")))
        } else if *code == SqlState::FOREIGN_KEY_VIOLATION {
            let msg = if db.message().contains("still referenced") || db.message().contains("toujours référencée") {
                "D'autres fiches sont liées à celle-ci : décochez plutôt « Actif »"
            } else {
                "La fiche liée choisie n'existe pas"
            };
            (StatusCode::CONFLICT, msg.to_string())
        } else if *code == SqlState::NOT_NULL_VIOLATION {
            (StatusCode::BAD_REQUEST, format!("Champ obligatoire : {}", libelle(db.column().unwrap_or("?"))))
        } else if *code == SqlState::CHECK_VIOLATION {
            let contrainte = db.constraint().unwrap_or("");
            let msg = match contrainte {
                "dmi_tracabilite" => "Un DMI doit avoir le lot ou le n° de série obligatoire, à la réception et à la sortie".to_string(),
                "liste_medicament" => "Seul un médicament peut relever des listes I et II ou des stupéfiants".to_string(),
                "mds_tracabilite" => "Un médicament dérivé du sang doit avoir le lot obligatoire à la réception et à la sortie".to_string(),
                "magasin_role" => "Ce rôle ne correspond pas au type du magasin".to_string(),
                "magasin_source_soi" => "Un magasin ne s'approvisionne pas lui-même".to_string(),
                "magasin_pui_economat" => "Un magasin d'économat ne dépend pas d'une PUI".to_string(),
                "magasin_pui_obligatoire" => "Un magasin de PUI doit être rattaché à une PUI".to_string(),
                "classe_dm_nature" => "La classe de DM ne s'applique qu'aux dispositifs médicaux".to_string(),
                c => match c.strip_prefix(&format!("{table}_")).and_then(|c| c.strip_suffix("_check")) {
                    Some(col) if !col.is_empty() && schema::ENTITES.iter().any(|e| e.table == table && e.champ(col).is_some()) => {
                        format!("Valeur invalide : {}", libelle(col))
                    }
                    _ => "Valeurs incohérentes (dates, bornes ou quantités)".to_string(),
                },
            };
            (StatusCode::BAD_REQUEST, msg)
        } else {
            (StatusCode::BAD_REQUEST, db.message().to_string())
        };
        Erreur(statut, msg)
    }
}

impl From<deadpool_postgres::PoolError> for Erreur {
    fn from(e: deadpool_postgres::PoolError) -> Self {
        Erreur(StatusCode::SERVICE_UNAVAILABLE, format!("Base de données injoignable : {e}"))
    }
}

fn introuvable() -> Erreur {
    Erreur(StatusCode::NOT_FOUND, "Fichier inconnu".into())
}

fn entite(nom: &str) -> Result<&'static Entite, Erreur> {
    schema::trouver(nom).ok_or_else(introuvable)
}

pub fn json_brut(texte: String, statut: StatusCode) -> Response {
    (statut, [(header::CONTENT_TYPE, "application/json; charset=utf-8")], texte).into_response()
}

pub async fn schema_json() -> Json<Value> {
    Json(schema::description())
}

/// Liens déduits (ex. établissement d'un emplacement) : colonnes calculées à la lecture.
fn colonnes_derivees(e: &Entite) -> String {
    e.champs
        .iter()
        .filter(|c| !c.derive.is_empty())
        .map(|c| format!(", ({}) as {}", c.derive, c.col))
        .collect()
}

/// `GET /api/e/{entite}?q=texte&col=valeur&~col=valeur&limit=n&_utilisable_par=etab` : lignes triées par
/// étiquette (5 000 au plus), avec l'étiquette de chaque lien affiché en colonne (`_l_<col>`).
/// `~col` : la valeur, ou vide (ex. : familles d'un référentiel et familles communes).
/// `_utilisable_par` (articles) : articles des référentiels qu'utilise l'établissement.
/// En-tête `X-Total` : nombre de lignes sans la limite.
pub async fn lister(
    State(etat): State<Arc<Etat>>,
    Path(nom): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, Erreur> {
    let e = entite(&nom)?;
    let limite = params.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(5000).clamp(1, 5000);
    let mut conds: Vec<String> = Vec::new();
    let mut vals: Vec<String> = Vec::new();
    if let Some(q) = params.get("q").filter(|q| !q.trim().is_empty()) {
        let textes: Vec<String> = e
            .champs
            .iter()
            .filter(|c| matches!(c.genre, Genre::Texte))
            .map(|c| format!("t.{}", c.col))
            .collect();
        vals.push(q.trim().to_string());
        conds.push(format!(
            "concat_ws(' ', {}, {}) ilike '%' || ${} || '%'",
            e.etiquette,
            textes.join(", "),
            vals.len()
        ));
    }
    for (k, v) in &params {
        if k == "_utilisable_magasin" && e.table == "article" {
            vals.push(v.clone());
            conds.push(format!(
                "article_utilisable(t.id, (select m.etablissement_id from magasin m where m.id = ${}::text::bigint))",
                vals.len()
            ));
            continue;
        }
        if k == "_utilisable_par" && e.table == "article" {
            vals.push(v.clone());
            conds.push(format!("article_utilisable(t.id, ${}::text::bigint)", vals.len()));
            continue;
        }
        let (col, ou_vide) = match k.strip_prefix('~') {
            Some(col) => (col, true),
            None => (k.as_str(), false),
        };
        if let Some(c) = e.champ(col) {
            vals.push(v.clone());
            // Lien déduit : filtré sur son expression.
            if !c.derive.is_empty() {
                conds.push(format!("({})::text = ${}", c.derive, vals.len()));
                continue;
            }
            conds.push(if ou_vide {
                format!("(t.{0}::text = ${1} or t.{0} is null)", c.col, vals.len())
            } else {
                format!("t.{}::text = ${}", c.col, vals.len())
            });
        }
    }
    let filtre = if conds.is_empty() { String::new() } else { format!("where {}", conds.join(" and ")) };
    // Étiquettes des liens affichés en colonne : calculées ici, sans charger les fichiers liés.
    let liens: String = e
        .champs
        .iter()
        .filter_map(|c| match c.genre {
            Genre::Ref(cible) if c.liste => schema::trouver(cible).map(|ce| {
                format!(", (select {} from {} t where t.id = x.{}) as _l_{}", ce.etiquette, ce.table, c.col, c.col)
            }),
            _ => None,
        })
        .collect();
    let derives = colonnes_derivees(e);
    let sql = format!(
        "select coalesce(json_agg(y order by y._etiquette), '[]')::text from (
            select x.* {liens} from (
                select t.*, {etiq} as _etiquette {derives} from {table} t {filtre} order by _etiquette limit {limite}) x) y",
        etiq = e.etiquette,
        table = e.table,
    );
    let total_sql = format!("select count(*) from {} t {}", e.table, filtre);
    let c = etat.pool.get().await?;
    let p: Vec<&(dyn ToSql + Sync)> = vals.iter().map(|v| v as &(dyn ToSql + Sync)).collect();
    let texte: String = c.query_one(&sql, &p).await?.get(0);
    let total: i64 = c.query_one(&total_sql, &p).await?.get(0);
    let mut r = json_brut(texte, StatusCode::OK);
    r.headers_mut().insert("x-total", total.into());
    Ok(r)
}

/// `POST /api/etablissement/{id}/referencer` `{nature?, famille_id?}` : crée les articles-sites
/// manquants pour les articles actifs des référentiels de l'établissement (la dotation se règle par magasin).
pub async fn referencer(
    State(etat): State<Arc<Etat>>,
    Path(id): Path<i64>,
    Json(corps): Json<Value>,
) -> Result<Response, Erreur> {
    let texte = |k: &str| -> Option<String> {
        match corps.get(k) {
            Some(Value::String(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
            Some(Value::Number(n)) => Some(n.to_string()),
            _ => None,
        }
    };
    let (nature, famille) = (texte("nature"), texte("famille_id"));
    let mut c = etat.pool.get().await?;
    let tx = c.transaction().await?;
    tx.execute("select set_config('stocks.utilisateur', $1, true)", &[&"poste local"]).await?;
    let n = tx
        .execute(
            "insert into article_site (article_id, etablissement_id)
             select a.id, $1
             from article a
             join etablissement_referentiel er
               on er.referentiel_id = a.referentiel_id and er.nature = a.nature and er.etablissement_id = $1
             where a.actif
               and ($2::text is null or a.nature = $2)
               and ($3::text is null or a.famille_id = $3::text::bigint)
               and not exists (select 1 from article_site s where s.article_id = a.id and s.etablissement_id = $1)",
            &[&id, &nature, &famille],
        )
        .await?;
    tx.commit().await?;
    Ok(json_brut(json!({ "crees": n }).to_string(), StatusCode::OK))
}

/// `GET /api/e/{entite}/{id}` : une fiche, avec son étiquette.
pub async fn lire(
    State(etat): State<Arc<Etat>>,
    Path((nom, id)): Path<(String, i64)>,
) -> Result<Response, Erreur> {
    let e = entite(&nom)?;
    let sql = format!(
        "select row_to_json(x)::text from (select t.*, {etiq} as _etiquette {derives} from {table} t where t.id = $1) x",
        etiq = e.etiquette,
        table = e.table,
        derives = colonnes_derivees(e),
    );
    let c = etat.pool.get().await?;
    let ligne = c.query_opt(&sql, &[&id]).await?.ok_or_else(introuvable)?;
    Ok(json_brut(ligne.get(0), StatusCode::OK))
}

/// Garde les clés connues de l'entité ; une chaîne vide devient nulle.
fn nettoyer(e: &Entite, corps: Value) -> Result<Map<String, Value>, Erreur> {
    let Value::Object(obj) = corps else {
        return Err(Erreur(StatusCode::BAD_REQUEST, "Objet JSON attendu".into()));
    };
    let mut out = Map::new();
    for (k, v) in obj {
        // Le code vient toujours du compteur et ne se modifie pas : jamais lu dans le corps.
        if k == "code" || e.champ(&k).is_some_and(|c| c.calcule) {
            continue;
        }
        if e.champ(&k).is_some() {
            let v = match v {
                Value::String(s) if s.trim().is_empty() => Value::Null,
                Value::String(s) => Value::String(s.trim().to_string()),
                v => v,
            };
            out.insert(k, v);
        }
    }
    if out.is_empty() {
        return Err(Erreur(StatusCode::BAD_REQUEST, "Aucun champ reconnu".into()));
    }
    Ok(out)
}

async fn ecrire(etat: &Etat, sql: &str, corps: &Map<String, Value>, id: Option<i64>) -> Result<Option<String>, Erreur> {
    let mut c = etat.pool.get().await?;
    let tx = c.transaction().await?;
    // Pas encore d'authentification : l'auteur du journal est le poste local.
    tx.execute("select set_config('stocks.utilisateur', $1, true)", &[&"poste local"]).await?;
    let corps = Value::Object(corps.clone()).to_string();
    let ligne = match id {
        Some(id) => tx.query_opt(sql, &[&corps, &id]).await?,
        None => tx.query_opt(sql, &[&corps]).await?,
    };
    tx.commit().await?;
    Ok(ligne.map(|l| l.get(0)))
}

/// `POST /api/e/{entite}` : crée une ligne ; les champs absents prennent leur valeur par défaut.
pub async fn creer(
    State(etat): State<Arc<Etat>>,
    Path(nom): Path<String>,
    Json(corps): Json<Value>,
) -> Result<Response, Erreur> {
    let e = entite(&nom)?;
    if schema::mode(e.nom) == "lecture" {
        return Err(Erreur(StatusCode::METHOD_NOT_ALLOWED, "Ce fichier est calculé : il ne se saisit pas".into()));
    }
    // Un champ laissé vide à la création prend la valeur par défaut de la base.
    let mut corps = nettoyer(e, corps)?;
    corps.retain(|_, v| !v.is_null());
    if corps.is_empty() {
        return Err(Erreur(StatusCode::BAD_REQUEST, "Fiche vide".into()));
    }
    let cols: Vec<&str> = corps.keys().map(|k| k.as_str()).collect();
    let sql = format!(
        "insert into {table} as t ({cols}) select {rcols} from json_populate_record(null::{table}, $1::text::json) r
         returning row_to_json(t)::text",
        table = e.table,
        cols = cols.join(", "),
        rcols = cols.iter().map(|c| format!("r.{c}")).collect::<Vec<_>>().join(", "),
    );
    let ligne = ecrire(&etat, &sql, &corps, None).await?.ok_or_else(introuvable)?;
    Ok(json_brut(ligne, StatusCode::CREATED))
}

/// `PUT /api/e/{entite}/{id}` : modifie les champs envoyés.
pub async fn modifier(
    State(etat): State<Arc<Etat>>,
    Path((nom, id)): Path<(String, i64)>,
    Json(corps): Json<Value>,
) -> Result<Response, Erreur> {
    let e = entite(&nom)?;
    if schema::mode(e.nom) != "normal" {
        return Err(Erreur(StatusCode::METHOD_NOT_ALLOWED, "Ces fiches ne se modifient pas".into()));
    }
    let corps = nettoyer(e, corps)?;
    let cols: Vec<&str> = corps.keys().map(|k| k.as_str()).collect();
    let sql = format!(
        "update {table} as t set ({cols}) = (select {rcols} from json_populate_record(null::{table}, $1::text::json) r)
         where t.id = $2 returning row_to_json(t)::text",
        table = e.table,
        cols = cols.join(", "),
        rcols = cols.iter().map(|c| format!("r.{c}")).collect::<Vec<_>>().join(", "),
    );
    let ligne = ecrire(&etat, &sql, &corps, Some(id)).await?.ok_or_else(introuvable)?;
    Ok(json_brut(ligne, StatusCode::OK))
}

/// `DELETE /api/e/{entite}/{id}` : refusé si d'autres fiches y sont liées (désactiver à la place).
pub async fn supprimer(
    State(etat): State<Arc<Etat>>,
    Path((nom, id)): Path<(String, i64)>,
) -> Result<StatusCode, Erreur> {
    let e = entite(&nom)?;
    if schema::mode(e.nom) != "normal" {
        return Err(Erreur(StatusCode::METHOD_NOT_ALLOWED, "Ces fiches ne se suppriment pas".into()));
    }
    let mut c = etat.pool.get().await?;
    let tx = c.transaction().await?;
    tx.execute("select set_config('stocks.utilisateur', $1, true)", &[&"poste local"]).await?;
    let n = tx.execute(&format!("delete from {} where id = $1", e.table), &[&id]).await?;
    tx.commit().await?;
    if n == 0 {
        return Err(introuvable());
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /api/journal/{entite}/{id}` : historique d'une fiche, du plus récent au plus ancien.
pub async fn journal(
    State(etat): State<Arc<Etat>>,
    Path((nom, id)): Path<(String, i64)>,
) -> Result<Response, Erreur> {
    let e = entite(&nom)?;
    let c = etat.pool.get().await?;
    let texte: String = c
        .query_one(
            "select coalesce(json_agg(j order by j.id desc), '[]')::text from (
                select id, le, utilisateur, operation, avant, apres from journal
                where table_nom = $1 and ligne_id = $2) j",
            &[&e.table, &id],
        )
        .await?
        .get(0);
    Ok(json_brut(texte, StatusCode::OK))
}
