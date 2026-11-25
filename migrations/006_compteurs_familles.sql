-- Compteurs propres à un établissement ou à un référentiel ; familles communes au groupe.

-- ---------------------------------------------------------------- Compteurs à portée
-- Un compteur peut ne valoir que pour un établissement (ex. : codes des UF d'une clinique) ou un
-- référentiel (ex. : DMI d'un site). Le compteur le plus précis l'emporte : établissement, puis
-- référentiel, puis variante (nature ou type), puis le compteur général du fichier.

alter table compteur
    add column etablissement_id bigint references etablissement,
    add column referentiel_id   bigint references referentiel;
alter table compteur drop constraint compteur_entite_variante_key;
create unique index compteur_portee on compteur
    (entite, variante, coalesce(etablissement_id, 0), coalesce(referentiel_id, 0));

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
    if new.code is not null and btrim(new.code) <> '' then
        return new;
    end if;
    select * into cpt from compteur
     where entite = tg_table_name and actif and variante in (v, '')
       and (etablissement_id is null or etablissement_id = etab)
       and (referentiel_id is null or referentiel_id = ref)
     order by (etablissement_id is not null) desc, (referentiel_id is not null) desc, (variante <> '') desc
     limit 1
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

-- ---------------------------------------------------------------- Familles communes
-- Sans référentiel, une famille vaut pour tous les référentiels du groupe (nomenclature commune,
-- consolidable entre sites). Elle doit être de la même nature que l'article.

alter table famille alter column referentiel_id drop not null;
create unique index famille_code_commune on famille (code) where referentiel_id is null;

create or replace function verifier_coherence() returns trigger language plpgsql as $$
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
