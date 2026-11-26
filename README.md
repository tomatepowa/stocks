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

Groupe de test complet (base vide, serveur lancé) : `python -I outils/groupe_test.py --scenario=1` ou `--scenario=2`. Tous les noms sont fictifs, et aucun code officiel n'est renseigné.

- **Scénario 1** : 4 établissements (2 MCO, 1 SMR, 1 HAD), chacun avec sa PUI.
- **Scénario 2** : une PUI centrale pour 3 MCO, avec des dépôts sur chaque site ; 3 petits SMR et une HAD, chacun avec sa PUI.

## Contenu

- `migrations/` : schéma PostgreSQL. `001_schema.sql` contient le schéma complet ; les évolutions s'ajoutent en `002_…`, `003_…`. Une migration appliquée ne se modifie plus : on en ajoute une nouvelle.
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
- **Codes** : attribués par la base à la création, jamais saisis ni modifiés. Un compteur par fichier (préfixe, longueur, prochain numéro), avec une variante selon la nature ou le type (articles : MED, DM, DMI, ECO), et au besoin un compteur propre à un établissement pour la structure (UF, services, magasins). Sans compteur, la base en crée un. L'appartenance d'un article à un référentiel se lit dans l'abrégé du référentiel, pas dans le code.
- **Fournisseur principal** : un seul par article et par portée (groupe ou établissement) ; en désigner un nouveau fait passer l'ancien au rang 2.
- **Pages** : liste avec recherche et filtres. La fiche s'ouvre en page entière : en-tête et pastilles, cartes par section, champs selon la nature, fiches liées, historique.
- **Sources externes** (centrales, référentiels) :
  - un article est lié à chaque source par le code article de cette source ;
  - les catalogues s'importent en CSV (Outils › Import de catalogues), avec choix des colonnes ;
  - sur la fiche article, le bouton « Centrales » ou le bouton au bout d'un champ ouvre la comparaison avec chaque source, et l'on reprend les valeurs choisies champ par champ ;
  - la provenance de chaque champ repris est conservée.
- **Journal d'audit** : il ne peut être ni modifié ni effacé, et toute écriture y est enregistrée.

Pas encore d'authentification : le journal enregistre « poste local » comme auteur.
