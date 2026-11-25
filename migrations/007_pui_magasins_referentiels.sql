-- Plusieurs référentiels par nature, siège et cadre de la PUI, rôle et approvisionnement des
-- magasins, PUI gestionnaire des référentiels.

-- ---------------------------------------------------------------- 1. Plusieurs référentiels par nature
-- Ex. : DM communs aux SMR, plus un référentiel de DM propre à un site.
alter table etablissement_referentiel drop constraint etablissement_referentiel_etablissement_id_nature_key;
alter table etablissement_referentiel
    add constraint etablissement_referentiel_unique unique (etablissement_id, nature, referentiel_id);

-- ---------------------------------------------------------------- 2. Siège et cadre de la PUI
-- Siège : l'établissement titulaire de l'autorisation, où la PUI est implantée.
-- Cadre : PUI propre à son établissement, multi-sites (même entité juridique), ou desservant
-- d'autres entités juridiques par convention ou au sein d'un GCS.
alter table pui
    add column etablissement_siege_id bigint references etablissement,
    add column cadre text not null default 'propre'
        check (cadre in ('propre', 'multi_sites', 'convention', 'gcs'));

-- ---------------------------------------------------------------- 4. PUI gestionnaire d'un référentiel
-- La PUI qui valide les mises à jour (listes officielles, reprises depuis les centrales).
alter table referentiel add column pui_gestionnaire_id bigint references pui;

-- ---------------------------------------------------------------- 3. Rôle et approvisionnement des magasins
alter table magasin
    add column role text,
    add column magasin_source_id bigint references magasin,
    add constraint magasin_role check (
        (type = 'pui' and role in ('reserve', 'depot', 'coffre_stupefiants', 'froid', 'dmi'))
        or (type = 'service' and role in ('armoire', 'arsenal', 'depot_antenne'))
        or (type = 'economat' and role in ('reserve', 'depot'))
    ),
    add constraint magasin_source_soi check (magasin_source_id is distinct from id);

update magasin set role = case type when 'service' then 'armoire' else 'reserve' end where role is null;
alter table magasin alter column role set not null;

-- ---------------------------------------------------------------- Cohérence

create or replace function verifier_coherence() returns trigger language plpgsql as $$
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

create trigger coherence before insert or update on pui
    for each row execute function verifier_coherence();
