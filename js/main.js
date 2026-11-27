// main.js — collegamento al repository dei dati, lettura di stato.json, ultima copia.

import { ApiError, leggiJson, leggiSoglie, salvaSoglie } from "./api.js";
import { attiva, controlla, disiscrivi } from "./notifiche.js";
import {
  compilaPannello, disegna, disegnaNotifiche, intestaPannello, leggiPannello,
  messaggioNotifiche, messaggioPannello, notaPannello, svuota,
} from "./ui.js";

const CHIAVI = { repo: "ptf.repo", token: "ptf.token", copia: "ptf.stato", soglie: "ptf.soglie" };
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
  dimenticaCopie();
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

// Le soglie stanno anche sul telefono, per la campanella senza rete.
let soglie = null; // mappa per asset; null finché non sono note

function ricordaSoglie(nuove) {
  soglie = nuove;
  scrivi(CHIAVI.soglie, nuove && JSON.stringify(nuove));
}

function sogliaSalvata() {
  try {
    const copia = JSON.parse(leggi(CHIAVI.soglie));
    return copia && typeof copia === "object" ? copia : null;
  } catch {
    return null;
  }
}

function dimenticaCopie() {
  scrivi(CHIAVI.copia, null);
  ricordaSoglie(null);
}

// --- schermate ---------------------------------------------------------------

// I numeri di un asset mai prezzato sono vuoti; quantità e carico ci sono sempre.
function assetValido(a) {
  return [a?.id, a?.nome, a?.stato].every((x) => typeof x === "string")
    && [a.quantita, a.pmc_eur].every(Number.isFinite)
    && [a.prezzo_eur, a.valore_eur, a.pl_eur, a.pl_pct].every((x) => x === null || Number.isFinite(x));
}

function formaValida(stato) {
  const t = stato?.totale;
  return stato?.schema === 1
    && !Number.isNaN(Date.parse(stato.aggiornato_il))
    && [t?.valore_eur, t?.pl_eur, t?.pl_pct, t?.prezzati, t?.posizioni].every(Number.isFinite)
    && Array.isArray(stato.asset) && stato.asset.every(assetValido);
}

function avvisa(testo) {
  $("messaggio").textContent = testo || "";
  $("messaggio").hidden = !testo;
}

let mostrato = null; // lo stato disegnato in pagina

function mostraDati(stato) {
  mostrato = stato;
  disegna(stato, soglie);
  $("vista-setup").hidden = true;
  $("vista-dati").hidden = false;
}

// Svuota anche i testi: con un accesso non valido nella pagina non resta nulla.
function nascondiDati() {
  mostrato = null;
  $("pannello").close();
  svuota();
  $("vista-dati").hidden = true;
}

function mostraSetup() {
  nascondiDati();
  const attuale = accesso();
  $("campo-repo").value = attuale?.repo || "";
  $("campo-token").value = "";
  $("annulla").hidden = !attuale;
  $("rimuovi").hidden = !attuale;
  // Le notifiche compaiono solo aprendo le Impostazioni (mostraNotifiche).
  giroNotifiche++;
  $("notifiche").hidden = true;
  $("titolo-accesso").hidden = true;
  $("vista-setup").hidden = false;
}

// --- notifiche ---------------------------------------------------------------

let giroNotifiche = 0;        // come "giro": le risposte superate non ridisegnano
let attivazione = false;      // un'attivazione per volta

const testoErrore = (e) => (e instanceof ApiError ? e.message : "Errore inatteso.");

async function mostraNotifiche() {
  const mio = ++giroNotifiche;
  $("notifiche").hidden = false;
  $("titolo-accesso").hidden = false;
  if (attivazione) { messaggioNotifiche("Attivazione in corso…"); return; }
  messaggioNotifiche("Controllo in corso…");
  try {
    const stato = await controlla(accesso());
    if (mio === giroNotifiche) disegnaNotifiche(stato);
  } catch (e) {
    if (mio === giroNotifiche) messaggioNotifiche(testoErrore(e), "Attiva notifiche");
  }
}

async function attivaNotifiche() {
  const config = accesso();
  if (!config || attivazione) return;
  attivazione = true;
  $("notifiche-attiva").hidden = true;
  let esito;
  let guasto;
  try {
    esito = await attiva(config, (testo) => messaggioNotifiche(testo));
  } catch (e) {
    // In lettura il 403 vuol dire token sbagliato; qui di solito manca il permesso Actions.
    guasto = e instanceof ApiError ? e.message : "Iscrizione non riuscita: riprova.";
  }
  attivazione = false;
  giroNotifiche++;
  if (guasto) messaggioNotifiche(guasto, "Attiva notifiche");
  else disegnaNotifiche(esito);
}

// --- soglie ------------------------------------------------------------------

let giroSoglie = 0;       // una lettura superata non deve rimettere valori vecchi
let aperto = null;        // id dell'asset nel pannello
let modificato = false;   // i campi toccati non vanno sovrascritti
let salvataggio = null;   // { id, voce, testo } finché è in corso: uno per volta

const stessoAccesso = (config) => accesso()?.repo === config.repo && accesso()?.token === config.token;

// Se la lettura fallisce restano le soglie già note: i dati si vedono comunque.
async function aggiornaSoglie(config) {
  const mio = ++giroSoglie;
  let guasto = null;
  try {
    const nuove = await leggiSoglie(config);
    if (mio !== giroSoglie || !stessoAccesso(config)) return;
    ricordaSoglie(nuove);
    if (mostrato) disegna(mostrato, soglie);
  } catch (e) {
    if (mio !== giroSoglie || !stessoAccesso(config)) return;
    guasto = testoErrore(e);
  }
  riempiPannello(guasto);
}

// Porta nel pannello aperto le soglie note, senza toccare quello che si sta scrivendo.
function riempiPannello(guasto = null) {
  if (!aperto || !$("pannello").open) return;
  if (salvataggio?.id === aperto) return;
  if (!modificato) compilaPannello(soglie ? soglie[aperto] : undefined);
  if (modificato) return; // resta il messaggio sull'ultimo tentativo
  if (salvataggio) {
    messaggioPannello(`Attendi: salvataggio di ${salvataggio.id} in corso.`, { occupato: true });
  } else if (!soglie) {
    // Senza i valori attuali non si salva: si rischierebbe di cancellarli.
    messaggioPannello(guasto ? `Soglie non lette. ${guasto}` : "Leggo le soglie…",
      { tipo: guasto ? "errore" : "", occupato: true });
  } else {
    messaggioPannello(guasto ? `${guasto} Vedi gli ultimi valori letti.` : "",
      { tipo: guasto ? "errore" : "" });
  }
}

function apriPannello(id) {
  const asset = mostrato?.asset.find((a) => a.id === id);
  if (!asset) return;
  aperto = id;
  modificato = false;
  intestaPannello(asset);
  if (salvataggio?.id === id) {
    compilaPannello(salvataggio.voce);
    messaggioPannello(salvataggio.testo, { occupato: true });
    $("pannello").showModal();
    return;
  }
  $("pannello").showModal();
  riempiPannello();
  aggiornaSoglie(accesso());
}

async function salva() {
  const config = accesso();
  if (!config || !aperto || !soglie || salvataggio) return;
  const { voce, errore } = leggiPannello();
  if (errore) { messaggioPannello(errore, { tipo: "errore" }); return; }

  const id = aperto;
  const qui = () => $("pannello").open && aperto === id;
  const mio = { id, voce, testo: "In salvataggio…" };
  salvataggio = mio;
  giroSoglie++; // le letture già partite non contano più
  modificato = true;
  messaggioPannello(mio.testo, { occupato: true });

  let esito;
  let guasto;
  try {
    esito = await salvaSoglie(config, id, voce, () => {
      mio.testo = "In salvataggio: di solito serve meno di un minuto…";
      if (qui()) messaggioPannello(mio.testo, { occupato: true });
    });
  } catch (e) {
    guasto = testoErrore(e);
  }
  salvataggio = null;
  if (!stessoAccesso(config)) return;

  if (esito) {
    giroSoglie++;
    ricordaSoglie(esito.soglie);
    if (mostrato) disegna(mostrato, soglie);
  }
  const riuscito = Boolean(esito?.salvate);
  const testo = riuscito ? "Salvato." : guasto ? `Non salvato. ${guasto}` : "Non salvato, riprova.";
  if (qui()) {
    modificato = !riuscito; // se non è andata, quello che hai scritto resta
    messaggioPannello(testo, { tipo: riuscito ? "fatto" : "errore" });
    return;
  }
  if (!riuscito) avvisa(`Soglie di ${id}: ${testo}`);
  // Un altro asset aperto stava aspettando: se ci hai già scritto, resta com'è.
  if (modificato) messaggioPannello("");
  else riempiPannello();
}

// --- lettura -----------------------------------------------------------------

let giro = 0; // la risposta di una lettura superata non deve ridisegnare nulla
let daRiprovare = false; // schermata di collegamento aperta solo perché mancava la rete

async function carica() {
  const mio = ++giro;
  daRiprovare = false;
  const config = accesso();
  if (!config) { mostraSetup(); return; }

  soglie ??= sogliaSalvata();
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
    aggiornaSoglie(config);
  } catch (e) {
    if (mio !== giro) return;
    const testo = e instanceof ApiError ? e.message : "Errore inatteso.";
    if (e.kind === "accesso") {
      dimenticaCopie();
      mostraSetup();
      avvisa(testo);
    } else if (copia) {
      avvisa(`${testo} Vedi l'ultima copia salvata.`);
    } else {
      mostraSetup();
      daRiprovare = true;
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
$("cambia").addEventListener("click", () => {
  giro++;
  daRiprovare = false;
  avvisa("");
  mostraSetup();
  mostraNotifiche();
});
$("elenco").addEventListener("click", (evento) => {
  const li = evento.target.closest("li");
  if (li) apriPannello(li.dataset.id);
});
$("elenco").addEventListener("keydown", (evento) => {
  const li = evento.target.closest("li");
  if (!li || (evento.key !== "Enter" && evento.key !== " ")) return;
  evento.preventDefault();
  apriPannello(li.dataset.id);
});
$("form-soglie").addEventListener("submit", (evento) => {
  evento.preventDefault();
  salva();
});
$("form-soglie").addEventListener("input", () => {
  // Prima che le soglie siano note non conta: arrivate, riempiono i campi.
  modificato = Boolean(soglie);
  notaPannello();
  if (!salvataggio && soglie) messaggioPannello("");
});
$("pannello-chiudi").addEventListener("click", () => $("pannello").close());
// Il tocco sullo sfondo scuro chiude il pannello.
$("pannello").addEventListener("click", (evento) => {
  if (evento.target === $("pannello")) $("pannello").close();
});
$("notifiche-attiva").addEventListener("click", attivaNotifiche);
$("annulla").addEventListener("click", carica);
$("rimuovi").addEventListener("click", () => {
  if (!confirm("Rimuovere token e copia locale da questo telefono?")) return;
  giro++;
  disiscrivi().catch(() => {}); // senza accesso il telefono non deve più ricevere nulla
  rimuoviAccesso();
  soglie = null;
  avvisa("");
  mostraSetup();
});
// Quando l'app torna in primo piano rilegge i dati. Non lo fa sulla schermata di
// collegamento: chi esce a copiare il token ritroverebbe i campi svuotati.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !accesso()) return;
  if ($("vista-setup").hidden || (daRiprovare && !$("campo-token").value)) carica();
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
