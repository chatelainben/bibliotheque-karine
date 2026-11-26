// ============================================================
// APP.JS - v4 : corrections d'affichage + diagnostic + cascade ISBN
// ============================================================

const VERSION = "v4";

let livres = [];
let scanner = null;

// ---- Filet de sécurité global : si une erreur JavaScript se produit
// n'importe où, on l'affiche à l'écran au lieu de rester dans le vide.
// (Un bouton qui "ne fait rien", c'est presque toujours une erreur JS
// qui a interrompu le script : maintenant on la verra.)
window.onerror = function (message) {
  const zone = document.getElementById("erreur-globale");
  if (zone) {
    zone.textContent = "Erreur : " + message;
    zone.classList.remove("invisible");
  }
};

// ============================================================
// PARTIE 1 : AFFICHER / MASQUER (mécanisme unique et fiable)
// ============================================================

function montrer(id)   { document.getElementById(id).classList.remove("invisible"); }
function cacher(id)    { document.getElementById(id).classList.add("invisible"); }

// ============================================================
// PARTIE 2 : CHARGER ET CHERCHER
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
// PARTIE 3 : LA FENÊTRE D'AJOUT (corrigée)
// ============================================================

function ouvrirAjout() {
  montrer("modale");
  afficherVue("scan");
}

function fermerAjout() {
  arreterScan();
  cacher("modale");
}

function afficherVue(nom) {
  // On masque les 3 vues puis on en montre une seule : impossible
  // d'arriver dans un état incohérent (2 vues visibles, etc.)
  cacher("vue-scan");
  cacher("vue-verdict");
  cacher("vue-formulaire");
  montrer("vue-" + nom);
  arreterScan();
}

// Cliquer sur le fond sombre (en dehors du contenu) ferme aussi la fenêtre
document.addEventListener("click", function (e) {
  const modale = document.getElementById("modale");
  if (!modale.classList.contains("invisible") && e.target === modale) {
    fermerAjout();
  }
});

// ============================================================
// PARTIE 4 : LE SCAN DE CODE-BARRES
// ============================================================

// La caméra ne démarre plus automatiquement : bouton explicite,
// comme ça pas de surprise à l'ouverture et pas d'erreur silencieuse.
function demarrerScanManuel() {
  const etat = document.getElementById("etat-scan");

  if (typeof Html5Qrcode === "undefined") {
    etat.textContent = "⚠️ Bibliothèque de scan non chargée (connexion internet ?). Utilise la saisie manuelle ci-dessous.";
    return;
  }
  if (scanner) return;

  etat.textContent = "Caméra en cours de démarrage… autorise l'accès si demandé.";
  scanner = new Html5Qrcode("lecteur");
  scanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 150 } },
    (isbn) => {
      arreterScan();
      chercherISBN(isbn);
    },
    () => {}
  ).then(function () {
    etat.textContent = "Vise le code-barres au dos du livre 📖";
    montrer("btn-stop-scan");
  }).catch(function (err) {
    scanner = null;
    etat.textContent = "⚠️ Caméra indisponible (" + err + "). Utilise la saisie manuelle ci-dessous.";
  });
}

function arreterScan() {
  if (!scanner) return;
  try {
    scanner.stop().then(function () { scanner.clear(); scanner = null; })
      .catch(function () { scanner = null; });
  } catch (e) { scanner = null; }
  document.getElementById("lecteur").innerHTML = "";
  cacher("btn-stop-scan");
}

function chercherISBNManuel() {
  const isbn = document.getElementById("isbn-manuel").value.trim();
  chercherISBN(isbn);
}

// ============================================================
// PARTIE 5 : RETROUVER UN LIVRE À PARTIR DE SON ISBN (cascade)
// ============================================================

async function chercherSurGoogleBooks(isbn) {
  const reponse = await fetch("https://www.googleapis.com/books/v1/volumes?q=isbn:" + isbn + "&country=FR");
  if (!reponse.ok) return null;
  const donnees = await reponse.json();
  if (!donnees.items || !donnees.items.length) return null;
  const v = donnees.items[0].volumeInfo;
  return {
    titre: v.title || "",
    auteur: (v.authors || []).join(", "),
    editeur: v.publisher || "",
    isbn: isbn,
    source: "Google Books"
  };
}

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

async function trouverInfosLivre(isbn) {
  const sources = [chercherSurGoogleBooks, chercherSurOpenLibrary];
  for (const source of sources) {
    try {
      const infos = await source(isbn);
      if (infos && infos.titre) return infos;
    } catch (e) { /* source indisponible : on continue */ }
  }
  return { titre: "", auteur: "", editeur: "", isbn: isbn, source: "" };
}

async function chercherISBN(isbn) {
  isbn = (isbn || "").replace(/\D/g, "");
  document.getElementById("isbn-manuel").value = "";
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
  cacher("erreur-ajout");
  afficherVue("formulaire");
}

// ============================================================
// PARTIE 6 : ENREGISTRER DANS LA GOOGLE SHEET
// ============================================================

async function enregistrerLivre() {
  const erreur = document.getElementById("erreur-ajout");
  cacher("erreur-ajout");

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
    montrer("erreur-ajout");
    return;
  }
  if (typeof SCRIPT_URL === "undefined" || SCRIPT_URL === "A_COLLER_ICI_APPS_SCRIPT") {
    erreur.textContent = "⚠️ SCRIPT_URL n'est pas encore configuré dans config.js.";
    montrer("erreur-ajout");
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
    montrer("erreur-ajout");
  }
}

// ============================================================
// DÉMARRAGE
// ============================================================

async function demarrer() {
  // Sécurité finale : la fenêtre d'ajout est TOUJOURS fermée au démarrage,
  // quoi qu'il arrive (même si le HTML a été mal enregistré).
  cacher("modale");
  document.getElementById("version").textContent = VERSION;

  try {
    await chargerLivres();
    remplirFiltres();
    afficher();
  } catch (e) {
    document.getElementById("compteur").textContent =
      e.message === "config"
        ? "⚠️ Il faut configurer config.js"
        : "⚠️ Impossible de charger la bibliothèque : " + e.message;
  }
  document.getElementById("recherche").addEventListener("input", afficher);
}
demarrer();
