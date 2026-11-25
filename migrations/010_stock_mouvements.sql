-- Stock : paramétrage par magasin (dotation, emplacement principal), stock par lot et par
-- emplacement facultatif, mouvements immuables qui seuls font varier le stock, PUMP par établissement.

-- ---------------------------------------------------------------- Article dans un magasin
-- Dotation du magasin et adresse habituelle de prélèvement.
create table article_magasin (
    id                        bigserial primary key,
    magasin_id                bigint not null references magasin,
    article_id                bigint not null references article,
    emplacement_principal_id  bigint references emplacement,
    stock_mini                numeric(12, 3) check (stock_mini >= 0),
    stock_maxi                numeric(12, 3) check (stock_maxi >= 0),
    point_commande            numeric(12, 3) check (point_commande >= 0),
    actif                     boolean not null default true,
    unique (magasin_id, article_id),
    check (stock_maxi is null or stock_mini is null or stock_maxi >= stock_mini)
);
create trigger journal after insert or update or delete on article_magasin
    for each row execute function journaliser();

-- ---------------------------------------------------------------- Stock
-- Une ligne par magasin, emplacement (facultatif), article, lot, n° de série et péremption.
-- Écrit uniquement par les mouvements.
create table stock (
    id              bigserial primary key,
    magasin_id      bigint not null references magasin,
    emplacement_id  bigint references emplacement,
    article_id      bigint not null references article,
    lot             text,
    numero_serie    text,
    peremption      date,
    quantite        numeric(14, 3) not null check (quantite >= 0),
    maj_le          timestamptz not null default now()
);
create unique index stock_ligne on stock (magasin_id, coalesce(emplacement_id, 0), article_id,
    coalesce(lot, ''), coalesce(numero_serie, ''), coalesce(peremption, 'infinity'));
create index stock_article on stock (article_id, magasin_id);

create function stock_par_mouvement() returns trigger language plpgsql as $$
begin
    if coalesce(current_setting('stocks.mouvement', true), '') <> 'oui' then
        raise exception 'Le stock ne se modifie que par des mouvements';
    end if;
    return coalesce(new, old);
end $$;
create trigger stock_par_mouvement before insert or update or delete on stock
    for each row execute function stock_par_mouvement();

-- ---------------------------------------------------------------- Valorisation (PUMP par établissement)
create table valorisation (
    id                bigserial primary key,
    etablissement_id  bigint not null references etablissement,
    article_id        bigint not null references article,
    pump              numeric(14, 4) not null default 0,
    maj_le            timestamptz not null default now(),
    unique (etablissement_id, article_id)
);

-- ---------------------------------------------------------------- Mouvements

create table mouvement (
    id                          bigserial primary key,
    le                          timestamptz not null default now(),
    utilisateur                 text not null default coalesce(nullif(current_setting('stocks.utilisateur', true), ''), 'système'),
    type                        text not null check (type in (
                                    'reception', 'transfert', 'deplacement', 'sortie', 'retour_service',
                                    'retour_fournisseur', 'destruction', 'inventaire_plus', 'inventaire_moins')),
    article_id                  bigint not null references article,
    quantite                    numeric(14, 3) not null check (quantite > 0),
    magasin_source_id           bigint references magasin,
    emplacement_source_id       bigint references emplacement,
    magasin_destination_id      bigint references magasin,
    emplacement_destination_id  bigint references emplacement,
    lot                         text,
    numero_serie                text,
    peremption                  date,
    fournisseur_id              bigint references fournisseur,
    prix_unitaire               numeric(14, 4) check (prix_unitaire >= 0),
    uf_id                       bigint references uf,
    sejour                      text,
    prescripteur                text,
    motif                       text,
    document                    text,
    valeur_unitaire             numeric(14, 4)
);
create index mouvement_article on mouvement (article_id, le);
create index mouvement_source on mouvement (magasin_source_id, le);
create index mouvement_destination on mouvement (magasin_destination_id, le);

-- Réglage de traçabilité effectif d'un article dans un établissement (article-site, sinon article).
create function tracabilite_effective(p_article bigint, p_etab bigint, p_champ text) returns text
language sql stable as $$
    select coalesce(to_jsonb(s) ->> p_champ, to_jsonb(a) ->> p_champ)
      from article a
      left join article_site s on s.article_id = a.id and s.etablissement_id = p_etab
     where a.id = p_article
$$;

create function appliquer_mouvement() returns trigger language plpgsql as $$
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
    -- Stupéfiants : sortie nominative, prescripteur connu.
    if new.type = 'sortie' and art.liste in ('stupefiant', 'assimile_stupefiant')
       and (coalesce(btrim(new.sejour), '') = '' or coalesce(btrim(new.prescripteur), '') = '') then
        raise exception 'Sortie de stupéfiant : séjour (ou IPP) et prescripteur obligatoires';
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
create trigger appliquer before insert on mouvement for each row execute function appliquer_mouvement();

create function mouvement_immuable() returns trigger language plpgsql as $$
begin
    raise exception 'Un mouvement ne se modifie pas et ne s''efface pas : saisissez un mouvement inverse';
end $$;
create trigger mouvement_immuable before update or delete on mouvement
    for each row execute function mouvement_immuable();
create trigger mouvement_immuable_truncate before truncate on mouvement
    for each statement execute function mouvement_immuable();

-- ---------------------------------------------------------------- Cohérence de l'article-magasin

create function verifier_article_magasin() returns trigger language plpgsql as $$
begin
    if not article_utilisable(new.article_id, (select etablissement_id from magasin where id = new.magasin_id)) then
        raise exception 'L''établissement de ce magasin n''utilise pas cet article';
    end if;
    if new.emplacement_principal_id is not null
       and not exists (select 1 from emplacement where id = new.emplacement_principal_id and magasin_id = new.magasin_id) then
        raise exception 'L''emplacement principal n''appartient pas à ce magasin';
    end if;
    return new;
end $$;
create trigger coherence before insert or update on article_magasin
    for each row execute function verifier_article_magasin();
