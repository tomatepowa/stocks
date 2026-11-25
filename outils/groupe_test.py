"""Charge par l'API un groupe de cliniques de test complet (noms fictifs, aucun code officiel).

Scénarios (--scenario=N) :
  1. Quatre établissements, chacun avec sa PUI : 2 MCO de 200 lits, 1 SMR de 60 lits, 1 HAD de 200 places.
     Médicaments et économat communs aux quatre ; DM communs aux MCO ; DM de soins courants communs
     au SMR et à la HAD ; DMI propres à chaque établissement.
  2. Une PUI centrale pour trois MCO de 200 lits, chaque MCO ayant ses propres magasins et emplacements ;
     tous les articles des MCO sont communs. À côté, trois petits SMR (40 lits) et une HAD, chacun avec
     sa PUI : ils ne partagent que les médicaments ; ni DMI au SMR ni à la HAD ; DM et économat propres
     à chacun.

Familles communes au groupe. Compteurs propres à chaque site (UF, services, magasins…) et à chaque
référentiel de DMI. Articles-sites créés par référencement en masse.

Usage : python -I outils/groupe_test.py [--scenario=2] [http://127.0.0.1:8090]
"""
import json
import random
import sys
import time
import urllib.error
import urllib.request

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
SCENARIO = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--scenario=")), "1")
BASE = (ARGS[0] if ARGS else "http://127.0.0.1:8090").rstrip("/") + "/api"
hasard = random.Random(42)
compte = {}


def appeler(chemin, corps):
    req = urllib.request.Request(f"{BASE}{chemin}", data=json.dumps(corps).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{chemin} {corps} : {e.read().decode('utf-8')}")


def creer(entite, corps):
    req = urllib.request.Request(f"{BASE}/e/{entite}", data=json.dumps(corps).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            compte[entite] = compte.get(entite, 0) + 1
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{entite} {corps} : {e.read().decode('utf-8')}")


# ------------------------------------------------------------------ Scénarios
# PUI : clé -> (libellé, cadre) ; le premier établissement desservi en est le siège.
# Référentiel : code -> (libellé, contenu, PUI gestionnaire ou None) ;
#   contenu : med, dm, dm_courant, dm_local, dmi, eco.
# Établissement : court, nom, ville, type (MCO, SMR, HAD), gabarit de services, PUI,
#   référentiels par nature (un code, ou une liste : commun puis local).

def _mco(court, nom, ville, pui, refs):
    return dict(court=court, nom=nom, ville=ville, type="MCO", gabarit="MCO", pui=pui, refs=refs)


SCENARIOS = {
    "1": dict(
        puis={"PIN": ("PUI Clinique des Pins", "propre"), "CHE": ("PUI Clinique des Chênes", "propre"),
              "OLI": ("PUI Centre SMR des Oliviers", "propre"), "GAR": ("PUI HAD de la Garrigue", "propre")},
        refs={"MED-GRP": ("Médicaments du groupe", "med", "PIN"), "DM-MCO": ("DM des MCO", "dm", "PIN"),
              "DM-SMRHAD": ("DM de soins courants SMR et HAD", "dm_courant", "OLI"),
              "ECO-GRP": ("Économat du groupe", "eco", None),
              "DMI-PIN": ("DMI Clinique des Pins", "dmi", "PIN"), "DMI-CHE": ("DMI Clinique des Chênes", "dmi", "CHE"),
              "DMI-OLI": ("DMI Centre SMR des Oliviers", "dmi", "OLI"), "DMI-GAR": ("DMI HAD de la Garrigue", "dmi", "GAR")},
        etabs=[
            _mco("PIN", "Clinique des Pins", "Ville-Test-Nord", "PIN",
                 {"medicament": "MED-GRP", "dm": "DM-MCO", "dmi": "DMI-PIN", "economat": "ECO-GRP"}),
            _mco("CHE", "Clinique des Chênes", "Ville-Test-Sud", "CHE",
                 {"medicament": "MED-GRP", "dm": "DM-MCO", "dmi": "DMI-CHE", "economat": "ECO-GRP"}),
            dict(court="OLI", nom="Centre SMR des Oliviers", ville="Ville-Test-Est", type="SMR", gabarit="SMR", pui="OLI",
                 refs={"medicament": "MED-GRP", "dm": "DM-SMRHAD", "dmi": "DMI-OLI", "economat": "ECO-GRP"}),
            dict(court="GAR", nom="HAD de la Garrigue", ville="Ville-Test-Ouest", type="HAD", gabarit="HAD", pui="GAR",
                 refs={"medicament": "MED-GRP", "dm": "DM-SMRHAD", "dmi": "DMI-GAR", "economat": "ECO-GRP"}),
        ]),
    "2": dict(
        puis={"CENTRALE": ("PUI centrale des MCO", "convention"), "LAV": ("PUI SMR des Lavandes", "propre"),
              "CYP": ("PUI SMR des Cyprès", "propre"), "AMA": ("PUI SMR des Amandiers", "propre"),
              "LIT": ("PUI HAD du Littoral", "propre")},
        refs={"MED-MCO": ("Médicaments des MCO", "med", "CENTRALE"), "DM-MCO": ("DM des MCO", "dm", "CENTRALE"),
              "DM-SUD": ("DM propres à la Clinique du Sud", "dm_local", "CENTRALE"),
              "DMI-MCO": ("DMI des MCO", "dmi", "CENTRALE"), "ECO-MCO": ("Économat des MCO", "eco", None),
              "MED-SMRHAD": ("Médicaments des SMR et de la HAD", "med", "LAV"),
              "DM-LAV": ("DM SMR des Lavandes", "dm_courant", "LAV"), "DM-CYP": ("DM SMR des Cyprès", "dm_courant", "CYP"),
              "DM-AMA": ("DM SMR des Amandiers", "dm_courant", "AMA"), "DM-LIT": ("DM HAD du Littoral", "dm_courant", "LIT"),
              "ECO-LAV": ("Économat SMR des Lavandes", "eco", None), "ECO-CYP": ("Économat SMR des Cyprès", "eco", None),
              "ECO-AMA": ("Économat SMR des Amandiers", "eco", None), "ECO-LIT": ("Économat HAD du Littoral", "eco", None)},
        etabs=[
            _mco("NOR", "Clinique du Nord", "Ville-Test-Nord", "CENTRALE",
                 {"medicament": "MED-MCO", "dm": "DM-MCO", "dmi": "DMI-MCO", "economat": "ECO-MCO"}),
            _mco("CEN", "Clinique du Centre", "Ville-Test-Centre", "CENTRALE",
                 {"medicament": "MED-MCO", "dm": "DM-MCO", "dmi": "DMI-MCO", "economat": "ECO-MCO"}),
            _mco("SUD", "Clinique du Sud", "Ville-Test-Sud", "CENTRALE",
                 {"medicament": "MED-MCO", "dm": ["DM-MCO", "DM-SUD"], "dmi": "DMI-MCO", "economat": "ECO-MCO"}),
        ] + [
            dict(court=c, nom=f"SMR des {n}", ville=v, type="SMR", gabarit="SMR_PETIT", pui=c,
                 refs={"medicament": "MED-SMRHAD", "dm": f"DM-{c}", "economat": f"ECO-{c}"})
            for c, n, v in [("LAV", "Lavandes", "Ville-Test-Est"), ("CYP", "Cyprès", "Ville-Test-Ouest"),
                            ("AMA", "Amandiers", "Ville-Test-Plaine")]
        ] + [
            dict(court="LIT", nom="HAD du Littoral", ville="Ville-Test-Côte", type="HAD", gabarit="HAD", pui="LIT",
                 refs={"medicament": "MED-SMRHAD", "dm": "DM-LIT", "economat": "ECO-LIT"}),
        ]),
}

# DM propres à un site, en plus du référentiel commun (ex. : activité particulière).
DM_LOCAUX = [
    ("Kit de péridurale obstétricale", "PERF", True, "kit"),
    ("Sonde de monitorage fœtal", "SONDES", True, "unité"),
    ("Clamp de cordon ombilical", "SUTURE", True, "unité"),
    ("Ventouse obstétricale à usage unique", "BLOC", True, "unité"),
    ("Tire-lait, téterelle stérile", "PROT", True, "unité"),
    ("Bracelet d'identification nouveau-né", "PROT", False, "unité"),
]

# Services : (libellé, type, pôle, lits ou places, [UF (libellé, activité)])
SERVICES_MCO = [
    ("Chirurgie orthopédique", "soins", "CHIR", 40, [("Hospitalisation complète orthopédie", "MCO"), ("Consultations orthopédie", "MCO")]),
    ("Chirurgie viscérale et digestive", "soins", "CHIR", 30, [("Hospitalisation complète viscéral", "MCO"), ("Consultations viscéral", "MCO")]),
    ("Urologie", "soins", "CHIR", 20, [("Hospitalisation complète urologie", "MCO")]),
    ("Chirurgie ambulatoire", "soins", "CHIR", 30, [("Unité de chirurgie ambulatoire", "MCO")]),
    ("Médecine polyvalente", "soins", "MED", 35, [("Hospitalisation complète médecine", "MCO"), ("Hôpital de jour médecine", "MCO")]),
    ("Cardiologie", "soins", "MED", 25, [("Hospitalisation complète cardiologie", "MCO"), ("Cardiologie interventionnelle", "MCO")]),
    ("Gastro-entérologie", "soins", "MED", 12, [("Hospitalisation gastro-entérologie", "MCO"), ("Endoscopies", "MCO")]),
    ("Unité de surveillance continue", "soins", "MED", 8, [("Surveillance continue", "MCO")]),
    ("Urgences", "soins", "MED", 0, [("Accueil des urgences", "MCO")]),
    ("Bloc opératoire", "medico_technique", "MT", 0, [("Salles d'opération", "MCO"), ("Salle de surveillance post-interventionnelle", "MCO")]),
    ("Imagerie", "medico_technique", "MT", 0, [("Radiologie et scanner", "MCO")]),
    ("Pharmacie", "logistique", None, 0, [("Pharmacie à usage intérieur", "autre")]),
    ("Stérilisation", "logistique", None, 0, [("Stérilisation centrale", "autre")]),
    ("Hôtellerie et logistique", "logistique", None, 0, [("Économat et magasin", "autre")]),
    ("Direction", "administratif", None, 0, [("Administration", "autre")]),
]
SERVICES_SMR = [
    ("SMR polyvalent", "soins", None, 30, [("Hospitalisation complète SMR polyvalent", "SMR"), ("Hôpital de jour SMR polyvalent", "SMR")]),
    ("SMR locomoteur", "soins", None, 30, [("Hospitalisation complète SMR locomoteur", "SMR"), ("Hôpital de jour SMR locomoteur", "SMR")]),
    ("Plateau de rééducation", "medico_technique", None, 0, [("Kinésithérapie et balnéothérapie", "SMR")]),
    ("Pharmacie", "logistique", None, 0, [("Pharmacie à usage intérieur", "autre")]),
    ("Hôtellerie et logistique", "logistique", None, 0, [("Économat et magasin", "autre")]),
    ("Direction", "administratif", None, 0, [("Administration", "autre")]),
]
SERVICES_HAD = [
    ("Antenne Nord", "soins", None, 70, [("HAD secteur Nord", "HAD")]),
    ("Antenne Sud", "soins", None, 70, [("HAD secteur Sud", "HAD")]),
    ("Antenne Ouest", "soins", None, 60, [("HAD secteur Ouest", "HAD")]),
    ("Coordination des soins", "soins", None, 0, [("Coordination et admissions", "HAD")]),
    ("Pharmacie", "logistique", None, 0, [("Pharmacie à usage intérieur", "autre")]),
    ("Hôtellerie et logistique", "logistique", None, 0, [("Économat et magasin", "autre")]),
    ("Direction", "administratif", None, 0, [("Administration", "autre")]),
]
SERVICES_SMR_PETIT = [
    ("SMR polyvalent", "soins", None, 40, [("Hospitalisation complète SMR polyvalent", "SMR"), ("Hôpital de jour SMR", "SMR")]),
    ("Pharmacie", "logistique", None, 0, [("Pharmacie à usage intérieur", "autre")]),
    ("Hôtellerie et logistique", "logistique", None, 0, [("Économat et magasin", "autre")]),
    ("Direction", "administratif", None, 0, [("Administration", "autre")]),
]
SERVICES = {"MCO": SERVICES_MCO, "SMR": SERVICES_SMR, "SMR_PETIT": SERVICES_SMR_PETIT, "HAD": SERVICES_HAD}
POLES = {"CHIR": "Pôle chirurgie", "MED": "Pôle médecine", "MT": "Pôle médico-technique"}

# ------------------------------------------------------------------ Articles

# Médicaments : (DCI, [(dosage, forme, voie, unité)], famille, classement, à risque, options)
MEDICAMENTS = [
    ("Paracétamol", [("1 g", "Comprimé", "Orale", "comprimé"), ("500 mg", "Gélule", "Orale", "gélule"), ("1 g/100 mL", "Solution pour perfusion", "IV", "flacon")], "ANTALG", "aucune", False, {}),
    ("Néfopam", [("20 mg/2 mL", "Solution injectable", "IV", "ampoule")], "ANTALG", "liste_I", False, {}),
    ("Tramadol", [("50 mg", "Gélule", "Orale", "gélule"), ("100 mg/2 mL", "Solution injectable", "IV", "ampoule")], "ANTALG", "liste_I", False, {}),
    ("Kétoprofène", [("100 mg", "Poudre pour solution injectable", "IV", "flacon")], "ANTALG", "liste_II", False, {}),
    ("Morphine", [("10 mg/1 mL", "Solution injectable", "IV/SC", "ampoule"), ("10 mg", "Gélule LP", "Orale", "gélule"), ("1 mg/mL", "Solution injectable", "IV", "ampoule")], "ANTALG", "stupefiant", True, {}),
    ("Oxycodone", [("10 mg", "Comprimé LP", "Orale", "comprimé"), ("5 mg", "Gélule", "Orale", "gélule"), ("10 mg/mL", "Solution injectable", "IV", "ampoule")], "ANTALG", "stupefiant", True, {}),
    ("Fentanyl", [("100 µg/2 mL", "Solution injectable", "IV", "ampoule"), ("25 µg/h", "Dispositif transdermique", "Cutanée", "patch")], "ANESTH", "stupefiant", True, {}),
    ("Sufentanil", [("50 µg/10 mL", "Solution injectable", "IV", "ampoule")], "ANESTH", "stupefiant", True, {}),
    ("Rémifentanil", [("1 mg", "Poudre pour solution injectable", "IV", "flacon")], "ANESTH", "stupefiant", True, {}),
    ("Kétamine", [("50 mg/5 mL", "Solution injectable", "IV", "ampoule")], "ANESTH", "assimile_stupefiant", True, {}),
    ("Propofol", [("10 mg/mL 20 mL", "Émulsion injectable", "IV", "ampoule"), ("10 mg/mL 50 mL", "Émulsion injectable", "IV", "flacon")], "ANESTH", "liste_I", True, {}),
    ("Midazolam", [("5 mg/5 mL", "Solution injectable", "IV", "ampoule")], "ANESTH", "assimile_stupefiant", True, {}),
    ("Rocuronium", [("50 mg/5 mL", "Solution injectable", "IV", "flacon")], "ANESTH", "liste_I", True, {"conservation": "refrigere"}),
    ("Suxaméthonium", [("100 mg/2 mL", "Solution injectable", "IV", "ampoule")], "ANESTH", "liste_I", True, {"conservation": "refrigere"}),
    ("Lidocaïne", [("1 % 20 mL", "Solution injectable", "Locale", "flacon"), ("2 % 20 mL", "Solution injectable", "Locale", "flacon")], "ANESTH", "liste_II", False, {}),
    ("Ropivacaïne", [("2 mg/mL 100 mL", "Solution pour perfusion", "Périnerveuse", "poche"), ("7,5 mg/mL 20 mL", "Solution injectable", "Périnerveuse", "ampoule")], "ANESTH", "liste_II", False, {}),
    ("Éphédrine", [("30 mg/10 mL", "Solution injectable en seringue", "IV", "seringue")], "ANESTH", "liste_I", False, {}),
    ("Noradrénaline", [("8 mg/4 mL", "Solution à diluer", "IV", "ampoule")], "CARDIO", "liste_I", True, {}),
    ("Adrénaline", [("1 mg/1 mL", "Solution injectable", "IV", "ampoule")], "CARDIO", "liste_I", True, {}),
    ("Amiodarone", [("200 mg", "Comprimé", "Orale", "comprimé"), ("150 mg/3 mL", "Solution injectable", "IV", "ampoule")], "CARDIO", "liste_I", False, {}),
    ("Bisoprolol", [("2,5 mg", "Comprimé", "Orale", "comprimé"), ("5 mg", "Comprimé", "Orale", "comprimé")], "CARDIO", "liste_I", False, {}),
    ("Furosémide", [("40 mg", "Comprimé", "Orale", "comprimé"), ("20 mg/2 mL", "Solution injectable", "IV", "ampoule")], "CARDIO", "liste_I", False, {}),
    ("Ramipril", [("5 mg", "Gélule", "Orale", "gélule")], "CARDIO", "liste_I", False, {}),
    ("Nicardipine", [("10 mg/10 mL", "Solution injectable", "IV", "ampoule")], "CARDIO", "liste_I", False, {}),
    ("Héparine sodique", [("25 000 UI/5 mL", "Solution injectable", "IV", "flacon")], "ANTICOAG", "liste_I", True, {}),
    ("Énoxaparine", [("4 000 UI/0,4 mL", "Solution injectable en seringue", "SC", "seringue"), ("6 000 UI/0,6 mL", "Solution injectable en seringue", "SC", "seringue")], "ANTICOAG", "liste_I", True, {}),
    ("Apixaban", [("2,5 mg", "Comprimé", "Orale", "comprimé"), ("5 mg", "Comprimé", "Orale", "comprimé")], "ANTICOAG", "liste_I", True, {}),
    ("Warfarine", [("5 mg", "Comprimé", "Orale", "comprimé")], "ANTICOAG", "liste_I", True, {}),
    ("Acide tranexamique", [("1 g/10 mL", "Solution injectable", "IV", "ampoule")], "ANTICOAG", "liste_I", False, {}),
    ("Amoxicilline", [("1 g", "Comprimé", "Orale", "comprimé"), ("1 g", "Poudre pour solution injectable", "IV", "flacon")], "ANTIINF", "liste_I", False, {}),
    ("Amoxicilline/acide clavulanique", [("1 g/125 mg", "Comprimé", "Orale", "comprimé"), ("1 g/200 mg", "Poudre pour solution injectable", "IV", "flacon")], "ANTIINF", "liste_I", False, {}),
    ("Céfazoline", [("2 g", "Poudre pour solution injectable", "IV", "flacon")], "ANTIINF", "liste_I", False, {}),
    ("Ceftriaxone", [("1 g", "Poudre pour solution injectable", "IV", "flacon")], "ANTIINF", "liste_I", False, {}),
    ("Gentamicine", [("80 mg/2 mL", "Solution injectable", "IV", "ampoule")], "ANTIINF", "liste_I", True, {}),
    ("Vancomycine", [("1 g", "Poudre pour solution injectable", "IV", "flacon")], "ANTIINF", "liste_I", False, {}),
    ("Métronidazole", [("500 mg/100 mL", "Solution pour perfusion", "IV", "poche")], "ANTIINF", "liste_I", False, {}),
    ("Ciprofloxacine", [("500 mg", "Comprimé", "Orale", "comprimé")], "ANTIINF", "liste_I", False, {}),
    ("Fluconazole", [("200 mg", "Gélule", "Orale", "gélule")], "ANTIINF", "liste_I", False, {}),
    ("Insuline asparte", [("100 UI/mL", "Solution injectable en stylo", "SC", "stylo")], "ENDOC", "liste_II", True, {"conservation": "refrigere"}),
    ("Insuline glargine", [("100 UI/mL", "Solution injectable en stylo", "SC", "stylo")], "ENDOC", "liste_II", True, {"conservation": "refrigere"}),
    ("Insuline humaine", [("100 UI/mL", "Solution injectable", "IV/SC", "flacon")], "ENDOC", "liste_II", True, {"conservation": "refrigere"}),
    ("Metformine", [("1000 mg", "Comprimé", "Orale", "comprimé")], "ENDOC", "liste_I", False, {}),
    ("Lévothyroxine", [("75 µg", "Comprimé", "Orale", "comprimé")], "ENDOC", "liste_I", False, {}),
    ("Dexaméthasone", [("4 mg/1 mL", "Solution injectable", "IV", "ampoule")], "CORTICO", "liste_I", False, {}),
    ("Méthylprednisolone", [("40 mg", "Poudre pour solution injectable", "IV", "flacon")], "CORTICO", "liste_I", False, {}),
    ("Prednisolone", [("20 mg", "Comprimé orodispersible", "Orale", "comprimé")], "CORTICO", "liste_I", False, {}),
    ("Oméprazole", [("20 mg", "Gélule", "Orale", "gélule")], "GASTRO", "aucune", False, {}),
    ("Ésoméprazole", [("40 mg", "Poudre pour solution injectable", "IV", "flacon")], "GASTRO", "liste_II", False, {}),
    ("Ondansétron", [("4 mg/2 mL", "Solution injectable", "IV", "ampoule")], "GASTRO", "liste_I", False, {}),
    ("Métoclopramide", [("10 mg/2 mL", "Solution injectable", "IV", "ampoule")], "GASTRO", "liste_II", False, {}),
    ("Macrogol", [("10 g", "Poudre pour solution buvable", "Orale", "sachet")], "GASTRO", "aucune", False, {}),
    ("Lactulose", [("10 g/15 mL", "Solution buvable", "Orale", "sachet")], "GASTRO", "aucune", False, {}),
    ("Chlorure de potassium", [("10 % 10 mL", "Solution à diluer", "IV", "ampoule"), ("600 mg", "Gélule LP", "Orale", "gélule")], "SOLUTES", "aucune", True, {}),
    ("Chlorure de sodium", [("0,9 % 100 mL", "Solution pour perfusion", "IV", "poche"), ("0,9 % 500 mL", "Solution pour perfusion", "IV", "poche"), ("0,9 % 1000 mL", "Solution pour perfusion", "IV", "poche"), ("20 % 10 mL", "Solution à diluer", "IV", "ampoule")], "SOLUTES", "aucune", False, {}),
    ("Glucose", [("5 % 500 mL", "Solution pour perfusion", "IV", "poche"), ("30 % 10 mL", "Solution injectable", "IV", "ampoule")], "SOLUTES", "aucune", False, {}),
    ("Ringer lactate", [("500 mL", "Solution pour perfusion", "IV", "poche")], "SOLUTES", "aucune", False, {}),
    ("Sulfate de magnésium", [("15 % 10 mL", "Solution injectable", "IV", "ampoule")], "SOLUTES", "aucune", True, {}),
    ("Albumine humaine", [("20 % 100 mL", "Solution pour perfusion", "IV", "flacon"), ("4 % 500 mL", "Solution pour perfusion", "IV", "flacon")], "MDS", "aucune", False, {"derive_sang": True}),
    ("Immunoglobulines humaines", [("10 g/100 mL", "Solution pour perfusion", "IV", "flacon")], "MDS", "aucune", False, {"derive_sang": True, "conservation": "refrigere", "prescription_restreinte": "reserve_hospitaliere"}),
    ("Fibrinogène humain", [("1,5 g", "Poudre pour solution injectable", "IV", "flacon")], "MDS", "aucune", False, {"derive_sang": True, "prescription_restreinte": "reserve_hospitaliere"}),
    ("Complexe prothrombinique humain", [("500 UI", "Poudre pour solution injectable", "IV", "flacon")], "MDS", "aucune", False, {"derive_sang": True, "prescription_restreinte": "reserve_hospitaliere"}),
    ("Haloperidol", [("5 mg/1 mL", "Solution injectable", "IM", "ampoule")], "NEURO", "liste_I", False, {}),
    ("Oxazépam", [("10 mg", "Comprimé", "Orale", "comprimé")], "NEURO", "liste_I", False, {}),
    ("Zopiclone", [("7,5 mg", "Comprimé", "Orale", "comprimé")], "NEURO", "liste_I", False, {}),
    ("Lévétiracétam", [("500 mg", "Comprimé", "Orale", "comprimé")], "NEURO", "liste_I", False, {}),
    ("Salbutamol", [("5 mg/2,5 mL", "Solution pour inhalation", "Inhalée", "récipient unidose")], "RESPI", "liste_II", False, {}),
    ("Ipratropium", [("0,5 mg/2 mL", "Solution pour inhalation", "Inhalée", "récipient unidose")], "RESPI", "liste_II", False, {}),
    ("Méthotrexate", [("25 mg/1 mL", "Solution injectable", "SC", "seringue")], "CYTO", "liste_I", True, {"cytotoxique": True}),
    ("Bléomycine", [("15 000 UI", "Poudre pour solution injectable", "IV", "flacon")], "CYTO", "liste_I", True, {"cytotoxique": True, "conservation": "refrigere", "prescription_restreinte": "reserve_hospitaliere"}),
]

FAMILLES = {
    "medicament": [("ANTALG", "Antalgiques"), ("ANESTH", "Anesthésie et réanimation"), ("CARDIO", "Cardiovasculaire"),
                   ("ANTICOAG", "Anticoagulants et hémostase"), ("ANTIINF", "Anti-infectieux"), ("ENDOC", "Diabète et endocrinologie"),
                   ("CORTICO", "Corticoïdes"), ("GASTRO", "Gastro-entérologie"), ("SOLUTES", "Solutés et électrolytes"),
                   ("MDS", "Médicaments dérivés du sang"), ("NEURO", "Neurologie et psychiatrie"), ("RESPI", "Respiratoire"),
                   ("CYTO", "Cytotoxiques")],
    "dm": [("INJ", "Injection et prélèvement"), ("PERF", "Perfusion et abord vasculaire"), ("PANS", "Pansements et compresses"),
           ("SONDES", "Sondes et drainage"), ("PROT", "Gants et protection"), ("SUTURE", "Suture et instruments à usage unique"),
           ("BLOC", "Consommables de bloc")],
    "dmi": [("HANCHE", "Prothèses de hanche"), ("GENOU", "Prothèses de genou"), ("OSTEO", "Ostéosynthèse"),
            ("CARDIO", "Implants cardiovasculaires"), ("VISC", "Implants viscéraux"), ("URO", "Implants urologiques")],
    "economat": [("SOLS", "Entretien des sols"), ("SURF", "Nettoyage et désinfection des surfaces"), ("DECHETS", "Sacs et déchets"),
                 ("PAPIER", "Papier et essuyage"), ("MAINS", "Hygiène des mains"), ("DROG", "Droguerie et petit matériel")],
}


def dm_liste():
    l = []
    for v in ["1 mL", "2 mL", "5 mL", "10 mL", "20 mL", "50 mL"]:
        l.append((f"Seringue {v} luer lock", "INJ", True, "seringue"))
    for g in ["18G", "21G", "23G", "25G"]:
        l.append((f"Aiguille hypodermique {g}", "INJ", True, "aiguille"))
    for g in ["14G", "16G", "18G", "20G", "22G", "24G"]:
        l.append((f"Cathéter court {g}", "PERF", True, "cathéter"))
    for x in ["Tubulure de perfusion par gravité", "Tubulure pour pompe volumétrique", "Prolongateur 25 cm", "Prolongateur 150 cm",
              "Robinet 3 voies", "Rampe 3 robinets", "Bouchon obturateur", "Valve bidirectionnelle", "Aiguille de Huber 20G",
              "Perfuseur de précision", "Filtre de perfusion 0,2 µm", "Garrot à usage unique"]:
        l.append((x, "PERF", True, "unité"))
    for t in ["5 x 5 cm", "7,5 x 7,5 cm", "10 x 10 cm"]:
        l.append((f"Compresse stérile non tissée {t}", "PANS", True, "sachet"))
        l.append((f"Compresse non stérile {t}", "PANS", False, "paquet"))
    for x in ["Pansement adhésif stérile 9 x 10 cm", "Pansement adhésif stérile 9 x 15 cm", "Pansement film transparent 6 x 7 cm",
              "Pansement film transparent 10 x 12 cm", "Pansement hydrocolloïde 10 x 10 cm", "Pansement hydrocellulaire 10 x 10 cm",
              "Pansement alginate 10 x 10 cm", "Bande de crêpe 10 cm", "Sparadrap microporeux 2,5 cm", "Bande cohésive 7 cm"]:
        l.append((x, "PANS", True, "unité"))
    for ch in ["CH12", "CH14", "CH16", "CH18", "CH20"]:
        l.append((f"Sonde urinaire Foley 2 voies {ch}", "SONDES", True, "sonde"))
    for ch in ["CH10", "CH12", "CH14", "CH16"]:
        l.append((f"Sonde d'aspiration {ch}", "SONDES", True, "sonde"))
    for x in ["Poche à urine 2 L", "Poche de recueil vidangeable", "Drain de Redon CH10", "Drain de Redon CH14",
              "Flacon de drainage aspiratif", "Sonde nasogastrique CH14", "Sonde nasogastrique CH16"]:
        l.append((x, "SONDES", True, "unité"))
    for t in ["S", "M", "L", "XL"]:
        l.append((f"Gant d'examen nitrile taille {t}", "PROT", False, "boîte"))
    for t in ["6", "6,5", "7", "7,5", "8", "8,5"]:
        l.append((f"Gant chirurgical stérile taille {t}", "PROT", True, "paire"))
    for x in ["Masque chirurgical type IIR", "Masque FFP2", "Charlotte", "Surblouse de protection", "Tablier plastique",
              "Lunettes de protection"]:
        l.append((x, "PROT", False, "unité"))
    for f in ["3/0", "4/0", "5/0"]:
        l.append((f"Fil résorbable tressé {f}", "SUTURE", True, "sachet"))
        l.append((f"Fil non résorbable monofilament {f}", "SUTURE", True, "sachet"))
    for n in ["11", "15", "20", "23"]:
        l.append((f"Lame de bistouri n° {n}", "SUTURE", True, "lame"))
    for x in ["Agrafeuse cutanée", "Ôte-agrafes", "Set à pansement", "Set de sondage urinaire", "Set de suture"]:
        l.append((x, "SUTURE", True, "unité"))
    for x in ["Champ opératoire adhésif 75 x 90 cm", "Champ de table 150 x 190 cm", "Casaque chirurgicale stérile L",
              "Casaque chirurgicale stérile XL", "Électrode de bistouri électrique", "Plaque neutre de bistouri",
              "Canule d'aspiration Yankauer", "Tuyau d'aspiration 3 m", "Kit de drapage hanche", "Kit de drapage genou",
              "Électrode ECG adulte", "Couvre-sonde de thermomètre", "Circuit de ventilation adulte", "Filtre antibactérien de ventilation",
              "Sonde d'intubation 7", "Sonde d'intubation 7,5", "Masque laryngé taille 4"]:
        l.append((x, "BLOC", True, "unité"))
    return l[:100]


def dmi_liste():
    l = []
    for t in range(1, 11):
        l.append((f"Tige fémorale cimentée taille {t}", "HANCHE"))
    for d in range(44, 62, 2):
        l.append((f"Cotyle sans ciment diamètre {d}", "HANCHE"))
    for d in ["28", "32", "36"]:
        for c in ["court", "moyen", "long"]:
            l.append((f"Tête fémorale céramique {d} mm col {c}", "HANCHE"))
    for d in ["28", "32", "36"]:
        l.append((f"Insert polyéthylène {d} mm", "HANCHE"))
    for t in range(1, 9):
        l.append((f"Composant fémoral de genou taille {t}", "GENOU"))
        l.append((f"Embase tibiale taille {t}", "GENOU"))
    for e in ["9", "11", "13"]:
        l.append((f"Insert tibial polyéthylène épaisseur {e} mm", "GENOU"))
    for lg in range(10, 62, 5):
        l.append((f"Vis corticale 3,5 mm longueur {lg} mm", "OSTEO"))
    for t in range(4, 13):
        l.append((f"Plaque verrouillée radius distal {t} trous", "OSTEO"))
    for d in ["2,5", "3,0", "3,5", "4,0"]:
        for lg in ["12", "18", "24"]:
            l.append((f"Stent coronaire actif {d} x {lg} mm", "CARDIO"))
    for x in ["Stimulateur cardiaque double chambre", "Sonde de stimulation auriculaire", "Sonde de stimulation ventriculaire"]:
        l.append((x, "CARDIO"))
    for t in ["10 x 15 cm", "15 x 15 cm", "30 x 30 cm"]:
        l.append((f"Prothèse pariétale {t}", "VISC"))
    for x in ["Sonde double J CH6", "Sonde double J CH7", "Bandelette sous-urétrale", "Implant de neuromodulation sacrée"]:
        l.append((x, "URO"))
    return l[:100]


def economat_liste():
    l = []
    for x in ["Détergent sols 5 L", "Détergent-désinfectant sols 5 L", "Décapant sols 5 L", "Cire métallisée 5 L",
              "Frange de lavage microfibre", "Frange de lavage coton", "Balai trapèze", "Seau double 25 L",
              "Chariot de ménage", "Gaze imprégnée de balayage", "Raclette sol 55 cm", "Monobrosse disque rouge",
              "Monobrosse disque blanc", "Pastille détergente lave-vaisselle", "Liquide de rinçage 5 L", "Sel régénérant 25 kg"]:
        l.append((x, "SOLS"))
    for x in ["Lingettes désinfectantes surfaces", "Spray détergent-désinfectant 750 mL", "Détartrant sanitaires 1 L",
              "Gel WC 750 mL", "Nettoyant vitres 750 mL", "Chiffon microfibre bleu", "Chiffon microfibre rouge",
              "Chiffon microfibre jaune", "Chiffon microfibre vert", "Éponge double face", "Désinfectant de contact 5 L",
              "Détergent vaisselle main 5 L", "Dégraissant cuisine 5 L", "Lingettes sans alcool dispositifs"]:
        l.append((x, "SURF"))
    for v in ["30 L", "50 L", "100 L", "130 L"]:
        for c in ["noir", "jaune DASRI", "transparent"]:
            l.append((f"Sac poubelle {v} {c}", "DECHETS"))
    for x in ["Collecteur à aiguilles 1,5 L", "Collecteur à aiguilles 3 L", "Fût DASRI 50 L", "Carton DASRI 50 L",
              "Sac à linge sale hydrosoluble", "Sac à linge sale blanc", "Bac de tri papier", "Caisse palette déchets"]:
        l.append((x, "DECHETS"))
    for x in ["Essuie-mains enchevêtré", "Essuie-mains en rouleau", "Papier toilette rouleau", "Papier toilette maxi jumbo",
              "Draps d'examen 50 x 35 cm", "Mouchoirs boîte", "Bobine d'essuyage dévidage central", "Serviettes de table papier",
              "Nappes papier", "Gobelets carton 20 cL"]:
        l.append((x, "PAPIER"))
    for x in ["Solution hydroalcoolique 500 mL", "Solution hydroalcoolique 1 L", "Gel hydroalcoolique 100 mL",
              "Savon doux 500 mL", "Savon doux 5 L", "Savon antiseptique 500 mL", "Crème protectrice mains 100 mL",
              "Distributeur de solution hydroalcoolique", "Distributeur de savon", "Distributeur d'essuie-mains"]:
        l.append((x, "MAINS"))
    for x in ["Ampoules LED E27", "Ampoules LED GU10", "Piles AA", "Piles AAA", "Piles 9 V", "Ruban adhésif d'emballage",
              "Film étirable", "Gants de ménage taille M", "Gants de ménage taille L", "Sacs congélation", "Papier aluminium",
              "Film alimentaire", "Allume-feu", "Insecticide", "Désodorisant", "Absorbant universel", "Clés de vestiaire",
              "Cadenas", "Étiquettes adhésives", "Marqueur permanent", "Lampe torche", "Rallonge électrique",
              "Multiprise", "Escabeau 3 marches"]:
        l.append((x, "DROG"))
    return l[:100]


# ------------------------------------------------------------------ Chargement

def modifier(entite, ident, corps):
    req = urllib.request.Request(f"{BASE}/e/{entite}/{ident}", data=json.dumps(corps).encode("utf-8"), method="PUT",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{entite}/{ident} {corps} : {e.read().decode('utf-8')}")


def article_med(ref, fam):
    """Médicaments d'un référentiel (une centaine, à partir des DCI et de leurs présentations)."""
    out = []
    for dci, variantes, famille, liste, risque, options in MEDICAMENTS:
        for dosage, forme, voie, unite in variantes:
            corps = {"referentiel_id": ref["id"], "nature": "medicament", "famille_id": fam["medicament"][famille]["id"],
                     "designation": f"{dci} {dosage} {forme.lower()}", "dci": dci, "dosage": dosage, "forme": forme,
                     "voie_administration": voie, "unite_stock": unite, "unite_delivrance": unite, "liste": liste,
                     "a_risque": risque, "lot_entree": "obligatoire", "peremption_entree": "obligatoire",
                     "lot_sortie": "obligatoire" if liste in ("stupefiant", "assimile_stupefiant") else "facultatif",
                     "peremption_sortie": "facultatif", "conservation": "ambiante"}
            corps.update(options)
            if corps.get("derive_sang"):
                corps["lot_sortie"] = "obligatoire"
            out.append(creer("article", corps))
    return out


def article_dm(ref, fam, liste):
    return [creer("article", {"referentiel_id": ref["id"], "nature": "dm", "famille_id": fam["dm"][f]["id"],
                              "designation": nom, "sterile": sterile, "usage_unique": True, "unite_stock": unite,
                              "classe_dm": "IIa" if f in ("INJ", "PERF", "SONDES") else ("Is" if sterile else "I"),
                              "lot_entree": "obligatoire" if sterile else "facultatif",
                              "peremption_entree": "obligatoire" if sterile else "sans_objet"})
            for nom, f, sterile, unite in liste]


def article_dmi(ref, fam):
    return [creer("article", {"referentiel_id": ref["id"], "nature": "dmi", "famille_id": fam["dmi"][f]["id"],
                              "designation": nom, "sterile": True, "usage_unique": True,
                              "classe_dm": "III" if f in ("CARDIO", "HANCHE", "GENOU") else "IIb",
                              "unite_stock": "unité", "lot_entree": "obligatoire", "lot_sortie": "obligatoire",
                              "serie_entree": "obligatoire", "serie_sortie": "obligatoire", "peremption_entree": "obligatoire"})
            for nom, f in dmi_liste()]


def article_eco(ref, fam):
    return [creer("article", {"referentiel_id": ref["id"], "nature": "economat", "famille_id": fam["economat"][f]["id"],
                              "designation": nom, "unite_achat": "carton", "unite_stock": "unité",
                              "coef_achat_stock": hasard.choice([1, 6, 10, 12, 20, 50])})
            for nom, f in economat_liste()]


def prix(a, contenu, f):
    """Prix fournisseurs d'un article, pour tout le groupe."""
    if contenu == "med":
        creer("article_fournisseur", {"article_id": a["id"], "fournisseur_id": hasard.choice(f["labos"])["id"], "rang": 1,
                                      "prix_unitaire_ht": round(hasard.uniform(0.05, 40), 4), "taux_tva": 2.1})
        creer("article_fournisseur", {"article_id": a["id"], "fournisseur_id": hasard.choice(f["grossistes"])["id"], "rang": 2,
                                      "prix_unitaire_ht": round(hasard.uniform(0.05, 45), 4), "taux_tva": 2.1})
    elif contenu.startswith("dm"):
        creer("article_fournisseur", {"article_id": a["id"], "fournisseur_id": hasard.choice(f["dm"])["id"], "rang": 1,
                                      "prix_unitaire_ht": round(hasard.uniform(0.02, 15), 4), "taux_tva": 20})
    elif contenu == "dmi":
        creer("article_fournisseur", {"article_id": a["id"], "fournisseur_id": hasard.choice(f["dmi"])["id"], "rang": 1,
                                      "prix_unitaire_ht": round(hasard.uniform(80, 4500), 2), "taux_tva": 5.5})
    else:
        creer("article_fournisseur", {"article_id": a["id"], "fournisseur_id": hasard.choice(f["eco"])["id"], "rang": 1,
                                      "prix_unitaire_ht": round(hasard.uniform(0.5, 60), 4), "taux_tva": 20})


def charger(config):
    t0 = time.time()

    fourn = {
        "labos": [creer("fournisseur", {"raison_sociale": f"Laboratoire Test {i}", "type": "laboratoire"}) for i in range(1, 11)],
        "grossistes": [creer("fournisseur", {"raison_sociale": f"Grossiste-répartiteur Test {i}", "type": "grossiste"}) for i in (1, 2)],
        "dm": [creer("fournisseur", {"raison_sociale": f"Fournisseur DM Test {i}", "type": "fournisseur"}) for i in range(1, 6)],
        "dmi": [creer("fournisseur", {"raison_sociale": f"Fabricant implants Test {i}", "type": "fournisseur"}) for i in range(1, 6)],
        "eco": [creer("fournisseur", {"raison_sociale": f"Fournisseur hygiène Test {i}", "type": "fournisseur"}) for i in range(1, 4)],
    }
    for i in (1, 2):
        creer("fournisseur", {"raison_sociale": f"Centrale d'achat Test {i}", "type": "centrale"})

    # PUI d'abord : elles gèrent les référentiels.
    puis = {cle: creer("pui", {"libelle": lib, "cadre": cadre, "pharmacien_gerant": f"Pharmacien gérant {cle.title()}"})
            for cle, (lib, cadre) in config["puis"].items()}

    # Familles communes au groupe, puis référentiels, leurs articles et leurs prix.
    fam = {nature: {code: creer("famille", {"libelle": lib, "nature": nature}) for code, lib in liste}
           for nature, liste in FAMILLES.items()}
    refs, articles = {}, {}
    for code, (libelle, contenu, gestionnaire) in config["refs"].items():
        ref = refs[code] = creer("referentiel", {"abrege": code, "libelle": libelle,
                                                 "pui_gestionnaire_id": puis[gestionnaire]["id"] if gestionnaire else None})
        if contenu == "med":
            lot = article_med(ref, fam)
        elif contenu == "dm":
            lot = article_dm(ref, fam, dm_liste())
        elif contenu == "dm_courant":
            lot = article_dm(ref, fam, [d for d in dm_liste() if d[1] not in ("BLOC", "SUTURE")])
        elif contenu == "dm_local":
            lot = article_dm(ref, fam, DM_LOCAUX)
        elif contenu == "dmi":
            lot = article_dmi(ref, fam)
        else:
            lot = article_eco(ref, fam)
        articles[code] = lot
        for a in lot:
            prix(a, contenu, fourn)

    sieges = {}  # PUI -> magasins du siège, par rôle (sources des dépôts des autres sites)

    for e in config["etabs"]:
        ej = creer("entite_juridique", {"raison_sociale": f"SAS {e['nom']}"})
        pui = puis[e["pui"]]
        etab = creer("etablissement", {"entite_juridique_id": ej["id"], "raison_sociale": e["nom"], "nom_usuel": e["nom"],
                                       "commune": e["ville"], "pui_id": pui["id"], "secteur_financement": "ex_oqn"})
        e["id"] = etab["id"]
        siege = e["pui"] not in sieges
        if siege:
            modifier("pui", pui["id"], {"etablissement_siege_id": etab["id"]})
        for entite, suffixe, longueur in [("service", "SRV", 2), ("uf", "UF", 3), ("magasin", "MAG", 2), ("pole", "POL", 1)]:
            creer("compteur", {"entite": entite, "prefixe": f"{e['court']}-{suffixe}", "longueur": longueur,
                               "prochain": 1, "etablissement_id": etab["id"]})
        for nature, codes in e["refs"].items():
            for code in (codes if isinstance(codes, list) else [codes]):
                creer("etablissement_referentiel", {"etablissement_id": etab["id"], "nature": nature,
                                                    "referentiel_id": refs[code]["id"]})

        poles = {}
        if e["type"] == "MCO":
            poles = {code: creer("pole", {"etablissement_id": etab["id"], "libelle": lib}) for code, lib in POLES.items()}
        e["uf_soins"], e["ufs"], e["services"] = [], {}, {}
        for i, (lib, typ, pole, lits, ufs) in enumerate(SERVICES[e["gabarit"]], 1):
            srv = creer("service", {"etablissement_id": etab["id"], "libelle": lib, "type": typ,
                                    "pole_id": poles[pole]["id"] if pole else None})
            e["services"][lib] = srv
            for j, (lib_uf, act) in enumerate(ufs, 1):
                uf = creer("uf", {"etablissement_id": etab["id"], "service_id": srv["id"], "libelle": lib_uf, "activite": act,
                                  "centre_cout": f"{e['court']}-{i:02d}{j}"})
                e["ufs"][lib_uf] = uf
                if typ == "soins" and j == 1:
                    e["uf_soins"].append((lib, uf))

        def magasin(lib, typ, role, emplacements, uf=None, source=None):
            m = creer("magasin", {"etablissement_id": etab["id"], "libelle": lib, "type": typ, "role": role,
                                  "uf_id": uf["id"] if uf else None, "magasin_source_id": source["id"] if source else None})
            for code in emplacements:
                creer("emplacement", {"magasin_id": m["id"], "libelle": code})
            return m

        # Magasins de PUI. Au siège : réserve, froid, coffre, DMI, approvisionnés par les fournisseurs.
        # Sur les autres sites d'une PUI centrale : dépôts approvisionnés par le magasin du siège de même rôle.
        if siege:
            sieges[e["pui"]] = s = {
                "reserve": magasin("Pharmacie, réserve principale", "pui", "reserve",
                                   [f"Allée {a}, étagère {n}" for a in "ABCDEF" for n in range(1, 6)]),
                "froid": magasin("Pharmacie, chambre froide", "pui", "froid", [f"Froid {n}" for n in range(1, 5)]),
                "coffre": magasin("Pharmacie, coffre des stupéfiants", "pui", "coffre_stupefiants", ["Coffre, tiroir 1", "Coffre, tiroir 2"]),
            }
            if "dmi" in e["refs"]:
                s["dmi"] = magasin("Pharmacie, réserve des DMI", "pui", "dmi", [f"Rayonnage DMI {n}" for n in range(1, 11)])
            local = s
        else:
            s = sieges[e["pui"]]
            nom = f"Dépôt de la {config['puis'][e['pui']][0]}"
            local = {
                "reserve": magasin(f"{nom}, réserve", "pui", "depot", [f"Allée {a}, étagère {n}" for a in "AB" for n in range(1, 6)], source=s["reserve"]),
                "froid": magasin(f"{nom}, réfrigérateur", "pui", "froid", ["Froid 1", "Froid 2"], source=s["froid"]),
                "coffre": magasin(f"{nom}, coffre des stupéfiants", "pui", "coffre_stupefiants", ["Coffre, tiroir 1"], source=s["coffre"]),
            }
            if "dmi" in e["refs"]:
                local["dmi"] = magasin(f"{nom}, DMI", "pui", "dmi", [f"Rayonnage DMI {n}" for n in range(1, 5)], source=s["dmi"])
        magasin("Magasin de l'économat", "economat", "reserve", [f"Économat, travée {n}" for n in range(1, 6)])
        for lib, uf in e["uf_soins"]:
            if e["type"] == "HAD":
                magasin(f"Dépôt {lib}", "service", "depot_antenne", [], uf, local["reserve"])
            else:
                magasin(f"Armoire {lib}", "service", "armoire", [], uf, local["reserve"])
        if e["type"] == "MCO":
            magasin("Arsenal du bloc opératoire", "service", "arsenal", [f"Arsenal, rayon {n}" for n in range(1, 9)],
                    e["ufs"]["Salles d'opération"], local["reserve"])

        for nature, (mini, maxi) in {"medicament": (10, 40), "dm": (20, 100), "dmi": (1, 3), "economat": (5, 30)}.items():
            if nature in e["refs"]:
                n = appeler(f"/etablissement/{etab['id']}/referencer",
                            {"nature": nature, "stock_mini": mini, "stock_maxi": maxi})["crees"]
                compte["article_site"] = compte.get("article_site", 0) + n

    # Médicaments à risque propres à certains services (en plus de la liste de la PUI).
    risques = {"Chlorure de potassium": ["Cardiologie", "Unité de surveillance continue", "SMR polyvalent", "Antenne Nord"],
               "Insuline": ["Médecine polyvalente", "SMR polyvalent", "Antenne Sud"],
               "Méthotrexate": ["Médecine polyvalente", "Antenne Ouest"]}
    for e in config["etabs"]:
        for a in articles[e["refs"]["medicament"]]:
            for prefixe, services in risques.items():
                if a["dci"].startswith(prefixe):
                    for s in services:
                        if s in e["services"]:
                            creer("risque_service", {"article_id": a["id"], "service_id": e["services"][s]["id"],
                                                     "motif": "Électrolyte concentré" if prefixe.startswith("Chlorure")
                                                     else "Médicament à haut risque"})

    print(f"Scénario {SCENARIO} chargé en {time.time() - t0:.0f} s :")
    for k, v in sorted(compte.items()):
        print(f"  {k:28} {v:6}")


if SCENARIO not in SCENARIOS:
    raise SystemExit(f"Scénario inconnu : {SCENARIO} (choix : {', '.join(SCENARIOS)})")
charger(SCENARIOS[SCENARIO])
