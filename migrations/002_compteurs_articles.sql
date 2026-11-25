-- Compteurs de codes, et caractéristiques détaillées des articles.

-- ---------------------------------------------------------------- Compteurs de codes
-- Un code laissé vide à la création est pris au compteur de la table. La variante choisit un
-- compteur selon la nature (articles) ou le type (magasins, fournisseurs…) de la fiche ; à défaut,
-- le compteur sans variante de la table. Les codes déjà pris (saisis à la main) sont sautés.

create table compteur (
    id        bigserial primary key,
    entite    text not null,
    variante  text not null default '',
    prefixe   text not null default '',
    longueur  integer not null default 6 check (longueur between 1 and 12),
    prochain  bigint not null default 1 check (prochain >= 1),
    actif     boolean not null default true,
    unique (entite, variante)
);

create function attribuer_code() returns trigger language plpgsql as $$
declare
    v       text := coalesce(to_jsonb(new) ->> 'nature', to_jsonb(new) ->> 'type', '');
    cpt     compteur%rowtype;
    numero  bigint;
    essai   text;
    pris    boolean;
begin
    if new.code is not null and btrim(new.code) <> '' then
        return new;
    end if;
    select * into cpt from compteur
     where entite = tg_table_name and variante in (v, '') and actif
     order by variante = '' limit 1
     for update;
    if not found then
        return new;  -- pas de compteur : la contrainte « code obligatoire » s'applique
    end if;
    loop
        update compteur set prochain = prochain + 1 where id = cpt.id returning prochain - 1 into numero;
        essai := cpt.prefixe || lpad(numero::text, cpt.longueur, '0');
        execute format('select exists (select 1 from %I where code = $1)', tg_table_name) into pris using essai;
        exit when not pris;
    end loop;
    new.code := essai;
    return new;
end $$;

do $$
declare t text;
begin
    foreach t in array array['referentiel', 'pui', 'entite_juridique', 'etablissement', 'pole', 'service', 'uf',
                             'magasin', 'emplacement', 'famille', 'article', 'fournisseur'] loop
        -- « a_ » : passe avant le contrôle de cohérence (les triggers BEFORE suivent l'ordre alphabétique).
        execute format('create trigger a_code before insert on %I
                        for each row execute function attribuer_code()', t);
    end loop;
end $$;

create trigger journal after insert or update or delete on compteur
    for each row execute function journaliser();

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
    ('fournisseur', '', 'FRN', 5);

-- ---------------------------------------------------------------- Articles : caractéristiques

alter table famille add column compte_comptable text;

alter table article
    add column laboratoire_titulaire  text,
    add column conditionnement        text,
    add column voie_administration    text,
    add column code_atc               text check (code_atc ~ '^[A-Z]([0-9]{2}([A-Z]([A-Z]([0-9]{2})?)?)?)?$'),
    add column au_livret              boolean not null default true,
    add column prescription_restreinte text not null default 'aucune'
        check (prescription_restreinte in ('aucune', 'reserve_hospitaliere', 'prescription_initiale_hospitaliere',
                                           'prescription_reservee_specialistes', 'surveillance_particuliere')),
    add column derive_sang            boolean not null default false,
    add column cytotoxique            boolean not null default false,
    add column conservation           text not null default 'ambiante'
        check (conservation in ('ambiante', 'refrigere', 'congele')),
    add column photosensible          boolean not null default false,
    add column classe_dm              text check (classe_dm in ('I', 'Is', 'Im', 'IIa', 'IIb', 'III')),
    add column sterile                boolean not null default false,
    add column usage_unique           boolean not null default false,
    add column compte_comptable       text,
    add column observations           text,
    -- Médicament dérivé du sang : médicament, traçabilité du lot obligatoire jusqu'au patient.
    add constraint mds_tracabilite check (
        not derive_sang
        or (nature = 'medicament' and lot_entree = 'obligatoire' and lot_sortie = 'obligatoire')
    ),
    add constraint classe_dm_nature check (classe_dm is null or nature in ('dm', 'dmi'));
