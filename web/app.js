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

async function refs(nom) {
  if (!etat.refs[nom]) {
    const lignes = await api(`/api/e/${nom}`);
    etat.refs[nom] = new Map(lignes.map((l) => [l.id, l._etiquette]));
  }
  return etat.refs[nom];
}

function afficher(c, v, liees) {
  if (v === null || v === undefined || v === "") return "";
  switch (c.genre) {
    case "booleen": return v ? "✓" : "";
    case "ref": return (liees && liees.get(v)) || `#${v}`;
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

async function optionsFiltre(c) {
  if (c.genre === "booleen") return [["true", "Oui"], ["false", "Non"]];
  if (c.genre === "choix") return c.extra;
  return [...(await refs(c.extra))];
}

async function pageListe() {
  const e = etat.courant, m = memo(e);
  // Filtres principaux toujours visibles (colonnes, rattachements, pastilles, actif) ; les autres repliés.
  const principal = (c) => c.liste || (c.genre === "ref" && c.requis) || c.badge || c.col === "actif";
  const filtreHtml = async (c) => {
    const actif = m.filtres[c.col] !== undefined;
    let h = `<label class="filtre${actif ? " actif" : ""}"><span>${esc(c.libelle)}</span><select data-filtre="${c.col}"><option value="">Tous</option>`;
    for (const [k, lib] of await optionsFiltre(c)) h += `<option value="${esc(k)}" ${String(m.filtres[c.col]) === String(k) ? "selected" : ""}>${esc(lib)}</option>`;
    return h + `</select></label>`;
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
  for (const s of $$("[data-filtre]")) {
    s.addEventListener("change", () => {
      if (s.value) m.filtres[s.dataset.filtre] = s.value; else delete m.filtres[s.dataset.filtre];
      s.closest(".filtre").classList.toggle("actif", !!s.value);
      chargerListe();
    });
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
  let lignes;
  try { lignes = await api(`/api/e/${e.nom}?${p}`); }
  catch (err) { $("#liste").innerHTML = `<p class="message erreur">${esc(err.message)}</p>`; return; }
  const filtre = !!m.q.trim() || Object.keys(m.filtres).length > 0;
  $("#reinitialiser").hidden = !filtre;
  $("#compte").textContent = `${lignes.length} fiche${lignes.length > 1 ? "s" : ""}${lignes.length >= 5000 ? " (5 000 premières)" : ""}`;
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
  const liees = {};
  for (const c of cols) if (c.genre === "ref") liees[c.col] = await refs(c.extra);
  if (tri) {
    const c = e.champs.find((x) => x.col === tri.col);
    const cle = (l) => {
      const v = l[tri.col];
      if (v === null || v === undefined || v === "") return null;
      if (c.genre === "decimal" || c.genre === "entier") return Number(v);
      return afficher(c, v, liees[c.col]);
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
      html += `<td class="${num ? "num" : ""}">${esc(afficher(c, l[c.col], liees[c.col]))}</td>`;
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
  form.addEventListener("change", (ev) => {
    appliquerConditions();
    dessinerBadges();
    if (ev.target.tagName === "SELECT") dessinerRattachement();
  });
  if (!nouveau) {
    $("#supprimer").addEventListener("click", supprimer);
    $("#historique").addEventListener("click", historique);
  }
  appliquerConditions();
  dessinerBadges();
  await dessinerRattachement();
  if (nouveau) { const premier = $("input:not([type=checkbox]), select", form); if (premier) premier.focus(); }
  else await dessinerLies(ligne);
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
    const lib = (await refs(c.extra)).get(valeurs[c.col]) || `#${valeurs[c.col]}`;
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
  if (c.genre === "choix" || c.genre === "ref") {
    const options = c.genre === "choix" ? c.extra : [...(await refs(c.extra))];
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
  for (const { autre, col } of blocs) {
    const lignes = await api(`/api/e/${autre.nom}?${col}=${ligne.id}`);
    const titre = blocs.filter((b) => b.autre === autre).length > 1 ? `${autre.pluriel} (${autre.champs.find((c) => c.col === col).libelle.toLowerCase()})` : autre.pluriel;
    html += `<section class="lie" data-nom="${autre.nom}">
      <div class="lie-tete"><h2>${esc(titre)} <span class="compte">${lignes.length}</span></h2>
      <a class="bouton" href="#${autre.nom}/nouveau?${col}=${ligne.id}">Ajouter</a></div>
      ${lignes.length ? await tableau(autre, lignes, col) : `<p class="vide">Aucune fiche.</p>`}</section>`;
  }
  $("#lies").innerHTML = html;
  for (const s of $$(".lie")) lierLignes(s, s.dataset.nom);
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
