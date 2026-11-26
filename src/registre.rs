//! Registre des stupéfiants, déduit des mouvements (qui ne se modifient pas).
//!
//! Périmètre : les magasins de pharmacie d'une PUI, ou un magasin précis (armoire d'un service…).
//! Un mouvement qui entre dans le périmètre est une entrée, un mouvement qui en sort une sortie ;
//! un mouvement entre deux magasins du périmètre est « interne » (entrée et sortie, solde inchangé).

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::Response;

use crate::crud::{json_brut, Erreur};
use crate::Etat;

fn entier(params: &HashMap<String, String>, cle: &str) -> Option<i64> {
    params.get(cle).and_then(|v| v.trim().parse().ok())
}

/// `GET /api/registre?pui_id=…|magasin_id=…&du=AAAA-MM-JJ&au=AAAA-MM-JJ[&article_id=…]` :
/// en-tête du périmètre, balance par article, lignes de la période avec le solde après chaque mouvement.
pub async fn registre(
    State(etat): State<Arc<Etat>>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, Erreur> {
    let pui = entier(&params, "pui_id");
    let magasin = entier(&params, "magasin_id");
    if pui.is_none() && magasin.is_none() {
        return Err(Erreur(StatusCode::BAD_REQUEST, "Choisissez une PUI ou un magasin".into()));
    }
    let article = entier(&params, "article_id");
    let du = params.get("du").cloned().unwrap_or_default();
    let au = params.get("au").cloned().unwrap_or_default();
    if du.is_empty() || au.is_empty() {
        return Err(Erreur(StatusCode::BAD_REQUEST, "Indiquez la période (du, au)".into()));
    }
    let c = etat.pool.get().await?;
    let texte: String = c
        .query_one(
            "with perimetre as (
                select id from magasin
                 where ($1::bigint is not null and pui_id = $1 and type = 'pui')
                    or ($2::bigint is not null and id = $2)
            ),
            mvt as (
                select m.*, a.code as article_code, a.designation, a.unite_stock, a.liste,
                       (m.magasin_destination_id in (select id from perimetre)) as vers_perimetre,
                       (m.magasin_source_id in (select id from perimetre)) as depuis_perimetre
                  from mouvement m join article a on a.id = m.article_id
                 where a.liste in ('stupefiant', 'assimile_stupefiant')
                   and ($3::bigint is null or m.article_id = $3)
                   and (m.magasin_source_id in (select id from perimetre)
                        or m.magasin_destination_id in (select id from perimetre))
            ),
            calcul as (
                select mvt.*,
                       case when vers_perimetre then quantite else 0 end as entree,
                       case when depuis_perimetre then quantite else 0 end as sortie,
                       sum(case when vers_perimetre then quantite else 0 end
                           - case when depuis_perimetre then quantite else 0 end)
                           over (partition by article_id order by le, id) as solde_apres
                  from mvt
            ),
            periode as (
                select * from calcul where le >= $4::text::date and le < $5::text::date + 1
            ),
            articles as (
                select a.id, a.code, a.designation, a.unite_stock, a.liste,
                       coalesce((select sum(entree - sortie) from calcul c
                                  where c.article_id = a.id and c.le < $4::text::date), 0) as solde_initial,
                       coalesce((select sum(entree) from periode p where p.article_id = a.id), 0) as entrees,
                       coalesce((select sum(sortie) from periode p where p.article_id = a.id), 0) as sorties,
                       coalesce((select sum(entree - sortie) from calcul c
                                  where c.article_id = a.id and c.le < $5::text::date + 1), 0) as solde_final,
                       coalesce((select sum(s.quantite) from stock s
                                  where s.article_id = a.id and s.magasin_id in (select id from perimetre)), 0) as stock_physique
                  from article a
                 where a.id in (select article_id from calcul)
            )
            select json_build_object(
                'entete', (select json_build_object(
                        'perimetre', coalesce((select p.code || ' – ' || p.libelle from pui p where p.id = $1),
                                              (select 'Magasin ' || m.code || ' – ' || m.libelle from magasin m where m.id = $2)),
                        'pharmacien_gerant', (select p.pharmacien_gerant from pui p
                                               where p.id = coalesce($1, (select pui_id from magasin where id = $2))),
                        'etablissement', e.raison_sociale, 'adresse', e.adresse, 'code_postal', e.code_postal,
                        'commune', e.commune, 'finess', e.finess_geographique)
                    from etablissement e
                    where e.id = coalesce((select etablissement_siege_id from pui where id = $1),
                                          (select etablissement_id from magasin where id = $2))),
                'articles', (select coalesce(json_agg(articles order by code), '[]') from articles),
                'lignes', (select coalesce(json_agg(json_build_object(
                        'id', p.id, 'le', p.le, 'type', p.type, 'article_id', p.article_id,
                        'lot', p.lot, 'peremption', p.peremption, 'quantite', p.quantite,
                        'entree', p.entree, 'sortie', p.sortie, 'solde_apres', p.solde_apres,
                        'interne', p.vers_perimetre and p.depuis_perimetre,
                        'origine', (select code || ' – ' || libelle from magasin where id = p.magasin_source_id),
                        'destination', (select code || ' – ' || libelle from magasin where id = p.magasin_destination_id),
                        'fournisseur', (select raison_sociale from fournisseur where id = p.fournisseur_id),
                        'uf', (select code || ' – ' || libelle from uf where id = p.uf_id),
                        'sejour', p.sejour, 'prescripteur', p.prescripteur, 'motif', p.motif,
                        'document', p.document, 'utilisateur', p.utilisateur, 'hors_regle', p.hors_regle)
                        order by p.article_code, p.le, p.id), '[]') from periode p)
            )::text",
            &[&pui, &magasin, &article, &du, &au],
        )
        .await?
        .get(0);
    Ok(json_brut(texte, StatusCode::OK))
}
