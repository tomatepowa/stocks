-- Magasin rattaché à la PUI qui en a la responsabilité.
-- Magasin de PUI : PUI obligatoire. Armoire de service : PUI qui l'approvisionne, si l'établissement
-- en a une. Économat : jamais de PUI. Laissée vide, la PUI est celle de l'établissement du magasin,
-- et elle ne peut pas être une autre (en mode PUI centrale, c'est la PUI commune aux sites).

alter table magasin add column pui_id bigint references pui;

update magasin m set pui_id = e.pui_id
  from etablissement e
 where e.id = m.etablissement_id and m.type in ('pui', 'service');

alter table magasin
    add constraint magasin_pui_economat check (type <> 'economat' or pui_id is null),
    add constraint magasin_pui_obligatoire check (type <> 'pui' or pui_id is not null);

-- PL/pgSQL évalue toute la condition : un champ propre à une table n'est lu que dans sa branche.
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
