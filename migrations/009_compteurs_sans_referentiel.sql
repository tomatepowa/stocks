-- Plus de compteur propre à un référentiel : un code ne change jamais, il ne doit donc rien encoder
-- qui puisse changer (un article peut passer d'un référentiel à un autre). Les articles sont
-- numérotés par nature (MED, DM, DMI, ECO) ; l'appartenance se lit dans l'abrégé du référentiel.
-- Les compteurs propres à un établissement restent (UF, services, magasins ne changent pas de site).

delete from compteur where referentiel_id is not null;
drop index compteur_portee;
alter table compteur drop column referentiel_id;
create unique index compteur_portee on compteur (entite, variante, coalesce(etablissement_id, 0));

create or replace function attribuer_code() returns trigger language plpgsql as $$
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
