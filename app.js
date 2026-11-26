// ============================================================
// APP.JS - v3 : recherche + scan + ajout, avec cascade de sources
//              pour retrouver un livre à partir de son ISBN.
//
// La cascade :  1. Google Books  (excellente couverture de l'édition française)
//               2. Open Library  (secours, surtout livres anglo-saxons)
//               3. saisie manuelle (le filet de sécurité ultime)
// ============================================================

let livres = [];
let scanner = null;

// ============================================================
// PARTIE 1 : CHARGER ET CHERCHER
// ============================================================

async function chargerLivres() {
  if (typeof CSV_URL === "undefined" || CSV_URL === "A_COLLER_ICI") {
    throw new Error("config");
  }
  const reponse = await fetch(CSV_URL);
  if (!reponse.ok) throw new Error("reseau");
  livres = parserCSV(await reponse.text());
}

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
  const entetes = lignes.shift().map(h => h.toLowerCase().trim());
  const resultat = [];
  for (const l of lignes) {
    if (!l[0]) continue;
    const obj = {};
    entetes.forEach((h, i) => { obj[h] = (l[i] || "").trim(); });
    resultat.push(obj);
  }
  return resultat;
}

function normaliser(s) {
  return (s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/['’-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rechercheCorrespond(livre, q) {
  const cible = normaliser(livre.titre + " " + livre.auteur + " " + livre.editeur + " " + livre.isbn);
  return q.split(" ").every(mot => cible.includes(mot));
}

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

function echapper(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function remplirFiltres() {
  const paires = [["filtre-theme", "theme"], ["filtre-niveau", "niveau"]];
  for (const [id, cle] of paires) {
    const select = document.getElementById(id);
    for (const v of [...new Set(livres.map(l => l[cle]).filter(Boolean))].sort()) {
      const option = document.createElement("option");
      option.value = v; option.textContent = v;
      select.appendChild(option);
    }
    select.addEventListener("change", afficher);
  }
  document.getElementById("liste-themes").innerHTML =
    [...new Set(livres.map(l => l.theme).filter(Boolean))]
      .sort().map(t => "<option value=\"" + echapper(t) + "\">").join("");
}

// ============================================================
// PARTIE 2 : LA MODALE D'AJOUT
// ============================================================

function ouvrirAjout() {
  document.getElementById("modale").hidden = false;
  afficherVue("scan");
}

function fermerAjout() {
  arreterScan();
  document.getElementById("modale").hidden = true;
}

function afficherVue(nom) {
  for (const v of ["scan", "verdict", "formulaire"]) {
    document.getElementById("vue-" + v).hidden = (v !== nom);
  }
  if (nom === "scan") demarrerScan(); else arreterScan();
}

// ============================================================
// PARTIE 3 : LE SCAN DE CODE-BARRES
// ============================================================

function demarrerScan() {
  if (scanner) return;
  scanner = new Html5Qrcode("lecteur");
  scanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 150 } },
    (isbn) => {
      arreterScan();
      chercherISBN(isbn);
    },
    () => {}
  ).catch(() => { /* caméra refusée/indisponible : ISBN manuel possible */ });
}

function arreterScan() {
  if (!scanner) return;
  scanner.stop().then(() => { scanner.clear(); scanner = null; })
    .catch(() => { scanner = null; });
  document.getElementById("lecteur").innerHTML = "";
}

// ============================================================
// PARTIE 4 : RETROUVER UN LIVRE À PARTIR DE SON ISBN
// ============================================================

// ---- Source 1 : Google Books (meilleure couverture du français) ----
// L'API répond en JSON : volumeInfo contient titre, auteurs, éditeur.
// Remarque : un même livre peut avoir plusieurs éditions ; on prend
// celle qui correspond exactement à l'ISBN scanné.
async function chercherSurGoogleBooks(isbn) {
  const url = "https://www.googleapis.com/books/v1/volumes?q=isbn:" + isbn + "&country=FR";
  const reponse = await fetch(url);
  if (!reponse.ok) return null;
  const donnees = await reponse.json();
  if (!donnees.items || !donnees.items.length) return null;
  const v = donnees.items[0].volumeInfo;
  return {
    titre: v.title || "",
    // "authors" est un tableau : on prend tous les auteurs, séparés par ", "
    auteur: (v.authors || []).join(", "),
    editeur: v.publisher || "",
    isbn: isbn,
    source: "Google Books"
  };
}

// ---- Source 2 : Open Library (secours) ----
async function chercherSurOpenLibrary(isbn) {
  const reponse = await fetch("https://openlibrary.org/isbn/" + isbn + ".json");
  if (!reponse.ok) return null;
  const livre = await reponse.json();
  const infos = {
    titre: livre.title || "",
    auteur: "",
    editeur: (livre.publishers || [])[0] || "",
    isbn: isbn,
    source: "Open Library"
  };
  if (livre.authors && livre.authors[0]) {
    try {
      const ra = await fetch("https://openlibrary.org" + livre.authors[0].key + ".json");
      if (ra.ok) infos.auteur = (await ra.json()).name || "";
    } catch (e) { /* on garde l'auteur vide */ }
  }
  return infos.titre ? infos : null;
}

// ---- La cascade : on essaie chaque source l'une après l'autre ----
async function trouverInfosLivre(isbn) {
  // Chaque tentative est entourée d'un try/catch : si une source est
  // en panne, on passe silencieusement à la suivante au lieu de planter.
  const sources = [chercherSurGoogleBooks, chercherSurOpenLibrary];
  for (const source of sources) {
    try {
      const infos = await source(isbn);
      if (infos && infos.titre) return infos;
    } catch (e) { /* source indisponible : on continue */ }
  }
  return { titre: "", auteur: "", editeur: "", isbn: isbn, source: "" };
}

// ---- Le grand orchestrateur : que faire d'un ISBN scanné ? ----
async function chercherISBN(isbn) {
  isbn = (isbn || "").replace(/\D/g, "");
  if (isbn.length < 9) {
    alert("ISBN invalide");
    afficherVue("scan");
    return;
  }

  // 1er réflexe : l'a-t-on déjà ?
  const deja = livres.find(l => normaliser(l.isbn) === isbn);
  const verdict = document.getElementById("verdict");

  if (deja) {
    verdict.className = "possede";
    verdict.innerHTML =
      "<h2>✅ Déjà possédé !</h2>" +
      "<p><b>" + echapper(deja.titre) + "</b> — " + echapper(deja.auteur || "auteur inconnu") + "</p>" +
      "<p>Éditeur : " + echapper(deja.editeur || "?") + (deja.emplacement ? " — 📍 " + echapper(deja.emplacement) : "") + "</p>" +
      "<p class=\"indication\">Pas besoin de l'acheter 😊</p>";
    afficherVue("verdict");
    return;
  }

  // Non possédé : lancer la cascade de recherche
  verdict.className = "nouveau";
  verdict.innerHTML = "<h2>➕ Non répertorié</h2><p>Recherche des informations du livre…</p>";
  afficherVue("verdict");

  const infos = await trouverInfosLivre(isbn);
  window._infosLivre = infos;

  if (infos.titre) {
    verdict.innerHTML =
      "<h2>➕ Non répertorié</h2>" +
      "<p>Trouvé : <b>" + echapper(infos.titre) + "</b>" +
      (infos.auteur ? " — " + echapper(infos.auteur) : "") + "</p>" +
      "<p class=\"indication\">Source : " + echapper(infos.source) + " — vérifie avant d'enregistrer.</p>" +
      "<button class=\"principal\" onclick=\"preparerFormulaire()\">Remplir la fiche ➜</button>";
  } else {
    verdict.innerHTML =
      "<h2>➕ Non répertorié</h2>" +
      "<p>Aucune info trouvée en ligne pour cet ISBN : tu peux saisir le livre à la main.</p>" +
      "<button class=\"principal\" onclick=\"preparerFormulaire()\">Saisir la fiche ➜</button>";
  }
}

function preparerFormulaire() {
  const i = window._infosLivre || {};
  document.getElementById("f-titre").value = i.titre || "";
  document.getElementById("f-auteur").value = i.auteur || "";
  document.getElementById("f-editeur").value = i.editeur || "";
  document.getElementById("f-isbn").value = i.isbn || "";
  document.getElementById("f-niveau").value = "Maternelle (album)";
  document.getElementById("f-theme").value = "";
  document.getElementById("f-emplacement").value = "";
  document.getElementById("erreur-ajout").hidden = true;
  afficherVue("formulaire");
}

// ============================================================
// PARTIE 5 : ENREGISTRER DANS LA GOOGLE SHEET
// ============================================================

async function enregistrerLivre() {
  const erreur = document.getElementById("erreur-ajout");
  erreur.hidden = true;

  const livre = {
    titre: document.getElementById("f-titre").value.trim(),
    auteur: document.getElementById("f-auteur").value.trim(),
    editeur: document.getElementById("f-editeur").value.trim(),
    isbn: document.getElementById("f-isbn").value.trim(),
    niveau: document.getElementById("f-niveau").value,
    theme: document.getElementById("f-theme").value.trim(),
    emplacement: document.getElementById("f-emplacement").value.trim()
  };

  if (!livre.titre) {
    erreur.textContent = "Le titre est obligatoire.";
    erreur.hidden = false;
    return;
  }
  if (typeof SCRIPT_URL === "undefined" || SCRIPT_URL === "A_COLLER_ICI_APPS_SCRIPT") {
    erreur.textContent = "⚠️ SCRIPT_URL n'est pas encore configuré dans config.js.";
    erreur.hidden = false;
    return;
  }

  try {
    const reponse = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(livre)
    });
    if (!reponse.ok) throw new Error("reponse " + reponse.status);

    livres.push({
      titre: livre.titre, auteur: livre.auteur, editeur: livre.editeur,
      isbn: livre.isbn, niveau: livre.niveau, theme: livre.theme,
      emplacement: livre.emplacement, date: ""
    });
    afficher();
    alert("Livre enregistré 🎉");
    fermerAjout();
  } catch (e) {
    erreur.textContent = "Échec de l'enregistrement : " + e.message;
    erreur.hidden = false;
  }
}

// ============================================================
// DÉMARRAGE
// ============================================================

async function demarrer() {
  try {
    await chargerLivres();
    remplirFiltres();
    afficher();
  } catch (e) {
    document.getElementById("compteur").textContent =
      e.message === "config"
        ? "⚠️ Il faut configurer config.js"
        : "⚠️ Impossible de charger la bibliothèque.";
  }
  document.getElementById("recherche").addEventListener("input", afficher);
}
demarrer();
