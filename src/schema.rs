//! Description des fichiers de base : sert à la fois à construire le SQL de l'API générique
//! (seules les tables et colonnes décrites ici sont accessibles) et à dessiner les pages.

use serde_json::{json, Value};

pub enum Genre {
    Texte,
    TexteLong,
    Entier,
    Decimal,
    Booleen,
    Date,
    Choix(&'static [(&'static str, &'static str)]),
    /// Clé étrangère vers une autre entité (par son nom).
    Ref(&'static str),
}

pub struct Champ {
    pub col: &'static str,
    pub libelle: &'static str,
    pub genre: Genre,
    pub requis: bool,
    /// Affiché en colonne dans la liste.
    pub liste: bool,
    pub aide: &'static str,
    /// Carte de la fiche où le champ s'affiche.
    pub section: &'static str,
    /// Champ affiché seulement quand un autre champ prend l'une de ces valeurs.
    pub quand: Option<(&'static str, &'static [&'static str])>,
    /// Pastille dans l'en-tête de la fiche : libellé court pour un booléen vrai ; pour une liste,
    /// « * » affiche la valeur choisie (sauf « aucune »).
    pub badge: &'static str,
    /// Lien vers le parent dans la structure (1 = premier choisi s'il est renseigné, puis 2…) ; 0 : aucun.
    pub parent: u8,
}

const fn c(col: &'static str, libelle: &'static str, genre: Genre) -> Champ {
    Champ { col, libelle, genre, requis: false, liste: false, aide: "", section: "", quand: None, badge: "", parent: 0 }
}

impl Champ {
    const fn req(mut self) -> Self {
        self.requis = true;
        self
    }
    const fn l(mut self) -> Self {
        self.liste = true;
        self
    }
    const fn aide(mut self, aide: &'static str) -> Self {
        self.aide = aide;
        self
    }
    const fn s(mut self, section: &'static str) -> Self {
        self.section = section;
        self
    }
    const fn quand(mut self, col: &'static str, valeurs: &'static [&'static str]) -> Self {
        self.quand = Some((col, valeurs));
        self
    }
    const fn badge(mut self, badge: &'static str) -> Self {
        self.badge = badge;
        self
    }
    const fn p(mut self, rang: u8) -> Self {
        self.parent = rang;
        self
    }
}

pub struct Entite {
    pub nom: &'static str,
    pub table: &'static str,
    pub libelle: &'static str,
    pub pluriel: &'static str,
    pub groupe: &'static str,
    /// Expression SQL (alias `t`) qui nomme une ligne dans les listes et les menus.
    pub etiquette: &'static str,
    pub champs: &'static [Champ],
}

use Genre::*;

const CODE_AUTO: &str = "Laisser vide : code attribué par le compteur (Paramètres › Compteurs de codes).";
const NATURES: &[(&str, &str)] =
    &[("medicament", "Médicament"), ("dm", "Dispositif médical"), ("dmi", "DMI"), ("economat", "Économat")];
const TRAC: &[(&str, &str)] =
    &[("obligatoire", "Obligatoire"), ("facultatif", "Facultatif"), ("sans_objet", "Sans objet")];
const ACTIVITES: &[(&str, &str)] =
    &[("MCO", "MCO"), ("SMR", "SMR"), ("HAD", "HAD"), ("PSY", "Psychiatrie"), ("autre", "Autre")];
const MED: &[&str] = &["medicament"];
const DM: &[&str] = &["dm", "dmi"];
const SANTE: &[&str] = &["medicament", "dm", "dmi"];

pub static ENTITES: &[Entite] = &[
    Entite {
        nom: "referentiel",
        table: "referentiel",
        libelle: "Référentiel articles",
        pluriel: "Référentiels articles",
        groupe: "Structure",
        etiquette: "t.code || ' – ' || t.libelle",
        champs: &[
            c("code", "Code", Texte).l().aide(CODE_AUTO),
            c("libelle", "Libellé", Texte).req().l(),
            c("actif", "Actif", Booleen).l(),
        ],
    },
    Entite {
        nom: "pui",
        table: "pui",
        libelle: "PUI",
        pluriel: "PUI",
        groupe: "Structure",
        etiquette: "t.code || ' – ' || t.libelle",
        champs: &[
            c("code", "Code", Texte).l().aide(CODE_AUTO),
            c("libelle", "Libellé", Texte).req().l(),
            c("pharmacien_gerant", "Pharmacien gérant", Texte).l(),
            c("actif", "Actif", Booleen).l(),
        ],
    },
    Entite {
        nom: "entite_juridique",
        table: "entite_juridique",
        libelle: "Entité juridique",
        pluriel: "Entités juridiques",
        groupe: "Structure",
        etiquette: "t.code || ' – ' || t.raison_sociale",
        champs: &[
            c("code", "Code", Texte).l().aide(CODE_AUTO),
            c("raison_sociale", "Raison sociale", Texte).req().l(),
            c("finess_ej", "FINESS juridique", Texte).l(),
            c("siren", "SIREN", Texte).l(),
            c("code_societe_compta", "Code société (comptabilité)", Texte).l().aide("Code de la société dans Sage X3 ou Sage 100."),
            c("actif", "Actif", Booleen),
        ],
    },
    Entite {
        nom: "etablissement",
        table: "etablissement",
        libelle: "Établissement",
        pluriel: "Établissements",
        groupe: "Structure",
        etiquette: "t.code || ' – ' || coalesce(t.nom_usuel, t.raison_sociale)",
        champs: &[
            c("entite_juridique_id", "Entité juridique", Ref("entite_juridique")).req().l().s("Identification").p(1),
            c("code", "Code", Texte).l().aide(CODE_AUTO).s("Identification"),
            c("raison_sociale", "Raison sociale", Texte).req().l().s("Identification"),
            c("nom_usuel", "Nom usuel", Texte).s("Identification"),
            c("actif", "Actif", Booleen).s("Identification"),
            c("siret", "SIRET", Texte).s("Identifiants"),
            c("finess_geographique", "FINESS géographique", Texte).l().s("Identifiants"),
            c("finess_pmsi", "FINESS PMSI (ePMSI)", Texte).s("Identifiants"),
            c("secteur_financement", "Secteur de financement", Choix(&[("ex_oqn", "Privé (ex-OQN)"), ("ex_dg", "Public / ESPIC (ex-DG)")])).req().s("Identifiants").badge("*"),
            c("referentiel_id", "Référentiel articles", Ref("referentiel")).req().l().s("Organisation"),
            c("pui_id", "PUI", Ref("pui")).l().s("Organisation").aide("Même PUI pour plusieurs établissements : mode PUI centrale."),
            c("adresse", "Adresse", Texte).s("Adresse"),
            c("code_postal", "Code postal", Texte).s("Adresse"),
            c("commune", "Commune", Texte).l().s("Adresse"),
        ],
    },
    Entite {
        nom: "pole",
        table: "pole",
        libelle: "Pôle",
        pluriel: "Pôles",
        groupe: "Structure",
        etiquette: "t.code || ' – ' || t.libelle",
        champs: &[
            c("etablissement_id", "Établissement", Ref("etablissement")).req().l().p(1),
            c("code", "Code", Texte).l().aide(CODE_AUTO),
            c("libelle", "Libellé", Texte).req().l(),
            c("actif", "Actif", Booleen),
        ],
    },
    Entite {
        nom: "service",
        table: "service",
        libelle: "Service",
        pluriel: "Services",
        groupe: "Structure",
        etiquette: "t.code || ' – ' || t.libelle",
        champs: &[
            c("etablissement_id", "Établissement", Ref("etablissement")).req().l().p(2),
            c("pole_id", "Pôle", Ref("pole")).l().aide("Facultatif.").p(1),
            c("code", "Code", Texte).l().aide(CODE_AUTO),
            c("libelle", "Libellé", Texte).req().l(),
            c("type", "Type", Choix(&[("soins", "Soins"), ("medico_technique", "Médico-technique"), ("logistique", "Logistique"), ("administratif", "Administratif")])).req().l().badge("*"),
            c("actif", "Actif", Booleen),
        ],
    },
    Entite {
        nom: "uf",
        table: "uf",
        libelle: "Unité fonctionnelle",
        pluriel: "Unités fonctionnelles",
        groupe: "Structure",
        etiquette: "t.code || ' – ' || t.libelle",
        champs: &[
            c("etablissement_id", "Établissement", Ref("etablissement")).req().l().s("Rattachement"),
            c("service_id", "Service", Ref("service")).req().l().s("Rattachement").p(1),
            c("code", "Code UF", Texte).l().aide(CODE_AUTO).s("Identification"),
            c("libelle", "Libellé", Texte).req().l().s("Identification"),
            c("activite", "Activité", Choix(ACTIVITES)).req().l().s("Identification").badge("*"),
            c("actif", "Actif", Booleen).s("Identification"),
            c("code_um", "Code UM (PMSI)", Texte).s("PMSI et analytique"),
            c("centre_cout", "Section analytique", Texte).l().s("PMSI et analytique"),
            c("date_debut", "Ouverte le", Date).s("PMSI et analytique"),
            c("date_fin", "Fermée le", Date).s("PMSI et analytique"),
        ],
    },
    Entite {
        nom: "magasin",
        table: "magasin",
        libelle: "Magasin",
        pluriel: "Magasins",
        groupe: "Structure",
        etiquette: "t.code || ' – ' || t.libelle",
        champs: &[
            c("etablissement_id", "Établissement", Ref("etablissement")).req().l().p(1),
            c("code", "Code", Texte).l().aide(CODE_AUTO),
            c("libelle", "Libellé", Texte).req().l(),
            c("type", "Type", Choix(&[("pui", "PUI"), ("economat", "Économat"), ("service", "Armoire de service")])).req().l().badge("*"),
            c("uf_id", "UF desservie", Ref("uf")).l().quand("type", &["service"]),
            c("pui_id", "PUI responsable", Ref("pui")).l().quand("type", &["pui", "service"]).aide("Vide : PUI de l'établissement."),
            c("actif", "Actif", Booleen),
        ],
    },
    Entite {
        nom: "emplacement",
        table: "emplacement",
        libelle: "Emplacement",
        pluriel: "Emplacements",
        groupe: "Structure",
        etiquette: "t.code || coalesce(' – ' || t.libelle, '')",
        champs: &[
            c("magasin_id", "Magasin", Ref("magasin")).req().l().p(1),
            c("code", "Code", Texte).l().aide(CODE_AUTO),
            c("libelle", "Libellé", Texte).l(),
            c("actif", "Actif", Booleen),
        ],
    },
    Entite {
        nom: "famille",
        table: "famille",
        libelle: "Famille",
        pluriel: "Familles",
        groupe: "Articles",
        etiquette: "t.code || ' – ' || t.libelle",
        champs: &[
            c("referentiel_id", "Référentiel", Ref("referentiel")).req().l().p(1),
            c("code", "Code", Texte).l().aide(CODE_AUTO),
            c("libelle", "Libellé", Texte).req().l(),
            c("nature", "Nature", Choix(NATURES)).req().l().badge("*"),
            c("compte_comptable", "Compte comptable", Texte).l().aide("Compte de charge repris par l'export comptable."),
            c("actif", "Actif", Booleen),
        ],
    },
    Entite {
        nom: "article",
        table: "article",
        libelle: "Article",
        pluriel: "Articles",
        groupe: "Articles",
        etiquette: "t.code || ' – ' || t.designation",
        champs: &[
            c("referentiel_id", "Référentiel", Ref("referentiel")).req().l().s("Identification").p(2),
            c("code", "Code", Texte).l().aide(CODE_AUTO).s("Identification"),
            c("designation", "Désignation", Texte).req().l().s("Identification"),
            c("nature", "Nature", Choix(NATURES)).req().l().s("Identification").badge("*"),
            c("famille_id", "Famille", Ref("famille")).l().s("Identification").p(1),
            c("laboratoire_titulaire", "Laboratoire titulaire / fabricant", Texte).s("Identification").quand("nature", SANTE),
            c("conditionnement", "Conditionnement", Texte).s("Identification").aide("Ex. : boîte de 10 ampoules de 1 mL."),
            c("actif", "Actif", Booleen).s("Identification"),

            c("dci", "DCI", Texte).l().s("Médicament").quand("nature", MED),
            c("dosage", "Dosage", Texte).s("Médicament").quand("nature", MED),
            c("forme", "Forme", Texte).s("Médicament").quand("nature", MED),
            c("voie_administration", "Voie d'administration", Texte).s("Médicament").quand("nature", MED),
            c("code_atc", "Code ATC", Texte).s("Médicament").quand("nature", MED),
            c("au_livret", "Au livret thérapeutique", Booleen).s("Médicament").quand("nature", MED),
            c("prescription_restreinte", "Prescription restreinte", Choix(&[("aucune", "Aucune"), ("reserve_hospitaliere", "Réserve hospitalière"), ("prescription_initiale_hospitaliere", "Prescription initiale hospitalière"), ("prescription_reservee_specialistes", "Prescription réservée à des spécialistes"), ("surveillance_particuliere", "Surveillance particulière")])).s("Médicament").quand("nature", MED).badge("*"),

            c("classe_dm", "Classe du DM", Choix(&[("I", "I"), ("Is", "I stérile"), ("Im", "I avec mesurage"), ("IIa", "IIa"), ("IIb", "IIb"), ("III", "III")])).s("Dispositif médical").quand("nature", DM),
            c("sterile", "Stérile", Booleen).s("Dispositif médical").quand("nature", DM),
            c("usage_unique", "Usage unique", Booleen).s("Dispositif médical").quand("nature", DM),

            c("ucd13", "Code UCD 13", Texte).l().s("Codes").quand("nature", MED),
            c("ucd7", "Code UCD 7", Texte).s("Codes").quand("nature", MED),
            c("cip13", "Code CIP 13", Texte).s("Codes").quand("nature", MED),
            c("lpp", "Code LPP", Texte).s("Codes").quand("nature", DM),
            c("gtin", "GTIN / EAN", Texte).s("Codes"),

            c("liste", "Classement", Choix(&[("aucune", "Aucun"), ("liste_I", "Liste I"), ("liste_II", "Liste II"), ("stupefiant", "Stupéfiant"), ("assimile_stupefiant", "Assimilé stupéfiant")])).req().l().s("Sécurité et conservation").quand("nature", MED).badge("*"),
            c("a_risque", "À risque (liste de la PUI)", Booleen).l().s("Sécurité et conservation").quand("nature", MED).badge("À risque"),
            c("derive_sang", "Médicament dérivé du sang", Booleen).s("Sécurité et conservation").quand("nature", MED).badge("MDS").aide("Impose le lot obligatoire à la réception et à la sortie."),
            c("cytotoxique", "Cytotoxique", Booleen).s("Sécurité et conservation").quand("nature", MED).badge("Cytotoxique"),
            c("conservation", "Conservation", Choix(&[("ambiante", "Température ambiante"), ("refrigere", "Réfrigéré (2 à 8 °C)"), ("congele", "Congelé")])).req().s("Sécurité et conservation").quand("nature", SANTE),
            c("photosensible", "Craint la lumière", Booleen).s("Sécurité et conservation").quand("nature", MED),

            c("unite_achat", "Unité d'achat", Texte).s("Unités"),
            c("unite_stock", "Unité de stock", Texte).req().s("Unités"),
            c("unite_delivrance", "Unité de délivrance", Texte).s("Unités"),
            c("coef_achat_stock", "Unités de stock par unité d'achat", Decimal).req().s("Unités"),
            c("coef_stock_delivrance", "Unités de délivrance par unité de stock", Decimal).req().s("Unités"),

            c("lot_entree", "Lot à la réception", Choix(TRAC)).req().s("Traçabilité"),
            c("lot_sortie", "Lot à la sortie", Choix(TRAC)).req().s("Traçabilité"),
            c("serie_entree", "N° de série à la réception", Choix(TRAC)).req().s("Traçabilité"),
            c("serie_sortie", "N° de série à la sortie", Choix(TRAC)).req().s("Traçabilité"),
            c("peremption_entree", "Péremption à la réception", Choix(TRAC)).req().s("Traçabilité"),
            c("peremption_sortie", "Péremption à la sortie", Choix(TRAC)).req().s("Traçabilité"),

            c("compte_comptable", "Compte comptable", Texte).s("Comptabilité").aide("Vide : compte de la famille."),
            c("observations", "Observations", TexteLong).s("Comptabilité"),
        ],
    },
    Entite {
        nom: "article_site",
        table: "article_site",
        libelle: "Article-site",
        pluriel: "Articles-sites",
        groupe: "Articles",
        etiquette: "(select a.code || ' – ' || a.designation from article a where a.id = t.article_id) \
                    || ' @ ' || (select e.code from etablissement e where e.id = t.etablissement_id)",
        champs: &[
            c("article_id", "Article", Ref("article")).req().l().s("Rattachement").p(1),
            c("etablissement_id", "Établissement", Ref("etablissement")).req().l().s("Rattachement"),
            c("code_local", "Code local", Texte).l().s("Rattachement"),
            c("actif", "Actif", Booleen).s("Rattachement"),
            c("stock_mini", "Stock mini", Decimal).l().s("Seuils"),
            c("stock_maxi", "Stock maxi", Decimal).l().s("Seuils"),
            c("point_commande", "Point de commande", Decimal).l().s("Seuils"),
            c("lot_entree", "Lot à la réception", Choix(TRAC)).s("Traçabilité locale").aide("Vide : réglage de l'article."),
            c("lot_sortie", "Lot à la sortie", Choix(TRAC)).s("Traçabilité locale"),
            c("serie_entree", "N° de série à la réception", Choix(TRAC)).s("Traçabilité locale"),
            c("serie_sortie", "N° de série à la sortie", Choix(TRAC)).s("Traçabilité locale"),
            c("peremption_entree", "Péremption à la réception", Choix(TRAC)).s("Traçabilité locale"),
            c("peremption_sortie", "Péremption à la sortie", Choix(TRAC)).s("Traçabilité locale"),
        ],
    },
    Entite {
        nom: "risque_service",
        table: "risque_service",
        libelle: "Médicament à risque du service",
        pluriel: "Médicaments à risque des services",
        groupe: "Articles",
        etiquette: "(select a.code from article a where a.id = t.article_id) \
                    || ' @ ' || (select s.code from service s where s.id = t.service_id)",
        champs: &[
            c("article_id", "Article", Ref("article")).req().l().p(1),
            c("service_id", "Service", Ref("service")).req().l(),
            c("motif", "Motif", Texte).l(),
        ],
    },
    Entite {
        nom: "fournisseur",
        table: "fournisseur",
        libelle: "Fournisseur",
        pluriel: "Fournisseurs",
        groupe: "Achats",
        etiquette: "t.code || ' – ' || t.raison_sociale",
        champs: &[
            c("code", "Code", Texte).l().aide(CODE_AUTO).s("Identification"),
            c("raison_sociale", "Raison sociale", Texte).req().l().s("Identification"),
            c("type", "Type", Choix(&[("fournisseur", "Fournisseur"), ("laboratoire", "Laboratoire"), ("grossiste", "Grossiste-répartiteur"), ("centrale", "Centrale d'achat")])).req().l().s("Identification").badge("*"),
            c("siret", "SIRET", Texte).s("Identification"),
            c("actif", "Actif", Booleen).s("Identification"),
            c("adresse", "Adresse", Texte).s("Coordonnées"),
            c("code_postal", "Code postal", Texte).s("Coordonnées"),
            c("commune", "Commune", Texte).l().s("Coordonnées"),
            c("telephone", "Téléphone", Texte).s("Coordonnées"),
            c("email", "Courriel", Texte).s("Coordonnées"),
        ],
    },
    Entite {
        nom: "article_fournisseur",
        table: "article_fournisseur",
        libelle: "Prix fournisseur",
        pluriel: "Prix fournisseurs",
        groupe: "Achats",
        etiquette: "(select a.code from article a where a.id = t.article_id) \
                    || ' / ' || (select f.code from fournisseur f where f.id = t.fournisseur_id)",
        champs: &[
            c("article_id", "Article", Ref("article")).req().l().s("Rattachement").p(1),
            c("fournisseur_id", "Fournisseur", Ref("fournisseur")).req().l().s("Rattachement"),
            c("etablissement_id", "Établissement", Ref("etablissement")).l().s("Rattachement").aide("Vide : vaut pour tout le groupe."),
            c("reference_fournisseur", "Référence fournisseur", Texte).l().s("Rattachement"),
            c("rang", "Rang (1 = principal)", Entier).req().l().s("Rattachement"),
            c("actif", "Actif", Booleen).s("Rattachement"),
            c("quantite_par_colis", "Quantité par colis", Decimal).s("Prix"),
            c("prix_unitaire_ht", "Prix unitaire HT", Decimal).l().s("Prix"),
            c("taux_tva", "TVA (%)", Decimal).s("Prix"),
            c("date_debut", "Prix valable du", Date).s("Prix"),
            c("date_fin", "au", Date).s("Prix"),
        ],
    },
    Entite {
        nom: "compteur",
        table: "compteur",
        libelle: "Compteur de codes",
        pluriel: "Compteurs de codes",
        groupe: "Paramètres",
        etiquette: "t.entite || coalesce(nullif(' / ' || t.variante, ' / '), '') || ' : ' || t.prefixe || lpad(t.prochain::text, t.longueur, '0')",
        champs: &[
            c("entite", "Fichier", Choix(&[("article", "Articles"), ("fournisseur", "Fournisseurs"), ("famille", "Familles"), ("etablissement", "Établissements"), ("entite_juridique", "Entités juridiques"), ("pui", "PUI"), ("referentiel", "Référentiels"), ("pole", "Pôles"), ("service", "Services"), ("uf", "UF"), ("magasin", "Magasins"), ("emplacement", "Emplacements")])).req().l(),
            c("variante", "Variante", Texte).l().aide("Nature (articles) ou type (magasins, fournisseurs…) concerné ; vide : toutes les fiches du fichier."),
            c("prefixe", "Préfixe", Texte).l(),
            c("longueur", "Nombre de chiffres", Entier).req().l(),
            c("prochain", "Prochain numéro", Entier).req().l(),
            c("actif", "Actif", Booleen).l(),
        ],
    },
];

pub fn trouver(nom: &str) -> Option<&'static Entite> {
    ENTITES.iter().find(|e| e.nom == nom)
}

impl Entite {
    pub fn champ(&self, col: &str) -> Option<&Champ> {
        self.champs.iter().find(|c| c.col == col)
    }
}

/// Description envoyée à la page.
pub fn description() -> Value {
    let entites: Vec<Value> = ENTITES
        .iter()
        .map(|e| {
            let champs: Vec<Value> = e
                .champs
                .iter()
                .map(|c| {
                    let (genre, extra) = match &c.genre {
                        Texte => ("texte", Value::Null),
                        TexteLong => ("texte_long", Value::Null),
                        Entier => ("entier", Value::Null),
                        Decimal => ("decimal", Value::Null),
                        Booleen => ("booleen", Value::Null),
                        Date => ("date", Value::Null),
                        Choix(v) => ("choix", json!(v.iter().map(|(k, l)| json!([k, l])).collect::<Vec<_>>())),
                        Ref(cible) => ("ref", json!(cible)),
                    };
                    json!({"col": c.col, "libelle": c.libelle, "genre": genre, "extra": extra,
                           "requis": c.requis, "liste": c.liste, "aide": c.aide,
                           "section": if c.section.is_empty() { "Général" } else { c.section },
                           "quand": c.quand.map(|(col, v)| json!({"col": col, "valeurs": v})),
                           "badge": c.badge, "parent": c.parent})
                })
                .collect();
            json!({"nom": e.nom, "libelle": e.libelle, "pluriel": e.pluriel, "groupe": e.groupe, "champs": champs})
        })
        .collect();
    json!({ "entites": entites })
}
