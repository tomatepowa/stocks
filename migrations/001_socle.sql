-- Socle : structure des établissements, référentiels articles et fournisseurs, journal d'audit.

-- ---------------------------------------------------------------- Journal d'audit
-- Chaque écriture sur les tables du socle y laisse une ligne ; le journal ne se modifie pas.

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

-- ---------------------------------------------------------------- Structure

-- Un référentiel articles est partagé par plusieurs établissements ou propre à un seul.
create table referentiel (
    id      bigserial primary key,
    code    text not null unique,
    libelle text not null,
    actif   boolean not null default true
);

-- Mode « une PUI par établissement » : une PUI par établissement.
-- Mode « PUI centrale » : plusieurs établissements rattachés à la même PUI.
create table pui (
    id                  bigserial primary key,
    code                text not null unique,
    libelle             text not null,
    pharmacien_gerant   text,
    actif               boolean not null default true
);

-- Société qui porte un ou plusieurs établissements, et sa comptabilité (export vers Sage).
create table entite_juridique (
    id              bigserial primary key,
    code            text not null unique,
    raison_sociale  text not null,
    finess_ej       text check (finess_ej ~ '^[0-9AB]{9}$'),
    siren           text check (siren ~ '^[0-9]{9}$'),
    code_societe_compta text,
    actif           boolean not null default true
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
    referentiel_id       bigint not null references referentiel,
    pui_id               bigint references pui,
    actif                boolean not null default true
);

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

create table magasin (
    id               bigserial primary key,
    etablissement_id bigint not null references etablissement,
    code             text not null,
    libelle          text not null,
    type             text not null check (type in ('pui', 'economat', 'service')),
    uf_id            bigint references uf,
    actif            boolean not null default true,
    unique (etablissement_id, code)
);

create table emplacement (
    id         bigserial primary key,
    magasin_id bigint not null references magasin,
    code       text not null,
    libelle    text,
    actif      boolean not null default true,
    unique (magasin_id, code)
);

-- ---------------------------------------------------------------- Référentiel articles

create table famille (
    id             bigserial primary key,
    referentiel_id bigint not null references referentiel,
    code           text not null,
    libelle        text not null,
    nature         text not null check (nature in ('medicament', 'dm', 'dmi', 'economat')),
    actif          boolean not null default true,
    unique (referentiel_id, code)
);

-- Réglage de traçabilité d'un champ (lot, n° de série, péremption), en entrée ou en sortie.
create domain tracabilite as text check (value in ('obligatoire', 'facultatif', 'sans_objet'));

create table article (
    id                     bigserial primary key,
    referentiel_id         bigint not null references referentiel,
    code                   text not null,
    designation            text not null,
    nature                 text not null check (nature in ('medicament', 'dm', 'dmi', 'economat')),
    famille_id             bigint references famille,
    dci                    text,
    dosage                 text,
    forme                  text,
    ucd13                  text check (ucd13 ~ '^[0-9]{13}$'),
    ucd7                   text check (ucd7 ~ '^[0-9]{7}$'),
    cip13                  text check (cip13 ~ '^[0-9]{13}$'),
    lpp                    text check (lpp ~ '^[0-9]{7}$'),
    gtin                   text check (gtin ~ '^[0-9]{8,14}$'),
    unite_achat            text,
    unite_stock            text not null default 'unité',
    unite_delivrance       text,
    coef_achat_stock       numeric(12, 4) not null default 1 check (coef_achat_stock > 0),
    coef_stock_delivrance  numeric(12, 4) not null default 1 check (coef_stock_delivrance > 0),
    liste                  text not null default 'aucune'
                           check (liste in ('aucune', 'liste_I', 'liste_II', 'stupefiant', 'assimile_stupefiant')),
    a_risque               boolean not null default false,
    lot_entree             tracabilite not null default 'sans_objet',
    lot_sortie             tracabilite not null default 'sans_objet',
    serie_entree           tracabilite not null default 'sans_objet',
    serie_sortie           tracabilite not null default 'sans_objet',
    peremption_entree      tracabilite not null default 'sans_objet',
    peremption_sortie      tracabilite not null default 'sans_objet',
    actif                  boolean not null default true,
    unique (referentiel_id, code),
    -- DMI : traçabilité obligatoire de bout en bout, par lot ou par n° de série.
    constraint dmi_tracabilite check (
        nature <> 'dmi'
        or ((lot_entree = 'obligatoire' or serie_entree = 'obligatoire')
            and (lot_sortie = 'obligatoire' or serie_sortie = 'obligatoire'))
    ),
    -- Seuls les médicaments relèvent des listes I, II et des stupéfiants.
    constraint liste_medicament check (liste = 'aucune' or nature = 'medicament')
);

-- Déclinaison locale d'un article ; un réglage de traçabilité vide reprend celui de l'article.
create table article_site (
    id                bigserial primary key,
    article_id        bigint not null references article,
    etablissement_id  bigint not null references etablissement,
    code_local        text,
    stock_mini        numeric(12, 3) check (stock_mini >= 0),
    stock_maxi        numeric(12, 3) check (stock_maxi >= 0),
    point_commande    numeric(12, 3) check (point_commande >= 0),
    lot_entree        tracabilite,
    lot_sortie        tracabilite,
    serie_entree      tracabilite,
    serie_sortie      tracabilite,
    peremption_entree tracabilite,
    peremption_sortie tracabilite,
    actif             boolean not null default true,
    unique (article_id, etablissement_id),
    check (stock_maxi is null or stock_mini is null or stock_maxi >= stock_mini)
);

-- Médicaments à risque propres à un service (en plus de la liste globale de la PUI : article.a_risque).
create table risque_service (
    id         bigserial primary key,
    article_id bigint not null references article,
    service_id bigint not null references service,
    motif      text,
    unique (article_id, service_id)
);

-- ---------------------------------------------------------------- Fournisseurs

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

-- ---------------------------------------------------------------- Cohérence entre tables

-- PL/pgSQL évalue toute la condition : un champ propre à une table n'est lu que dans sa branche.
create function verifier_coherence() returns trigger language plpgsql as $$
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
        if not exists (select 1 from service s join etablissement e on e.id = s.etablissement_id
                       join article a on a.referentiel_id = e.referentiel_id
                       where s.id = new.service_id and a.id = new.article_id) then
            raise exception 'L''article ne fait pas partie du référentiel de l''établissement de ce service';
        end if;
    elsif tg_table_name = 'magasin' then
        if new.uf_id is not null
           and not exists (select 1 from uf where id = new.uf_id and etablissement_id = new.etablissement_id) then
            raise exception 'L''UF choisie appartient à un autre établissement que le magasin';
        end if;
    elsif tg_table_name = 'article' then
        if new.famille_id is not null
           and not exists (select 1 from famille where id = new.famille_id and referentiel_id = new.referentiel_id) then
            raise exception 'La famille choisie appartient à un autre référentiel que l''article';
        end if;
    elsif tg_table_name = 'article_site' then
        if not exists (select 1 from article a join etablissement e on e.referentiel_id = a.referentiel_id
                       where a.id = new.article_id and e.id = new.etablissement_id) then
            raise exception 'L''article ne fait pas partie du référentiel de cet établissement';
        end if;
    end if;
    return new;
end $$;

do $$
declare t text;
begin
    foreach t in array array['service', 'uf', 'magasin', 'article', 'article_site', 'risque_service'] loop
        execute format('create trigger coherence before insert or update on %I
                        for each row execute function verifier_coherence()', t);
    end loop;
    foreach t in array array['referentiel', 'pui', 'entite_juridique', 'etablissement', 'pole', 'service', 'uf',
                             'magasin', 'emplacement', 'famille', 'article', 'article_site', 'risque_service',
                             'fournisseur', 'article_fournisseur'] loop
        execute format('create trigger journal after insert or update or delete on %I
                        for each row execute function journaliser()', t);
    end loop;
end $$;
