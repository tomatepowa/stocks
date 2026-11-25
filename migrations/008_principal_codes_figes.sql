-- Un seul fournisseur principal par article et par portée ; codes attribués par la base, jamais
-- saisis ni modifiés ; abrégé des référentiels pour l'affichage.

-- ---------------------------------------------------------------- Fournisseur principal unique
-- Portée : le groupe (sans établissement) ou un établissement. En cas de doublon existant, le
-- principal désigné en dernier le reste ; les autres passent au rang 2.
update article_fournisseur af set rang = 2
 where af.rang = 1 and af.actif
   and exists (select 1 from article_fournisseur x
               where x.article_id = af.article_id
                 and coalesce(x.etablissement_id, 0) = coalesce(af.etablissement_id, 0)
                 and x.rang = 1 and x.actif and x.id > af.id);

create unique index article_fournisseur_principal on article_fournisseur
    (article_id, coalesce(etablissement_id, 0)) where rang = 1 and actif;

-- Désigner un nouveau principal fait passer l'ancien au rang 2 (tracé dans le journal).
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
create trigger a_principal before insert or update of rang, actif, article_id, etablissement_id on article_fournisseur
    for each row execute function retrograder_principal();

-- ---------------------------------------------------------------- Codes figés
-- À la création, le code vient toujours d'un compteur (un code envoyé est ignoré). Sans compteur
-- actif pour le fichier, un compteur général est créé. Ensuite, le code ne change plus.

create or replace function attribuer_code() returns trigger language plpgsql as $$
declare
    ligne   jsonb := to_jsonb(new);
    v       text := coalesce(ligne ->> 'nature', ligne ->> 'type', '');
    etab    bigint := (ligne ->> 'etablissement_id')::bigint;
    ref     bigint := (ligne ->> 'referentiel_id')::bigint;
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
           and (referentiel_id is null or referentiel_id = ref)
         order by (etablissement_id is not null) desc, (referentiel_id is not null) desc, (variante <> '') desc
         limit 1
         for update;
        exit when found;
        -- Aucun compteur : on crée le compteur général du fichier (préfixe modifiable ensuite).
        insert into compteur (entite, variante, prefixe, longueur)
        values (tg_table_name, '', upper(left(regexp_replace(tg_table_name, '[^a-z]', '', 'g'), 3)), 5)
        on conflict do nothing;
        -- Le compteur général existait mais inactif : on le réactive plutôt que de bloquer la création.
        update compteur set actif = true
         where entite = tg_table_name and variante = '' and etablissement_id is null and referentiel_id is null;
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

do $$
declare t text;
begin
    foreach t in array array['referentiel', 'pui', 'entite_juridique', 'etablissement', 'pole', 'service', 'uf',
                             'magasin', 'emplacement', 'famille', 'article', 'fournisseur', 'source_externe'] loop
        execute format('create trigger a_code_fige before update of code on %I
                        for each row execute function attribuer_code()', t);
    end loop;
end $$;

-- ---------------------------------------------------------------- Abrégé des référentiels
-- Libellé court modifiable (« DMI-PIN », « DM-MCO »), affiché à côté des articles et des familles :
-- l'appartenance se lit dans le libellé, pas dans le code.
alter table referentiel add column abrege text;
update referentiel set abrege = code where code !~ '^REF[0-9]+$';
