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

function scheda(a) {
  const li = elemento("li");

  const chi = elemento("div", "chi");
  chi.append(elemento("p", "nome", a.nome), elemento("p", "tenue", a.id));
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

export function disegna(stato) {
  const t = stato.totale;
  $("vecchi").hidden = !datiVecchi(stato.aggiornato_il);
  $("valore").textContent = soldi(t.valore_eur);
  $("pl").textContent = `${euroConSegno(t.pl_eur)} (${percento(t.pl_pct)})`;
  $("pl").className = `riga-pl ${segno(t.pl_eur)}`;
  $("aggiornato").textContent = `Aggiornato ${quando(stato.aggiornato_il)}`;
  $("prezzati").textContent = `${t.prezzati} asset prezzati su ${t.posizioni}`;
  // Dal controvalore più alto; chi non ha prezzo va in fondo.
  const ordinati = [...stato.asset].sort((x, y) => (y.valore_eur ?? -1) - (x.valore_eur ?? -1));
  $("elenco").replaceChildren(...ordinati.map(scheda));
}

export function svuota() {
  ["valore", "pl", "aggiornato", "prezzati"].forEach((id) => { $(id).textContent = ""; });
  $("elenco").replaceChildren();
  $("vecchi").hidden = true;
}
