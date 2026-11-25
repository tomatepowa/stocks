-- Un établissement utilise un référentiel par nature d'article : par exemple les médicaments du
-- référentiel commun au groupe, les DM d'un référentiel commun aux MCO, ses propres DMI, et
-- l'économat commun. Remplace le référentiel unique de l'établissement.

create table etablissement_referentiel (
    id               bigserial primary key,
    etablissement_id bigint not null references etablissement,
    nature           text not null check (nature in ('medicament', 'dm', 'dmi', 'economat')),
    referentiel_id   bigint not null references referentiel,
    unique (etablissement_id, nature)
);

insert into etablissement_referentiel (etablissement_id, nature, referentiel_id)
select e.id, n.nature, e.referentiel_id
  from etablissement e
 cross join (values ('medicament'), ('dm'), ('dmi'), ('economat')) as n(nature);

alter table etablissement drop column referentiel_id;

create trigger journal after insert or update or delete on etablissement_referentiel
    for each row execute function journaliser();

-- Vrai si l'établissement utilise, pour la nature de l'article, le référentiel de l'article.
create function article_utilisable(p_article bigint, p_etablissement bigint) returns boolean
language sql stable as $$
    select exists (select 1 from article a
                   join etablissement_referentiel er
                     on er.referentiel_id = a.referentiel_id and er.nature = a.nature
                   where a.id = p_article and er.etablissement_id = p_etablissement)
$$;

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
        if new.famille_id is not null
           and not exists (select 1 from famille where id = new.famille_id and referentiel_id = new.referentiel_id) then
            raise exception 'La famille choisie appartient à un autre référentiel que l''article';
        end if;
    elsif tg_table_name = 'article_site' then
        if not article_utilisable(new.article_id, new.etablissement_id) then
            raise exception 'Cet établissement n''utilise pas le référentiel de cet article pour sa nature';
        end if;
    end if;
    return new;
end $$;
