// main.js — collegamento al repository dei dati, lettura di stato.json, ultima copia.

import { ApiError, leggiJson } from "./api.js";

const CHIAVI = { repo: "ptf.repo", token: "ptf.token", copia: "ptf.stato" };
const REPO_VALIDO = /^[A-Za-z0-9-]+\/(?!\.{1,2}$)[A-Za-z0-9._-]+$/;
const TOKEN_VALIDO = /^[A-Za-z0-9_]+$/;

const $ = (id) => document.getElementById(id);

// --- memoria del telefono (può mancare: l'app deve reggere lo stesso) --------

let accessoInMemoria = null; // vale per la sessione se localStorage non scrive

function leggi(chiave) {
  try { return localStorage.getItem(chiave); } catch { return null; }
}

function scrivi(chiave, valore) {
  try {
    if (valore === null) localStorage.removeItem(chiave);
    else localStorage.setItem(chiave, valore);
    return true;
  } catch {
    return false;
  }
}

function accesso() {
  const repo = leggi(CHIAVI.repo);
  const token = leggi(CHIAVI.token);
  return repo && token ? { repo, token } : accessoInMemoria;
}

// Cambiando accesso la copia salvata non vale più.
function salvaAccesso(repo, token) {
  scrivi(CHIAVI.copia, null);
  accessoInMemoria = { repo, token };
  return scrivi(CHIAVI.repo, repo) && scrivi(CHIAVI.token, token);
}

function rimuoviAccesso() {
  accessoInMemoria = null;
  Object.values(CHIAVI).forEach((chiave) => scrivi(chiave, null));
}

function copiaSalvata() {
  try {
    const stato = JSON.parse(leggi(CHIAVI.copia));
    return formaValida(stato) ? stato : null;
  } catch {
    return null;
  }
}

// --- schermate ---------------------------------------------------------------

const euro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const percento = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero",
});
const conSegno = new Intl.NumberFormat("it-IT", {
  style: "currency", currency: "EUR", signDisplay: "exceptZero",
});
const quando = new Intl.DateTimeFormat("it-IT", {
  weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  timeZone: "Europe/Rome",
});

function formaValida(stato) {
  const t = stato?.totale;
  return stato?.schema === 1
    && !Number.isNaN(Date.parse(stato.aggiornato_il))
    && [t?.valore_eur, t?.pl_eur, t?.pl_pct, t?.prezzati, t?.posizioni].every(Number.isFinite);
}

function avvisa(testo) {
  $("messaggio").textContent = testo || "";
  $("messaggio").hidden = !testo;
}

function mostraDati(stato) {
  const t = stato.totale;
  $("valore").textContent = euro.format(t.valore_eur);
  $("pl").textContent = `${conSegno.format(t.pl_eur)} (${percento.format(t.pl_pct)}%)`;
  $("prezzati").textContent = `${t.prezzati} su ${t.posizioni}`;
  $("aggiornato").textContent = quando.format(new Date(stato.aggiornato_il));
  $("vista-setup").hidden = true;
  $("vista-dati").hidden = false;
}

// Svuota anche i testi: con un accesso non valido nella pagina non resta nulla.
function nascondiDati() {
  ["valore", "pl", "prezzati", "aggiornato"].forEach((id) => { $(id).textContent = ""; });
  $("vista-dati").hidden = true;
}

function mostraSetup() {
  nascondiDati();
  const attuale = accesso();
  $("campo-repo").value = attuale?.repo || "";
  $("campo-token").value = "";
  $("annulla").hidden = !attuale;
  $("rimuovi").hidden = !attuale;
  $("vista-setup").hidden = false;
}

// --- lettura -----------------------------------------------------------------

let giro = 0; // la risposta di una lettura superata non deve ridisegnare nulla

async function carica() {
  const mio = ++giro;
  const config = accesso();
  if (!config) { mostraSetup(); return; }

  const copia = copiaSalvata();
  if (copia) mostraDati(copia);
  else { nascondiDati(); $("vista-setup").hidden = true; }
  avvisa("Lettura in corso…");

  try {
    const stato = await leggiJson(config, "stato.json");
    if (mio !== giro) return;
    if (!formaValida(stato)) throw new ApiError("Il file dei dati ha un formato non riconosciuto.", "formato");
    scrivi(CHIAVI.copia, JSON.stringify(stato));
    mostraDati(stato);
    avvisa("");
  } catch (e) {
    if (mio !== giro) return;
    const testo = e instanceof ApiError ? e.message : "Errore inatteso.";
    if (e.kind === "accesso") {
      scrivi(CHIAVI.copia, null);
      mostraSetup();
      avvisa(testo);
    } else if (copia) {
      avvisa(`${testo} Vedi l'ultima copia salvata.`);
    } else {
      mostraSetup();
      avvisa(`${testo} Non c'è ancora una copia salvata: riapri l'app per riprovare.`);
    }
  }
}

// --- collegamento ------------------------------------------------------------

function collega(repo, token) {
  if (!REPO_VALIDO.test(repo) || !TOKEN_VALIDO.test(token)) {
    mostraSetup();
    avvisa("Repository o token scritti in modo non valido.");
    return;
  }
  if (!salvaAccesso(repo, token)) {
    alert("Il browser non permette di salvare: alla prossima apertura dovrai ricollegarti.");
  }
  carica();
}

// Link di collegamento: #setup=utente/repository:token. Il frammento non arriva
// al server; va comunque tolto subito dalla barra degli indirizzi.
function prendiFrammento() {
  if (!location.hash.startsWith("#setup=")) return null;
  const valore = location.hash.slice("#setup=".length);
  history.replaceState(null, "", location.pathname + location.search);
  const taglio = valore.indexOf(":");
  return { repo: valore.slice(0, taglio), token: valore.slice(taglio + 1) };
}

function avvia() {
  const nuovo = prendiFrammento();
  if (!nuovo) { carica(); return; }
  const attuale = accesso();
  const diverso = attuale && (attuale.repo !== nuovo.repo || attuale.token !== nuovo.token);
  if (diverso && !confirm("L'app è già collegata. Sostituire l'accesso con quello del link?")) {
    carica();
    return;
  }
  collega(nuovo.repo, nuovo.token);
}

$("form-setup").addEventListener("submit", (evento) => {
  evento.preventDefault();
  collega($("campo-repo").value.trim(), $("campo-token").value.trim());
});
$("cambia").addEventListener("click", () => { giro++; avvisa(""); mostraSetup(); });
$("annulla").addEventListener("click", carica);
$("rimuovi").addEventListener("click", () => {
  if (!confirm("Rimuovere token e copia locale da questo telefono?")) return;
  giro++;
  rimuoviAccesso();
  avvisa("");
  mostraSetup();
});
window.addEventListener("hashchange", () => {
  if (location.hash.startsWith("#setup=")) avvia();
});

if ("serviceWorker" in navigator) {
  // Alla prima installazione non c'è nulla da ricaricare; dopo un aggiornamento sì.
  let giaControllata = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (giaControllata) location.reload();
    giaControllata = true;
  });
  navigator.serviceWorker.register("sw.js");
}

avvia();
