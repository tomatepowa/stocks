# Stocks pharmacie et économat

Gestion des stocks de la PUI et de l'économat des cliniques, pour un établissement ou un groupe.
Le besoin est décrit dans [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md).

## Lancer

Avec Docker (base et serveur) :

```
docker compose up -d --build
```

Pages : http://127.0.0.1:8090. Les migrations de `migrations/` s'appliquent au démarrage du serveur.

En développement : `docker compose up -d db`, puis `cargo run` (base sur le port 5433 de ce poste).

## Contenu

- `migrations/` : schéma PostgreSQL. Une migration appliquée ne se modifie plus : on en ajoute une nouvelle.
- `src/schema.rs` : description des fichiers de base. Elle fixe les tables et colonnes que l'API expose et sert à dessiner les pages.
- `src/crud.rs` : API générique (`/api/e/{fichier}`) et historique (`/api/journal/{fichier}/{id}`).
- `web/` : pages (thème clair uniquement).

## Socle actuel

- **Structure** : entités juridiques, établissements, PUI (une par établissement, ou centrale pour plusieurs), pôles (facultatifs), services, UF (activité, code UM, section analytique), magasins, emplacements.
- **Articles** : référentiels partagés ou propres à un établissement, familles, articles, articles-sites (seuils et traçabilité locale), médicaments à risque par service.
- **Achats** : fournisseurs, centrales, prix et références par article (pour le groupe ou pour un établissement).
- **Règles en base** :
  - traçabilité obligatoire des DMI ;
  - listes I, II et stupéfiants réservées aux médicaments ;
  - cohérence entre établissement, service, UF, référentiel et famille.
- **Compteurs de codes** : un compteur par fichier codé (préfixe, longueur, prochain numéro), avec une variante possible selon la nature ou le type. Un code laissé vide est attribué par la base, et les codes déjà pris sont sautés.
- **Pages** : liste avec recherche et filtres. La fiche s'ouvre en page entière : en-tête et pastilles, cartes par section, champs selon la nature, fiches liées, historique.
- **Journal d'audit** : il ne peut être ni modifié ni effacé, et toute écriture y est enregistrée.

Pas encore d'authentification : le journal enregistre « poste local » comme auteur.
