// ui.js — disegna riepilogo ed elenco a partire dai dati letti. Niente rete e
// niente memoria del telefono. Solo textContent: i dati non diventano mai HTML.

const FUSO = "Europe/Rome";

const numero = (min, max, extra = {}) => new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: "always", ...extra,
});
const dueCifre = numero(2, 2);
const quattroCifre = numero(2, 4);
const variazione = numero(2, 2, { signDisplay: "exceptZero" });
const quantita = numero(0, 8);
const dataOra = new Intl.DateTimeFormat("it-IT", {
  weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  timeZone: FUSO,
});
const oraDiRoma = new Intl.DateTimeFormat("it-IT", {
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: FUSO,
});

// Un valore che manca (asset mai prezzato) diventa un trattino.
const soldi = (x) => (x == null ? "—" : `${dueCifre.format(x)} €`);
// Sotto l'euro due cifre non bastano a distinguere i prezzi.
const prezzo = (x) => (x == null ? "—"
  : `${(Math.abs(x) < 1 ? quattroCifre : dueCifre).format(x)} €`);
const euroConSegno = (x) => `${variazione.format(x)} €`;
const percento = (x) => `${variazione.format(x)}%`;
const segno = (x) => (x > 0 ? "su" : x < 0 ? "giu" : "");
const quando = (testo) => (Number.isNaN(Date.parse(testo)) ? "data sconosciuta"
  : dataOra.format(new Date(testo)));

const AVVISI = {
  vecchio: (a) => `Prezzo vecchio: è di ${quando(a.prezzo_del)}`,
  sospetto: (a) => `Prezzo nuovo sospetto: resta quello di ${quando(a.prezzo_del)}`,
  mancante: () => "Mai prezzato: fuori dai totali",
};

// Più di 5 ore senza aggiornamenti, controllato dalle 8:15 alle 21 italiane:
// di notte non ci sono giri, e alle 8 il primo ha un quarto d'ora per arrivare.
const MASSIMA_ETA_MS = 5 * 60 * 60 * 1000;

export function datiVecchi(aggiornatoIl, adesso = new Date()) {
  const ora = oraDiRoma.format(adesso); // "HH:MM": si confronta come testo
  return ora >= "08:15" && ora <= "21:00"
    && adesso - new Date(aggiornatoIl) > MASSIMA_ETA_MS;
}

const $ = (id) => document.getElementById(id);

function elemento(tag, classe, testo) {
  const nodo = document.createElement(tag);
  if (classe) nodo.className = classe;
  if (testo !== undefined) nodo.textContent = testo;
  return nodo;
}

function scheda(a, conNotifica) {
  const li = elemento("li");
  li.dataset.id = a.id;
  li.tabIndex = 0;
  li.setAttribute("role", "button");

  const sigla = elemento("p", "tenue", a.id);
  if (conNotifica) {
    const campanella = elemento("span", "campanella", " 🔔");
    campanella.setAttribute("aria-label", "notifica attiva");
    sigla.append(campanella);
  }
  const chi = elemento("div", "chi");
  chi.append(elemento("p", "nome", a.nome), sigla);
  const quanto = elemento("div", "quanto");
  quanto.append(
    elemento("p", "controvalore", soldi(a.valore_eur)),
    elemento("p", segno(a.pl_eur), a.pl_eur == null || a.pl_pct == null ? "—"
      : `${euroConSegno(a.pl_eur)} · ${percento(a.pl_pct)}`),
  );
  const testa = elemento("div", "testa");
  testa.append(chi, quanto);

  const campi = elemento("dl", "campi");
  [
    ["Quantità", quantita.format(a.quantita)],
    ["Prezzo", prezzo(a.prezzo_eur)],
    ["Carico", prezzo(a.pmc_eur)],
  ].forEach(([nome, valore]) => {
    const campo = elemento("div");
    campo.append(elemento("dt", "", nome), elemento("dd", "", valore));
    campi.append(campo);
  });

  li.append(testa, campi);
  if (a.stato !== "ok") {
    const avviso = AVVISI[a.stato]?.(a) ?? `Stato non riconosciuto: ${a.stato}`;
    li.append(elemento("p", "segnale", `⚠ ${avviso}`));
  }
  return li;
}

// `soglie` è la mappa per asset di soglie.json, oppure null se non è stata letta.
export function disegna(stato, soglie) {
  const t = stato.totale;
  $("vecchi").hidden = !datiVecchi(stato.aggiornato_il);
  $("valore").textContent = soldi(t.valore_eur);
  $("pl").textContent = `${euroConSegno(t.pl_eur)} (${percento(t.pl_pct)})`;
  $("pl").className = `riga-pl ${segno(t.pl_eur)}`;
  $("aggiornato").textContent = `Aggiornato ${quando(stato.aggiornato_il)}`;
  $("prezzati").textContent = `${t.prezzati} asset prezzati su ${t.posizioni}`;
  // Dal controvalore più alto; chi non ha prezzo va in fondo.
  const ordinati = [...stato.asset].sort((x, y) => (y.valore_eur ?? -1) - (x.valore_eur ?? -1));
  // Ridisegnando non si perde l'asset su cui sta il cursore della tastiera.
  const scelto = document.activeElement?.closest?.("#elenco li")?.dataset.id;
  $("elenco").replaceChildren(...ordinati.map((a) => scheda(a, soglie?.[a.id]?.attiva === true)));
  if (scelto) [...$("elenco").children].find((li) => li.dataset.id === scelto)?.focus({ preventScroll: true });
}

// --- pannello delle soglie ---------------------------------------------------

// I limiti sono quelli di imposta.py. Il segno è fisso accanto al campo: si
// scrive solo il numero (la tastiera numerica di Android può non avere il meno).
const DIREZIONI = {
  su: { nome: "Rialzo", segni: ["+"], massimo: 1000 },
  giu: { nome: "Ribasso", segni: ["-", "−"], massimo: 100 },
};
const SCRITTO = /^([+\-−]?)\s*(\d+(?:[.,]\d*)?|[.,]\d+)$/;

/** Testo del campo -> { valore } (null se vuoto) oppure { errore }. */
export function leggiSoglia(testo, direzione) {
  const { nome, segni, massimo } = DIREZIONI[direzione];
  const pulito = testo.trim().replace(/\s*%$/, "");
  if (!pulito) return { valore: null };
  const parti = SCRITTO.exec(pulito);
  if (!parti) return { errore: `${nome}: scrivi solo un numero, per esempio 7,5.` };
  if (parti[1] && !segni.includes(parti[1])) {
    return { errore: `${nome}: il segno è già «${segni.at(-1)}», scrivi solo il numero.` };
  }
  const cifre = parti[2].replace(",", ".");
  const valore = Number(cifre);
  if (!(valore > 0 && valore <= massimo)) {
    return { errore: `${nome}: serve un numero maggiore di 0 e al massimo ${massimo}.` };
  }
  // Più severo del cloud: contano anche gli zeri, così «1.000» scritto per dire
  // mille non diventa in silenzio 1%.
  if ((cifre.split(".")[1] || "").length > 2) {
    return { errore: `${nome}: al massimo due decimali.` };
  }
  return { valore: direzione === "giu" ? -valore : valore };
}

const nelCampo = (x) => (Number.isFinite(x) ? String(Math.abs(x)).replace(".", ",") : "");

export function intestaPannello(a) {
  $("pannello-nome").textContent = a.nome;
  $("pannello-ora").textContent = a.pl_pct == null ? `${a.id} · senza prezzo`
    : `${a.id} · ora ${percento(a.pl_pct)} sul carico`;
}

/** `voce`: le soglie salvate dell'asset; undefined se non ne ha. */
export function compilaPannello(voce) {
  $("soglia-attiva").checked = voce?.attiva === true;
  $("soglia-su").value = nelCampo(voce?.su_pct);
  $("soglia-giu").value = nelCampo(voce?.giu_pct);
  notaPannello();
}

/** Quello che si sta per salvare: { voce } oppure { errore }. */
export function leggiPannello() {
  const su = leggiSoglia($("soglia-su").value, "su");
  const giu = leggiSoglia($("soglia-giu").value, "giu");
  const errore = su.errore || giu.errore;
  return errore ? { errore }
    : { voce: { attiva: $("soglia-attiva").checked, su_pct: su.valore, giu_pct: giu.valore } };
}

// Accesa senza soglie è ammessa, ma va detto che non succederà nulla.
export function notaPannello() {
  $("pannello-nota").hidden = !($("soglia-attiva").checked
    && !$("soglia-su").value.trim() && !$("soglia-giu").value.trim());
}

/** `tipo`: "" | "fatto" | "errore". `occupato` blocca il pulsante Salva. */
export function messaggioPannello(testo, { tipo = "", occupato = false } = {}) {
  $("pannello-esito").textContent = testo;
  $("pannello-esito").className = tipo;
  $("pannello-salva").disabled = occupato;
}

// [testo da mostrare, etichetta del pulsante (null: nessun pulsante)]
const NOTIFICHE = {
  "no": ["Questo browser non supporta le notifiche.", null],
  "bloccate": ["Notifiche bloccate: consentile nelle impostazioni di Android per questa app, poi riapri le Impostazioni.", null],
  "da-attivare": ["Non attive su questo telefono.", "Attiva notifiche"],
  "attive": ["Attive su questo telefono.", "Invia di nuovo la notifica di prova"],
  "non-salvate": ["Non salvata dopo 2 minuti: riprova.", "Attiva notifiche"],
};

export function disegnaNotifiche(stato) {
  const [testo, pulsante] = NOTIFICHE[stato];
  messaggioNotifiche(testo, pulsante);
}

// Senza etichetta il pulsante sparisce.
export function messaggioNotifiche(testo, pulsante = null) {
  $("notifiche-stato").textContent = testo;
  $("notifiche-attiva").textContent = pulsante || "";
  $("notifiche-attiva").hidden = !pulsante;
}

export function svuota() {
  ["valore", "pl", "aggiornato", "prezzati"].forEach((id) => { $(id).textContent = ""; });
  $("elenco").replaceChildren();
  $("vecchi").hidden = true;
}
