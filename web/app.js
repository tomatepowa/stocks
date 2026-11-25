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
function contexteFormulaire(form, c) {
  const cible = etat.entites[c.extra];
  const p = {};
  for (const tc of cible.champs) {
    if (tc.col === "actif" || !["ref", "choix"].includes(tc.genre)) continue;
    const el = form.elements[tc.col];
    if (!el || el.value === "" || tc.col === c.col) continue;
    p[(tc.requis ? "" : "~") + tc.col] = el.value;
  }
  if (c.extra === "article" && form.elements.etablissement_id && form.elements.etablissement_id.value) {
    p._utilisable_par = form.elements.etablissement_id.value;
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
    default: return v;
  }
}

// ------------------------------------------------------------------ Démarrage et adresses

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
  let html = "", groupe = null;
  for (const nom of etat.ordre) {
    const e = etat.entites[nom];
    if (e.groupe !== groupe) { groupe = e.groupe; html += `<h2>${esc(groupe)}</h2>`; }
    html += `<a href="#${nom}" data-nom="${nom}">${esc(e.pluriel)}</a>`;
  }
  html += `<h2>Outils</h2><a href="#import" data-nom="import">Import de catalogues</a>`;
  $("#menu").innerHTML = html;
  window.addEventListener("hashchange", router);
  document.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "s" && $("#formulaire")) { ev.preventDefault(); $("#formulaire").requestSubmit(); }
  });
  router();
}

function router() {
  const [chemin, requete] = location.hash.slice(1).split("?");
  const [nom, id] = chemin.split("/");
  if (nom === "import") {
    for (const a of $$("#menu a")) a.classList.toggle("actif", a.dataset.nom === nom);
    pageImport();
    return;
  }
  const e = etat.entites[nom];
  if (!e) return;
  for (const a of $$("#menu a")) a.classList.toggle("actif", a.dataset.nom === nom);
  etat.courant = e;
  window.scrollTo(0, 0);
  if (!id) pageListe();
  else if (id === "nouveau") pageFiche(null, Object.fromEntries(new URLSearchParams(requete || "")));
  else pageFiche(Number(id));
}

// ------------------------------------------------------------------ Liste

// Filtres : toutes les listes de choix, tous les liens et toutes les cases du fichier.
const filtrables = (e) => e.champs.filter((c) => ["ref", "choix", "booleen"].includes(c.genre));
const memo = (e) => (etat.memo[e.nom] ??= { filtres: {}, q: "", tri: null });

const optionsFiltre = (c) => (c.genre === "booleen" ? [["true", "Oui"], ["false", "Non"]] : c.extra);

async function pageListe() {
  const e = etat.courant, m = memo(e);
  // Filtres principaux toujours visibles (colonnes, rattachements, pastilles, actif) ; les autres repliés.
  const principal = (c) => c.liste || (c.genre === "ref" && c.requis) || c.badge || c.col === "actif";
  const filtreHtml = async (c) => {
    const actif = m.filtres[c.col] !== undefined;
    let h = `<div class="filtre${actif ? " actif" : ""}" data-filtre-col="${c.col}"><span>${esc(c.libelle)}</span>`;
    // Lien : recherche à la frappe (les fichiers liés peuvent compter des milliers de fiches).
    if (c.genre === "ref") return h + (await comboHtml(`filtre-${c.col}`, c.extra, m.filtres[c.col], { placeholder: "Tous" })) + `</div>`;
    h += `<select data-filtre="${c.col}"><option value="">Tous</option>`;
    for (const [k, lib] of optionsFiltre(c)) h += `<option value="${esc(k)}" ${String(m.filtres[c.col]) === String(k) ? "selected" : ""}>${esc(lib)}</option>`;
    return h + `</select></div>`;
  };
  let filtres = "", autres = "", nbAutresActifs = 0;
  for (const c of filtrables(e)) {
    if (principal(c)) filtres += await filtreHtml(c);
    else { autres += await filtreHtml(c); if (m.filtres[c.col] !== undefined) nbAutresActifs++; }
  }
  if (autres) {
    filtres += `<details class="plus"${nbAutresActifs ? " open" : ""}><summary>Plus de filtres${nbAutresActifs ? ` (${nbAutresActifs})` : ""}</summary><div class="filtres">${autres}</div></details>`;
  }
  $("#page").innerHTML = `
    <div class="tete-liste">
      <h1>${esc(e.pluriel)}</h1>
      <input type="search" id="recherche" placeholder="Rechercher (code, libellé…)" value="${esc(m.q)}">
      <button id="reinitialiser" hidden>Réinitialiser</button>
      <span class="compte" id="compte"></span>
      <button class="principal" id="nouveau">Nouveau</button>
    </div>
    ${filtres ? `<div class="filtres">${filtres}</div>` : ""}
    <div id="liste"></div>`;

  let minuterie;
  $("#recherche").addEventListener("input", (ev) => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => { m.q = ev.target.value; chargerListe(); }, 250);
  });
  const appliquerFiltre = (col, valeur, el) => {
    if (valeur) m.filtres[col] = valeur; else delete m.filtres[col];
    el.closest(".filtre").classList.toggle("actif", !!valeur);
    chargerListe();
  };
  for (const s of $$("select[data-filtre]")) s.addEventListener("change", () => appliquerFiltre(s.dataset.filtre, s.value, s));
  for (const div of $$(".filtre .combo")) {
    const col = div.closest(".filtre").dataset.filtreCol;
    activerCombo(div, () => ({}), (valeur) => appliquerFiltre(col, valeur, div));
  }
  $("#reinitialiser").addEventListener("click", () => { etat.memo[e.nom] = { filtres: {}, q: "", tri: m.tri }; pageListe(); });
  $("#nouveau").addEventListener("click", () => {
    const p = new URLSearchParams(m.filtres).toString();
    location.hash = `#${e.nom}/nouveau${p ? "?" + p : ""}`;
  });
  $("#recherche").focus();
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
  $("#reinitialiser").hidden = !filtre;
  $("#compte").textContent = `${nf.format(total)} fiche${total > 1 ? "s" : ""}${total > lignes.length ? ` (${nf.format(lignes.length)} affichées : affinez la recherche)` : ""}`;
  $("#liste").innerHTML = lignes.length
    ? await tableau(e, lignes, null, m.tri)
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
 *  `tri` : { col, sens } pour trier sur une colonne (sinon : ordre des étiquettes). */
async function tableau(e, lignes, sauf, tri = null) {
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
    return `<th${tri !== null || sauf === null ? ` data-col="${c.col}" class="triable"` : ""}>${esc(c.libelle)}${fleche}</th>`;
  }).join("");
  let html = `<div class="tableau"><table><thead><tr>${entete}</tr></thead><tbody>`;
  for (const l of lignes) {
    html += `<tr data-id="${l.id}" class="${l.actif === false ? "inactif" : ""}">`;
    for (const c of cols) {
      const num = c.genre === "decimal" || c.genre === "entier";
      html += `<td class="${num ? "num" : ""}">${esc(afficher(c, l[c.col], lien(l, c)))}</td>`;
    }
    html += `</tr>`;
  }
  return html + `</tbody></table></div>`;
}

function lierLignes(conteneur, nom) {
  for (const tr of $$("tbody tr", conteneur)) tr.addEventListener("click", () => { location.hash = `#${nom}/${tr.dataset.id}`; });
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

  $("#page").innerHTML = `
    <div class="tete">
      <div class="fil" id="fil"><a href="#${e.nom}">${esc(e.pluriel)}</a></div>
      <div class="tete-ligne">
        <h1>${nouveau ? `Nouvel élément : ${esc(e.libelle.toLowerCase())}` : esc(ligne._etiquette)}</h1>
        <div class="badges" id="badges"></div>
        <span class="espace"></span>
        <button type="submit" form="formulaire" class="principal" title="Ctrl+S">Enregistrer</button>
        ${!nouveau && e.nom === "article" ? `<button type="button" id="sources" title="Comparer et reprendre les données des centrales">Centrales</button>` : ""}
        ${!nouveau && e.nom === "etablissement" ? `<button type="button" id="referencer" title="Créer les articles-sites manquants">Référencer des articles</button>` : ""}
        ${nouveau ? "" : `<button type="button" id="historique">Historique</button><button type="button" class="danger" id="supprimer">Supprimer</button>`}
      </div>
      <div class="puces" id="puces"></div>
      <div id="message"></div>
    </div>
    <form id="formulaire" class="sections" novalidate>${cartes}</form>
    <div id="lies"></div>
    <div id="journal"></div>`;

  const form = $("#formulaire");
  form.addEventListener("submit", enregistrer);
  etat.modifie = false;
  form.addEventListener("input", () => { etat.modifie = true; });
  form.addEventListener("change", (ev) => {
    etat.modifie = true;
    appliquerConditions();
    dessinerBadges();
    if (ev.target.tagName === "SELECT" || ev.target.type === "hidden") dessinerRattachement();
  });
  for (const div of $$(".combo", form)) {
    const c = e.champs.find((x) => x.col === div.dataset.col);
    activerCombo(div, () => contexteFormulaire(form, c));
  }
  if (!nouveau) {
    $("#supprimer").addEventListener("click", supprimer);
    $("#historique").addEventListener("click", historique);
  }
  if (!nouveau && e.nom === "etablissement") $("#referencer").addEventListener("click", ouvrirReferencement);
  appliquerConditions();
  dessinerBadges();
  await dessinerRattachement();
  if (!nouveau && e.nom === "article") {
    $("#sources").addEventListener("click", () => ouvrirSources(null));
    await decorerChampsExternes();
  }
  if (nouveau) { const premier = $("input:not([type=checkbox]), select", form); if (premier) premier.focus(); }
  else await dessinerLies(ligne);
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
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "prendre" + (valeurs.length ? "" : " vide");
    bouton.textContent = valeurs.length ? `⇣ ${valeurs.length}` : "⇣";
    bouton.title = valeurs.length
      ? `Prendre la valeur d'une source (${valeurs.map((s) => s.source).join(", ")})`
      : "Aucune source liée ne donne ce champ";
    bouton.addEventListener("click", (ev) => { ev.preventDefault(); ouvrirSources(c.col); });
    const label = $("label", div);
    label.appendChild(bouton);
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
        <span class="espace"></span><button type="button" class="fermer">✕</button></div>
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
    <p class="aide">Fichier CSV d'une centrale ou d'une autre source (export Excel en CSV). Chaque ligne est une fiche produit,
      repérée par le code article de la source ; un nouvel import de la même source remplace les fiches de même code.</p>
    <div class="outils">
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
      <p class="aide">Choisissez, pour chaque colonne, le champ d'article qu'elle renseigne. La colonne « Code article de la source » est obligatoire.</p>
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
    fil += ` <span class="sep">›</span> <a href="#${entite.nom}/${fiche.id}" title="${esc(entite.libelle)}"><small>${esc(entite.libelle)}</small> ${esc(fiche._etiquette)}</a>`;
  }
  $("#fil").innerHTML = fil;

  let puces = "";
  for (const c of e.champs) {
    if (c.genre !== "ref" || c.col === premier || valeurs[c.col] === undefined || vus.has(c.extra)) continue;
    const lib = await etiquette(c.extra, valeurs[c.col]);
    puces += `<a class="puce" href="#${c.extra}/${valeurs[c.col]}"><span>${esc(c.libelle)}</span> ${esc(lib)}</a>`;
  }
  $("#puces").innerHTML = puces;
}

async function champHtml(c, v, nouveau) {
  const id = `f-${c.col}`;
  const etoile = c.requis ? ` <span class="requis">*</span>` : "";
  const aide = c.aide ? `<div class="aide">${esc(c.aide)}</div>` : "";
  const large = c.genre === "texte_long" ? " large" : "";
  if (c.genre === "booleen") {
    return `<div class="champ case" data-col="${c.col}"><label><input type="checkbox" name="${c.col}" ${v ? "checked" : ""}> ${esc(c.libelle)}</label>${aide}</div>`;
  }
  let input;
  if (c.genre === "ref") {
    input = await comboHtml(c.col, c.extra, v, { id, placeholder: c.requis ? "Rechercher…" : "— (rechercher pour choisir)" });
  } else if (c.genre === "choix") {
    const options = c.extra;
    // Liste obligatoire laissée vide à la création : valeur par défaut de la base.
    const vide = c.requis ? (nouveau ? `<option value="">— par défaut —</option>` : "") : `<option value="">—</option>`;
    input = `<select id="${id}" name="${c.col}">${vide}`;
    for (const [k, lib] of options) input += `<option value="${esc(k)}" ${String(v) === String(k) ? "selected" : ""}>${esc(lib)}</option>`;
    input += `</select>`;
  } else if (c.genre === "texte_long") {
    input = `<textarea id="${id}" name="${c.col}" rows="4">${esc(v ?? "")}</textarea>`;
  } else {
    const type = { entier: "number", decimal: "number", date: "date" }[c.genre] || "text";
    const pas = c.genre === "decimal" ? ` step="any"` : c.genre === "entier" ? ` step="1"` : "";
    const indice = c.col === "code" && nouveau ? ` placeholder="Automatique"` : "";
    input = `<input id="${id}" name="${c.col}" type="${type}"${pas}${indice} value="${esc(v ?? "")}">`;
  }
  return `<div class="champ${large}" data-col="${c.col}"><label for="${id}">${esc(c.libelle)}${etoile}</label>${input}${aide}</div>`;
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
    if (!etat.fiche) { location.hash = `#${e.nom}/${ligne.id}`; return; }
    await pageFiche(ligne.id);
    message("Fiche enregistrée.", "ok");
  } catch (err) {
    message(err.message, "erreur");
  }
}

async function supprimer() {
  const e = etat.courant;
  if (!confirm(`Supprimer définitivement « ${etat.fiche._etiquette} » ?\nSi d'autres fiches y sont liées, la suppression sera refusée : décochez plutôt « Actif ».`)) return;
  try {
    await api(`/api/e/${e.nom}/${etat.fiche.id}`, { method: "DELETE" });
    delete etat.refs[e.nom];
    oublierEtiquettes(e.nom);
    location.hash = `#${e.nom}`;
  } catch (err) {
    message(err.message, "erreur");
  }
}

/** Fiches des autres fichiers rattachées à celle-ci (ex. : articles-sites et prix d'un article). */
async function dessinerLies(ligne) {
  const e = etat.courant;
  let html = "";
  const blocs = [];
  for (const nom of etat.ordre) {
    for (const c of etat.entites[nom].champs) {
      if (c.genre === "ref" && c.extra === e.nom) blocs.push({ autre: etat.entites[nom], col: c.col });
    }
  }
  // 20 lignes par bloc au plus ; « Voir tout » ouvre la liste filtrée sur cette fiche.
  for (const { autre, col } of blocs) {
    const { lignes, total } = await apiListe(`/api/e/${autre.nom}?${col}=${ligne.id}&limit=20`);
    const titre = blocs.filter((b) => b.autre === autre).length > 1 ? `${autre.pluriel} (${autre.champs.find((c) => c.col === col).libelle.toLowerCase()})` : autre.pluriel;
    html += `<section class="lie" data-nom="${autre.nom}">
      <div class="lie-tete"><h2>${esc(titre)} <span class="compte">${nf.format(total)}</span></h2>
      <a class="bouton" href="#${autre.nom}/nouveau?${col}=${ligne.id}">Ajouter</a>
      ${total > lignes.length ? `<a class="bouton voir-tout" href="#${autre.nom}" data-col="${col}" data-id="${ligne.id}">Voir les ${nf.format(total)}</a>` : ""}</div>
      ${lignes.length ? await tableau(autre, lignes, col) : `<p class="vide">Aucune fiche.</p>`}</section>`;
  }
  $("#lies").innerHTML = html;
  for (const s of $$(".lie")) lierLignes(s, s.dataset.nom);
  for (const a of $$(".voir-tout")) {
    a.addEventListener("click", () => {
      etat.memo[a.closest(".lie").dataset.nom] = { filtres: { [a.dataset.col]: a.dataset.id }, q: "", tri: null };
    });
  }
}

/** Fiche établissement : crée en une fois les articles-sites manquants (par nature, par famille),
 *  avec des seuils par défaut. */
function ouvrirReferencement() {
  const etab = etat.fiche;
  const natures = etat.entites.article.champs.find((c) => c.col === "nature").extra;
  const voile = document.createElement("div");
  voile.className = "voile";
  voile.innerHTML = `<div class="fenetre petite" role="dialog" aria-modal="true">
      <div class="fenetre-tete"><h2>Référencer des articles</h2><span class="espace"></span><button type="button" class="fermer">✕</button></div>
      <p class="aide">Crée un article-site pour chaque article actif des référentiels utilisés par ${esc(etab._etiquette)}
        qui n'y est pas encore. Les articles déjà référencés ne changent pas.</p>
      <form id="form-referencer">
        <div class="champ"><label>Nature</label><select name="nature"><option value="">Toutes</option>
          ${natures.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></div>
        <div class="champ"><label>Famille (facultatif)</label>
          <div class="combo" data-cible="famille" data-col="famille_id"><input type="text" class="combo-texte" placeholder="Toutes" autocomplete="off">
          <input type="hidden" name="famille_id" value=""><div class="combo-liste" hidden></div></div></div>
        <div class="champ"><label>Stock mini par défaut</label><input type="number" step="any" name="stock_mini"></div>
        <div class="champ"><label>Stock maxi par défaut</label><input type="number" step="any" name="stock_maxi"></div>
        <div class="actions"><button type="submit" class="principal">Référencer</button><button type="button" class="fermer">Fermer</button>
          <span id="message-referencer"></span></div>
      </form></div>`;
  document.body.appendChild(voile);
  const form = $("#form-referencer", voile);
  const fermer = () => voile.remove();
  for (const b of $$(".fermer", voile)) b.addEventListener("click", fermer);
  activerCombo($(".combo", voile), () => (form.elements.nature.value ? { nature: form.elements.nature.value } : {}));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const corps = Object.fromEntries(["nature", "famille_id", "stock_mini", "stock_maxi"].map((k) => [k, form.elements[k].value]));
    try {
      const r = await api(`/api/etablissement/${etab.id}/referencer`, { method: "POST", body: JSON.stringify(corps) });
      $("#message-referencer", voile).innerHTML = `<span class="message ok">${nf.format(r.crees)} article${r.crees > 1 ? "s" : ""} référencé${r.crees > 1 ? "s" : ""}.</span>`;
      await dessinerLies(etab);
    } catch (err) {
      $("#message-referencer", voile).innerHTML = `<span class="message erreur">${esc(err.message)}</span>`;
    }
  });
}

async function historique() {
  const e = etat.courant;
  const lignes = await api(`/api/journal/${e.nom}/${etat.fiche.id}`);
  const libelles = Object.fromEntries(e.champs.map((c) => [c.col, c.libelle]));
  let html = `<section class="lie"><div class="lie-tete"><h2>Historique</h2></div><ul class="journal">`;
  for (const j of lignes) {
    const quand = new Date(j.le).toLocaleString("fr-FR");
    let detail = "";
    if (j.operation === "modification") {
      const changes = Object.keys(j.apres).filter((k) => JSON.stringify(j.avant[k]) !== JSON.stringify(j.apres[k]));
      detail = changes.map((k) => `${libelles[k] || k} : ${j.avant[k] ?? "—"} → ${j.apres[k] ?? "—"}`).join(" ; ");
    }
    html += `<li><span class="quand">${esc(quand)} · ${esc(j.utilisateur)}</span> ${esc(j.operation)}${detail ? " — " + esc(detail) : ""}</li>`;
  }
  $("#journal").innerHTML = html + `</ul></section>`;
  $("#journal").scrollIntoView({ behavior: "smooth" });
}

demarrer();
