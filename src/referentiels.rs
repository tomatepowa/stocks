//! Référentiels externes : comparer un article aux fiches des centrales, reprendre des champs,
//! chercher dans un catalogue, importer un catalogue.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use serde_json::{json, Map, Value};

use crate::crud::{json_brut, Erreur};
use crate::schema;
use crate::Etat;

fn champs_externes() -> Vec<&'static str> {
    schema::trouver("article").map(|e| e.champs.iter().filter(|c| c.externe).map(|c| c.col).collect()).unwrap_or_default()
}

fn requete(msg: &str) -> Erreur {
    Erreur(StatusCode::BAD_REQUEST, msg.to_string())
}

/// `GET /api/article/{id}/sources` : pour chaque source active, le code de l'article chez elle et
/// sa fiche du catalogue ; la provenance des champs déjà repris.
pub async fn sources(State(etat): State<Arc<Etat>>, Path(id): Path<i64>) -> Result<Response, Erreur> {
    let c = etat.pool.get().await?;
    let texte: String = c
        .query_one(
            "select json_build_object(
                'sources', (select coalesce(json_agg(json_build_object(
                        'source_id', s.id, 'source', s.libelle, 'type', s.type,
                        'lien_id', l.id, 'code_externe', l.code_externe,
                        'designation', p.designation, 'donnees', p.donnees, 'importe_le', p.importe_le)
                        order by s.libelle), '[]')
                    from source_externe s
                    left join article_code_externe l on l.source_id = s.id and l.article_id = $1
                    left join catalogue_produit p on p.source_id = s.id and p.code_externe = l.code_externe
                    where s.actif),
                'provenance', (select coalesce(json_object_agg(p.champ, json_build_object(
                        'source', s.libelle, 'code_externe', p.code_externe, 'le', p.le, 'utilisateur', p.utilisateur)), '{}')
                    from article_provenance p join source_externe s on s.id = p.source_id
                    where p.article_id = $1)
            )::text",
            &[&id],
        )
        .await?
        .get(0);
    Ok(json_brut(texte, StatusCode::OK))
}

/// `POST /api/article/{id}/reprendre` `{"choix": {"champ": source_id, …}}` : copie dans l'article
/// la valeur de chaque champ chez la source choisie, et note la provenance.
pub async fn reprendre(
    State(etat): State<Arc<Etat>>,
    Path(id): Path<i64>,
    Json(corps): Json<Value>,
) -> Result<Response, Erreur> {
    let externes = champs_externes();
    let choix = corps.get("choix").and_then(Value::as_object).ok_or_else(|| requete("« choix » attendu"))?;
    if choix.is_empty() {
        return Err(requete("Aucun champ choisi"));
    }
    let mut par_source: BTreeMap<i64, Vec<String>> = BTreeMap::new();
    for (champ, source) in choix {
        if !externes.contains(&champ.as_str()) {
            return Err(requete(&format!("Le champ « {champ} » ne se reprend pas d'une source")));
        }
        let source = source.as_i64().ok_or_else(|| requete("Source invalide"))?;
        par_source.entry(source).or_default().push(champ.clone());
    }

    let mut c = etat.pool.get().await?;
    let tx = c.transaction().await?;
    tx.execute("select set_config('stocks.utilisateur', $1, true)", &[&"poste local"]).await?;

    // Valeurs à reprendre, et provenance (source, code externe) de chacune.
    let mut valeurs = Map::new();
    let mut origine: Vec<(String, i64, String)> = Vec::new();
    for (source, champs) in &par_source {
        let ligne = tx
            .query_opt(
                "select l.code_externe, p.donnees::text from article_code_externe l
                 join catalogue_produit p on p.source_id = l.source_id and p.code_externe = l.code_externe
                 where l.article_id = $1 and l.source_id = $2",
                &[&id, source],
            )
            .await?
            .ok_or_else(|| requete("L'article n'est pas lié à cette source, ou sa fiche n'est pas au catalogue"))?;
        let code: String = ligne.get(0);
        let donnees: Value = serde_json::from_str(&ligne.get::<_, String>(1)).unwrap_or(Value::Null);
        for champ in champs {
            let v = donnees.get(champ).cloned().ok_or_else(|| requete(&format!("La source n'a pas de valeur pour « {champ} »")))?;
            valeurs.insert(champ.clone(), v);
            origine.push((champ.clone(), *source, code.clone()));
        }
    }

    let cols: Vec<&str> = valeurs.keys().map(|k| k.as_str()).collect();
    let sql = format!(
        "update article as t set ({cols}) = (select {rcols} from json_populate_record(null::article, $1::text::json) r)
         where t.id = $2 returning row_to_json(t)::text",
        cols = cols.join(", "),
        rcols = cols.iter().map(|c| format!("r.{c}")).collect::<Vec<_>>().join(", "),
    );
    let corps_maj = Value::Object(valeurs.clone()).to_string();
    let article: String = tx
        .query_opt(&sql, &[&corps_maj, &id])
        .await?
        .ok_or_else(|| Erreur(StatusCode::NOT_FOUND, "Article inconnu".into()))?
        .get(0);
    for (champ, source, code) in &origine {
        let valeur = valeurs[champ].to_string();
        tx.execute(
            "insert into article_provenance (article_id, champ, source_id, code_externe, valeur)
             values ($1, $2, $3, $4, $5::text::jsonb)
             on conflict (article_id, champ) do update set source_id = excluded.source_id,
                code_externe = excluded.code_externe, valeur = excluded.valeur, le = now(),
                utilisateur = excluded.utilisateur",
            &[&id, champ, source, code, &valeur],
        )
        .await?;
    }
    tx.commit().await?;
    Ok(json_brut(article, StatusCode::OK))
}

/// `GET /api/catalogue?source_id=…&q=…` : 20 fiches du catalogue d'une source dont le code, la
/// désignation ou un code produit (UCD, CIP, GTIN, LPP) correspond.
pub async fn rechercher(
    State(etat): State<Arc<Etat>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, Erreur> {
    let source: i64 = params.get("source_id").and_then(|s| s.parse().ok()).ok_or_else(|| requete("source_id attendu"))?;
    let q = params.get("q").map(|s| s.trim().to_string()).unwrap_or_default();
    if q.is_empty() {
        return Ok(json_brut("[]".into(), StatusCode::OK));
    }
    let c = etat.pool.get().await?;
    let texte: String = c
        .query_one(
            "select coalesce(json_agg(x), '[]')::text from (
                select code_externe, designation, donnees from catalogue_produit
                where source_id = $1 and (
                    code_externe ilike $2 || '%' or designation ilike '%' || $2 || '%'
                    or $2 in (donnees ->> 'ucd13', donnees ->> 'ucd7', donnees ->> 'cip13', donnees ->> 'gtin', donnees ->> 'lpp'))
                order by (code_externe = $2 or $2 in (donnees ->> 'ucd13', donnees ->> 'cip13', donnees ->> 'gtin', donnees ->> 'lpp')) desc,
                         designation
                limit 20) x",
            &[&source, &q],
        )
        .await?
        .get(0);
    Ok(json_brut(texte, StatusCode::OK))
}

/// `POST /api/catalogue/import` `{"source_id", "fichier", "lignes": [{code_externe, designation, donnees, brut}]}` :
/// ajoute ou remplace les fiches du catalogue de la source (par code article de la source).
pub async fn importer(State(etat): State<Arc<Etat>>, Json(corps): Json<Value>) -> Result<Response, Erreur> {
    let source = corps.get("source_id").and_then(Value::as_i64).ok_or_else(|| requete("source_id attendu"))?;
    let fichier = corps.get("fichier").and_then(Value::as_str).unwrap_or("").to_string();
    let lignes = corps.get("lignes").and_then(Value::as_array).ok_or_else(|| requete("« lignes » attendu"))?;
    let externes = champs_externes();
    // Seuls les champs d'article reprenables sont gardés dans `donnees`.
    let mut propres = Vec::with_capacity(lignes.len());
    for l in lignes {
        let code = l.get("code_externe").and_then(Value::as_str).map(str::trim).unwrap_or("");
        if code.is_empty() {
            continue;
        }
        let mut donnees = Map::new();
        if let Some(d) = l.get("donnees").and_then(Value::as_object) {
            for (k, v) in d {
                let vide = v.is_null() || v.as_str().is_some_and(|s| s.trim().is_empty());
                if externes.contains(&k.as_str()) && !vide {
                    donnees.insert(k.clone(), v.clone());
                }
            }
        }
        propres.push(json!({
            "code_externe": code,
            "designation": l.get("designation").cloned().unwrap_or(Value::Null),
            "donnees": donnees,
            "brut": l.get("brut").cloned().unwrap_or(Value::Null),
        }));
    }
    if propres.is_empty() {
        return Err(requete("Aucune ligne avec un code article de la source"));
    }
    let mut c = etat.pool.get().await?;
    let tx = c.transaction().await?;
    tx.execute("select set_config('stocks.utilisateur', $1, true)", &[&"poste local"]).await?;
    let lot = Value::Array(propres).to_string();
    let n = tx
        .execute(
            "insert into catalogue_produit (source_id, code_externe, designation, donnees, brut)
             select $1, r.code_externe, r.designation, coalesce(r.donnees, '{}'), r.brut
             from json_to_recordset($2::text::json) as r(code_externe text, designation text, donnees jsonb, brut jsonb)
             on conflict (source_id, code_externe) do update set designation = excluded.designation,
                donnees = excluded.donnees, brut = excluded.brut, importe_le = now()",
            &[&source, &lot],
        )
        .await?;
    tx.execute(
        "insert into import_catalogue (source_id, fichier, lignes) values ($1, $2, $3)",
        &[&source, &fichier, &(n as i32)],
    )
    .await?;
    tx.commit().await?;
    Ok(json_brut(json!({ "lignes": n }).to_string(), StatusCode::OK))
}

/// `GET /api/catalogue/imports` : derniers imports, avec la taille de chaque catalogue.
pub async fn imports(State(etat): State<Arc<Etat>>) -> Result<Response, Erreur> {
    let c = etat.pool.get().await?;
    let texte: String = c
        .query_one(
            "select coalesce(json_agg(x order by x.le desc), '[]')::text from (
                select i.id, s.libelle as source, i.fichier, i.lignes, i.le, i.utilisateur,
                       (select count(*) from catalogue_produit p where p.source_id = i.source_id) as catalogue
                from import_catalogue i join source_externe s on s.id = i.source_id
                order by i.le desc limit 50) x",
            &[],
        )
        .await?
        .get(0);
    Ok(json_brut(texte, StatusCode::OK))
}
