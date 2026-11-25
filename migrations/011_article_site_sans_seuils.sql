-- La dotation (mini, maxi, point de commande) se fait par magasin (article_magasin) ; l'article-site
-- garde le référencement dans l'établissement et les réglages locaux (code local, traçabilité).
alter table article_site
    drop column stock_mini,
    drop column stock_maxi,
    drop column point_commande;
