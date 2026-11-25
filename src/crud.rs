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

pub struct Erreur(StatusCode, String);

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

fn json_brut(texte: String, statut: StatusCode) -> Response {
    (statut, [(header::CONTENT_TYPE, "application/json; charset=utf-8")], texte).into_response()
}

pub async fn schema_json() -> Json<Value> {
    Json(schema::description())
}

/// `GET /api/e/{entite}?q=texte&col=valeur…` : lignes triées par étiquette, 5 000 au plus.
pub async fn lister(
    State(etat): State<Arc<Etat>>,
    Path(nom): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, Erreur> {
    let e = entite(&nom)?;
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
        if k == "q" {
            continue;
        }
        if let Some(c) = e.champ(k) {
            vals.push(v.clone());
            conds.push(format!("t.{}::text = ${}", c.col, vals.len()));
        }
    }
    let filtre = if conds.is_empty() { String::new() } else { format!("where {}", conds.join(" and ")) };
    let sql = format!(
        "select coalesce(json_agg(x order by x._etiquette), '[]')::text from (
            select t.*, {etiq} as _etiquette from {table} t {filtre} order by 2 limit 5000) x",
        etiq = e.etiquette,
        table = e.table,
    );
    let c = etat.pool.get().await?;
    let p: Vec<&(dyn ToSql + Sync)> = vals.iter().map(|v| v as &(dyn ToSql + Sync)).collect();
    let texte: String = c.query_one(&sql, &p).await?.get(0);
    Ok(json_brut(texte, StatusCode::OK))
}

/// `GET /api/e/{entite}/{id}` : une fiche, avec son étiquette.
pub async fn lire(
    State(etat): State<Arc<Etat>>,
    Path((nom, id)): Path<(String, i64)>,
) -> Result<Response, Erreur> {
    let e = entite(&nom)?;
    let sql = format!(
        "select row_to_json(x)::text from (select t.*, {etiq} as _etiquette from {table} t where t.id = $1) x",
        etiq = e.etiquette,
        table = e.table,
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
