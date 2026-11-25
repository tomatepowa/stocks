-- Référentiels externes : centrales d'achat et autres sources de fiches produit.
-- Un article est lié à chaque source par le code article de la source ; la fiche produit de la
-- source vient d'un catalogue importé (fichier à plat, plus tard API). L'utilisateur reprend dans
-- l'article les champs qu'il choisit, source par source ; chaque reprise garde sa provenance.

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

create trigger a_code before insert on source_externe
    for each row execute function attribuer_code();
insert into compteur (entite, variante, prefixe, longueur) values ('source_externe', '', 'SRC', 3);

create trigger journal after insert or update or delete on source_externe
    for each row execute function journaliser();
create trigger journal after insert or update or delete on article_code_externe
    for each row execute function journaliser();
