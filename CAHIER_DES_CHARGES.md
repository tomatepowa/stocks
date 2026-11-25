# Cahier des charges : gestion des stocks pharmacie et économat

Version de travail du 25/11/2026. Les points marqués **[à vérifier]** dépendent de textes ou de formats officiels à contrôler avant développement.

## 1. Objet

Logiciel de gestion des stocks de la pharmacie à usage intérieur (PUI) et de l'économat des cliniques, pour un établissement seul ou un groupe. Il est destiné à être commercialisé : modes de fonctionnement, listes, formats d'import et d'export sont paramétrables.

Activités couvertes : MCO, SMR, HAD.

## 2. Périmètre

**Pharmacie** : médicaments, dispositifs médicaux stériles, dispositifs médicaux implantables (DMI).

**Économat** : produits d'entretien, droguerie, consommables (sacs poubelles, lingettes…). Il n'y a pas de circuit du linge ni de blanchisserie.

**Hors première version** : prescription, validation pharmaceutique des ordonnances, sérialisation anti-falsification (FMD), préparations magistrales, factures fournisseurs, données de santé autres que le n° de séjour et l'IPP.

## 3. Organisation multi-établissements

- Le logiciel gère plusieurs établissements (cible : un groupe d'environ 15 établissements).
- **Deux modes de PUI**, choisis par client :
  - *une PUI par établissement* : chaque site a son stock, son pharmacien et ses services ;
  - *une PUI centrale* : une PUI approvisionne plusieurs sites, qui ont leurs propres magasins et leurs propres services.
- **Cessions entre sites** : transferts de stock tracés, valorisés au PUMP du site qui cède.
- **Magasins** : PUI, économat, armoires et réserves des services, avec des emplacements.
- **Structure** : établissement, puis services et unités fonctionnelles (UF), puis centres de coût.

## 4. Référentiel articles

### 4.1 Deux niveaux

- **Article de référence**, dans un référentiel. Un référentiel est partagé par plusieurs établissements ou propre à un seul. Chaque établissement est rattaché à un référentiel.
- **Article-site** : la déclinaison locale de l'article de référence. On y trouve :
  - le stock mini et maxi, le point de commande ;
  - les emplacements ;
  - les fournisseurs retenus et leurs prix ;
  - les options de traçabilité (§ 6) ;
  - le statut « à risque » propre au site ou au service.

### 4.2 Contenu de l'article

- Désignation, famille, nature (médicament, DM, DMI, économat).
- Codes : UCD, CIP13, LPP, EAN/GTIN, code interne.
- Conditionnements : unité d'achat, unité de stock, unité de délivrance, coefficients de conversion.
- Classification réglementaire : liste I, liste II, stupéfiant, assimilé stupéfiant.
- Statut « médicament à risque » (§ 7).
- Statut « en sus » par activité (MCO, SMR, HAD), alimenté par les listes officielles (§ 8).

### 4.3 Fournisseurs

- Plusieurs fournisseurs par article : un principal, d'autres en secours.
- Références, prix et conditionnements propres à chaque fournisseur.
- Les fournisseurs sont communs au groupe. Chaque établissement passe ses propres commandes.

### 4.4 Centrales d'achat et enrichissement

- On consulte la fiche produit d'un article telle que la publie chaque centrale : Helpévia, CACIP, Exhausmed, et d'autres.
- On enrichit l'article **champ par champ** : pour chaque champ, l'utilisateur retient la valeur d'une source. L'outil garde la provenance (source, date) et l'historique de chaque valeur.
- **Connecteurs** : chaque centrale a son connecteur, construit sur un modèle commun.
  - Première version : import de fichiers à plat (catalogues CSV ou Excel).
  - Évolution : API, sous réserve d'un accord avec chaque centrale. Aucun contact n'existe à ce jour.

## 5. Flux de stock

- **Commandes** : proposition de réapprovisionnement d'après les mini/maxi et les consommations, puis commande fournisseur, par établissement.
- **Réception** :
  - contrôle des quantités ;
  - saisie du lot, du n° de série et de la péremption selon les options de l'article ;
  - gestion des reliquats et des litiges.
- **Distribution aux services** :
  - dotation par service et par article ;
  - réapprovisionnement global (plein-vide ou relevé) ;
  - commandes urgentes.
- **Délivrance nominative** : rattachée à un n° de séjour ou à un IPP saisi à la main. Elle concerne les stupéfiants, les produits en sus et la HAD.
- **HAD** :
  - délivrance vers un séjour HAD, livrée au domicile ;
  - **retours** tracés comme un mouvement à part, avec **destruction obligatoire**. Statuts : « retourné », puis « en attente de destruction », puis « détruit » avec la date et la référence du bon d'enlèvement ou du certificat de destruction. Aucun de ces statuts ne permet de revenir au stock utilisable. Un médicament revenu du domicile est un médicament non utilisé (MNU) : le réutiliser est interdit, et la PUI doit le collecter pour destruction ;
  - option « remise en stock » désactivée par défaut. Elle ne s'active que pour une PUI qui participe à l'expérimentation de re-dispensation prévue par la LFSS 2026, et chaque remise en stock est tracée et signée par le pharmacien **[à vérifier : textes d'application et liste des PUI participantes]**.
- **Autres mouvements** : retours fournisseur, casse, péremption, quarantaine, régularisations (chacune avec un motif obligatoire).
- **Inventaires** : tournants et annuels, par magasin, avec écarts justifiés et validés.

## 6. Traçabilité : lots, numéros de série, péremptions

- Lot, n° de série et péremption se règlent **séparément** pour chaque article, et séparément en entrée et en sortie : obligatoire, facultatif ou sans objet.
- Les DMI sont verrouillés en traçabilité obligatoire de bout en bout : de la réception jusqu'au patient, avec la date, l'intervention et l'opérateur.
- La sortie se fait du plus proche périmé d'abord, avec un délai d'alerte paramétrable.
- Quarantaine et rappels de lot : blocage du lot, puis recherche de ses emplacements et de ses sorties.

## 7. Médicaments à risque et produits réglementés

- **Médicaments à risque** sur deux niveaux :
  - la liste globale, définie par la PUI ;
  - la liste propre à chaque service.
- Ce statut déclenche des alertes à la délivrance et, en option, un double contrôle.
- **Listes I et II** : affichées et utilisées dans les règles de délivrance.
- **Stupéfiants** : registre informatique (article R. 5132-36 du CSP et arrêté du 12 mars 2013 pour les établissements de santé).
  - Entrées : désignation et quantité reçue ; pour les spécialités, la quantité en unités de prise.
  - Sorties : désignation et quantité délivrée en unités de prise, rattachées au séjour ou à l'IPP et au prescripteur.
  - Aucune modification possible après validation : une erreur se corrige par une écriture inverse.
  - Édition immédiate à la demande d'une autorité de contrôle, avec le nom et l'adresse de l'établissement sur chaque page.
  - Balance mensuelle des entrées et des sorties ; inventaire annuel du stock ; inventaire contradictoire.
  - Données dupliquées sur deux supports distincts (consultation courante et réserve).
  - Conservation **dix ans** à compter de la dernière mention, avec les éditions et les documents de destruction.
  - **[à vérifier : ces règles viennent de la version du texte en vigueur de 2012 à 2022. Relire la version en vigueur depuis février 2022 et l'arrêté du 12 mars 2013 sur Légifrance]**

## 8. Facturation en sus et PMSI

- **Listes officielles**, toutes publiées par l'ATIH :
  - les UCD prises en charge en sus ;
  - les dispositifs médicaux pris en charge en sus (dernière mise à jour le 16/07/2026) ;
  - les médicaments en accès précoce, accès compassionnel et cadre de prescription compassionnelle (AAP, AAC, CPC), qui remplacent les anciennes ATU et post-ATU (mise à jour le 10/06/2026) ;
  - les listes de traceurs propres à la HAD et au SMR.
  - Certains téléchargements de l'ATIH demandent un compte PLAGE. La détection automatique devra donc peut-être passer par un compte fourni par le client.
  - **[à vérifier : format de chaque fichier (Excel ou CSV, colonnes) en téléchargeant la version courante]**
- **Mises à jour** :
  - l'outil détecte chaque nouvelle publication ;
  - il prépare la liste des changements (nouveautés, prix, radiations) ;
  - rien n'est appliqué sans la validation du pharmacien.
- **Ce que les formats ATIH 2026 imposent selon le secteur** (vérifié dans les classeurs « formats_mco_2026 », « formats_smr_2026 » et « formats_had_2026 ») :
  - **cliniques privées (ex-OQN)** : en MCO et en SMR, les médicaments en sus et les DMI en sus sont **facturés** sur la facture du séjour, et non déclarés par FICHCOMP. Ils passent dans le RSF H (médicaments : code UCD sur 7, indication, coefficient de fractionnement, prix d'achat unitaire TTC, quantité, montants) et le RSF P (prothèses : code LPP, quantité, tarif LPP ou prix sur devis, prix d'achat unitaire). Ces enregistrements portent le n° d'immatriculation et le n° de facture : c'est le logiciel de facturation (HM) qui les produit. L'outil lui fournit les lignes de délivrance en sus (séjour, date, code, indication, quantité, prix d'achat) ;
  - **HAD ex-OQN** : l'outil produit lui-même les FICHCOMP « MED AP-AC » (type 09) et « MCHL » (médicaments coûteux hors liste, type 11), en enregistrements de 103 caractères, avec le n° d'entrée et le n° de facture ;
  - **établissements ex-DG** (pour la commercialisation hors du privé lucratif) : FICHCOMP LES (type 06, 105 caractères), MED AP-AC (type 09, 105 caractères) et DMI (type 02, 92 caractères) ; en HAD, LES, MED AP-AC et MCHL ex-DGF.
  - Règles communes : champs à position fixe, alphanumériques cadrés à gauche avec des espaces, numériques cadrés à droite avec des zéros. Les quantités et les prix sont en 7+3 (millièmes d'euro) dans les FICHCOMP et en 5+2 dans les RSF. Le code UCD est de préférence sur 13 caractères dans les FICHCOMP. L'indication est un code de la liste en sus (« I » + 6 chiffres) ou de la liste d'accès dérogatoire (« I », « N » ou « C » + 6 caractères).
- **FICHCOMP** :
  - l'outil produit lui-même les fichiers complémentaires prévus pour le secteur de l'établissement (ci-dessus), à partir des délivrances nominatives ;
  - le format suit l'année PMSI en vigueur et reste paramétrable. L'ATIH publie chaque année les formats (classeurs Excel de la page « Formats PMSI ») et une notice technique (pour 2026 : notice ATIH-294-9-2025 du 21/11/2025) ;
  - les catégories de FICHCOMP médicaments suivent la réforme des accès dérogatoires (AAP, AAC, CPC au lieu des ATU) ;
  - la notice 2026 n'ajoute aucun nouveau FICHCOMP. La transmission passe par DRUIDES et l'anonymisation par MAGIC (version 5.12.0 à partir de M1 2026) ;
  - le cadrage initial vise Hospital Manager (HM).
  - **[à vérifier : format du fichier d'échange attendu par HM pour les lignes en sus ; formats 2027 à leur parution]**

## 9. Valorisation et exports comptables

- La valorisation se fait au **PUMP**, par établissement.
- Les consommations sont valorisées par UF et par centre de coût.
- **Export des réceptions** vers Sage X3 et Sage 100, sur un modèle d'export paramétrable pour d'autres logiciels.
- Les factures fournisseurs ne passent pas par l'outil : elles arrivent à la comptabilité par les plateformes de la facturation électronique, et c'est Sage qui rapproche commande, réception et facture. Calendrier de la réforme : depuis le 1er septembre 2026, toutes les entreprises doivent pouvoir recevoir des factures électroniques, et les grandes entreprises et ETI doivent les émettre ainsi ; l'émission devient obligatoire pour les PME et TPE le 1er septembre 2027.

## 10. Codes-barres

- Lecture par douchette de tous les standards courants : GS1 DataMatrix, GS1-128, EAN-13, HIBC, CIP/ACL.
- Lot, péremption et n° de série sont extraits automatiquement du code lu.

## 11. Utilisateurs, droits, audit

- Connexion par LDAP (annuaire de l'établissement), ou par comptes locaux.
- **Rôles** : pharmacien, préparateur, économe, magasinier, cadre de service, direction (lecture seule).
- Les droits se donnent par établissement, par magasin et par service.
- La signature du pharmacien est requise sur les actes réglementés : stupéfiants, validation des listes, remises en stock HAD.
- Un journal d'audit non modifiable enregistre tous les mouvements et toutes les modifications du référentiel.

## 12. Architecture et exploitation

- Un serveur installé chez chaque client. Les données restent chez le client.
- **Pile technique** : API Rust, base PostgreSQL, interface web, le tout dans Docker.
- **Mises à jour** : nouvelle image, puis migration automatique de la base.
- **Sauvegardes** : planifiées, avec une procédure de restauration documentée.
- Le serveur a besoin d'un accès Internet pour détecter les mises à jour des listes officielles.
- **Volumétrie cible** (estimation à confirmer chez un client) :
  - environ 15 établissements ;
  - quelques milliers à quelques dizaines de milliers d'articles par référentiel ;
  - quelques centaines d'utilisateurs, dont quelques dizaines connectés en même temps.
- **Évolution** : quand des données de santé seront ajoutées, l'hébergement HDS sera à traiter chez chaque client.

## 13. Points ouverts

- Les accords avec les centrales d'achat (API, flux de fichiers).
- La vérification des points marqués **[à vérifier]**.
- La confirmation de la volumétrie auprès d'un premier client.
