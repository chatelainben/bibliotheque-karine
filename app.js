// ============================================================
// APP.JS - le "cerveau" de l'application (v1 : recherche)
// ============================================================

// --- 1. Le conteneur de nos données : une simple liste (tableau) d'objets.
// Chaque livre = { titre, auteur, editeur, isbn, niveau, theme, emplacement, date }
let livres = [];

// --- 2. Charger les données : on télécharge le CSV publié puis on le convertit.
async function chargerLivres() {
  if (typeof CSV_URL === "undefined" || CSV_URL === "A_COLLER_ICI") {
    throw new Error("config");
  }
  const reponse = await fetch(CSV_URL);
  if (!reponse.ok) throw new Error("reseau");
  const texte = await reponse.text();
  livres = parserCSV(texte);
}

// --- 3. Convertir du texte CSV en liste d'objets.
// Le piège : certaines virgules sont DANS un champ entre guillemets
// (ex. : "Le roi, la poule et..."). On ne peut donc pas juste faire split(",").
function parserCSV(texte) {
  const lignes = [];
  let champ = "", ligne = [], dansGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (dansGuillemets) {
      if (c === '"') { dansGuillemets = false; }
      else { champ += c; }
    } else if (c === '"') { dansGuillemets = true; }
    else if (c === ",") { ligne.push(champ); champ = ""; }
    else if (c === "\n") { ligne.push(champ.trim()); lignes.push(ligne); ligne = []; champ = ""; }
    else if (c !== "\r") { champ += c; }
  }
  if (champ || ligne.length) { ligne.push(champ.trim()); lignes.push(ligne); }

  // La 1re ligne contient les titres de colonnes.
  const entetes = lignes.shift().map(h => h.toLowerCase().trim());
  const resultat = [];
  for (const l of lignes) {
    if (!l[0]) continue; // ligne vide : on ignore
    const obj = {};
    entetes.forEach((h, i) => { obj[h] = (l[i] || "").trim(); });
    resultat.push(obj);
  }
  return resultat;
}

// --- 4. La recherche "intelligente" : insensible aux accents et à la casse.
// "bel et la bete" doit trouver "La Belle et la Bête".
function normaliser(s) {
  return (s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // retire les accents
    .replace(/['’-]/g, " ")                            // apostrophes/tirets = espaces
    .replace(/\s+/g, " ")
    .trim();
}

function rechercheCorrespond(livre, q) {
  const cible = normaliser(
    livre.titre + " " + livre.auteur + " " + livre.editeur + " " + livre.isbn
  );
  // Chaque mot tapé doit être présent (tous les mots, dans n'importe quel ordre)
  return q.split(" ").every(mot => cible.includes(mot));
}

// --- 5. Afficher la liste filtrée.
function afficher() {
  const q = normaliser(document.getElementById("recherche").value);
  const theme = document.getElementById("filtre-theme").value;
  const niveau = document.getElementById("filtre-niveau").value;

  const resultats = livres.filter(l =>
    rechercheCorrespond(l, q) &&
    (!theme  || l.theme  === theme) &&
    (!niveau || l.niveau === niveau)
  );

  const liste = document.getElementById("liste");
  liste.innerHTML = "";

  for (const l of resultats) {
    const li = document.createElement("li");
    li.className = "livre";
    // Si la recherche est un ISBN déjà possédé -> le signaler en vert
    const qChiffres = q.replace(/\s/g, "");
    if (/^\d{9,13}$/.test(qChiffres) && l.isbn && normaliser(l.isbn) === qChiffres) {
      li.classList.add("deja-possede");
    }
    const meta = [];
    if (l.theme)  meta.push("🏷️ " + l.theme);
    if (l.niveau) meta.push("🎓 " + l.niveau);
    if (l.editeur) meta.push("🏛️ " + l.editeur);
    if (l.emplacement) meta.push("📍 " + l.emplacement);
    li.innerHTML =
      "<h2>" + echapper(l.titre) + "</h2>" +
      "<p class=\"auteur\">" + echapper(l.auteur || "Auteur inconnu") + "</p>" +
      (meta.length ? "<div class=\"meta\">" + meta.map(m => "<span>" + echapper(m) + "</span>").join("") + "</div>" : "");
    liste.appendChild(li);
  }

  document.getElementById("vide").hidden = resultats.length > 0;
  document.getElementById("compteur").textContent =
    q || theme || niveau
      ? resultats.length + " livre(s) trouvé(s) sur " + livres.length
      : livres.length + " livres référencés";
}

// Sécurité de base : un titre contenant "<script>" ne doit pas être interprété.
function echapper(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- 6. Remplir les menus déroulants de filtres (thèmes/niveaux uniques).
function remplirFiltres() {
  const paires = [["filtre-theme", "theme"], ["filtre-niveau", "niveau"]];
  for (const [id, cle] of paires) {
    const select = document.getElementById(id);
    const valeurs = [...new Set(livres.map(l => l[cle]).filter(Boolean))].sort();
    for (const v of valeurs) {
      const option = document.createElement("option");
      option.value = v; option.textContent = v;
      select.appendChild(option);
    }
    select.addEventListener("change", afficher);
  }
}

// --- 7. Démarrage de l'application.
async function demarrer() {
  try {
    await chargerLivres();
    remplirFiltres();
    afficher();
  } catch (e) {
    document.getElementById("compteur").textContent =
      e.message === "config"
        ? "⚠️ Il faut configurer config.js (voir les instructions dans ce fichier)"
        : "⚠️ Impossible de charger la bibliothèque. Vérifie que la sheet est bien publiée sur le web.";
  }
  document.getElementById("recherche").addEventListener("input", afficher);
}
demarrer();
