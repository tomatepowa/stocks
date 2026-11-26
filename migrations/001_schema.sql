-- Schéma complet de la base « stocks » : structure des établissements, référentiels d'articles,
-- fournisseurs et centrales, stock et mouvements, journal d'audit.
-- Les évolutions ultérieures s'ajoutent en migrations numérotées à partir de 002.

-- ================================================================ Journal d'audit
-- Chaque écriture sur les fichiers de base y laisse une ligne ; le journal ne se modifie pas.

create table journal (
    id          bigserial primary key,
    le          timestamptz not null default now(),
    utilisateur text not null default coalesce(nullif(current_setting('stocks.utilisateur', true), ''), 'système'),
    table_nom   text not null,
    ligne_id    bigint,
    operation   text not null,
    avant       jsonb,
    apres       jsonb
);
create index journal_ligne on journal (table_nom, ligne_id);

create function journaliser() returns trigger language plpgsql as $$
begin
    if tg_op = 'DELETE' then
        insert into journal (table_nom, ligne_id, operation, avant)
        values (tg_table_name, old.id, 'suppression', to_jsonb(old));
        return old;
    elsif tg_op = 'UPDATE' then
        if to_jsonb(old) is distinct from to_jsonb(new) then
            insert into journal (table_nom, ligne_id, operation, avant, apres)
            values (tg_table_name, new.id, 'modification', to_jsonb(old), to_jsonb(new));
        end if;
        return new;
    else
        insert into journal (table_nom, ligne_id, operation, apres)
        values (tg_table_name, new.id, 'création', to_jsonb(new));
        return new;
    end if;
end $$;
create function journal_immuable() returns trigger language plpgsql as $$
begin
    raise exception 'Le journal d''audit ne peut être ni modifié ni effacé';
end $$;
create trigger journal_immuable before update or delete on journal
    for each row execute function journal_immuable();
create trigger journal_immuable_truncate before truncate on journal
    for each statement execute function journal_immuable();

-- ================================================================ Structure

-- Société qui porte un ou plusieurs établissements, et sa comptabilité (export vers Sage).
create table entite_juridique (
    id                   bigserial primary key,
    code                 text not null unique,
    raison_sociale       text not null,
    finess_ej            text check (finess_ej ~ '^[0-9AB]{9}$'),
    siren                text check (siren ~ '^[0-9]{9}$'),
    code_societe_compta  text,
    actif                boolean not null default true
);

-- PUI : propre à un établissement, ou centrale (plusieurs établissements rattachés à la même PUI).
-- Siège : l'établissement titulaire de l'autorisation, où la PUI est implantée.
-- Cadre : PUI de l'établissement, multi-sites (même entité juridique), convention ou GCS.
create table pui (
    id                      bigserial primary key,
    code                    text not null unique,
    libelle                 text not null,
    pharmacien_gerant       text,
    etablissement_siege_id  bigint,  -- clé étrangère ajoutée après la table etablissement
    cadre                   text not null default 'propre'
                            check (cadre in ('propre', 'multi_sites', 'convention', 'gcs')),
    actif                   boolean not null default true
);

-- Établissement géographique (FINESS ET).
create table etablissement (
    id                   bigserial primary key,
    entite_juridique_id  bigint not null references entite_juridique,
    code                 text not null unique,
    raison_sociale       text not null,
    nom_usuel            text,
    siret                text check (siret ~ '^[0-9]{14}$'),
    finess_geographique  text check (finess_geographique ~ '^[0-9AB]{9}$'),
    finess_pmsi          text check (finess_pmsi ~ '^[0-9AB]{9}$'),
    secteur_financement  text not null default 'ex_oqn' check (secteur_financement in ('ex_oqn', 'ex_dg')),
    adresse              text,
    code_postal          text,
    commune              text,
    pui_id               bigint references pui,
    actif                boolean not null default true
);
alter table pui add foreign key (etablissement_siege_id) references etablissement;

-- Regroupement facultatif de services (beaucoup de cliniques n'en ont pas).
create table pole (
    id               bigserial primary key,
    etablissement_id bigint not null references etablissement,
    code             text not null,
    libelle          text not null,
    actif            boolean not null default true,
    unique (etablissement_id, code)
);

create table service (
    id               bigserial primary key,
    etablissement_id bigint not null references etablissement,
    pole_id          bigint references pole,
    code             text not null,
    libelle          text not null,
    type             text not null default 'soins'
                     check (type in ('soins', 'medico_technique', 'logistique', 'administratif')),
    actif            boolean not null default true,
    unique (etablissement_id, code)
);

-- Unité fonctionnelle : maille des consommations, de l'activité PMSI et de l'analytique.
create table uf (
    id               bigserial primary key,
    etablissement_id bigint not null references etablissement,
    service_id       bigint not null references service,
    code             text not null,
    libelle          text not null,
    activite         text not null check (activite in ('MCO', 'SMR', 'HAD', 'PSY', 'autre')),
    code_um          text,
    centre_cout      text,
    date_debut       date,
    date_fin         date,
    actif            boolean not null default true,
    unique (etablissement_id, code),
    check (date_fin is null or date_debut is null or date_fin >= date_debut)
);

-- Magasin : lieu de stock. Magasin de PUI : PUI obligatoire ; armoire de service : PUI qui
-- l'approvisionne ; économat : aucune PUI. Rôle selon le type ; magasin d'approvisionnement : de la
-- même PUI (même d'un autre site), ou l'économat de l'établissement.
create table magasin (
    id                 bigserial primary key,
    etablissement_id   bigint not null references etablissement,
    code               text not null,
    libelle            text not null,
    type               text not null check (type in ('pui', 'economat', 'service')),
    role               text not null,
    uf_id              bigint references uf,
    pui_id             bigint references pui,
    magasin_source_id  bigint references magasin,
    actif              boolean not null default true,
    unique (etablissement_id, code),
    constraint magasin_pui_economat check (type <> 'economat' or pui_id is null),
    constraint magasin_pui_obligatoire check (type <> 'pui' or pui_id is not null),
    constraint magasin_role check (
        (type = 'pui' and role in ('reserve', 'depot', 'coffre_stupefiants', 'froid', 'dmi'))
        or (type = 'service' and role in ('armoire', 'arsenal', 'depot_antenne'))
        or (type = 'economat' and role in ('reserve', 'depot'))
    ),
    constraint magasin_source_soi check (magasin_source_id is distinct from id)
);

create table emplacement (
    id         bigserial primary key,
    magasin_id bigint not null references magasin,
    code       text not null,
    libelle    text,
    actif      boolean not null default true,
    unique (magasin_id, code)
);

-- ================================================================ Référentiels d'articles

-- Un référentiel est partagé par plusieurs établissements ou propre à un seul. Abrégé : libellé court
-- affiché à côté des articles (l'appartenance se lit dans le libellé, pas dans le code). PUI
-- gestionnaire : celle qui valide les mises à jour (listes officielles, centrales).
create table referentiel (
    id                   bigserial primary key,
    code                 text not null unique,
    libelle              text not null,
    abrege               text,
    pui_gestionnaire_id  bigint references pui,
    actif                boolean not null default true
);

-- Référentiels utilisés par un établissement, par nature d'article (ex. : médicaments du groupe,
-- DM communs aux MCO plus un référentiel de DM local, DMI propres, économat commun).
create table etablissement_referentiel (
    id               bigserial primary key,
    etablissement_id bigint not null references etablissement,
    nature           text not null check (nature in ('medicament', 'dm', 'dmi', 'economat')),
    referentiel_id   bigint not null references referentiel,
    constraint etablissement_referentiel_unique unique (etablissement_id, nature, referentiel_id)
);

-- Famille sans référentiel : commune à tous les référentiels du groupe (nomenclature consolidable).
create table famille (
    id               bigserial primary key,
    referentiel_id   bigint references referentiel,
    code             text not null,
    libelle          text not null,
    nature           text not null check (nature in ('medicament', 'dm', 'dmi', 'economat')),
    compte_comptable text,
    actif            boolean not null default true,
    unique (referentiel_id, code)
);
create unique index famille_code_commune on famille (code) where referentiel_id is null;

-- Réglage de traçabilité d'un champ (lot, n° de série, péremption), en entrée ou en sortie.
create domain tracabilite as text check (value in ('obligatoire', 'facultatif', 'sans_objet'));

create table article (
    id                      bigserial primary key,
    referentiel_id          bigint not null references referentiel,
    code                    text not null,
    designation             text not null,
    nature                  text not null check (nature in ('medicament', 'dm', 'dmi', 'economat')),
    famille_id              bigint references famille,
    laboratoire_titulaire   text,
    conditionnement         text,
    -- Médicament
    dci                     text,
    dosage                  text,
    forme                   text,
    voie_administration     text,
    code_atc                text check (code_atc ~ '^[A-Z]([0-9]{2}([A-Z]([A-Z]([0-9]{2})?)?)?)?$'),
    au_livret               boolean not null default true,
    prescription_restreinte text not null default 'aucune'
        check (prescription_restreinte in ('aucune', 'reserve_hospitaliere', 'prescription_initiale_hospitaliere',
                                           'prescription_reservee_specialistes', 'surveillance_particuliere')),
    -- Dispositif médical
    classe_dm               text check (classe_dm in ('I', 'Is', 'Im', 'IIa', 'IIb', 'III')),
    sterile                 boolean not null default false,
    usage_unique            boolean not null default false,
    -- Codes
    ucd13                   text check (ucd13 ~ '^[0-9]{13}$'),
    ucd7                    text check (ucd7 ~ '^[0-9]{7}$'),
    cip13                   text check (cip13 ~ '^[0-9]{13}$'),
    lpp                     text check (lpp ~ '^[0-9]{7}$'),
    gtin                    text check (gtin ~ '^[0-9]{8,14}$'),
    -- Sécurité et conservation
    liste                   text not null default 'aucune'
                            check (liste in ('aucune', 'liste_I', 'liste_II', 'stupefiant', 'assimile_stupefiant')),
    a_risque                boolean not null default false,
    derive_sang             boolean not null default false,
    cytotoxique             boolean not null default false,
    conservation            text not null default 'ambiante' check (conservation in ('ambiante', 'refrigere', 'congele')),
    photosensible           boolean not null default false,
    -- Unités
    unite_achat             text,
    unite_stock             text not null default 'unité',
    unite_delivrance        text,
    coef_achat_stock        numeric(12, 4) not null default 1 check (coef_achat_stock > 0),
    coef_stock_delivrance   numeric(12, 4) not null default 1 check (coef_stock_delivrance > 0),
    -- Traçabilité
    lot_entree              tracabilite not null default 'sans_objet',
    lot_sortie              tracabilite not null default 'sans_objet',
    serie_entree            tracabilite not null default 'sans_objet',
    serie_sortie            tracabilite not null default 'sans_objet',
    peremption_entree       tracabilite not null default 'sans_objet',
    peremption_sortie       tracabilite not null default 'sans_objet',
    -- Comptabilité
    compte_comptable        text,
    observations            text,
    actif                   boolean not null default true,
    unique (referentiel_id, code),
    -- DMI : traçabilité obligatoire de bout en bout, par lot ou par n° de série.
    constraint dmi_tracabilite check (
        nature <> 'dmi'
        or ((lot_entree = 'obligatoire' or serie_entree = 'obligatoire')
            and (lot_sortie = 'obligatoire' or serie_sortie = 'obligatoire'))
    ),
    -- Seuls les médicaments relèvent des listes I, II et des stupéfiants.
    constraint liste_medicament check (liste = 'aucune' or nature = 'medicament'),
    -- Médicament dérivé du sang : médicament, traçabilité du lot obligatoire jusqu'au patient.
    constraint mds_tracabilite check (
        not derive_sang or (nature = 'medicament' and lot_entree = 'obligatoire' and lot_sortie = 'obligatoire')
    ),
    constraint classe_dm_nature check (classe_dm is null or nature in ('dm', 'dmi'))
);

-- Article référencé dans un établissement : code local et traçabilité propre au site (vide : celle
-- de l'article). La dotation se règle par magasin (article_magasin).
create table article_site (
    id                bigserial primary key,
    article_id        bigint not null references article,
    etablissement_id  bigint not null references etablissement,
    code_local        text,
    lot_entree        tracabilite,
    lot_sortie        tracabilite,
    serie_entree      tracabilite,
    serie_sortie      tracabilite,
    peremption_entree tracabilite,
    peremption_sortie tracabilite,
    actif             boolean not null default true,
    unique (article_id, etablissement_id)
);

-- Médicaments à risque propres à un service (en plus de la liste globale de la PUI : article.a_risque).
create table risque_service (
    id         bigserial primary key,
    article_id bigint not null references article,
    service_id bigint not null references service,
    motif      text,
    unique (article_id, service_id)
);

-- ================================================================ Fournisseurs et sources externes

create table fournisseur (
    id             bigserial primary key,
    code           text not null unique,
    raison_sociale text not null,
    type           text not null default 'fournisseur'
                   check (type in ('fournisseur', 'laboratoire', 'grossiste', 'centrale')),
    siret          text check (siret ~ '^[0-9]{14}$'),
    adresse        text,
    code_postal    text,
    commune        text,
    telephone      text,
    email          text,
    actif          boolean not null default true
);

-- Prix et références d'un fournisseur pour un article ; sans établissement, vaut pour tout le groupe.
-- Un seul principal (rang 1) par article et par portée ; en désigner un autre fait passer l'ancien au rang 2.
create table article_fournisseur (
    id                     bigserial primary key,
    article_id             bigint not null references article,
    fournisseur_id         bigint not null references fournisseur,
    etablissement_id       bigint references etablissement,
    reference_fournisseur  text,
    rang                   integer not null default 1 check (rang >= 1),
    quantite_par_colis     numeric(12, 3) check (quantite_par_colis > 0),
    prix_unitaire_ht       numeric(12, 4) check (prix_unitaire_ht >= 0),
    taux_tva               numeric(5, 2) check (taux_tva >= 0),
    date_debut             date,
    date_fin               date,
    actif                  boolean not null default true,
    check (date_fin is null or date_debut is null or date_fin >= date_debut)
);
create index article_fournisseur_article on article_fournisseur (article_id);
create unique index article_fournisseur_principal on article_fournisseur
    (article_id, coalesce(etablissement_id, 0)) where rang = 1 and actif;

-- Sources externes (centrales…) : un article y est lié par le code article de la source ; la fiche
-- produit vient d'un catalogue importé ; chaque champ repris garde sa provenance.
create table source_externe (
    id              bigserial primary key,
    code            text not null unique,
    libelle         text not null,
    type            text not null default 'centrale'
                    check (type in ('centrale', 'referentiel_officiel', 'fournisseur', 'autre')),
    fournisseur_id  bigint references fournisseur,
    actif           boolean not null default true
);

create table article_code_externe (
    id            bigserial primary key,
    article_id    bigint not null references article,
    source_id     bigint not null references source_externe,
    code_externe  text not null,
    unique (article_id, source_id),
    unique (source_id, code_externe)
);

-- Fiche produit telle que publiée par la source. `donnees` : valeurs rangées sous les noms des
-- champs de l'article (choisis à l'import) ; `brut` : la ligne du fichier telle quelle.
create table catalogue_produit (
    id            bigserial primary key,
    source_id     bigint not null references source_externe,
    code_externe  text not null,
    designation   text,
    donnees       jsonb not null default '{}',
    brut          jsonb,
    importe_le    timestamptz not null default now(),
    unique (source_id, code_externe)
);
create index catalogue_produit_designation on catalogue_produit (source_id, lower(designation));

-- Trace des imports (le catalogue lui-même n'est pas journalisé ligne à ligne).
create table import_catalogue (
    id           bigserial primary key,
    source_id    bigint not null references source_externe,
    fichier      text,
    lignes       integer not null,
    le           timestamptz not null default now(),
    utilisateur  text not null default coalesce(nullif(current_setting('stocks.utilisateur', true), ''), 'système')
);

-- Dernière reprise de chaque champ d'un article.
create table article_provenance (
    article_id    bigint not null references article,
    champ         text not null,
    source_id     bigint not null references source_externe,
    code_externe  text not null,
    valeur        jsonb,
    le            timestamptz not null default now(),
    utilisateur   text not null default coalesce(nullif(current_setting('stocks.utilisateur', true), ''), 'système'),
    primary key (article_id, champ)
);

-- ================================================================ Stock

-- Article dans un magasin : dotation et adresse habituelle de prélèvement.
create table article_magasin (
    id                        bigserial primary key,
    magasin_id                bigint not null references magasin,
    article_id                bigint not null references article,
    emplacement_principal_id  bigint references emplacement,
    stock_mini                numeric(12, 3) check (stock_mini >= 0),
    stock_maxi                numeric(12, 3) check (stock_maxi >= 0),
    point_commande            numeric(12, 3) check (point_commande >= 0),
    actif                     boolean not null default true,
    unique (magasin_id, article_id),
    check (stock_maxi is null or stock_mini is null or stock_maxi >= stock_mini)
);

-- Une ligne par magasin, emplacement (facultatif), article, lot, n° de série et péremption.
-- Écrit uniquement par les mouvements.
create table stock (
    id              bigserial primary key,
    magasin_id      bigint not null references magasin,
    emplacement_id  bigint references emplacement,
    article_id      bigint not null references article,
    lot             text,
    numero_serie    text,
    peremption      date,
    quantite        numeric(14, 3) not null check (quantite >= 0),
    maj_le          timestamptz not null default now()
);
create unique index stock_ligne on stock (magasin_id, coalesce(emplacement_id, 0), article_id,
    coalesce(lot, ''), coalesce(numero_serie, ''), coalesce(peremption, 'infinity'));
create index stock_article on stock (article_id, magasin_id);

-- PUMP par établissement.
create table valorisation (
    id                bigserial primary key,
    etablissement_id  bigint not null references etablissement,
    article_id        bigint not null references article,
    pump              numeric(14, 4) not null default 0,
    maj_le            timestamptz not null default now(),
    unique (etablissement_id, article_id)
);

-- Mouvements : seuls à faire varier le stock ; ne se modifient pas (correction par mouvement inverse).
create table mouvement (
    id                          bigserial primary key,
    le                          timestamptz not null default now(),
    utilisateur                 text not null default coalesce(nullif(current_setting('stocks.utilisateur', true), ''), 'système'),
    type                        text not null check (type in (
                                    'reception', 'transfert', 'deplacement', 'sortie', 'retour_service',
                                    'retour_fournisseur', 'destruction', 'inventaire_plus', 'inventaire_moins')),
    article_id                  bigint not null references article,
    quantite                    numeric(14, 3) not null check (quantite > 0),
    magasin_source_id           bigint references magasin,
    emplacement_source_id       bigint references emplacement,
    magasin_destination_id      bigint references magasin,
    emplacement_destination_id  bigint references emplacement,
    lot                         text,
    numero_serie                text,
    peremption                  date,
    fournisseur_id              bigint references fournisseur,
    prix_unitaire               numeric(14, 4) check (prix_unitaire >= 0),
    uf_id                       bigint references uf,
    sejour                      text,
    prescripteur                text,
    motif                       text,
    document                    text,
    valeur_unitaire             numeric(14, 4)
);
create index mouvement_article on mouvement (article_id, le);
create index mouvement_source on mouvement (magasin_source_id, le);
create index mouvement_destination on mouvement (magasin_destination_id, le);

-- ================================================================ Compteurs de codes
-- À la création, le code vient toujours d'un compteur ; ensuite il ne change plus. Compteur le plus
-- précis : établissement, puis variante (nature ou type), puis compteur général du fichier.

create table compteur (
    id                bigserial primary key,
    entite            text not null,
    variante          text not null default '',
    prefixe           text not null default '',
    longueur          integer not null default 6 check (longueur between 1 and 12),
    prochain          bigint not null default 1 check (prochain >= 1),
    actif             boolean not null default true,
    etablissement_id  bigint references etablissement
);
create unique index compteur_portee on compteur (entite, variante, coalesce(etablissement_id, 0));


-- ================================================================ Règles

-- Vrai si l'établissement utilise, pour la nature de l'article, le référentiel de l'article.
create function article_utilisable(p_article bigint, p_etablissement bigint) returns boolean
language sql stable as $$
    select exists (select 1 from article a
                   join etablissement_referentiel er
                     on er.referentiel_id = a.referentiel_id and er.nature = a.nature
                   where a.id = p_article and er.etablissement_id = p_etablissement)
$$;
-- Réglage de traçabilité effectif d'un article dans un établissement (article-site, sinon article).
create function tracabilite_effective(p_article bigint, p_etab bigint, p_champ text) returns text
language sql stable as $$
    select coalesce(to_jsonb(s) ->> p_champ, to_jsonb(a) ->> p_champ)
      from article a
      left join article_site s on s.article_id = a.id and s.etablissement_id = p_etab
     where a.id = p_article
$$;
-- Vrai si ce magasin peut recevoir cet article d'un fournisseur : en tête de chaîne, du bon type,
-- un coffre pour un stupéfiant (sert aussi à filtrer la saisie).
create function magasin_peut_recevoir(p_magasin bigint, p_article bigint) returns boolean
language sql stable as $$
    select m.magasin_source_id is null
       and m.actif
       and m.type = case when a.nature = 'economat' then 'economat' else 'pui' end
       and (a.liste not in ('stupefiant', 'assimile_stupefiant') or m.role = 'coffre_stupefiants')
       and article_utilisable(a.id, m.etablissement_id)
      from magasin m, article a
     where m.id = p_magasin and a.id = p_article
$$;
-- Code attribué par le compteur à la création, jamais modifié ensuite.
create function attribuer_code() returns trigger language plpgsql as $$
declare
    ligne   jsonb := to_jsonb(new);
    v       text := coalesce(ligne ->> 'nature', ligne ->> 'type', '');
    etab    bigint := (ligne ->> 'etablissement_id')::bigint;
    cpt     compteur%rowtype;
    numero  bigint;
    essai   text;
    pris    boolean;
begin
    if tg_op = 'UPDATE' then
        if new.code is distinct from old.code then
            raise exception 'Le code d''une fiche ne se modifie pas';
        end if;
        return new;
    end if;
    for i in 1 .. 2 loop
        select * into cpt from compteur
         where entite = tg_table_name and actif and variante in (v, '')
           and (etablissement_id is null or etablissement_id = etab)
         order by (etablissement_id is not null) desc, (variante <> '') desc
         limit 1
         for update;
        exit when found;
        -- Aucun compteur : on crée le compteur général du fichier (préfixe modifiable ensuite).
        insert into compteur (entite, variante, prefixe, longueur)
        values (tg_table_name, '', upper(left(regexp_replace(tg_table_name, '[^a-z]', '', 'g'), 3)), 5)
        on conflict do nothing;
        -- Le compteur général existait mais inactif : on le réactive plutôt que de bloquer la création.
        update compteur set actif = true
         where entite = tg_table_name and variante = '' and etablissement_id is null;
    end loop;
    loop
        update compteur set prochain = prochain + 1 where id = cpt.id returning prochain - 1 into numero;
        essai := cpt.prefixe || lpad(numero::text, cpt.longueur, '0');
        execute format('select exists (select 1 from %I where code = $1)', tg_table_name) into pris using essai;
        exit when not pris;
    end loop;
    new.code := essai;
    return new;
end $$;
-- Désigner un nouveau fournisseur principal fait passer l'ancien au rang 2.
create function retrograder_principal() returns trigger language plpgsql as $$
begin
    if new.rang = 1 and new.actif then
        update article_fournisseur set rang = 2
         where article_id = new.article_id
           and coalesce(etablissement_id, 0) = coalesce(new.etablissement_id, 0)
           and rang = 1 and actif and id <> new.id;
    end if;
    return new;
end $$;
-- Cohérence entre tables (PL/pgSQL évalue toute la condition : un champ propre à une table n'est lu
-- que dans sa branche).
create function verifier_coherence() returns trigger language plpgsql as $$
declare
    src magasin%rowtype;
begin
    if tg_table_name = 'service' then
        if new.pole_id is not null
           and not exists (select 1 from pole where id = new.pole_id and etablissement_id = new.etablissement_id) then
            raise exception 'Le pôle choisi appartient à un autre établissement que le service';
        end if;
    elsif tg_table_name = 'uf' then
        if not exists (select 1 from service where id = new.service_id and etablissement_id = new.etablissement_id) then
            raise exception 'Le service choisi appartient à un autre établissement que l''UF';
        end if;
    elsif tg_table_name = 'risque_service' then
        if not article_utilisable(new.article_id, (select etablissement_id from service where id = new.service_id)) then
            raise exception 'L''établissement de ce service n''utilise pas le référentiel de cet article';
        end if;
    elsif tg_table_name = 'pui' then
        if new.etablissement_siege_id is not null
           and not exists (select 1 from etablissement where id = new.etablissement_siege_id and pui_id = new.id) then
            raise exception 'Le siège doit être un établissement desservi par cette PUI';
        end if;
    elsif tg_table_name = 'magasin' then
        if new.uf_id is not null
           and not exists (select 1 from uf where id = new.uf_id and etablissement_id = new.etablissement_id) then
            raise exception 'L''UF choisie appartient à un autre établissement que le magasin';
        end if;
        if new.type = 'economat' then
            new.pui_id := null;
        elsif new.pui_id is null then
            new.pui_id := (select pui_id from etablissement where id = new.etablissement_id);
        elsif new.pui_id is distinct from (select pui_id from etablissement where id = new.etablissement_id) then
            raise exception 'Cette PUI ne dessert pas l''établissement du magasin';
        end if;
        if new.type = 'pui' and new.pui_id is null then
            raise exception 'L''établissement du magasin n''a pas de PUI : rattachez-le d''abord à une PUI';
        end if;
        if new.role is null then
            new.role := case new.type when 'service' then 'armoire' else 'reserve' end;
        end if;
        -- Magasin d'approvisionnement : un magasin de la même PUI (circuit pharmaceutique, y compris
        -- d'un site à l'autre avec une PUI centrale), ou de l'économat du même établissement.
        if new.magasin_source_id is not null then
            select * into src from magasin where id = new.magasin_source_id;
            if src.magasin_source_id = new.id then
                raise exception 'Deux magasins ne peuvent pas s''approvisionner l''un l''autre';
            end if;
            if src.type = 'service' then
                raise exception 'Une armoire de service n''approvisionne pas d''autre magasin';
            end if;
            if src.type = 'pui' and src.pui_id is distinct from new.pui_id then
                raise exception 'Le magasin d''approvisionnement dépend d''une autre PUI';
            end if;
            if src.type = 'economat' and (src.etablissement_id <> new.etablissement_id or new.type = 'pui') then
                raise exception 'Un magasin d''économat n''approvisionne que les magasins de son établissement (hors PUI)';
            end if;
        end if;
    elsif tg_table_name = 'article' then
        if new.famille_id is not null then
            if not exists (select 1 from famille where id = new.famille_id
                           and (referentiel_id is null or referentiel_id = new.referentiel_id)) then
                raise exception 'La famille choisie appartient à un autre référentiel que l''article';
            end if;
            if not exists (select 1 from famille where id = new.famille_id and nature = new.nature) then
                raise exception 'La famille choisie n''est pas de la même nature que l''article';
            end if;
        end if;
    elsif tg_table_name = 'article_site' then
        if not article_utilisable(new.article_id, new.etablissement_id) then
            raise exception 'Cet établissement n''utilise pas le référentiel de cet article pour sa nature';
        end if;
    end if;
    return new;
end $$;
create function verifier_article_magasin() returns trigger language plpgsql as $$
begin
    if not article_utilisable(new.article_id, (select etablissement_id from magasin where id = new.magasin_id)) then
        raise exception 'L''établissement de ce magasin n''utilise pas cet article';
    end if;
    if new.emplacement_principal_id is not null
       and not exists (select 1 from emplacement where id = new.emplacement_principal_id and magasin_id = new.magasin_id) then
        raise exception 'L''emplacement principal n''appartient pas à ce magasin';
    end if;
    return new;
end $$;
-- Le stock ne s'écrit que par les mouvements.
create function stock_par_mouvement() returns trigger language plpgsql as $$
begin
    if coalesce(current_setting('stocks.mouvement', true), '') <> 'oui' then
        raise exception 'Le stock ne se modifie que par des mouvements';
    end if;
    return coalesce(new, old);
end $$;
-- Contrôles d'un mouvement, valorisation (PUMP) et mise à jour du stock.
create function appliquer_mouvement() returns trigger language plpgsql as $$
declare
    src_etab   bigint;
    dst_etab   bigint;
    art        article%rowtype;
    dispo      numeric;
    pump_src   numeric;
    pump_dst   numeric;
    qte_dst    numeric;
    entree     boolean;
    sortie     boolean;
    dst        magasin%rowtype;
begin
    sortie := new.type in ('transfert', 'deplacement', 'sortie', 'retour_fournisseur', 'destruction', 'inventaire_moins');
    entree := new.type in ('reception', 'transfert', 'deplacement', 'retour_service', 'inventaire_plus');
    select * into art from article where id = new.article_id;

    -- Champs attendus selon le type.
    if sortie and new.magasin_source_id is null then raise exception 'Magasin de départ obligatoire pour ce mouvement'; end if;
    if entree and new.magasin_destination_id is null then raise exception 'Magasin d''arrivée obligatoire pour ce mouvement'; end if;
    if not sortie then new.magasin_source_id := null; new.emplacement_source_id := null; end if;
    if not entree then new.magasin_destination_id := null; new.emplacement_destination_id := null; end if;
    if new.type = 'reception' and (new.fournisseur_id is null or new.prix_unitaire is null) then
        raise exception 'Une réception indique le fournisseur et le prix unitaire';
    end if;
    if new.type = 'retour_fournisseur' and new.fournisseur_id is null then raise exception 'Fournisseur obligatoire pour un retour'; end if;
    if new.type in ('sortie', 'retour_service') and new.uf_id is null then raise exception 'UF obligatoire pour une sortie ou un retour de service'; end if;
    if new.type in ('destruction', 'inventaire_plus', 'inventaire_moins') and coalesce(btrim(new.motif), '') = '' then
        raise exception 'Motif obligatoire pour une destruction ou un écart d''inventaire';
    end if;
    if new.type = 'transfert' and new.magasin_source_id = new.magasin_destination_id then
        raise exception 'Un transfert change de magasin : pour changer d''emplacement, faites un déplacement';
    end if;
    if new.type = 'deplacement' and (new.magasin_source_id <> new.magasin_destination_id
        or new.emplacement_source_id is not distinct from new.emplacement_destination_id) then
        raise exception 'Un déplacement reste dans le même magasin et change d''emplacement';
    end if;
    -- Réception fournisseur : dans un magasin qui peut la recevoir (voir magasin_peut_recevoir).
    if new.type = 'reception' then
        select * into dst from magasin where id = new.magasin_destination_id;
        if dst.magasin_source_id is not null then
            raise exception 'Ce magasin est approvisionné par %, pas par un fournisseur : recevez en amont, puis transférez',
                (select code || ' – ' || libelle from magasin where id = dst.magasin_source_id);
        end if;
        if art.nature = 'economat' and dst.type <> 'economat' then
            raise exception 'Un article d''économat se reçoit dans un magasin d''économat';
        end if;
        if art.nature <> 'economat' and dst.type <> 'pui' then
            raise exception 'Un produit de santé se reçoit dans un magasin de PUI, pas dans une armoire de service ni à l''économat';
        end if;
        if art.liste in ('stupefiant', 'assimile_stupefiant') and dst.role <> 'coffre_stupefiants' then
            raise exception 'Un stupéfiant se reçoit dans un coffre des stupéfiants';
        end if;
    end if;
    -- Stupéfiants : sortie nominative, prescripteur connu.
    if new.type = 'sortie' and art.liste in ('stupefiant', 'assimile_stupefiant')
       and (coalesce(btrim(new.sejour), '') = '' or coalesce(btrim(new.prescripteur), '') = '') then
        raise exception 'Sortie de stupéfiant : séjour (ou IPP) et prescripteur obligatoires';
    end if;

    -- Magasins, emplacements, article utilisable.
    select etablissement_id into src_etab from magasin where id = new.magasin_source_id;
    select etablissement_id into dst_etab from magasin where id = new.magasin_destination_id;
    if new.emplacement_source_id is not null
       and not exists (select 1 from emplacement where id = new.emplacement_source_id and magasin_id = new.magasin_source_id) then
        raise exception 'L''emplacement de départ n''appartient pas au magasin de départ';
    end if;
    if new.emplacement_destination_id is not null
       and not exists (select 1 from emplacement where id = new.emplacement_destination_id and magasin_id = new.magasin_destination_id) then
        raise exception 'L''emplacement d''arrivée n''appartient pas au magasin d''arrivée';
    end if;
    if src_etab is not null and not article_utilisable(new.article_id, src_etab) then
        raise exception 'L''établissement du magasin de départ n''utilise pas cet article';
    end if;
    if dst_etab is not null and not article_utilisable(new.article_id, dst_etab) then
        raise exception 'L''établissement du magasin d''arrivée n''utilise pas cet article';
    end if;
    if new.uf_id is not null and not exists (select 1 from uf where id = new.uf_id
                                              and etablissement_id = coalesce(src_etab, dst_etab)) then
        raise exception 'L''UF appartient à un autre établissement que le magasin';
    end if;

    -- Traçabilité : à l'entrée (réception, inventaire, retour) et à la sortie, selon l'établissement.
    if new.type in ('reception', 'inventaire_plus', 'retour_service') then
        if tracabilite_effective(new.article_id, dst_etab, 'lot_entree') = 'obligatoire' and coalesce(btrim(new.lot), '') = '' then
            raise exception 'N° de lot obligatoire à l''entrée pour cet article'; end if;
        if tracabilite_effective(new.article_id, dst_etab, 'serie_entree') = 'obligatoire' and coalesce(btrim(new.numero_serie), '') = '' then
            raise exception 'N° de série obligatoire à l''entrée pour cet article'; end if;
        if tracabilite_effective(new.article_id, dst_etab, 'peremption_entree') = 'obligatoire' and new.peremption is null then
            raise exception 'Date de péremption obligatoire à l''entrée pour cet article'; end if;
    end if;
    if new.type in ('sortie', 'destruction', 'retour_fournisseur') then
        if tracabilite_effective(new.article_id, src_etab, 'lot_sortie') = 'obligatoire' and coalesce(btrim(new.lot), '') = '' then
            raise exception 'N° de lot obligatoire à la sortie pour cet article'; end if;
        if tracabilite_effective(new.article_id, src_etab, 'serie_sortie') = 'obligatoire' and coalesce(btrim(new.numero_serie), '') = '' then
            raise exception 'N° de série obligatoire à la sortie pour cet article'; end if;
    end if;

    -- Valorisation : prix de la réception, sinon PUMP de l'établissement qui sort (ou qui reçoit).
    select pump into pump_src from valorisation where etablissement_id = src_etab and article_id = new.article_id;
    new.valeur_unitaire := case when new.type = 'reception' then new.prix_unitaire
                                else coalesce(pump_src, (select pump from valorisation
                                                         where etablissement_id = dst_etab and article_id = new.article_id), 0) end;

    -- PUMP de l'établissement qui reçoit de l'extérieur (fournisseur, ou autre établissement : cession).
    if new.type = 'reception' or (new.type = 'transfert' and src_etab <> dst_etab) then
        select coalesce(sum(s.quantite), 0) into qte_dst from stock s join magasin m on m.id = s.magasin_id
         where m.etablissement_id = dst_etab and s.article_id = new.article_id;
        select pump into pump_dst from valorisation where etablissement_id = dst_etab and article_id = new.article_id;
        insert into valorisation (etablissement_id, article_id, pump)
        values (dst_etab, new.article_id,
                round((qte_dst * coalesce(pump_dst, 0) + new.quantite * new.valeur_unitaire) / (qte_dst + new.quantite), 4))
        on conflict (etablissement_id, article_id) do update set pump = excluded.pump, maj_le = now();
    end if;

    -- Mise à jour du stock : la ligne de départ doit exister et suffire.
    perform set_config('stocks.mouvement', 'oui', true);
    if sortie then
        select quantite into dispo from stock
         where magasin_id = new.magasin_source_id and coalesce(emplacement_id, 0) = coalesce(new.emplacement_source_id, 0)
           and article_id = new.article_id and coalesce(lot, '') = coalesce(new.lot, '')
           and coalesce(numero_serie, '') = coalesce(new.numero_serie, '')
           and coalesce(peremption, 'infinity') = coalesce(new.peremption, 'infinity')
         for update;
        if coalesce(dispo, 0) < new.quantite then
            raise exception 'Stock insuffisant pour ce lot à cet emplacement (disponible : %)', coalesce(dispo, 0);
        end if;
        update stock set quantite = quantite - new.quantite, maj_le = now()
         where magasin_id = new.magasin_source_id and coalesce(emplacement_id, 0) = coalesce(new.emplacement_source_id, 0)
           and article_id = new.article_id and coalesce(lot, '') = coalesce(new.lot, '')
           and coalesce(numero_serie, '') = coalesce(new.numero_serie, '')
           and coalesce(peremption, 'infinity') = coalesce(new.peremption, 'infinity');
        delete from stock where quantite = 0 and magasin_id = new.magasin_source_id and article_id = new.article_id;
    end if;
    if entree then
        insert into stock (magasin_id, emplacement_id, article_id, lot, numero_serie, peremption, quantite)
        values (new.magasin_destination_id, new.emplacement_destination_id, new.article_id,
                nullif(btrim(new.lot), ''), nullif(btrim(new.numero_serie), ''), new.peremption, new.quantite)
        on conflict (magasin_id, coalesce(emplacement_id, 0), article_id, coalesce(lot, ''), coalesce(numero_serie, ''),
                     coalesce(peremption, 'infinity'))
        do update set quantite = stock.quantite + excluded.quantite, maj_le = now();
    end if;
    perform set_config('stocks.mouvement', '', true);
    new.lot := nullif(btrim(new.lot), '');
    new.numero_serie := nullif(btrim(new.numero_serie), '');
    return new;
end $$;
create function mouvement_immuable() returns trigger language plpgsql as $$
begin
    raise exception 'Un mouvement ne se modifie pas et ne s''efface pas : saisissez un mouvement inverse';
end $$;

-- ================================================================ Déclencheurs

do $$
declare t text;
begin
    -- Code attribué à la création et figé ensuite.
    foreach t in array array['referentiel', 'pui', 'entite_juridique', 'etablissement', 'pole', 'service', 'uf',
                             'magasin', 'emplacement', 'famille', 'article', 'fournisseur', 'source_externe'] loop
        -- « a_ » : passe avant le contrôle de cohérence (les triggers BEFORE suivent l'ordre alphabétique).
        execute format('create trigger a_code before insert on %I
                        for each row execute function attribuer_code()', t);
        execute format('create trigger a_code_fige before update of code on %I
                        for each row execute function attribuer_code()', t);
    end loop;
    -- Cohérence entre tables.
    foreach t in array array['pui', 'service', 'uf', 'magasin', 'article', 'article_site', 'risque_service'] loop
        execute format('create trigger coherence before insert or update on %I
                        for each row execute function verifier_coherence()', t);
    end loop;
    -- Journal d'audit.
    foreach t in array array['referentiel', 'pui', 'entite_juridique', 'etablissement', 'etablissement_referentiel',
                             'pole', 'service', 'uf', 'magasin', 'emplacement', 'famille', 'article', 'article_site',
                             'risque_service', 'fournisseur', 'article_fournisseur', 'source_externe',
                             'article_code_externe', 'article_magasin', 'compteur'] loop
        execute format('create trigger journal after insert or update or delete on %I
                        for each row execute function journaliser()', t);
    end loop;
end $$;

create trigger a_principal before insert or update of rang, actif, article_id, etablissement_id on article_fournisseur
    for each row execute function retrograder_principal();
create trigger coherence before insert or update on article_magasin
    for each row execute function verifier_article_magasin();
create trigger stock_par_mouvement before insert or update or delete on stock
    for each row execute function stock_par_mouvement();
create trigger appliquer before insert on mouvement for each row execute function appliquer_mouvement();
create trigger mouvement_immuable before update or delete on mouvement
    for each row execute function mouvement_immuable();
create trigger mouvement_immuable_truncate before truncate on mouvement
    for each statement execute function mouvement_immuable();

-- ================================================================ Compteurs de départ
-- Un compteur par fichier codé ; préfixes, longueurs et variantes se changent dans Paramètres.
insert into compteur (entite, variante, prefixe, longueur) values
    ('referentiel', '', 'REF', 3),
    ('pui', '', 'PUI', 3),
    ('entite_juridique', '', 'EJ', 3),
    ('etablissement', '', 'ETB', 3),
    ('pole', '', 'POL', 3),
    ('service', '', 'SRV', 4),
    ('uf', '', 'UF', 4),
    ('magasin', '', 'MAG', 3),
    ('emplacement', '', 'EMP', 5),
    ('famille', '', 'FAM', 4),
    ('article', 'medicament', 'MED', 6),
    ('article', 'dm', 'DM', 6),
    ('article', 'dmi', 'DMI', 6),
    ('article', 'economat', 'ECO', 6),
    ('fournisseur', '', 'FRN', 5),
    ('source_externe', '', 'SRC', 3);
