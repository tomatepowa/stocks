-- Stupéfiants : magasins sécurisés et contrôle réglable par PUI.
-- La loi impose un stockage fermé à clé, pas un rôle de magasin : tout magasin peut être déclaré
-- « sécurisé pour les stupéfiants » (toujours vrai pour un coffre). Chaque PUI choisit son niveau de
-- contrôle : strict (écart refusé) ou souple (écart accepté avec un motif, mouvement « hors règle »).

alter table magasin add column securise_stupefiants boolean not null default false;
update magasin set securise_stupefiants = true where role = 'coffre_stupefiants';
alter table magasin add constraint coffre_securise check (role <> 'coffre_stupefiants' or securise_stupefiants);

-- Un coffre créé est sécurisé d'office.
create function coffre_securise() returns trigger language plpgsql as $$
begin
    if new.role = 'coffre_stupefiants' then
        new.securise_stupefiants := true;
    end if;
    return new;
end $$;
create trigger b_coffre_securise before insert or update on magasin
    for each row execute function coffre_securise();

alter table pui add column controle_stupefiants text not null default 'strict'
    check (controle_stupefiants in ('strict', 'souple'));

alter table mouvement add column hors_regle boolean not null default false;
create index mouvement_hors_regle on mouvement (le) where hors_regle;

-- Écart à une règle des stupéfiants : refusé si la PUI est en contrôle strict (ou s'il n'y a pas de
-- PUI), accepté en contrôle souple à condition d'indiquer un motif.
create function regle_stupefiant(p_pui bigint, p_motif text, p_message text) returns void
language plpgsql as $$
begin
    if (select controle_stupefiants from pui where id = p_pui) is distinct from 'souple' then
        raise exception '% (contrôle strict de la PUI)', p_message;
    end if;
    if coalesce(btrim(p_motif), '') = '' then
        raise exception '% : la PUI est en contrôle souple, indiquez un motif pour passer outre', p_message;
    end if;
end $$;

create or replace function magasin_peut_recevoir(p_magasin bigint, p_article bigint) returns boolean
language sql stable as $$
    select m.magasin_source_id is null
       and m.actif
       and m.type = case when a.nature = 'economat' then 'economat' else 'pui' end
       and (a.liste not in ('stupefiant', 'assimile_stupefiant') or m.securise_stupefiants)
       and article_utilisable(a.id, m.etablissement_id)
      from magasin m, article a
     where m.id = p_magasin and a.id = p_article
$$;

create or replace function appliquer_mouvement() returns trigger language plpgsql as $$
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
    src        magasin%rowtype;
    stup       boolean;
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
    select * into dst from magasin where id = new.magasin_destination_id;
    select * into src from magasin where id = new.magasin_source_id;
    stup := art.liste in ('stupefiant', 'assimile_stupefiant');
    new.hors_regle := false;
    if new.type = 'reception' then
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
    end if;
    -- Stupéfiants : stockage dans un magasin sécurisé, sortie nominative. Si la PUI est en contrôle
    -- « souple », l'écart passe avec un motif et le mouvement est marqué « hors règle ».
    if stup then
        if entree and not coalesce(dst.securise_stupefiants, false) then
            perform regle_stupefiant(dst.pui_id, new.motif,
                'Un stupéfiant ne va que dans un magasin sécurisé pour les stupéfiants');
            new.hors_regle := true;
        end if;
        if new.type = 'sortie' and (coalesce(btrim(new.sejour), '') = '' or coalesce(btrim(new.prescripteur), '') = '') then
            perform regle_stupefiant(src.pui_id, new.motif,
                'Sortie de stupéfiant : séjour (ou IPP) et prescripteur obligatoires');
            new.hors_regle := true;
        end if;
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
