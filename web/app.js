// Pages des fichiers de base, dessinées à partir de /api/schema.
// Adresses : #fichier (liste), #fichier/123 (fiche), #fichier/nouveau?col=valeur (nouvelle fiche).
"use strict";

const etat = {
  entites: {},     // nom -> description
  ordre: [],       // noms dans l'ordre du menu
  refs: {},        // nom -> Map(id -> étiquette), cache des listes liées
  memo: {},        // nom -> { filtres, q } : la liste retrouve sa recherche au retour
  courant: null,   // entité affichée
  fiche: null,     // fiche ouverte (null : nouvelle)
  nav: { cle: null },  // liste latérale : clé (fichier, recherche, filtres), lignes, total
  onglet: {},      // nom -> onglet ouvert sur la fiche
  modifie: false,  // fiche modifiée et non enregistrée
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 });

async function api(url, options = {}) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  if (r.status === 204) return null;
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error((d && d.erreur) || `Erreur ${r.status}`);
  return d;
}

/** Liste complète d'un petit fichier (sources externes…) ; les gros fichiers passent par combo(). */
async function refs(nom) {
  if (!etat.refs[nom]) {
    const lignes = await api(`/api/e/${nom}`);
    etat.refs[nom] = new Map(lignes.map((l) => [l.id, l._etiquette]));
  }
  return etat.refs[nom];
}

/** Liste avec son total (en-tête X-Total). */
async function apiListe(url) {
  const r = await fetch(url);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error((d && d.erreur) || `Erreur ${r.status}`);
  return { lignes: d, total: Number(r.headers.get("x-total") ?? d.length) };
}

/** Étiquette d'une fiche (mise en cache). */
const cacheEtiquettes = new Map();
async function etiquette(nom, id) {
  if (id === null || id === undefined || id === "") return "";
  const cle = `${nom}/${id}`;
  if (!cacheEtiquettes.has(cle)) {
    try { cacheEtiquettes.set(cle, (await api(`/api/e/${nom}/${id}`))._etiquette); }
    catch { return `#${id}`; }
  }
  return cacheEtiquettes.get(cle);
}
const oublierEtiquettes = (nom) => { for (const k of [...cacheEtiquettes.keys()]) if (k.startsWith(`${nom}/`)) cacheEtiquettes.delete(k); };

// ------------------------------------------------------------------ Champ de lien avec recherche

/** HTML d'un champ de lien : texte de recherche, valeur cachée (name = col), liste de propositions. */
async function comboHtml(col, cible, valeur, { id = "", placeholder = "Rechercher…" } = {}) {
  const texte = await etiquette(cible, valeur);
  return `<div class="combo" data-cible="${cible}" data-col="${col}">
    <input type="text" class="combo-texte" ${id ? `id="${id}"` : ""} value="${esc(texte)}" placeholder="${esc(placeholder)}" autocomplete="off">
    <input type="hidden" name="${col}" value="${esc(valeur ?? "")}">
    <div class="combo-liste" hidden></div></div>`;
}

/** Active un champ de lien : recherche côté serveur (30 propositions), filtres de contexte, clavier.
 *  `contexte()` : paramètres de filtre ; `surChoix(id)` : appelé après un choix ou un effacement. */
function activerCombo(div, contexte = () => ({}), surChoix = null) {
  const texte = $(".combo-texte", div), cache = $("input[type=hidden]", div), liste = $(".combo-liste", div);
  let options = [], courant = -1, minuterie, libelle = texte.value;
  const fermer = () => { liste.hidden = true; courant = -1; };
  const choisir = (o) => {
    cache.value = o ? o.id : "";
    texte.value = libelle = o ? o._etiquette : "";
    if (o) cacheEtiquettes.set(`${div.dataset.cible}/${o.id}`, o._etiquette);
    fermer();
    cache.dispatchEvent(new Event("change", { bubbles: true }));
    if (surChoix) surChoix(cache.value);
  };
  const dessiner = (total) => {
    liste.innerHTML = options.length
      ? options.map((o, i) => `<div class="combo-option${i === courant ? " active" : ""}" data-i="${i}">${esc(o._etiquette)}</div>`).join("")
        + (total > options.length ? `<div class="combo-pied">${options.length} sur ${nf.format(total)} : précisez la recherche</div>` : "")
      : `<div class="combo-pied">Aucune fiche</div>`;
    liste.hidden = false;
  };
  const chercher = async () => {
    const p = new URLSearchParams({ ...contexte(), limit: "30" });
    if (texte.value.trim() && texte.value !== libelle) p.set("q", texte.value.trim());
    try {
      const r = await apiListe(`/api/e/${div.dataset.cible}?${p}`);
      options = r.lignes; courant = -1; dessiner(r.total);
    } catch { /* liste laissée telle quelle */ }
  };
  texte.addEventListener("focus", () => { texte.select(); chercher(); });
  texte.addEventListener("input", () => { clearTimeout(minuterie); minuterie = setTimeout(chercher, 200); });
  texte.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!options.length) return;
      courant = (courant + (ev.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      dessiner(0);
    } else if (ev.key === "Enter") {
      if (!liste.hidden) { ev.preventDefault(); if (courant >= 0) choisir(options[courant]); else if (options.length === 1) choisir(options[0]); }
    } else if (ev.key === "Escape") { fermer(); texte.value = libelle; }
  });
  liste.addEventListener("mousedown", (ev) => {
    const o = ev.target.closest(".combo-option");
    if (o) { ev.preventDefault(); choisir(options[Number(o.dataset.i)]); }
  });
  texte.addEventListener("blur", () => {
    setTimeout(fermer, 150);
    if (!texte.value.trim() && cache.value) choisir(null);
    else texte.value = libelle;
  });
}

/** Filtres de contexte d'un champ de lien dans un formulaire : les champs de la fiche cible qui
 *  existent aussi dans le formulaire (même nom) la restreignent ; ex. le service d'une UF est pris
 *  dans l'établissement de l'UF, la famille d'un article dans son référentiel et sa nature. */
function contexteFormulaire(form, c, source = etat.courant) {
  const cible = etat.entites[c.extra];
  const p = {};
  // Lien vers le même fichier (ex. : magasin d'approvisionnement, souvent sur un autre site) :
  // pas de filtre de contexte, la base vérifie la règle.
  if (c.extra === source.nom) return cible.champs.some((x) => x.col === "actif") ? { actif: "true" } : {};
  // Un champ du formulaire ne restreint la recherche que s'il désigne la même chose des deux côtés :
  // même nom ET même lien (même fichier) ou même liste de valeurs. Ex. : le « type » d'un mouvement
  // (réception…) n'a rien à voir avec le « type » d'un magasin (PUI…) ou d'un fournisseur.
  const memesValeurs = (a, b) => JSON.stringify((a || []).map(([k]) => k)) === JSON.stringify((b || []).map(([k]) => k));
  for (const tc of cible.champs) {
    if (tc.col === "actif" || !["ref", "choix"].includes(tc.genre)) continue;
    const el = form.elements[tc.col];
    if (!el || el.value === "" || tc.col === c.col) continue;
    const sc = source.champs.find((x) => x.col === tc.col);
    if (!sc || sc.genre !== tc.genre) continue;
    if (tc.genre === "ref" ? sc.extra !== tc.extra : !memesValeurs(sc.extra, tc.extra)) continue;
    p[(tc.requis ? "" : "~") + tc.col] = el.value;
  }
  // Même suffixe : l'emplacement « de départ » est pris dans le magasin « de départ ».
  const suffixe = c.col.startsWith(c.extra) ? c.col.slice(c.extra.length) : "";
  if (suffixe && suffixe !== "_id") {
    for (const tc of cible.champs) {
      if (tc.genre !== "ref") continue;
      const el = form.elements[tc.extra + suffixe];
      if (el && el.value) p[tc.col] = el.value;
    }
  }
  if (c.extra === "article" && form.elements.etablissement_id && form.elements.etablissement_id.value) {
    p._utilisable_par = form.elements.etablissement_id.value;
  }
  if (c.extra === "article") {
    const magasin = ["magasin_id", "magasin_source_id", "magasin_destination_id"].map((k) => form.elements[k]).find((el) => el && el.value);
    if (magasin) p._utilisable_magasin = magasin.value;
  }
  // Mouvement : on ne propose que ce qui a un sens pour le type choisi.
  if (source.nom === "mouvement" && form.elements.type) {
    const type = form.elements.type.value;
    const val = (k) => (form.elements[k] ? form.elements[k].value : "");
    const depuisStock = ["transfert", "deplacement", "sortie", "retour_fournisseur", "destruction", "inventaire_moins"].includes(type);
    // Réception : seulement les magasins pouvant recevoir cet article d'un fournisseur (tête de chaîne,
    // bon type, coffre pour un stupéfiant).
    if (c.col === "magasin_destination_id" && type === "reception" && val("article_id")) p._reception = val("article_id");
    // Sorties, transferts… : seulement les magasins ayant l'article en stock, et inversement.
    if (c.col === "magasin_source_id" && depuisStock && val("article_id")) p._avec_stock = val("article_id");
    if (c.col === "article_id" && depuisStock && val("magasin_source_id")) p._en_stock = val("magasin_source_id");
  }
  if (cible.champs.some((x) => x.col === "actif")) p.actif = "true";
  return p;
}

function afficher(c, v, liees) {
  if (v === null || v === undefined || v === "") return "";
  switch (c.genre) {
    case "booleen": return v ? "✓" : "";
    case "ref": return liees || `#${v}`;
    case "choix": { const o = c.extra.find(([k]) => k === v); return o ? o[1] : v; }
    case "decimal": case "entier": return nf.format(Number(v));
    case "date": return new Date(v + "T00:00:00").toLocaleDateString("fr-FR");
    case "horodatage": return new Date(v).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    default: return v;
  }
}

// ------------------------------------------------------------------ Démarrage, menu et adresses

/** Préférences d'affichage de ce poste (menu replié, groupes ouverts…) ; sans stockage, valeurs par défaut. */
const prefs = {
  lire(cle, defaut) {
    try { const v = localStorage.getItem(`stocks.${cle}`); return v === null ? defaut : JSON.parse(v); } catch { return defaut; }
  },
  ecrire(cle, v) {
    try { localStorage.setItem(`stocks.${cle}`, JSON.stringify(v)); } catch { /* sans stockage */ }
  },
};

async function demarrer() {
  try {
    const schema = await api("/api/schema");
    for (const e of schema.entites) { etat.entites[e.nom] = e; etat.ordre.push(e.nom); }
    $("#etat-serveur").textContent = "serveur connecté";
  } catch (err) {
    $("#etat-serveur").textContent = "serveur injoignable";
    $("#page").innerHTML = `<p class="message erreur">${esc(err.message)}</p>`;
    return;
  }
  dessinerMenu();
  document.body.classList.toggle("menu-replie", prefs.lire("menuReplie", innerWidth < 1500));
  document.body.classList.toggle("nav-repliee", prefs.lire("navRepliee", false));
  $("#bascule-menu").addEventListener("click", () => {
    if (matchMedia("(max-width: 900px)").matches) { document.body.classList.toggle("menu-ouvert"); return; }
    prefs.ecrire("menuReplie", document.body.classList.toggle("menu-replie"));
  });
  window.addEventListener("hashchange", router);
  window.addEventListener("beforeunload", (ev) => { if (etat.modifie) { ev.preventDefault(); ev.returnValue = ""; } });
  document.addEventListener("keydown", raccourcis);
  document.addEventListener("click", (ev) => {
    for (const d of $$(".plus-actions[open]")) if (!d.contains(ev.target)) d.open = false;
  });
  etat.hash = location.hash;
  router();
}

/** Menu par groupes repliables ; les groupes ouverts sont retenus sur ce poste. */
function dessinerMenu() {
  const groupes = new Map();
  for (const nom of etat.ordre) {
    const e = etat.entites[nom];
    if (!groupes.has(e.groupe)) groupes.set(e.groupe, []);
    groupes.get(e.groupe).push(e);
  }
  groupes.set("Outils", [{ nom: "registre", pluriel: "Registre des stupéfiants" }, { nom: "admin_pui", pluriel: "Administration de la PUI" },
    { nom: "import", pluriel: "Import de catalogues" }]);
  const ouverts = prefs.lire("groupesOuverts", ["Structure", "Articles"]);
  let html = "";
  for (const [g, entites] of groupes) {
    html += `<details data-groupe="${esc(g)}"${ouverts.includes(g) ? " open" : ""}><summary>${esc(g)}</summary>`;
    for (const e of entites) {
      const point = e.libelle ? `<span class="point" style="--teinte: ${teinte(e)}"></span>` : `<span class="point outil"></span>`;
      html += `<a href="#${e.nom}" data-nom="${e.nom}" title="${esc(e.libelle ? description(e) || e.pluriel : e.pluriel)}">${point}${esc(e.pluriel)}</a>`;
    }
    html += `</details>`;
  }
  $("#menu").innerHTML = html;
  for (const d of $$("#menu details")) {
    d.addEventListener("toggle", () => prefs.ecrire("groupesOuverts", $$("#menu details[open]").map((x) => x.dataset.groupe)));
  }
  $("#menu").addEventListener("click", (ev) => { if (ev.target.closest("a")) document.body.classList.remove("menu-ouvert"); });
}

function marquerMenu(nom) {
  for (const a of $$("#menu a")) {
    const actif = a.dataset.nom === nom;
    a.classList.toggle("actif", actif);
    if (actif) a.closest("details").open = true;
  }
}

function raccourcis(ev) {
  const form = $("#formulaire");
  if ((ev.ctrlKey || ev.metaKey) && ev.key === "s" && form) { ev.preventDefault(); if (!form.classList.contains("lecture")) form.requestSubmit(); }
  if (ev.key === "F2" && form && form.classList.contains("lecture")) { ev.preventDefault(); passerEnSaisie(); }
  if (ev.altKey && (ev.key === "ArrowDown" || ev.key === "ArrowUp") && etat.fiche) {
    ev.preventDefault();
    allerVoisin(ev.key === "ArrowDown" ? 1 : -1);
  }
}

function router() {
  // Fiche modifiée : confirmation avant de la quitter ; sinon on reste.
  if (etat.modifie && location.hash !== etat.hash) {
    if (!confirm("La fiche a des modifications non enregistrées. Les abandonner ?")) {
      history.replaceState(null, "", etat.hash);
      return;
    }
    etat.modifie = false;
  }
  etat.hash = location.hash;
  const [chemin, requete] = location.hash.slice(1).split("?");
  const [nom, id] = chemin.split("/");
  document.body.classList.toggle("mode-fiche", !!id && !!etat.entites[nom]);
  const outils = { import: () => pageImport(), admin_pui: () => pageAdminPui(), registre: () => pageRegistre() };
  if (outils[nom]) {
    marquerMenu(nom);
    etat.fiche = null;
    outils[nom]();
    return;
  }
  const e = etat.entites[nom];
  if (!e) return;
  marquerMenu(nom);
  if (etat.courant !== e) etat.nav = { cle: null };
  etat.courant = e;
  window.scrollTo(0, 0);
  if (!id) pageListe();
  else if (id === "nouveau") pageFiche(null, Object.fromEntries(new URLSearchParams(requete || "")));
  else pageFiche(Number(id));
}

/** « CODE – libellé » : le code à part, pour l'afficher en petit au-dessus du titre. */
function decouper(etiq) {
  const i = (etiq || "").indexOf(" – ");
  return i < 0 ? ["", etiq || ""] : [etiq.slice(0, i), etiq.slice(i + 3)];
}

// ------------------------------------------------------------------ Liste

// Filtres : toutes les listes de choix, tous les liens et toutes les cases du fichier.
const filtrables = (e) => e.champs.filter((c) => ["ref", "choix", "booleen"].includes(c.genre));
const memo = (e) => (etat.memo[e.nom] ??= { filtres: {}, q: "", tri: null, panneau: false });
const optionsFiltre = (c) => (c.genre === "booleen" ? [["true", "Oui"], ["false", "Non"]] : c.extra);

async function filtresHtml(e, m) {
  // Les filtres les plus utiles d'abord : colonnes, rattachements, pastilles, actif.
  const principal = (c) => c.liste || (c.genre === "ref" && c.requis) || c.badge || c.col === "actif";
  const champs = [...filtrables(e).filter(principal), ...filtrables(e).filter((c) => !principal(c))];
  let html = "";
  for (const c of champs) {
    const actif = m.filtres[c.col] !== undefined;
    html += `<div class="filtre${actif ? " actif" : ""}" data-filtre-col="${c.col}"><span>${esc(c.libelle)}</span>`;
    if (c.genre === "ref") {
      html += (await comboHtml(`filtre-${c.col}`, c.extra, m.filtres[c.col], { placeholder: "Tous" })) + `</div>`;
      continue;
    }
    html += `<select data-filtre="${c.col}"><option value="">Tous</option>`;
    for (const [k, lib] of optionsFiltre(c)) html += `<option value="${esc(k)}" ${String(m.filtres[c.col]) === String(k) ? "selected" : ""}>${esc(lib)}</option>`;
    html += `</select></div>`;
  }
  return html;
}

/** Filtres actifs en pastilles supprimables, et nombre sur le bouton « Filtres ». */
async function dessinerPucesFiltres() {
  const e = etat.courant, m = memo(e);
  let html = "";
  for (const [col, v] of Object.entries(m.filtres)) {
    const c = e.champs.find((x) => x.col === col);
    if (!c) continue;
    const lib = c.genre === "ref" ? await etiquette(c.extra, v) : afficher(c, c.genre === "booleen" ? v === "true" : v) || (v === "false" ? "Non" : v);
    html += `<span class="puce-filtre"><span>${esc(c.libelle)} :</span> ${esc(lib)}<button type="button" data-retirer="${col}" title="Retirer ce filtre">✕</button></span>`;
  }
  $("#puces-filtres").innerHTML = html;
  const n = Object.keys(m.filtres).length;
  $("#bouton-filtres").textContent = n ? `Filtres (${n})` : "Filtres";
  $("#bouton-filtres").classList.toggle("actif", n > 0);
  for (const b of $$("[data-retirer]")) {
    b.addEventListener("click", () => { delete m.filtres[b.dataset.retirer]; pageListe(); });
  }
}

async function pageListe() {
  const e = etat.courant, m = memo(e);
  etat.fiche = null;
  $("#page").innerHTML = `
    <div class="bandeau-type" style="--teinte: ${teinte(e)}">${pastille(e)}<div><strong>${esc(e.pluriel)}</strong>
      <span>${esc(description(e))}</span></div></div>
    <div class="tete-liste">
      <h1 class="sr">${esc(e.pluriel)}</h1>
      <input type="search" id="recherche" placeholder="Rechercher : code, libellé…" value="${esc(m.q)}">
      <button type="button" id="bouton-filtres" class="filtres-bouton">Filtres</button>
      <span class="compte" id="compte"></span>
      <span class="espace"></span>
      ${e.mode === "lecture" ? `<span class="compte">Calculé par la base</span>` : `<button type="button" class="principal" id="nouveau">Nouveau</button>`}
    </div>
    <div class="puces-filtres" id="puces-filtres"></div>
    <div class="panneau-filtres" id="panneau-filtres"${m.panneau ? "" : " hidden"}>${await filtresHtml(e, m)}</div>
    <div id="liste"></div>`;

  let minuterie;
  $("#recherche").addEventListener("input", (ev) => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => { m.q = ev.target.value; chargerListe(); }, 250);
  });
  $("#bouton-filtres").addEventListener("click", () => { m.panneau = !m.panneau; $("#panneau-filtres").hidden = !m.panneau; });
  const appliquerFiltre = (col, valeur, el) => {
    if (valeur) m.filtres[col] = valeur; else delete m.filtres[col];
    el.closest(".filtre").classList.toggle("actif", !!valeur);
    dessinerPucesFiltres();
    chargerListe();
  };
  for (const s of $$("select[data-filtre]")) s.addEventListener("change", () => appliquerFiltre(s.dataset.filtre, s.value, s));
  for (const div of $$(".filtre .combo")) {
    const col = div.closest(".filtre").dataset.filtreCol;
    activerCombo(div, () => ({}), (valeur) => appliquerFiltre(col, valeur, div));
  }
  if ($("#nouveau")) $("#nouveau").addEventListener("click", () => {
    const p = new URLSearchParams(m.filtres).toString();
    location.hash = `#${e.nom}/nouveau${p ? "?" + p : ""}`;
  });
  $("#recherche").focus();
  await dessinerPucesFiltres();
  await chargerListe();
}

async function chargerListe() {
  const e = etat.courant, m = memo(e);
  const p = new URLSearchParams(m.filtres);
  if (m.q.trim()) p.set("q", m.q.trim());
  let lignes, total;
  try { ({ lignes, total } = await apiListe(`/api/e/${e.nom}?${p}`)); }
  catch (err) { $("#liste").innerHTML = `<p class="message erreur">${esc(err.message)}</p>`; return; }
  const filtre = !!m.q.trim() || Object.keys(m.filtres).length > 0;
  $("#compte").textContent = `${nf.format(total)} fiche${total > 1 ? "s" : ""}${total > lignes.length ? ` · ${nf.format(lignes.length)} affichées, affinez la recherche` : ""}`;
  $("#liste").innerHTML = lignes.length
    ? await tableau(e, lignes, null, m.tri, true)
    : `<p class="vide">Aucune fiche${filtre ? " pour ces critères" : ""}.</p>`;
  lierLignes($("#liste"), e.nom);
  for (const th of $$("#liste th[data-col]")) {
    th.addEventListener("click", () => {
      m.tri = m.tri && m.tri.col === th.dataset.col ? { col: th.dataset.col, sens: -m.tri.sens } : { col: th.dataset.col, sens: 1 };
      chargerListe();
    });
  }
}

/** Tableau des colonnes « liste » d'une entité ; `sauf` : colonne à taire (rattachement connu) ;
 *  `tri` : { col, sens } ; `principal` : liste de page (en-tête fixe, colonnes triables). */
async function tableau(e, lignes, sauf, tri = null, principal = false) {
  const cols = e.champs.filter((c) => c.liste && c.col !== sauf);
  // Étiquette d'un lien : calculée par le serveur (_l_<col>).
  const lien = (l, c) => l[`_l_${c.col}`];
  if (tri) {
    const c = e.champs.find((x) => x.col === tri.col);
    const cle = (l) => {
      const v = l[tri.col];
      if (v === null || v === undefined || v === "") return null;
      if (c.genre === "decimal" || c.genre === "entier") return Number(v);
      return afficher(c, v, lien(l, c));
    };
    lignes = [...lignes].sort((a, b) => {
      const x = cle(a), y = cle(b);
      if (x === null) return 1;
      if (y === null) return -1;
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "fr", { numeric: true })) * tri.sens;
    });
  }
  const entete = cols.map((c) => {
    const fleche = tri && tri.col === c.col ? (tri.sens > 0 ? " ▲" : " ▼") : "";
    return `<th${principal ? ` data-col="${c.col}" class="triable"` : ""}>${esc(c.libelle)}${fleche}</th>`;
  }).join("");
  let html = `<div class="tableau${principal ? " principal" : ""}"><table><thead><tr>${entete}</tr></thead><tbody>`;
  for (const l of lignes) {
    html += `<tr data-id="${l.id}" class="${l.actif === false ? "inactif" : ""}">`;
    for (const c of cols) {
      const classe = c.genre === "decimal" || c.genre === "entier" ? "num" : c.col === "code" ? "code" : "";
      html += `<td class="${classe}">${esc(afficher(c, l[c.col], lien(l, c)))}</td>`;
    }
    html += `</tr>`;
  }
  return html + `</tbody></table></div>`;
}

function lierLignes(conteneur, nom) {
  for (const tr of $$("tbody tr", conteneur)) tr.addEventListener("click", () => { location.hash = `#${nom}/${tr.dataset.id}`; });
}

// ------------------------------------------------------------------ Liste latérale (fiche)

/** À côté de la fiche : les fiches de la liste (mêmes recherche et filtres), pour passer de l'une à
 *  l'autre. Rechargée seulement quand le fichier, la recherche ou les filtres changent. */
async function dessinerNavigation() {
  const e = etat.courant, m = memo(e);
  const cle = JSON.stringify([e.nom, m.filtres, m.q]);
  const nav = $("#navigation");
  if (etat.nav.cle !== cle) {
    const p = new URLSearchParams(m.filtres);
    if (m.q.trim()) p.set("q", m.q.trim());
    p.set("limit", "2000");
    let r;
    try { r = await apiListe(`/api/e/${e.nom}?${p}`); } catch { return; }
    etat.nav = { cle, lignes: r.lignes, total: r.total };
    const nbFiltres = Object.keys(m.filtres).length;
    const enRecherche = document.activeElement && document.activeElement.id === "nav-recherche";
    nav.innerHTML = `
      <div class="nav-tete">
        <div class="nav-titre">${pastille(e, "petite")}<a href="#${e.nom}" title="Revenir à la liste">${esc(e.pluriel)}</a>
          <span class="compte">${nf.format(r.total)}</span>
          <button type="button" class="discret icone" id="replier-nav" title="Masquer cette liste">«</button></div>
        <input type="search" id="nav-recherche" placeholder="Filtrer…" value="${esc(m.q)}">
        ${nbFiltres ? `<a class="nav-filtres" href="#${e.nom}">${nbFiltres} filtre${nbFiltres > 1 ? "s" : ""} actif${nbFiltres > 1 ? "s" : ""}</a>` : ""}
      </div>
      <div class="nav-liste">${r.lignes.map((l) => {
        const [code, lib] = decouper(l._etiquette);
        return `<a class="nav-item${l.actif === false ? " inactif" : ""}" href="#${e.nom}/${l.id}" data-id="${l.id}">
          ${code ? `<span class="nav-code">${esc(code)}</span>` : ""}<span class="nav-lib" title="${esc(lib)}">${esc(lib)}</span></a>`;
      }).join("") || `<p class="vide" style="padding: 8px">Aucune fiche.</p>`}</div>
      ${r.total > r.lignes.length ? `<div class="nav-pied">${nf.format(r.lignes.length)} premières sur ${nf.format(r.total)} : affinez</div>` : ""}`;
    let minuterie;
    const champ = $("#nav-recherche", nav);
    champ.addEventListener("input", () => {
      clearTimeout(minuterie);
      minuterie = setTimeout(() => { m.q = champ.value; dessinerNavigation(); }, 250);
    });
    if (enRecherche) { champ.focus(); champ.setSelectionRange(champ.value.length, champ.value.length); }
    $("#replier-nav", nav).addEventListener("click", () => {
      document.body.classList.add("nav-repliee");
      prefs.ecrire("navRepliee", true);
    });
  }
  const courant = etat.fiche ? String(etat.fiche.id) : "";
  // Fiche ouverte hors de la liste chargée (au-delà de la limite, ou écartée par les filtres) : en tête.
  const ancienne = $(".nav-item.hors-liste", nav);
  if (ancienne) ancienne.outerHTML = "";
  if (courant && !$(`.nav-item[data-id="${courant}"]`, nav)) {
    const [code, lib] = decouper(etat.fiche._etiquette);
    $(".nav-liste", nav).insertAdjacentHTML("afterbegin", `<a class="nav-item hors-liste" href="#${e.nom}/${courant}" data-id="${courant}"
      title="Fiche ouverte, hors de la liste chargée">${code ? `<span class="nav-code">${esc(code)}</span>` : ""}<span class="nav-lib">${esc(lib)}</span></a>`);
  }
  for (const a of $$(".nav-item", nav)) {
    const actif = a.dataset.id === courant;
    a.classList.toggle("actif", actif);
    if (actif) a.scrollIntoView({ block: "nearest" });
  }
  majPosition();
}

function majPosition() {
  const pos = $("#position");
  if (!pos || !etat.fiche || !etat.nav.lignes) return;
  const i = etat.nav.lignes.findIndex((l) => l.id === etat.fiche.id);
  pos.textContent = i < 0 ? `— / ${nf.format(etat.nav.total)}` : `${nf.format(i + 1)} / ${nf.format(etat.nav.total)}`;
  $("#precedent").disabled = i <= 0;
  $("#suivant").disabled = i < 0 || i >= etat.nav.lignes.length - 1;
}

function allerVoisin(sens) {
  const lignes = etat.nav.lignes || [];
  const i = lignes.findIndex((l) => l.id === (etat.fiche && etat.fiche.id));
  const cible = lignes[i + sens];
  if (i >= 0 && cible) location.hash = `#${etat.courant.nom}/${cible.id}`;
}

// ------------------------------------------------------------------ Fiche

async function pageFiche(id, valeursInitiales = {}) {
  const e = etat.courant;
  let ligne = null;
  if (id) {
    try { ligne = await api(`/api/e/${e.nom}/${id}`); }
    catch (err) { $("#page").innerHTML = `<p class="message erreur">${esc(err.message)}</p>`; return; }
  }
  etat.fiche = ligne;
  const nouveau = !ligne;
  etat.lectureSeule = e.mode === "lecture" || (e.mode === "ajout" && !nouveau);
  dessinerNavigation();

  // Champs regroupés par section, dans l'ordre de la description.
  const sections = new Map();
  for (const c of e.champs) {
    if (!sections.has(c.section)) sections.set(c.section, []);
    sections.get(c.section).push(c);
  }
  let cartes = "";
  for (const [titre, champs] of sections) {
    let html = "";
    for (const c of champs) {
      let v = ligne ? ligne[c.col] : valeursInitiales[c.col];
      if (nouveau && c.genre === "booleen" && v === undefined) v = c.col === "actif" || c.col === "au_livret";
      html += await champHtml(c, v, nouveau);
    }
    cartes += `<fieldset class="carte" data-section="${esc(titre)}"><legend>${esc(titre)}</legend>${html}</fieldset>`;
  }

  const [code, titre] = nouveau ? ["", `Nouvel élément : ${e.libelle.toLowerCase()}`] : decouper(ligne._etiquette);
  const mouvement = !nouveau && MOUVEMENT_RAPIDE.includes(e.nom) ? `<details class="plus-actions mouvement-rapide">
      <summary title="Saisir un mouvement pour cette fiche">Mouvement ▾</summary><div class="menu-actions">
      ${TYPES_RAPIDES.map(([k, l]) => `<button type="button" data-mouvement="${k}">${esc(l)}</button>`).join("")}</div></details>` : "";
  const extra = mouvement + (nouveau ? "" : {
    article: `<button type="button" id="sources" title="Comparer et reprendre les données des centrales">Centrales</button>`,
    etablissement: `<button type="button" id="referencer" title="Créer les articles-sites manquants">Référencer des articles</button>`,
  }[e.nom] || "");
  $("#page").innerHTML = `
    <div class="tete" style="--teinte: ${teinte(e)}">
      <div class="fil" id="fil"><a href="#${e.nom}">${esc(e.pluriel)}</a></div>
      <div class="tete-ligne">
        <div class="titre">${pastille(e)}
          <div><div class="type-fiche" title="${esc(description(e))}">${esc(e.libelle)}</div>
          <div class="titre-ligne"><h1>${code ? `<span class="titre-code">${esc(code)}</span>` : ""}<span id="titre-texte">${esc(titre)}</span></h1>
            <div class="badges" id="badges"></div></div>
          <div class="sous-titre-fiche" id="sous-titre" hidden></div></div></div>
        <div class="actions-tete">
        <span class="etat-saisie" id="etat-saisie" hidden>● Non enregistré</span>
        ${nouveau ? "" : `<div class="pagination">
          <button type="button" class="discret icone" id="montrer-nav" title="Afficher la liste">»</button>
          <button type="button" class="discret icone" id="precedent" title="Fiche précédente (Alt+↑)">‹</button>
          <span id="position"></span>
          <button type="button" class="discret icone" id="suivant" title="Fiche suivante (Alt+↓)">›</button></div>`}
        ${extra}
        ${etat.lectureSeule ? `<span class="compte">${e.mode === "lecture" ? "Calculé par la base" : "Mouvement enregistré : il ne se modifie pas"}</span>`
          : `${nouveau ? "" : `<button type="button" class="principal" id="modifier" title="Modifier la fiche (F2 ou double-clic sur un champ)">Modifier</button>
             <button type="button" id="annuler" hidden>Annuler</button>`}
             <button type="submit" form="formulaire" class="principal" id="enregistrer" title="Enregistrer (Ctrl+S)"${nouveau ? "" : " hidden"}>Enregistrer</button>`}
        ${nouveau || etat.lectureSeule ? "" : `<details class="plus-actions"><summary title="Autres actions">⋯</summary>
          <div class="menu-actions"><button type="button" class="danger" id="supprimer">Supprimer la fiche…</button></div></details>`}
        </div>
      </div>
      <div class="puces" id="puces"></div>
      <div class="resume-stock" id="resume-stock" hidden></div>
      ${nouveau ? "" : `<nav class="onglets" id="onglets"><button type="button" data-onglet="fiche" class="actif">Fiche</button></nav>`}
      <div id="message"></div>
    </div>
    <div id="impacts" class="impacts" hidden></div>
    ${e.nom === "article_fournisseur" ? `<div id="prix-connus" class="prix-connus" hidden></div>` : ""}
    <form id="formulaire" class="sections" novalidate>${cartes}</form>
    <div id="vue-onglet" hidden></div>`;

  const form = $("#formulaire");
  form.addEventListener("submit", enregistrer);
  etat.modifie = false;
  const modifie = () => { etat.modifie = true; $("#etat-saisie").hidden = false; afficherImpacts(); };
  form.addEventListener("input", modifie);
  form.addEventListener("change", (ev) => {
    modifie();
    appliquerConditions();
    dessinerBadges();
    if (ev.target.tagName === "SELECT" || ev.target.type === "hidden") dessinerRattachement();
    if (e.nom === "article_fournisseur" && ["article_id", "fournisseur_id", "etablissement_id", "rang", "actif"].includes(ev.target.name)) {
      afficherPrixConnus();
    }
  });
  if (e.nom === "article_fournisseur") afficherPrixConnus();
  if (e.nom === "mouvement" && nouveau) {
    form.addEventListener("change", (ev) => {
      if (["type", "article_id", "magasin_source_id", "magasin_destination_id"].includes(ev.target.name)) aideMouvement();
    });
    aideMouvement();
  }
  for (const div of $$(".combo", form)) {
    const c = e.champs.find((x) => x.col === div.dataset.col);
    activerCombo(div, () => contexteFormulaire(form, c));
  }
  if (etat.lectureSeule) {
    for (const el of $$("input, select, textarea", form)) { el.disabled = true; }
  }
  if (!nouveau && $("#supprimer")) $("#supprimer").addEventListener("click", supprimer);
  if (!nouveau) {
    $("#precedent").addEventListener("click", () => allerVoisin(-1));
    $("#suivant").addEventListener("click", () => allerVoisin(1));
    $("#montrer-nav").addEventListener("click", () => { document.body.classList.remove("nav-repliee"); prefs.ecrire("navRepliee", false); });
    majPosition();
  }
  if (!nouveau && e.nom === "etablissement") $("#referencer").addEventListener("click", ouvrirReferencement);
  if (!nouveau && MOUVEMENT_RAPIDE.includes(e.nom)) {
    for (const b of $$("[data-mouvement]")) {
      b.addEventListener("click", () => { b.closest("details").open = false; ouvrirMouvementRapide(b.dataset.mouvement); });
    }
    dessinerResumeStock();
  }
  appliquerConditions();
  dessinerBadges();
  if (ligne) {
    titreLisible(e, ligne).then((t) => {
      if (!t || etat.fiche !== ligne) return;
      $("#titre-texte").textContent = t.titre;
      if (t.sous) { $("#sous-titre").textContent = t.sous; $("#sous-titre").hidden = false; }
    });
  }
  await dessinerRattachement();
  if (!nouveau && e.nom === "article") {
    $("#sources").addEventListener("click", () => ouvrirSources(null));
    await decorerChampsExternes();
  }
  if (!nouveau) {
    passerEnLecture();
    if (!etat.lectureSeule) {
      $("#modifier").addEventListener("click", () => passerEnSaisie());
      $("#annuler").addEventListener("click", () => { etat.modifie = false; pageFiche(ligne.id); });
      form.addEventListener("dblclick", (ev) => { if (form.classList.contains("lecture")) passerEnSaisie(ev.target.closest(".champ")); });
    }
  }
  if (nouveau) { const premier = $("input:not([type=checkbox]):not([type=hidden]), select", form); if (premier) premier.focus(); }
  else await chargerOnglets(ligne);
}

// ------------------------------------------------------------------ Sources externes (centrales…)

/** Bouton « prendre d'une source » au bout de chaque champ reprenable, et provenance sous le champ. */
async function decorerChampsExternes() {
  try { etat.sources = await api(`/api/article/${etat.fiche.id}/sources`); }
  catch { return; }
  const form = $("#formulaire");
  for (const c of etat.courant.champs.filter((x) => x.externe)) {
    const div = $(`.champ[data-col="${c.col}"]`, form);
    if (!div) continue;
    const valeurs = etat.sources.sources.filter((s) => s.donnees && s.donnees[c.col] !== undefined);
    // Bouton seulement quand une source liée donne ce champ.
    if (valeurs.length) {
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.className = "prendre";
      bouton.textContent = `${valeurs.length} source${valeurs.length > 1 ? "s" : ""}`;
      bouton.title = `Comparer avec ${valeurs.map((s) => s.source).join(", ")} et reprendre une valeur`;
      bouton.addEventListener("click", (ev) => { ev.preventDefault(); ouvrirSources(c.col); });
      $("label", div).appendChild(bouton);
    }
    const p = etat.sources.provenance[c.col];
    if (p) {
      div.insertAdjacentHTML("beforeend", `<div class="provenance">Repris de ${esc(p.source)} (${esc(p.code_externe)}) le ${esc(new Date(p.le).toLocaleDateString("fr-FR"))}</div>`);
    }
  }
}

const egal = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/** Fenêtre de comparaison : fiche actuelle face à chaque source ; on coche, champ par champ,
 *  la valeur à reprendre. `seul` : n'afficher que ce champ. */
async function ouvrirSources(seul) {
  if (etat.modifie && !confirm("La fiche a des modifications non enregistrées, qui seront perdues. Continuer ?")) return;
  etat.sources = await api(`/api/article/${etat.fiche.id}/sources`);
  const e = etat.courant, fiche = etat.fiche;
  const sources = etat.sources.sources;
  const liees = sources.filter((s) => s.donnees);
  const champs = e.champs.filter((c) => c.externe && (c.col === seul || (!seul && liees.some((s) => s.donnees[c.col] !== undefined))));

  let tableauHtml = "";
  if (liees.length && champs.length) {
    tableauHtml = `<div class="tableau"><table class="comparaison"><thead><tr><th>Champ</th><th>Fiche actuelle</th>`;
    for (const s of liees) {
      tableauHtml += `<th>${esc(s.source)}<br><small>${esc(s.code_externe)} · ${esc(new Date(s.importe_le).toLocaleDateString("fr-FR"))}</small>
        ${seul ? "" : `<br><button type="button" class="tout" data-source="${s.source_id}">Tout prendre</button>`}</th>`;
    }
    tableauHtml += `</tr></thead><tbody>`;
    for (const c of champs) {
      tableauHtml += `<tr><th>${esc(c.libelle)}</th>
        <td><label class="cellule"><input type="radio" name="r-${c.col}" value="" checked> ${esc(afficher(c, fiche[c.col])) || "<em>vide</em>"}</label></td>`;
      for (const s of liees) {
        const v = s.donnees[c.col];
        if (v === undefined) { tableauHtml += `<td class="absent">—</td>`; continue; }
        const diff = !egal(afficher(c, v), afficher(c, fiche[c.col]));
        tableauHtml += `<td class="${diff ? "diff" : "pareil"}"><label class="cellule"><input type="radio" name="r-${c.col}" value="${s.source_id}" data-col="${c.col}" ${diff ? "" : "disabled"}> ${esc(afficher(c, v))}</label></td>`;
      }
      tableauHtml += `</tr>`;
    }
    tableauHtml += `</tbody></table></div>`;
  } else if (liees.length) {
    tableauHtml = `<p class="vide">Aucune source liée ne donne ${seul ? "ce champ" : "de champ reprenable"}.</p>`;
  }

  // Sources non liées (ou fiche absente du catalogue) : recherche pour lier l'article.
  let liens = "";
  for (const s of sources.filter((x) => !x.donnees)) {
    liens += `<div class="lier" data-source="${s.source_id}">
      <div><strong>${esc(s.source)}</strong> : ${s.code_externe ? `code ${esc(s.code_externe)} absent du catalogue importé` : "article non lié"}</div>
      ${s.code_externe ? "" : `<input type="search" placeholder="Chercher dans le catalogue (code, désignation, UCD, CIP, GTIN…)"><div class="resultats"></div>`}
    </div>`;
  }
  if (!sources.length) liens = `<p class="vide">Aucune source externe : créez-en dans Achats › Sources externes, puis importez leur catalogue (Outils › Import de catalogues).</p>`;

  const voile = document.createElement("div");
  voile.className = "voile";
  voile.innerHTML = `<div class="fenetre" role="dialog" aria-modal="true">
      <div class="fenetre-tete"><h2>${seul ? `${esc(e.champs.find((c) => c.col === seul).libelle)} : sources` : "Comparer avec les sources"}</h2>
        <span class="espace"></span><button type="button" class="discret icone fermer" title="Fermer">✕</button></div>
      <p class="aide">Cochez la valeur à reprendre ; les valeurs égales à la fiche ne se cochent pas.</p>
      ${tableauHtml}
      ${liens ? `<h3>Lier l'article à une source</h3>${liens}` : ""}
      <div class="actions"><button type="button" class="principal" id="appliquer" disabled>Reprendre la sélection</button>
        <button type="button" class="fermer">Fermer</button><span id="message-sources"></span></div>
    </div>`;
  document.body.appendChild(voile);
  const fermer = () => voile.remove();
  for (const b of $$(".fermer", voile)) b.addEventListener("click", fermer);
  voile.addEventListener("click", (ev) => { if (ev.target === voile) fermer(); });
  document.addEventListener("keydown", function echap(ev) { if (ev.key === "Escape") { fermer(); document.removeEventListener("keydown", echap); } });

  const choix = () => Object.fromEntries($$("input[type=radio]:checked", voile).filter((r) => r.value).map((r) => [r.dataset.col, Number(r.value)]));
  const majBouton = () => {
    const n = Object.keys(choix()).length;
    $("#appliquer", voile).disabled = !n;
    $("#appliquer", voile).textContent = n ? `Reprendre ${n} champ${n > 1 ? "s" : ""}` : "Reprendre la sélection";
  };
  voile.addEventListener("change", majBouton);
  for (const b of $$(".tout", voile)) {
    b.addEventListener("click", () => {
      for (const r of $$(`input[type=radio][value="${b.dataset.source}"]:not(:disabled)`, voile)) r.checked = true;
      majBouton();
    });
  }
  $("#appliquer", voile).addEventListener("click", async () => {
    try {
      await api(`/api/article/${fiche.id}/reprendre`, { method: "POST", body: JSON.stringify({ choix: choix() }) });
      const n = Object.keys(choix()).length;
      fermer();
      await pageFiche(fiche.id);
      message(`${n} champ${n > 1 ? "s" : ""} repris des sources.`, "ok");
    } catch (err) {
      $("#message-sources", voile).innerHTML = `<span class="message erreur">${esc(err.message)}</span>`;
    }
  });

  // Recherche dans le catalogue des sources non liées, d'abord par les codes connus de l'article.
  const codeConnu = ["ucd13", "cip13", "gtin", "lpp", "ucd7"].map((k) => fiche[k]).find((v) => v);
  for (const bloc of $$(".lier", voile)) {
    const champ = $("input", bloc);
    if (!champ) continue;
    const chercher = async (q) => {
      const res = await api(`/api/catalogue?source_id=${bloc.dataset.source}&q=${encodeURIComponent(q)}`);
      $(".resultats", bloc).innerHTML = res.length
        ? res.map((r) => `<div class="resultat"><span><strong>${esc(r.code_externe)}</strong> ${esc(r.designation || "")}</span>
            <button type="button" data-code="${esc(r.code_externe)}">Lier</button></div>`).join("")
        : (q ? `<p class="vide">Aucune fiche trouvée.</p>` : "");
      for (const b of $$("button[data-code]", bloc)) {
        b.addEventListener("click", async () => {
          try {
            await api(`/api/e/article_code_externe`, { method: "POST", body: JSON.stringify({ article_id: fiche.id, source_id: Number(bloc.dataset.source), code_externe: b.dataset.code }) });
            fermer();
            etat.modifie = false;
            await pageFiche(fiche.id);
            ouvrirSources(seul);
          } catch (err) {
            $(".resultats", bloc).insertAdjacentHTML("afterbegin", `<p class="message erreur">${esc(err.message)}</p>`);
          }
        });
      }
    };
    let minuterie;
    champ.addEventListener("input", () => { clearTimeout(minuterie); minuterie = setTimeout(() => chercher(champ.value.trim()), 250); });
    const depart = codeConnu || fiche.designation;
    if (depart) { champ.value = depart; chercher(depart); }
  }
  majBouton();
}

// ------------------------------------------------------------------ Import de catalogues

/** Lecture d'un CSV (guillemets, séparateur détecté : point-virgule, virgule ou tabulation). */
function lireCsv(texte) {
  const premiere = texte.split(/\r?\n/, 1)[0];
  const sep = [";", "\t", ","].map((s) => [s, premiere.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const lignes = [];
  let ligne = [], champ = "", guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const ch = texte[i];
    if (guillemets) {
      if (ch === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
      else if (ch === '"') guillemets = false;
      else champ += ch;
    } else if (ch === '"') guillemets = true;
    else if (ch === sep) { ligne.push(champ); champ = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texte[i + 1] === "\n") i++;
      ligne.push(champ); champ = "";
      if (ligne.some((x) => x.trim() !== "")) lignes.push(ligne);
      ligne = [];
    } else champ += ch;
  }
  ligne.push(champ);
  if (ligne.some((x) => x.trim() !== "")) lignes.push(ligne);
  return { sep, entetes: (lignes.shift() || []).map((h) => h.trim()), lignes };
}

const normaliser = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Valeur d'une cellule convertie selon le genre du champ d'article. */
function convertir(c, brut) {
  const v = String(brut ?? "").trim();
  if (v === "") return null;
  if (c.genre === "decimal" || c.genre === "entier") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : v;
  }
  if (c.genre === "booleen") return ["oui", "o", "1", "true", "vrai", "x", "yes"].includes(normaliser(v));
  if (c.genre === "choix") {
    const o = c.extra.find(([k, lib]) => normaliser(k) === normaliser(v) || normaliser(lib) === normaliser(v));
    return o ? o[0] : v;
  }
  return v;
}

async function pageImport() {
  const article = etat.entites.article;
  const externes = article.champs.filter((c) => c.externe);
  const sources = [...(await refs("source_externe"))];
  $("#page").innerHTML = `
    <div class="tete-liste"><h1>Import de catalogues</h1></div>
    <p class="texte-aide">Fichier CSV d'une centrale ou d'une autre source (export Excel en CSV). Chaque ligne est une fiche produit,
      repérée par le code article de la source ; un nouvel import de la même source remplace les fiches de même code.</p>
    <div class="ligne-champs">
      <label class="filtre"><span>Source</span><select id="imp-source">${sources.map(([id, lib]) => `<option value="${id}">${esc(lib)}</option>`).join("")}</select></label>
      <label class="filtre"><span>Encodage</span><select id="imp-encodage"><option value="utf-8">UTF-8</option><option value="windows-1252">Windows (Excel)</option></select></label>
      <label class="filtre"><span>Fichier</span><input type="file" id="imp-fichier" accept=".csv,.txt,text/csv"></label>
    </div>
    ${sources.length ? "" : `<p class="message erreur">Créez d'abord une source dans Achats › Sources externes.</p>`}
    <div id="imp-correspondance"></div>
    <h2 class="sous-titre-page">Derniers imports</h2><div id="imp-historique"></div>`;

  const historique = async () => {
    const lignes = await api("/api/catalogue/imports");
    $("#imp-historique").innerHTML = lignes.length
      ? `<div class="tableau"><table><thead><tr><th>Date</th><th>Source</th><th>Fichier</th><th>Lignes</th><th>Fiches au catalogue</th><th>Par</th></tr></thead><tbody>
        ${lignes.map((l) => `<tr><td>${esc(new Date(l.le).toLocaleString("fr-FR"))}</td><td>${esc(l.source)}</td><td>${esc(l.fichier)}</td>
          <td class="num">${nf.format(l.lignes)}</td><td class="num">${nf.format(l.catalogue)}</td><td>${esc(l.utilisateur)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="vide">Aucun import.</p>`;
  };
  historique();

  let csv = null, nomFichier = "";
  const lire = async () => {
    const f = $("#imp-fichier").files[0];
    if (!f) return;
    nomFichier = f.name;
    const texte = new TextDecoder($("#imp-encodage").value).decode(await f.arrayBuffer());
    csv = lireCsv(texte.replace(/^﻿/, ""));
    dessinerCorrespondance();
  };
  $("#imp-fichier").addEventListener("change", lire);
  $("#imp-encodage").addEventListener("change", lire);

  // Colonne du fichier -> code de la source, désignation, ou champ d'article (deviné sur le nom).
  const deviner = (entete) => {
    const n = normaliser(entete);
    if (["code", "codearticle", "ref", "reference", "refarticle", "codeproduit", "codecentrale"].includes(n)) return "code_externe";
    const c = externes.find((x) => normaliser(x.col) === n || normaliser(x.libelle) === n);
    return c ? c.col : "";
  };
  const dessinerCorrespondance = () => {
    const options = (choisi) => `<option value="">— ignorer —</option>
      <option value="code_externe" ${choisi === "code_externe" ? "selected" : ""}>Code article de la source</option>
      ${externes.map((c) => `<option value="${c.col}" ${choisi === c.col ? "selected" : ""}>${esc(c.libelle)}</option>`).join("")}`;
    const apercu = csv.lignes.slice(0, 3);
    $("#imp-correspondance").innerHTML = `
      <h2 class="sous-titre-page">${esc(nomFichier)} : ${nf.format(csv.lignes.length)} lignes, ${csv.entetes.length} colonnes</h2>
      <p class="texte-aide">Choisissez, pour chaque colonne, le champ d'article qu'elle renseigne. La colonne « Code article de la source » est obligatoire.</p>
      <div class="tableau"><table><thead><tr><th>Colonne du fichier</th><th>Champ</th><th>Exemples</th></tr></thead><tbody>
      ${csv.entetes.map((h, i) => `<tr><td>${esc(h)}</td><td><select data-colonne="${i}">${options(deviner(h))}</select></td>
        <td class="exemples">${apercu.map((l) => esc(l[i] ?? "")).join(" · ")}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="actions"><button class="principal" id="imp-lancer">Importer</button><span id="imp-message"></span></div>`;
    $("#imp-lancer").addEventListener("click", importer);
  };

  const importer = async () => {
    const correspondance = $$("[data-colonne]").map((s) => [Number(s.dataset.colonne), s.value]).filter(([, v]) => v);
    const iCode = correspondance.find(([, v]) => v === "code_externe");
    if (!iCode) { $("#imp-message").innerHTML = `<span class="message erreur">Indiquez la colonne du code article de la source.</span>`; return; }
    const lignes = csv.lignes.map((l) => {
      const donnees = {};
      for (const [i, col] of correspondance) {
        if (col === "code_externe") continue;
        const c = externes.find((x) => x.col === col);
        const v = convertir(c, l[i]);
        if (v !== null) donnees[col] = v;
      }
      return {
        code_externe: String(l[iCode[0]] ?? "").trim(),
        designation: donnees.designation ?? null,
        donnees,
        brut: Object.fromEntries(csv.entetes.map((h, i) => [h, l[i] ?? ""])),
      };
    });
    const bouton = $("#imp-lancer");
    bouton.disabled = true;
    let total = 0;
    try {
      for (let i = 0; i < lignes.length; i += 2000) {
        $("#imp-message").textContent = `Import… ${nf.format(i)} / ${nf.format(lignes.length)}`;
        const r = await api("/api/catalogue/import", { method: "POST", body: JSON.stringify({
          source_id: Number($("#imp-source").value), fichier: nomFichier, lignes: lignes.slice(i, i + 2000) }) });
        total += r.lignes;
      }
      $("#imp-message").innerHTML = `<span class="message ok">${nf.format(total)} fiches importées.</span>`;
      historique();
    } catch (err) {
      $("#imp-message").innerHTML = `<span class="message erreur">${esc(err.message)}</span>`;
    } finally {
      bouton.disabled = false;
    }
  };
}

/** En-tête : chaîne des parents (ex. entité juridique › établissement › pôle › service pour une UF),
 *  puis les autres liens de la fiche en pastilles. Suit les valeurs du formulaire. */
async function dessinerRattachement() {
  const e = etat.courant, form = $("#formulaire");
  const valeurs = {};
  for (const c of e.champs) {
    const el = form.elements[c.col];
    if (c.genre === "ref" && el && el.value !== "") valeurs[c.col] = Number(el.value);
  }
  const chaine = [], vus = new Set([e.nom]);
  let ent = e, v = valeurs, premier = null;
  for (let i = 0; i < 10; i++) {
    const c = ent.champs.filter((x) => x.parent > 0).sort((a, b) => a.parent - b.parent)
      .find((x) => v[x.col] !== null && v[x.col] !== undefined && v[x.col] !== "");
    if (!c || vus.has(c.extra)) break;
    if (i === 0) premier = c.col;
    const cible = etat.entites[c.extra];
    let fiche;
    try { fiche = await api(`/api/e/${cible.nom}/${v[c.col]}`); } catch { break; }
    chaine.unshift({ entite: cible, fiche });
    vus.add(cible.nom);
    ent = cible;
    v = fiche;
  }
  let fil = `<a href="#${e.nom}">${esc(e.pluriel)}</a>`;
  for (const { entite, fiche } of chaine) {
    fil += `<span class="sep">›</span><a href="#${entite.nom}/${fiche.id}" title="${esc(entite.libelle)}"><small>${esc(entite.libelle)}</small> ${esc(fiche._etiquette)}</a>`;
  }
  $("#fil").innerHTML = fil;

  // Carte « Filiation » : la chaîne complète, du plus haut au parent direct, en tête de la fiche.
  let carte = $("#carte-filiation");
  if (!carte) {
    form.insertAdjacentHTML("afterbegin", `<fieldset class="carte filiation" id="carte-filiation"><legend>Filiation</legend><div></div></fieldset>`);
    carte = $("#carte-filiation");
  }
  carte.hidden = !chaine.length;
  $("div", carte).innerHTML = chaine.map(({ entite, fiche }) => `<div class="champ derive"><label>${esc(entite.libelle)}</label>
    <a class="valeur-derivee" href="#${entite.nom}/${fiche.id}">${esc(fiche._etiquette)}</a></div>`).join("");

  let puces = "";
  for (const c of e.champs) {
    // Lien vers le même fichier (ex. : magasin d'approvisionnement) : toujours montré.
    if (c.genre !== "ref" || c.col === premier || valeurs[c.col] === undefined || (vus.has(c.extra) && c.extra !== e.nom)) continue;
    const lib = await etiquette(c.extra, valeurs[c.col]);
    puces += `<a class="puce" href="#${c.extra}/${valeurs[c.col]}"><span>${esc(c.libelle)}</span> ${esc(lib)}</a>`;
  }
  $("#puces").innerHTML = puces;
}

async function champHtml(c, v, nouveau) {
  const id = `f-${c.col}`;
  const etoile = c.requis ? ` <span class="requis" title="Obligatoire">*</span>` : "";
  // L'aide reste à portée (info-bulle) sans encombrer la fiche.
  const info = c.aide ? ` <span class="info" title="${esc(c.aide)}">?</span>` : "";
  const large = c.genre === "texte_long" ? " large" : "";
  if (c.genre === "booleen") {
    return `<div class="champ case" data-col="${c.col}"><label><input type="checkbox" name="${c.col}" ${v ? "checked" : ""}> ${esc(c.libelle)}${info}</label></div>`;
  }
  let input;
  if (c.derive) {
    // Lien déduit (ex. établissement d'un emplacement) : en grisé, cliquable, jamais saisi.
    const lib = v ? await etiquette(c.extra, v) : "";
    return `<div class="champ derive" data-col="${c.col}"><label>${esc(c.libelle)}${info}</label>
      ${v ? `<a class="valeur-derivee" href="#${c.extra}/${v}">${esc(lib)}</a>` : `<span class="valeur-derivee vide">${nouveau ? "Déduit à l'enregistrement" : "—"}</span>`}</div>`;
  }
  if (c.calcule || c.genre === "horodatage") {
    const texte = c.genre === "horodatage" ? afficher(c, v) : (v ?? "");
    input = `<input id="${id}" type="text" class="fige" readonly tabindex="-1" value="${esc(texte)}"
      placeholder="${nouveau ? "Calculé à l'enregistrement" : ""}">`;
    return `<div class="champ" data-col="${c.col}"><label for="${id}">${esc(c.libelle)}${info}</label>${input}</div>`;
  }
  if (c.genre === "ref") {
    input = await comboHtml(c.col, c.extra, v, { id, placeholder: c.requis ? "Rechercher…" : "Aucun (rechercher pour choisir)" });
  } else if (c.genre === "choix") {
    // Liste obligatoire laissée vide à la création : valeur par défaut de la base.
    const vide = c.requis ? (nouveau ? `<option value="">Par défaut</option>` : "") : `<option value="">—</option>`;
    input = `<select id="${id}" name="${c.col}">${vide}`;
    for (const [k, lib] of c.extra) input += `<option value="${esc(k)}" ${String(v) === String(k) ? "selected" : ""}>${esc(lib)}</option>`;
    input += `</select>`;
  } else if (c.genre === "texte_long") {
    input = `<textarea id="${id}" name="${c.col}" rows="4">${esc(v ?? "")}</textarea>`;
  } else {
    const type = { entier: "number", decimal: "number", date: "date" }[c.genre] || "text";
    const pas = c.genre === "decimal" ? ` step="any"` : c.genre === "entier" ? ` step="1"` : "";
    if (c.col === "code") {
      // Le code est attribué par la base à l'enregistrement et ne se modifie jamais.
      input = `<input id="${id}" type="text" class="fige" readonly tabindex="-1" value="${esc(v ?? "")}"
        placeholder="${nouveau ? "Attribué à l'enregistrement" : ""}">`;
    } else {
      input = `<input id="${id}" name="${c.col}" type="${type}"${pas} value="${esc(v ?? "")}">`;
    }
  }
  return `<div class="champ${large}" data-col="${c.col}"><label for="${id}">${esc(c.libelle)}${etoile}${info}</label>${input}</div>`;
}

/** Montre les champs selon la valeur d'un autre champ (ex. : nature de l'article), et masque les cartes vides. */
function appliquerConditions() {
  const form = $("#formulaire");
  for (const c of etat.courant.champs) {
    if (!c.quand) continue;
    const pilote = form.elements[c.quand.col];
    const visible = pilote && c.quand.valeurs.includes(pilote.value);
    $(`.champ[data-col="${c.col}"]`, form).hidden = !visible;
  }
  for (const carte of $$(".carte", form)) carte.hidden = $$(".champ", carte).every((d) => d.hidden);
}

function dessinerBadges() {
  const form = $("#formulaire");
  let html = "";
  const actif = form.elements.actif;
  if (actif && !actif.checked) html += `<span class="badge gris">Inactif</span>`;
  for (const c of etat.courant.champs) {
    if (!c.badge) continue;
    const el = form.elements[c.col];
    if (!el || $(`.champ[data-col="${c.col}"]`, form).hidden) continue;
    if (c.genre === "booleen" && el.checked) html += `<span class="badge alerte">${esc(c.badge)}</span>`;
    if (c.genre === "choix" && el.value && el.value !== "aucune") {
      const o = c.extra.find(([k]) => k === el.value);
      const fort = ["stupefiant", "assimile_stupefiant", "reserve_hospitaliere"].includes(el.value);
      html += `<span class="badge ${fort ? "alerte" : ""}">${esc(o ? o[1] : el.value)}</span>`;
    }
  }
  $("#badges").innerHTML = html;
}

function lireFormulaire() {
  const e = etat.courant, form = $("#formulaire");
  const corps = {};
  for (const c of e.champs) {
    const el = form.elements[c.col];
    if (!el) continue;
    // Champ masqué (sans objet pour cette nature) : remis à sa valeur neutre, ou laissé tel quel.
    if ($(`.champ[data-col="${c.col}"]`, form).hidden) {
      if (!etat.fiche) continue;
      if (c.genre === "booleen") corps[c.col] = false;
      else if (c.genre === "choix" && c.extra.some(([k]) => k === "aucune")) corps[c.col] = "aucune";
      else if (!c.requis) corps[c.col] = null;
      continue;
    }
    if (c.genre === "booleen") corps[c.col] = el.checked;
    else if ((c.genre === "ref" || c.genre === "entier") && el.value !== "") corps[c.col] = Number(el.value);
    else corps[c.col] = el.value;
  }
  return corps;
}

function message(texte, genre) {
  $("#message").innerHTML = texte ? `<div class="message ${genre}">${esc(texte)}</div>` : "";
}

async function enregistrer(ev) {
  ev.preventDefault();
  const e = etat.courant;
  try {
    const corps = JSON.stringify(lireFormulaire());
    const ligne = etat.fiche
      ? await api(`/api/e/${e.nom}/${etat.fiche.id}`, { method: "PUT", body: corps })
      : await api(`/api/e/${e.nom}`, { method: "POST", body: corps });
    delete etat.refs[e.nom];
    oublierEtiquettes(e.nom);
    etat.nav.cle = null;  // le libellé ou les filtres de la liste latérale ont pu changer
    etat.modifie = false;
    if (!etat.fiche) { location.hash = `#${e.nom}/${ligne.id}`; return; }
    await pageFiche(ligne.id);
    message("Fiche enregistrée.", "ok");
    setTimeout(() => { if ($("#message .ok")) message(""); }, 3000);
  } catch (err) {
    message(err.message, "erreur");
  }
}

async function supprimer() {
  const e = etat.courant;
  $(".plus-actions").open = false;
  if (!confirm(`Supprimer définitivement « ${etat.fiche._etiquette} » ?\nSi d'autres fiches y sont liées, la suppression sera refusée : décochez plutôt « Actif ».`)) return;
  try {
    await api(`/api/e/${e.nom}/${etat.fiche.id}`, { method: "DELETE" });
    delete etat.refs[e.nom];
    oublierEtiquettes(e.nom);
    etat.nav.cle = null;
    etat.modifie = false;
    location.hash = `#${e.nom}`;
  } catch (err) {
    message(err.message, "erreur");
  }
}

// ------------------------------------------------------------------ Prix fournisseur : prix déjà connus

/** Fiche « prix fournisseur » : dès qu'un article est choisi, ses autres prix (chez qui, pour quelle
 *  portée, à quel rang), avec deux avertissements : même fournisseur déjà présent sur la même
 *  portée (doublon probable), et principal actuel qui passera au rang 2 si cette fiche est principale. */
async function afficherPrixConnus() {
  const zone = $("#prix-connus"), form = $("#formulaire");
  if (!zone || !form) return;
  const article = form.elements.article_id.value;
  if (!article) { zone.hidden = true; return; }
  let lignes;
  try { lignes = (await apiListe(`/api/e/article_fournisseur?article_id=${article}&limit=100`)).lignes; }
  catch { zone.hidden = true; return; }
  if (form.elements.article_id.value !== article) return;  // un autre article a été choisi entre-temps
  const autres = lignes.filter((l) => !etat.fiche || l.id !== etat.fiche.id);
  const fournisseur = form.elements.fournisseur_id.value;
  const portee = form.elements.etablissement_id.value || "";
  const rang = Number(form.elements.rang.value || 1);
  const actif = form.elements.actif ? form.elements.actif.checked : true;
  const memePortee = (l) => String(l.etablissement_id ?? "") === portee;
  const prix = (v) => (v === null || v === undefined ? "—" : `${nf.format(Number(v))} €`);
  const nom = (l) => l._l_fournisseur_id || `#${l.fournisseur_id}`;
  const lieu = (l) => l._l_etablissement_id || "Tout le groupe";

  const alertes = [];
  const doublon = autres.find((l) => fournisseur && String(l.fournisseur_id) === fournisseur && memePortee(l));
  if (doublon) {
    alertes.push(`${esc(nom(doublon))} a déjà un prix pour cet article sur la même portée (${esc(lieu(doublon))}, ${prix(doublon.prix_unitaire_ht)}, rang ${doublon.rang}). `
      + `<a href="#article_fournisseur/${doublon.id}">Modifier plutôt cette fiche</a>.`);
  }
  const principal = autres.find((l) => l.rang === 1 && l.actif && memePortee(l));
  if (principal && rang === 1 && actif) {
    alertes.push(`Enregistrer en rang 1 fera passer le principal actuel, ${esc(nom(principal))} (${prix(principal.prix_unitaire_ht)}), au rang 2.`);
  }

  const actifs = autres.filter((l) => l.actif && l.prix_unitaire_ht !== null);
  const moinsCher = actifs.reduce((m, l) => (m === null || Number(l.prix_unitaire_ht) < Number(m.prix_unitaire_ht) ? l : m), null);
  zone.hidden = false;
  zone.innerHTML = `
    <div class="prix-connus-tete"><strong>Prix déjà connus pour cet article</strong>
      <span class="compte">${autres.length ? `${autres.length} prix${moinsCher ? ` · le moins cher : ${esc(nom(moinsCher))}, ${prix(moinsCher.prix_unitaire_ht)}` : ""}` : "aucun autre prix"}</span></div>
    ${alertes.map((a) => `<div class="message attention">${a}</div>`).join("")}
    ${autres.length ? `<table><thead><tr><th>Fournisseur</th><th>Portée</th><th>Référence</th><th>Rang</th><th class="num">Prix HT</th><th class="num">TVA</th><th>Validité</th></tr></thead><tbody>
      ${autres.sort((a, b) => a.rang - b.rang || Number(a.prix_unitaire_ht) - Number(b.prix_unitaire_ht)).map((l) => `
        <tr data-id="${l.id}" class="${l.actif ? "" : "inactif"}${memePortee(l) ? " meme-portee" : ""}">
          <td>${esc(nom(l))}</td><td>${esc(lieu(l))}</td><td>${esc(l.reference_fournisseur || "")}</td>
          <td>${l.rang === 1 ? "Principal" : l.rang}${l.actif ? "" : " (inactif)"}</td>
          <td class="num">${prix(l.prix_unitaire_ht)}</td><td class="num">${l.taux_tva === null ? "" : `${nf.format(Number(l.taux_tva))} %`}</td>
          <td>${[l.date_debut, l.date_fin].some((d) => d) ? `${l.date_debut ? afficher({ genre: "date" }, l.date_debut) : "…"} → ${l.date_fin ? afficher({ genre: "date" }, l.date_fin) : "…"}` : ""}</td></tr>`).join("")}
      </tbody></table>` : ""}`;
  lierLignes(zone, "article_fournisseur");
}

// ------------------------------------------------------------------ Mouvement : stock disponible et emplacement proposé

/** Donne une valeur à un champ de lien (texte affiché et valeur cachée). */
function remplirCombo(col, id, libelle, form = $("#formulaire")) {
  const div = $(`.combo[data-col="${col}"]`, form);
  if (!div) return;
  $("input[type=hidden]", div).value = id ?? "";
  $(".combo-texte", div).value = libelle ?? "";
  if (id) cacheEtiquettes.set(`${div.dataset.cible}/${id}`, libelle);
}

/** Nouveau mouvement. Avec un départ : stock disponible de l'article dans ce magasin, du premier au
 *  dernier périmé, avec « Prendre ce lot » (emplacement, lot, série, péremption). Avec une arrivée :
 *  emplacement principal de l'article dans ce magasin, proposé s'il n'est pas déjà choisi. */
async function aideMouvement(form = $("#formulaire")) {
  let zone = form.previousElementSibling;
  if (!zone || !zone.classList.contains("aide-mouvement")) {
    form.insertAdjacentHTML("beforebegin", `<div class="prix-connus aide-mouvement" hidden></div>`);
    zone = form.previousElementSibling;
  }
  const article = form.elements.article_id.value;
  const visible = (col) => { const d = $(`.champ[data-col="${col}"]`, form); return d && !d.hidden; };
  const source = visible("magasin_source_id") ? form.elements.magasin_source_id.value : "";
  const destination = visible("magasin_destination_id") ? form.elements.magasin_destination_id.value : "";

  // Emplacement proposé à l'arrivée.
  if (article && destination && !form.elements.emplacement_destination_id.value) {
    const am = (await api(`/api/e/article_magasin?article_id=${article}&magasin_id=${destination}&limit=1`))[0];
    if (am && am.emplacement_principal_id) {
      remplirCombo("emplacement_destination_id", am.emplacement_principal_id, await etiquette("emplacement", am.emplacement_principal_id), form);
    }
  }
  // Réception : fournisseur principal et son dernier prix (de l'établissement, sinon du groupe).
  if (article && destination && form.elements.type.value === "reception" && form.elements.fournisseur_id && !form.elements.fournisseur_id.value) {
    const magasin = await api(`/api/e/magasin/${destination}`);
    const prix = await api(`/api/e/article_fournisseur?article_id=${article}&rang=1&actif=true&limit=20`);
    const p = prix.find((x) => x.etablissement_id === magasin.etablissement_id) || prix.find((x) => !x.etablissement_id);
    if (p) {
      remplirCombo("fournisseur_id", p.fournisseur_id, p._l_fournisseur_id, form);
      if (!form.elements.prix_unitaire.value && p.prix_unitaire_ht !== null) form.elements.prix_unitaire.value = p.prix_unitaire_ht;
    }
  }
  if (!article || !source) { zone.hidden = true; return; }
  const lignes = (await api(`/api/e/stock?article_id=${article}&magasin_id=${source}&limit=200`))
    .sort((a, b) => (a.peremption || "9999").localeCompare(b.peremption || "9999"));
  const total = lignes.reduce((n, l) => n + Number(l.quantite), 0);
  zone.hidden = false;
  zone.innerHTML = `
    <div class="prix-connus-tete"><strong>Stock disponible dans ce magasin</strong>
      <span class="compte">${lignes.length ? `${nf.format(total)} en ${lignes.length} ligne${lignes.length > 1 ? "s" : ""}, du premier au dernier périmé` : "aucun stock"}</span></div>
    ${lignes.length ? `<table><thead><tr><th>Emplacement</th><th>Lot</th><th>N° de série</th><th>Péremption</th><th class="num">Quantité</th><th></th></tr></thead><tbody>
      ${lignes.map((l, i) => `<tr><td>${esc(l._l_emplacement_id || "—")}</td><td>${esc(l.lot || "")}</td><td>${esc(l.numero_serie || "")}</td>
        <td>${l.peremption ? afficher({ genre: "date" }, l.peremption) : ""}</td><td class="num">${nf.format(Number(l.quantite))}</td>
        <td><button type="button" class="petit" data-prendre="${i}">Prendre ce lot</button></td></tr>`).join("")}
      </tbody></table>` : `<p class="vide">Rien à prélever : choisissez un autre magasin, ou faites d'abord une entrée.</p>`}`;
  for (const b of $$("[data-prendre]", zone)) {
    b.addEventListener("click", async () => {
      const l = lignes[Number(b.dataset.prendre)];
      remplirCombo("emplacement_source_id", l.emplacement_id, l._l_emplacement_id || "", form);
      form.elements.lot.value = l.lot || "";
      form.elements.numero_serie.value = l.numero_serie || "";
      form.elements.peremption.value = l.peremption || "";
      if (!form.elements.quantite.value) form.elements.quantite.value = l.quantite;
      form.elements.quantite.max = l.quantite;
      form.dispatchEvent(new Event("input"));
      form.elements.quantite.focus();
    });
  }
}

// ------------------------------------------------------------------ Saisie rapide d'un mouvement depuis une fiche

const MOUVEMENT_RAPIDE = ["article", "article_site", "article_magasin", "magasin"];
const TYPES_RAPIDES = [["reception", "Réception fournisseur"], ["sortie", "Sortie vers une UF"], ["transfert", "Transfert"],
  ["inventaire_plus", "Inventaire : écart en plus"], ["inventaire_moins", "Inventaire : écart en moins"], ["destruction", "Destruction"]];

/** Ce que la fiche ouverte apporte au mouvement : article, magasin, établissement. */
function contexteMouvement() {
  const e = etat.courant, f = etat.fiche;
  if (e.nom === "article") return { article: f.id };
  if (e.nom === "article_site") return { article: f.article_id, etab: f.etablissement_id };
  if (e.nom === "article_magasin") return { article: f.article_id, magasin: f.magasin_id, etab: f.etablissement_id };
  if (e.nom === "magasin") return { magasin: f.id, etab: f.etablissement_id };
  return {};
}

/** Fenêtre de saisie d'un mouvement, pré-remplie selon la fiche ; seuls les champs du type choisi.
 *  « Enregistrer et continuer » garde la fenêtre ouverte pour la ligne suivante (autre lot…). */
async function ouvrirMouvementRapide(type) {
  const m = etat.entites.mouvement, ctx = contexteMouvement();
  const entree = ["reception", "inventaire_plus", "retour_service"].includes(type);
  const valeurs = { article_id: ctx.article, [entree ? "magasin_destination_id" : "magasin_source_id"]: ctx.magasin };
  const libelle = m.champs.find((c) => c.col === "type").extra.find(([k]) => k === type)[1];
  const visibles = m.champs.filter((c) => !c.calcule && c.col !== "type" && (!c.quand || c.quand.valeurs.includes(type)));
  let champs = "";
  for (const c of visibles) champs += await champHtml(c, valeurs[c.col], true);
  const voile = document.createElement("div");
  voile.className = "voile";
  voile.innerHTML = `<div class="fenetre moyenne" role="dialog" aria-modal="true">
      <div class="fenetre-tete"><h2>${esc(libelle)}</h2><span class="compte">depuis ${esc(etat.fiche._etiquette)}</span>
        <span class="espace"></span><button type="button" class="discret icone fermer" title="Fermer">✕</button></div>
      <form class="saisie-rapide" novalidate>
        <input type="hidden" name="type" value="${type}">
        ${ctx.etab ? `<input type="hidden" name="etablissement_id" value="${ctx.etab}">` : ""}
        <div class="grille">${champs}</div>
        <div class="actions"><button type="submit" class="principal" data-suite="0">Enregistrer</button>
          <button type="submit" data-suite="1">Enregistrer et continuer</button>
          <button type="button" class="fermer">Fermer</button><span class="message-mouvement"></span></div>
      </form></div>`;
  document.body.appendChild(voile);
  const form = $("form", voile);
  const fermer = () => voile.remove();
  for (const b of $$(".fermer", voile)) b.addEventListener("click", fermer);
  for (const div of $$(".combo", form)) {
    const c = m.champs.find((x) => x.col === div.dataset.col);
    activerCombo(div, () => contexteFormulaire(form, c, m));
  }
  form.addEventListener("change", (ev) => {
    if (["article_id", "magasin_source_id", "magasin_destination_id"].includes(ev.target.name)) aideMouvement(form);
  });
  aideMouvement(form);
  const premier = visibles.find((c) => !valeurs[c.col]);
  if (premier && form.elements[premier.col]) {
    const el = form.elements[premier.col].type === "hidden" ? $(`.combo[data-col="${premier.col}"] .combo-texte`, form) : form.elements[premier.col];
    el.focus();
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const suite = ev.submitter && ev.submitter.dataset.suite === "1";
    const corps = { type };
    for (const c of visibles) {
      const el = form.elements[c.col];
      if (!el || el.value === "") continue;
      corps[c.col] = c.genre === "ref" || c.genre === "entier" ? Number(el.value) : el.value;
    }
    const zone = $(".message-mouvement", voile);
    try {
      const r = await api("/api/e/mouvement", { method: "POST", body: JSON.stringify(corps) });
      const quoi = `${nf.format(Number(r.quantite))}${r.lot ? ` · lot ${r.lot}` : ""}, valeur ${nf.format(Number(r.valeur_unitaire))} €`;
      etat.nav.cle = null;
      if (suite) {
        for (const k of ["quantite", "lot", "numero_serie", "peremption"]) if (form.elements[k]) form.elements[k].value = "";
        zone.innerHTML = `<span class="message ok">Enregistré : ${esc(quoi)}.</span>`;
        aideMouvement(form);
      } else {
        fermer();
        message(`Mouvement enregistré : ${libelle.charAt(0).toLowerCase() + libelle.slice(1)}, ${quoi}.`, "ok");
      }
      dessinerResumeStock();
      if (etat.fiche) chargerOnglets(etat.fiche);
    } catch (err) {
      zone.innerHTML = `<span class="message erreur">${esc(err.message)}</span>`;
    }
  });
}

/** En-tête d'un article, d'un article-site ou d'un article-magasin : quantité en stock, répartition
 *  et prochain lot à périmer. */
async function dessinerResumeStock() {
  const zone = $("#resume-stock"), e = etat.courant, f = etat.fiche;
  if (!zone || !f) return;
  const ctx = contexteMouvement();
  if (!ctx.article) { zone.hidden = true; return; }
  const p = new URLSearchParams({ article_id: ctx.article, limit: "1000" });
  if (e.nom === "article_magasin") p.set("magasin_id", ctx.magasin);
  else if (ctx.etab) p.set("etablissement_id", ctx.etab);
  let lignes;
  try { lignes = await api(`/api/e/stock?${p}`); } catch { return; }
  if (etat.fiche !== f) return;
  const total = lignes.reduce((n, l) => n + Number(l.quantite), 0);
  const unite = (await api(`/api/e/article/${ctx.article}`)).unite_stock || "";
  let detail = "";
  if (e.nom === "article") {
    const parEtab = new Map();
    for (const l of lignes) parEtab.set(l._l_etablissement_id, (parEtab.get(l._l_etablissement_id) || 0) + Number(l.quantite));
    detail = [...parEtab].map(([k, q]) => `${esc(decouper(k)[1] || k)} ${nf.format(q)}`).join(" · ");
  } else {
    const parMagasin = new Map();
    for (const l of lignes) parMagasin.set(l._l_magasin_id, (parMagasin.get(l._l_magasin_id) || 0) + Number(l.quantite));
    if (e.nom !== "article_magasin") detail = [...parMagasin].map(([k, q]) => `${esc(decouper(k)[0] || k)} ${nf.format(q)}`).join(" · ");
  }
  const prochain = lignes.filter((l) => l.peremption).sort((a, b) => a.peremption.localeCompare(b.peremption))[0];
  zone.hidden = false;
  zone.innerHTML = total
    ? `<strong>En stock : ${nf.format(total)} ${esc(unite)}</strong>${detail ? ` <span>(${detail})</span>` : ""}
       ${prochain ? `<span class="prochain">Prochain à périmer : lot ${esc(prochain.lot || "?")} au ${afficher({ genre: "date" }, prochain.peremption)}, ${nf.format(Number(prochain.quantite))}</span>` : ""}`
    : `<strong>Aucun stock</strong>`;
}

// ------------------------------------------------------------------ Fiche en lecture

/** Identité de chaque type de fiche : couleur, sigle et phrase qui dit ce qu'il contient. On la
 *  retrouve partout (menu, liste, liste latérale, en-tête de fiche) pour savoir ce que l'on regarde. */
const IDENTITE = {
  entite_juridique: ["#37474f", "EJ", "Société qui porte un ou plusieurs établissements et leur comptabilité."],
  etablissement: ["#1e6fd0", "ÉTAB", "Établissement géographique : clinique, centre SMR, HAD."],
  pui: ["#0d47a1", "PUI", "Pharmacie à usage intérieur : autorisation, pharmacien gérant, établissements desservis."],
  pole: ["#3949ab", "PÔLE", "Regroupement de services d'un établissement."],
  service: ["#5c6bc0", "SERV", "Service d'un établissement : soins, médico-technique, logistique, administratif."],
  uf: ["#7e57c2", "UF", "Unité fonctionnelle : maille de l'activité, des consommations et de l'analytique."],
  magasin: ["#795548", "MAG", "Lieu de stock : réserve de pharmacie, coffre, armoire de service, économat."],
  emplacement: ["#a1887f", "EMP", "Adresse de rangement à l'intérieur d'un magasin."],
  referentiel: ["#546e7a", "RÉF", "Catalogue d'articles, partagé par plusieurs établissements ou propre à un seul."],
  etablissement_referentiel: ["#607d8b", "UTIL", "Référentiel qu'un établissement utilise pour une nature d'articles."],
  famille: ["#689f38", "FAM", "Famille d'articles, commune au groupe ou propre à un référentiel."],
  article: ["#2e7d32", "ART", "Fiche produit : ce qu'est l'article, pour tous les établissements qui partagent son référentiel."],
  article_site: ["#00897b", "SITE", "Un article référencé dans un établissement, avec ses réglages locaux."],
  article_magasin: ["#00695c", "DOT", "Un article tenu dans un magasin : dotation et emplacement habituel."],
  risque_service: ["#c62828", "RISQ", "Médicament à risque dans un service, en plus de la liste de la PUI."],
  article_code_externe: ["#00838f", "CODE", "Code d'un article chez une centrale ou une autre source."],
  fournisseur: ["#e65100", "FOUR", "Laboratoire, grossiste, fournisseur ou centrale d'achat."],
  article_fournisseur: ["#b26a00", "PRIX", "Prix d'achat d'un article chez un fournisseur, pour le groupe ou un établissement."],
  source_externe: ["#8e24aa", "SRC", "Centrale ou référentiel dont on importe les fiches produit."],
  stock: ["#6a1b9a", "STK", "Quantité en stock d'un article par magasin, emplacement et lot (calculée par les mouvements)."],
  mouvement: ["#ad1457", "MVT", "Entrée, sortie ou transfert de stock (enregistré, ne se modifie pas)."],
  valorisation: ["#4527a0", "PUMP", "Prix unitaire moyen pondéré d'un article dans un établissement (calculé)."],
  compteur: ["#616161", "CPT", "Numérotation automatique des codes d'un fichier."],
};
const teinte = (e) => (IDENTITE[e.nom] || ["#6b6862"])[0];
const sigle = (e) => (IDENTITE[e.nom] || [null, e.libelle.slice(0, 3).toUpperCase()])[1];
const description = (e) => (IDENTITE[e.nom] || [null, null, ""])[2];
const pastille = (e, classe = "") => `<span class="pastille-fichier ${classe}" style="--teinte: ${teinte(e)}" title="${esc(e.libelle)}">${esc(sigle(e))}</span>`;

/** Titre qui dit ce que l'on regarde, pour les fiches qui relient deux choses (null : l'étiquette suffit). */
async function titreLisible(e, l) {
  const nom = async (fichier, id) => (id ? decouper(await etiquette(fichier, id))[1] || "" : "");
  const article = async () => (await nom("article", l.article_id)).replace(/ · [^·]+$/, "");
  const choix = (fichier, col, v) => {
    const o = etat.entites[fichier].champs.find((c) => c.col === col).extra.find(([k]) => k === v);
    return o ? o[1] : v;
  };
  switch (e.nom) {
    case "article_site": return { titre: `${await article()} — ${await nom("etablissement", l.etablissement_id)}` };
    case "article_fournisseur": return {
      titre: `${await article()} chez ${await nom("fournisseur", l.fournisseur_id)}`,
      sous: [l.prix_unitaire_ht !== null ? `${nf.format(Number(l.prix_unitaire_ht))} € HT` : "", l.rang === 1 ? "fournisseur principal" : `rang ${l.rang}`,
        l.etablissement_id ? `pour ${await nom("etablissement", l.etablissement_id)}` : "pour tout le groupe"].filter(Boolean).join(" · "),
    };
    case "article_magasin": return { titre: `${await article()} dans ${await nom("magasin", l.magasin_id)}` };
    case "stock": return {
      titre: `${await article()} dans ${await nom("magasin", l.magasin_id)}`,
      sous: [`${nf.format(Number(l.quantite))} en stock`, l.lot ? `lot ${l.lot}` : "", l.peremption ? `péremption ${afficher({ genre: "date" }, l.peremption)}` : ""].filter(Boolean).join(" · "),
    };
    case "risque_service": return { titre: `${await article()} à risque en ${await nom("service", l.service_id)}` };
    case "article_code_externe": return { titre: `${await article()} chez ${await nom("source_externe", l.source_id)} : ${l.code_externe}` };
    case "etablissement_referentiel": return {
      titre: `${await nom("etablissement", l.etablissement_id)} : ${choix("etablissement_referentiel", "nature", l.nature).toLowerCase()}`,
      sous: `référentiel ${await nom("referentiel", l.referentiel_id)}`,
    };
    case "mouvement": return {
      titre: `${choix("mouvement", "type", l.type)} : ${nf.format(Number(l.quantite))} × ${await article()}`,
      sous: [afficher({ genre: "horodatage" }, l.le), l.utilisateur ? `par ${l.utilisateur}` : ""].filter(Boolean).join(" · "),
    };
    case "valorisation": return { titre: `PUMP de ${await article()} — ${await nom("etablissement", l.etablissement_id)}`,
      sous: `${nf.format(Number(l.pump))} € par unité de stock` };
    default: return null;
  }
}

/** Valeur d'un champ, telle qu'on la lit : texte, lien (fiche liée) ou rien. */
function valeurLecture(div) {
  const form = $("#formulaire");
  const c = etat.courant.champs.find((x) => x.col === div.dataset.col);
  if (!c || div.classList.contains("derive")) return null;
  if (c.genre === "booleen") { const el = form.elements[c.col]; return el && el.checked ? "Oui" : ""; }
  if (c.genre === "ref") {
    const el = form.elements[c.col], texte = $(".combo-texte", div);
    return el && el.value ? { lien: `#${c.extra}/${el.value}`, texte: texte ? texte.value : `#${el.value}` } : "";
  }
  if (c.genre === "choix") { const el = form.elements[c.col]; return el && el.value ? el.selectedOptions[0].text : ""; }
  if (c.col === "code" || c.calcule || c.genre === "horodatage") { const el = $("input", div); return el ? el.value : ""; }
  const el = form.elements[c.col];
  if (!el || el.value === "") return "";
  if (c.genre === "date") return afficher(c, el.value);
  if (c.genre === "decimal" || c.genre === "entier") return nf.format(Number(el.value));
  return el.value;
}

/** Lecture : chaque champ en « libellé : valeur », les champs et les cartes vides masqués. */
function dessinerLecture() {
  const form = $("#formulaire");
  for (const div of $$(".champ", form)) {
    const v = valeurLecture(div);
    if (v === null) continue;
    let zone = $(".valeur-lecture", div);
    if (!zone) { div.insertAdjacentHTML("beforeend", `<div class="valeur-lecture"></div>`); zone = $(".valeur-lecture", div); }
    zone.innerHTML = typeof v === "object" ? `<a href="${v.lien}">${esc(v.texte)}</a>` : esc(v);
    div.classList.toggle("vide", !v);
  }
  for (const carte of $$(".carte", form)) {
    carte.classList.toggle("vide-lecture", $$(".champ", carte).every((d) => d.hidden || d.classList.contains("vide")));
  }
}

function passerEnLecture() {
  const form = $("#formulaire");
  if (!form) return;
  dessinerLecture();
  form.classList.add("lecture");
  for (const [id, visible] of [["#modifier", true], ["#annuler", false], ["#enregistrer", false]]) { const b = $(id); if (b) b.hidden = !visible; }
}

function passerEnSaisie(champ = null) {
  const form = $("#formulaire");
  if (!form || etat.lectureSeule || !form.classList.contains("lecture")) return;
  form.classList.remove("lecture");
  for (const [id, visible] of [["#modifier", false], ["#annuler", true], ["#enregistrer", true]]) { const b = $(id); if (b) b.hidden = !visible; }
  const el = champ && ($(".combo-texte", champ) || $("input:not([type=hidden]):not([readonly]), select, textarea", champ));
  if (el) el.focus();
}

// ------------------------------------------------------------------ Structure d'un établissement

/** Onglet « Structure » : pôles, services et UF en arbre ; magasins avec leur chaîne d'approvisionnement. */
async function afficherStructure(vue) {
  const id = etat.fiche.id;
  const [poles, services, ufs, magasins] = await Promise.all(["pole", "service", "uf", "magasin"]
    .map((n) => api(`/api/e/${n}?etablissement_id=${id}&limit=2000`)));
  const libelleChoix = (entite, col, v) => {
    const c = etat.entites[entite].champs.find((x) => x.col === col);
    const o = c && c.extra.find(([k]) => k === v);
    return o ? o[1] : v;
  };
  const lien = (nom, l, suite = "") => `<a href="#${nom}/${l.id}"><span class="code">${esc(l.code)}</span> ${esc(l.libelle)}</a>${suite}`;
  const ufHtml = (s) => ufs.filter((u) => u.service_id === s.id).map((u) => `<li>${lien("uf", u,
    ` <span class="badge">${esc(u.activite)}</span>${u.centre_cout ? ` <span class="discret">${esc(u.centre_cout)}</span>` : ""}`)}</li>`).join("");
  const servicesHtml = (liste) => liste.map((s) => `<li>${lien("service", s, ` <span class="discret">${esc(libelleChoix("service", "type", s.type))}</span>`)}
    ${ufHtml(s) ? `<ul>${ufHtml(s)}</ul>` : ""}</li>`).join("");
  let soins = poles.map((p) => `<li class="pole">${lien("pole", p)}<ul>${servicesHtml(services.filter((s) => s.pole_id === p.id))}</ul></li>`).join("");
  const sansPole = services.filter((s) => !s.pole_id);
  if (sansPole.length) soins += poles.length ? `<li class="pole"><span class="discret">Hors pôle</span><ul>${servicesHtml(sansPole)}</ul></li>` : servicesHtml(sansPole);

  const ici = new Set(magasins.map((m) => m.id));
  const enfants = (m) => magasins.filter((x) => x.magasin_source_id === m.id);
  const magasinHtml = (m) => `<li>${lien("magasin", m, ` <span class="badge">${esc(libelleChoix("magasin", "role", m.role))}</span>`
    + (m.securise_stupefiants ? ` <span class="badge alerte">Sécurisé stupéfiants</span>` : "")
    + (m.magasin_source_id && !ici.has(m.magasin_source_id) ? ` <span class="discret">approvisionné par ${esc(m._l_magasin_source_id)}</span>` : ""))}
    ${enfants(m).length ? `<ul>${enfants(m).map(magasinHtml).join("")}</ul>` : ""}</li>`;
  const racines = magasins.filter((m) => !m.magasin_source_id || !ici.has(m.magasin_source_id));
  vue.innerHTML = `<p class="compte">${poles.length} pôle${poles.length > 1 ? "s" : ""} · ${services.length} services · ${ufs.length} UF · ${magasins.length} magasins</p>
    <div class="structure">
      <section><h3>Organisation des soins</h3><ul class="arbre">${soins || `<li class="vide">Aucun service.</li>`}</ul></section>
      <section><h3>Magasins et approvisionnement</h3><ul class="arbre">${racines.map(magasinHtml).join("") || `<li class="vide">Aucun magasin.</li>`}</ul></section>
    </div>`;
}

// ------------------------------------------------------------------ Administration de la PUI

/** Réglages du pharmacien gérant : contrôle des stupéfiants, magasins sécurisés, écarts à régulariser. */
async function pageAdminPui() {
  const puis = await api("/api/e/pui");
  if (!puis.length) { $("#page").innerHTML = `<h1>Administration de la PUI</h1><p class="vide">Aucune PUI.</p>`; return; }
  const pui = puis.find((p) => String(p.id) === String(etat.adminPui)) || puis[0];
  etat.adminPui = pui.id;
  const magasins = await api(`/api/e/magasin?pui_id=${pui.id}&limit=2000`);
  const ici = new Set(magasins.map((m) => m.id));
  const hors = (await api("/api/e/mouvement?hors_regle=true&limit=1000"))
    .filter((m) => ici.has(m.magasin_source_id) || ici.has(m.magasin_destination_id));
  const champ = (col) => etat.entites.pui.champs.find((c) => c.col === col);
  const role = (v) => (etat.entites.magasin.champs.find((c) => c.col === "role").extra.find(([k]) => k === v) || [v, v])[1];
  $("#page").innerHTML = `
    <div class="tete-liste"><h1>Administration de la PUI</h1>
      <select id="admin-pui">${puis.map((p) => `<option value="${p.id}" ${p.id === pui.id ? "selected" : ""}>${esc(p._etiquette)}</option>`).join("")}</select>
      <span class="compte">Réglages du pharmacien gérant${pui.pharmacien_gerant ? ` : ${esc(pui.pharmacien_gerant)}` : ""}</span></div>
    <p class="texte-aide">Ces réglages s'appliquent à tous les établissements desservis par la PUI. La page n'est pas encore réservée
      au pharmacien gérant : elle le sera avec la connexion des utilisateurs.</p>
    <div class="admin-grille">
      <section class="panneau-admin"><h3>Contrôle des stupéfiants</h3>
        ${champ("controle_stupefiants").extra.map(([k, l]) => `<label class="choix-carte${pui.controle_stupefiants === k ? " actif" : ""}">
          <input type="radio" name="controle" value="${k}" ${pui.controle_stupefiants === k ? "checked" : ""}>
          <span><strong>${k === "strict" ? "Strict" : "Souple"}</strong><br>${esc(l.split(" : ")[1] || l)}</span></label>`).join("")}
        <p class="texte-aide">En souple, un stupéfiant peut aller dans un magasin non sécurisé ou sortir sans séjour, à condition
          d'indiquer un motif : le mouvement est marqué « hors règle » et listé ci-dessous.</p></section>
      <section class="panneau-admin"><h3>PUI</h3>
        <div class="champ"><label>Pharmacien gérant</label><input type="text" id="admin-gerant" value="${esc(pui.pharmacien_gerant || "")}"></div>
        <div class="champ"><label>Cadre</label><select id="admin-cadre">${champ("cadre").extra.map(([k, l]) => `<option value="${k}" ${pui.cadre === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <div class="actions"><button type="button" class="principal" id="admin-enregistrer">Enregistrer</button>
          <a class="bouton" href="#pui/${pui.id}">Fiche complète</a><span id="admin-message"></span></div></section>
    </div>
    <h2 class="sous-titre-page">Magasins de la PUI <span class="compte">${magasins.length}</span></h2>
    <p class="texte-aide">Cochez les lieux fermés à clé où les stupéfiants peuvent être stockés. Un coffre l'est toujours.</p>
    <div class="tableau"><table><thead><tr><th>Établissement</th><th>Magasin</th><th>Rôle</th><th>Sécurisé pour les stupéfiants</th></tr></thead><tbody>
      ${magasins.map((m) => `<tr><td>${esc(m._l_etablissement_id)}</td><td><a href="#magasin/${m.id}">${esc(m._etiquette)}</a></td><td>${esc(role(m.role))}</td>
        <td><label class="interrupteur"><input type="checkbox" data-securise="${m.id}" ${m.securise_stupefiants ? "checked" : ""} ${m.role === "coffre_stupefiants" ? "disabled" : ""}>
        <span>${m.securise_stupefiants ? "Oui" : "Non"}</span></label></td></tr>`).join("")}
    </tbody></table></div>
    <h2 class="sous-titre-page">Mouvements hors règle à régulariser <span class="compte">${hors.length}</span></h2>
    <div id="admin-hors">${hors.length ? await tableau(etat.entites.mouvement, hors, null) : `<p class="vide">Aucun écart.</p>`}</div>`;
  lierLignes($("#admin-hors"), "mouvement");
  $("#admin-pui").addEventListener("change", (ev) => { etat.adminPui = ev.target.value; pageAdminPui(); });
  const enregistrer = async (corps, ok) => {
    try {
      await api(`/api/e/pui/${pui.id}`, { method: "PUT", body: JSON.stringify(corps) });
      oublierEtiquettes("pui");
      $("#admin-message").innerHTML = `<span class="message ok">${esc(ok)}</span>`;
    } catch (err) { $("#admin-message").innerHTML = `<span class="message erreur">${esc(err.message)}</span>`; }
  };
  for (const r of $$("[name=controle]")) {
    r.addEventListener("change", async () => {
      for (const l of $$(".choix-carte")) l.classList.toggle("actif", $("input", l).checked);
      await enregistrer({ controle_stupefiants: r.value }, `Contrôle des stupéfiants : ${r.value}.`);
    });
  }
  $("#admin-enregistrer").addEventListener("click", () => enregistrer(
    { pharmacien_gerant: $("#admin-gerant").value, cadre: $("#admin-cadre").value }, "PUI enregistrée."));
  for (const c of $$("[data-securise]")) {
    c.addEventListener("change", async () => {
      try {
        await api(`/api/e/magasin/${c.dataset.securise}`, { method: "PUT", body: JSON.stringify({ securise_stupefiants: c.checked }) });
        c.nextElementSibling.textContent = c.checked ? "Oui" : "Non";
      } catch (err) { c.checked = !c.checked; alert(err.message); }
    });
  }
}

// ------------------------------------------------------------------ Registre des stupéfiants

/** Registre déduit des mouvements : périmètre (PUI ou magasin), période, article facultatif. */
async function pageRegistre() {
  const r = (etat.registre ??= {});
  const puis = await api("/api/e/pui");
  if (!r.pui && !r.magasin && puis.length) r.pui = String(puis[0].id);
  const auj = new Date();
  r.mois ??= `${auj.getFullYear()}-${String(auj.getMonth() + 1).padStart(2, "0")}`;
  $("#page").innerHTML = `
    <div class="tete-liste sans-impression"><h1>Registre des stupéfiants</h1></div>
    <div class="ligne-champs sans-impression">
      <label class="filtre"><span>PUI (magasins de la pharmacie)</span><select id="reg-pui"><option value="">—</option>
        ${puis.map((p) => `<option value="${p.id}" ${r.pui === String(p.id) ? "selected" : ""}>${esc(p._etiquette)}</option>`).join("")}</select></label>
      <div class="filtre"><span>ou un magasin précis</span>${await comboHtml("reg-magasin", "magasin", r.magasin, { placeholder: "Armoire, dépôt…" })}</div>
      <label class="filtre"><span>Mois</span><input type="month" id="reg-mois" value="${r.mois}"></label>
      <div class="filtre"><span>Article (facultatif)</span>${await comboHtml("reg-article", "article", r.article, { placeholder: "Tous les stupéfiants" })}</div>
      <span class="espace"></span>
      <button type="button" id="reg-csv">Exporter (CSV)</button>
      <button type="button" class="principal" id="reg-imprimer">Imprimer ou PDF</button>
    </div>
    <div id="registre"></div>`;
  activerCombo($(".filtre .combo[data-cible=magasin]"), () => ({}), (v) => { r.magasin = v; if (v) { r.pui = ""; $("#reg-pui").value = ""; } dessinerRegistre(); });
  activerCombo($(".filtre .combo[data-cible=article]"), () => ({ actif: "true" }), (v) => { r.article = v; dessinerRegistre(); });
  $("#reg-pui").addEventListener("change", (ev) => {
    r.pui = ev.target.value;
    if (r.pui) { r.magasin = ""; remplirCombo("reg-magasin", "", "", $("#page")); }
    dessinerRegistre();
  });
  $("#reg-mois").addEventListener("change", (ev) => { r.mois = ev.target.value; dessinerRegistre(); });
  $("#reg-imprimer").addEventListener("click", () => window.print());
  $("#reg-csv").addEventListener("click", exporterRegistre);
  await dessinerRegistre();
}

function periodeRegistre() {
  const [a, m] = etat.registre.mois.split("-").map(Number);
  const fin = new Date(a, m, 0).getDate();
  return { du: `${a}-${String(m).padStart(2, "0")}-01`, au: `${a}-${String(m).padStart(2, "0")}-${fin}` };
}

async function chargerRegistre() {
  const r = etat.registre, { du, au } = periodeRegistre();
  const p = new URLSearchParams({ du, au });
  if (r.magasin) p.set("magasin_id", r.magasin); else if (r.pui) p.set("pui_id", r.pui); else return null;
  if (r.article) p.set("article_id", r.article);
  return { ...(await api(`/api/registre?${p}`)), du, au };
}

async function dessinerRegistre() {
  const zone = $("#registre");
  let d;
  try { d = await chargerRegistre(); } catch (err) { zone.innerHTML = `<p class="message erreur">${esc(err.message)}</p>`; return; }
  if (!d) { zone.innerHTML = `<p class="vide">Choisissez une PUI ou un magasin.</p>`; return; }
  const type = (v) => (etat.entites.mouvement.champs.find((c) => c.col === "type").extra.find(([k]) => k === v) || [v, v])[1];
  const n = (v) => (Number(v) ? nf.format(Number(v)) : "");
  const date = (v) => afficher({ genre: "date" }, v);
  const e = d.entete || {};
  const adresse = [e.adresse, [e.code_postal, e.commune].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const enCours = d.au >= aujourdhui;
  const entete = `${esc(e.etablissement || "")}${adresse ? ` · ${esc(adresse)}` : ""}${e.finess ? ` · FINESS ${esc(e.finess)}` : ""}`;
  let html = `<div class="entete-registre">
      <div><strong>${entete || "Établissement non renseigné"}</strong></div>
      <div>Registre des stupéfiants · ${esc(e.perimetre || "")}${e.pharmacien_gerant ? ` · pharmacien gérant : ${esc(e.pharmacien_gerant)}` : ""}</div>
      <div>Période du ${date(d.du)} au ${date(d.au)} · édité le ${new Date().toLocaleString("fr-FR")}</div></div>`;
  if (!d.articles.length) {
    zone.innerHTML = html + `<p class="vide">Aucun mouvement de stupéfiant dans ce périmètre.</p>`;
    return;
  }
  html += `<h2 class="sous-titre-page">Balance de la période</h2>
    <div class="tableau"><table class="registre"><thead><tr><th>Article</th><th>Unité</th><th class="num">Solde initial</th><th class="num">Entrées</th>
      <th class="num">Sorties</th><th class="num">Solde final</th>${enCours ? `<th class="num">Stock physique</th><th class="num">Écart</th>` : ""}</tr></thead><tbody>
    ${d.articles.map((a) => {
      const ecart = Number(a.stock_physique) - Number(a.solde_final);
      return `<tr><td><a href="#article/${a.id}">${esc(a.code)} – ${esc(a.designation)}</a></td><td>${esc(a.unite_stock)}</td>
        <td class="num">${nf.format(Number(a.solde_initial))}</td><td class="num">${n(a.entrees)}</td><td class="num">${n(a.sorties)}</td>
        <td class="num"><strong>${nf.format(Number(a.solde_final))}</strong></td>
        ${enCours ? `<td class="num">${nf.format(Number(a.stock_physique))}</td><td class="num ${ecart ? "ecart" : ""}">${ecart ? nf.format(ecart) : "—"}</td>` : ""}</tr>`;
    }).join("")}</tbody></table></div>`;
  for (const a of d.articles) {
    const lignes = d.lignes.filter((l) => l.article_id === a.id);
    const colonnes = 11;
    html += `<section class="registre-article">
      <table class="registre"><thead>
        <tr class="entete-page"><th colspan="${colonnes}">${entete} · Registre des stupéfiants · ${date(d.du)} au ${date(d.au)}</th></tr>
        <tr class="titre-article"><th colspan="${colonnes}">${esc(a.code)} – ${esc(a.designation)} <span class="discret">(${esc(a.unite_stock)})</span></th></tr>
        <tr><th>Date</th><th>Mouvement</th><th>Lot</th><th>Origine</th><th>Destination</th><th class="num">Entrée</th><th class="num">Sortie</th>
          <th class="num">Solde</th><th>Séjour, prescripteur</th><th>Motif ou pièce</th><th>Saisi par</th></tr></thead><tbody>
        <tr class="solde"><td>${date(d.du)}</td><td colspan="6">Solde au début de la période</td><td class="num">${nf.format(Number(a.solde_initial))}</td><td colspan="3"></td></tr>
        ${lignes.map((l) => `<tr class="${l.hors_regle ? "hors-regle" : ""}${l.interne ? " interne" : ""}">
          <td>${esc(new Date(l.le).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }))}</td>
          <td><a href="#mouvement/${l.id}">${esc(type(l.type))}</a>${l.interne ? ` <span class="discret">interne</span>` : ""}${l.hors_regle ? ` <span class="badge alerte">Hors règle</span>` : ""}</td>
          <td>${esc(l.lot || "")}${l.peremption ? `<br><span class="discret">${date(l.peremption)}</span>` : ""}</td>
          <td>${esc(l.origine || l.fournisseur || "")}</td><td>${esc(l.destination || l.uf || "")}</td>
          <td class="num">${n(l.entree)}</td><td class="num">${n(l.sortie)}</td><td class="num"><strong>${nf.format(Number(l.solde_apres))}</strong></td>
          <td>${esc([l.sejour, l.prescripteur].filter(Boolean).join(" · "))}</td><td>${esc([l.motif, l.document].filter(Boolean).join(" · "))}</td>
          <td>${esc(l.utilisateur)}</td></tr>`).join("")}
        <tr class="solde"><td>${date(d.au)}</td><td colspan="4">Solde à la fin de la période</td><td class="num">${n(a.entrees)}</td><td class="num">${n(a.sorties)}</td>
          <td class="num"><strong>${nf.format(Number(a.solde_final))}</strong></td><td colspan="3"></td></tr>
      </tbody></table></section>`;
  }
  zone.innerHTML = html;
}

async function exporterRegistre() {
  const d = await chargerRegistre();
  if (!d) return;
  const articles = Object.fromEntries(d.articles.map((a) => [a.id, a]));
  const champ = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lignes = [["Article", "Désignation", "Unité", "Date", "Mouvement", "Lot", "Péremption", "Origine", "Destination", "Entrée", "Sortie",
    "Solde", "Séjour", "Prescripteur", "Motif", "Pièce", "Saisi par", "Hors règle"].map(champ).join(";")];
  for (const l of d.lignes) {
    const a = articles[l.article_id];
    lignes.push([a.code, a.designation, a.unite_stock, new Date(l.le).toLocaleString("fr-FR"), l.type, l.lot, l.peremption,
      l.origine || l.fournisseur, l.destination || l.uf, String(l.entree).replace(".", ","), String(l.sortie).replace(".", ","),
      String(l.solde_apres).replace(".", ","), l.sejour, l.prescripteur, l.motif, l.document, l.utilisateur, l.hors_regle ? "oui" : ""].map(champ).join(";"));
  }
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(new Blob(["\uFEFF" + lignes.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  lien.download = `registre-stupefiants-${etat.registre.mois}.csv`;
  lien.click();
  URL.revokeObjectURL(lien.href);
}

// ------------------------------------------------------------------ Impacts d'une modification en cours

const IMPACTS_DETAILLES = 3;  // au-delà, on affiche le nombre (cliquable) plutôt que chaque fiche

/** Fiche existante en cours de modification : les fiches qui en dépendent (tous fichiers confondus).
 *  Peu nombreuses : chacune, avec un lien ; sinon leur nombre, qui ouvre l'onglet où elles sont toutes.
 *  Désactiver la fiche : message plus appuyé. */
function afficherImpacts() {
  const zone = $("#impacts");
  if (!zone || !etat.fiche || !etat.modifie) { if (zone) zone.hidden = true; return; }
  const blocs = (etat.blocs || []).filter((b) => b.total > 0);
  if (!blocs.length) { zone.hidden = true; return; }
  const form = $("#formulaire");
  const desactive = form.elements.actif && etat.fiche.actif && !form.elements.actif.checked;
  const total = blocs.reduce((n, b) => n + b.total, 0);
  const parBloc = blocs.map((b) => {
    if (b.total <= IMPACTS_DETAILLES) {
      const liens = b.lignes.slice(0, IMPACTS_DETAILLES)
        .map((l) => `<a href="#${b.autre.nom}/${l.id}">${esc(l._etiquette)}</a>`).join(", ");
      return `<li><span class="impact-fichier">${esc(b.titre)}</span> ${liens}</li>`;
    }
    return `<li><span class="impact-fichier">${esc(b.titre)}</span>
      <button type="button" class="lien-nombre" data-onglet-impact="${b.cle}">${nf.format(b.total)} fiches</button></li>`;
  }).join("");
  zone.hidden = false;
  zone.classList.toggle("fort", !!desactive);
  zone.innerHTML = `
    <div class="impacts-tete">${desactive
      ? `<strong>Désactiver cette fiche</strong> concerne ${nf.format(total)} fiche${total > 1 ? "s" : ""} qui en dépendent :`
      : `<strong>Modification en cours.</strong> ${nf.format(total)} fiche${total > 1 ? "s" : ""} dépendent de celle-ci et seront concernées :`}</div>
    <ul>${parBloc}</ul>`;
  for (const b of $$("[data-onglet-impact]", zone)) b.addEventListener("click", () => afficherOnglet(b.dataset.ongletImpact));
}

// ------------------------------------------------------------------ Onglets : fiches liées et historique

/** Un onglet par fichier rattaché à cette fiche (ex. : articles-sites et prix d'un article), avec
 *  son nombre de fiches, puis l'historique. L'onglet ouvert est gardé en passant d'une fiche à l'autre. */
async function chargerOnglets(ligne) {
  const e = etat.courant;
  const blocs = [];
  for (const nom of etat.ordre) {
    for (const c of etat.entites[nom].champs) {
      if (c.genre === "ref" && c.extra === e.nom) blocs.push({ autre: etat.entites[nom], col: c.col });
    }
  }
  etat.blocs = [];
  for (const { autre, col } of blocs) {
    const { lignes, total } = await apiListe(`/api/e/${autre.nom}?${col}=${ligne.id}&limit=50`);
    // Plusieurs liens vers cette fiche, ou lien vers le même fichier : on précise lequel.
    const precise = blocs.filter((b) => b.autre === autre).length > 1 || autre === e;
    const titre = precise ? `${autre.pluriel} (${autre.champs.find((c) => c.col === col).libelle.toLowerCase()})` : autre.pluriel;
    etat.blocs.push({ cle: `${autre.nom}.${col}`, autre, col, titre, lignes, total });
  }
  const onglets = $("#onglets");
  if (!onglets || etat.fiche !== ligne) return;
  // Petit écran : les six premiers onglets non vides restent visibles, les autres vont dans « Plus ».
  const bouton = (b) => `<button type="button" data-onglet="${b.cle}">${esc(b.titre)} <span class="nombre">${nf.format(b.total)}</span></button>`;
  const pleins = etat.blocs.filter((b) => b.total > 0);
  const visibles = pleins.slice(0, 6);
  const autres = etat.blocs.filter((b) => !visibles.includes(b));
  onglets.innerHTML = `<button type="button" data-onglet="fiche">Fiche</button>`
    + (e.nom === "etablissement" ? `<button type="button" data-onglet="structure">Structure</button>` : "")
    + visibles.map(bouton).join("")
    + `<button type="button" data-onglet="historique">Historique</button>`
    + (autres.length ? `<details class="plus-actions plus-onglets"><summary>Plus <span class="nombre">${autres.length}</span> ▾</summary>
        <div class="menu-actions">${autres.map(bouton).join("")}</div></details>` : "");
  for (const b of $$("button", onglets)) {
    b.addEventListener("click", () => { const d = b.closest("details"); if (d) d.open = false; afficherOnglet(b.dataset.onglet); });
  }
  afficherImpacts();
  const voulu = (etat.onglet || {})[e.nom];
  afficherOnglet(voulu && $(`[data-onglet="${voulu}"]`, onglets) ? voulu : "fiche");
}

async function afficherOnglet(cle) {
  const e = etat.courant, ligne = etat.fiche;
  (etat.onglet ??= {})[e.nom] = cle;
  for (const b of $$("#onglets button")) b.classList.toggle("actif", b.dataset.onglet === cle);
  const plus = $("#onglets .plus-onglets summary");
  if (plus) plus.classList.toggle("actif", !!$(`.plus-onglets [data-onglet="${cle}"]`));
  const jeton = (etat.jetonOnglet = (etat.jetonOnglet || 0) + 1);
  const vue = $("#vue-onglet");
  $("#formulaire").hidden = cle !== "fiche";
  for (const id of ["#impacts", "#prix-connus"]) { const z = $(id); if (z && cle !== "fiche") z.hidden = true; }
  if (cle === "fiche") afficherImpacts();
  vue.hidden = cle === "fiche";
  if (cle === "fiche") return;
  if (cle === "historique") { await historique(vue); return; }
  if (cle === "structure") {
    // Le dernier onglet demandé gagne (deux demandes peuvent se croiser pendant le chargement).
    const tampon = document.createElement("div");
    await afficherStructure(tampon);
    if (jeton === etat.jetonOnglet) vue.innerHTML = tampon.innerHTML;
    return;
  }
  const b = etat.blocs.find((x) => x.cle === cle);
  if (!b) return;
  vue.innerHTML = `<div class="onglet-lie">
      <div class="lie-tete"><span class="compte">${nf.format(b.total)} fiche${b.total > 1 ? "s" : ""}${b.total > b.lignes.length ? ` · ${b.lignes.length} affichées` : ""}</span>
        ${b.total > b.lignes.length ? `<a class="bouton voir-tout" href="#${b.autre.nom}">Voir les ${nf.format(b.total)} dans la liste</a>` : ""}
        <a class="bouton" href="#${b.autre.nom}/nouveau?${b.col}=${ligne.id}">Ajouter</a></div>
      ${b.lignes.length ? await tableau(b.autre, b.lignes, b.col) : `<p class="vide">Aucune fiche.</p>`}</div>`;
  lierLignes(vue, b.autre.nom);
  const voir = $(".voir-tout", vue);
  if (voir) {
    voir.addEventListener("click", () => {
      etat.memo[b.autre.nom] = { filtres: { [b.col]: String(ligne.id) }, q: "", tri: null, panneau: false };
    });
  }
  // Depuis un onglet, la liste latérale de la fiche ouverte reprend ce filtre.
  for (const a of $$("tbody tr", vue)) {
    a.addEventListener("click", () => {
      etat.memo[b.autre.nom] = { filtres: { [b.col]: String(ligne.id) }, q: "", tri: null, panneau: false };
    }, { capture: true });
  }
}

async function historique(vue) {
  const e = etat.courant;
  const lignes = await api(`/api/journal/${e.nom}/${etat.fiche.id}`);
  const libelles = Object.fromEntries(e.champs.map((c) => [c.col, c.libelle]));
  let html = `<ul class="journal">`;
  for (const j of lignes) {
    const quand = new Date(j.le).toLocaleString("fr-FR");
    let detail = "";
    if (j.operation === "modification") {
      const changes = Object.keys(j.apres).filter((k) => JSON.stringify(j.avant[k]) !== JSON.stringify(j.apres[k]));
      detail = changes.map((k) => `${libelles[k] || k} : ${j.avant[k] ?? "—"} → ${j.apres[k] ?? "—"}`).join(" ; ");
    }
    html += `<li><span class="quand">${esc(quand)} · ${esc(j.utilisateur)}</span>${esc(j.operation)}${detail ? " : " + esc(detail) : ""}</li>`;
  }
  vue.innerHTML = lignes.length ? html + `</ul>` : `<p class="vide">Aucun historique.</p>`;
}

/** Fiche établissement : crée en une fois les articles-sites manquants (par nature, par famille),
 *  avec des seuils par défaut. */
function ouvrirReferencement() {
  const etab = etat.fiche;
  const natures = etat.entites.article.champs.find((c) => c.col === "nature").extra;
  const voile = document.createElement("div");
  voile.className = "voile";
  voile.innerHTML = `<div class="fenetre petite" role="dialog" aria-modal="true">
      <div class="fenetre-tete"><h2>Référencer des articles</h2><span class="espace"></span><button type="button" class="discret icone fermer" title="Fermer">✕</button></div>
      <p class="aide">Crée un article-site pour chaque article actif des référentiels utilisés par ${esc(etab._etiquette)}
        qui n'y est pas encore. Les articles déjà référencés ne changent pas.</p>
      <form id="form-referencer">
        <div class="champ"><label>Nature</label><select name="nature"><option value="">Toutes</option>
          ${natures.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></div>
        <div class="champ"><label>Famille (facultatif)</label>
          <div class="combo" data-cible="famille" data-col="famille_id"><input type="text" class="combo-texte" placeholder="Toutes" autocomplete="off">
          <input type="hidden" name="famille_id" value=""><div class="combo-liste" hidden></div></div></div>
        <div class="actions"><button type="submit" class="principal">Référencer</button><button type="button" class="fermer">Fermer</button>
          <span id="message-referencer"></span></div>
      </form></div>`;
  document.body.appendChild(voile);
  const form = $("#form-referencer", voile);
  const fermer = () => voile.remove();
  for (const b of $$(".fermer", voile)) b.addEventListener("click", fermer);
  voile.addEventListener("click", (ev) => { if (ev.target === voile) fermer(); });
  activerCombo($(".combo", voile), () => (form.elements.nature.value ? { nature: form.elements.nature.value } : {}));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const corps = Object.fromEntries(["nature", "famille_id"].map((k) => [k, form.elements[k].value]));
    try {
      const r = await api(`/api/etablissement/${etab.id}/referencer`, { method: "POST", body: JSON.stringify(corps) });
      $("#message-referencer", voile).innerHTML = `<span class="message ok">${nf.format(r.crees)} article${r.crees > 1 ? "s" : ""} référencé${r.crees > 1 ? "s" : ""}.</span>`;
      await chargerOnglets(etab);
    } catch (err) {
      $("#message-referencer", voile).innerHTML = `<span class="message erreur">${esc(err.message)}</span>`;
    }
  });
}

demarrer();
