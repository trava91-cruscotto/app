// notifiche.js — iscrive questo telefono alle notifiche (Web Push).
//
// L'app non scrive nel repository: manda l'iscrizione al workflow imposta.yml, che la
// controlla, la salva in iscrizioni-push.json e risponde con una notifica di prova.
// A mandare le notifiche è il cloud, quindi arrivano anche ad app chiusa.

import { avviaWorkflow, leggiJson } from "./api.js";

const OGNI_MS = 10 * 1000;
const AL_MASSIMO_MS = 2 * 60 * 1000;

const supportate = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const daBase64Url = (testo) => Uint8Array.from(
  atob(testo.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const stessiByte = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

async function iscrizioneLocale() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// Nel repo vanno solo indirizzo e chiavi (niente expirationTime: verrebbe rifiutato).
function daSalvare(sub) {
  const { endpoint, keys } = sub.toJSON();
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

async function salvata(config, mia) {
  const file = await leggiJson(config, "iscrizioni-push.json");
  return Array.isArray(file?.telefoni) && file.telefoni.some((t) => t.endpoint === mia.endpoint
    && t.keys?.p256dh === mia.keys.p256dh && t.keys?.auth === mia.keys.auth);
}

/** "no" (non supportate) | "bloccate" | "da-attivare" | "attive".
 *  "attive" solo se l'iscrizione di questo telefono risulta salvata nel repository. */
export async function controlla(config) {
  if (!supportate()) return "no";
  if (Notification.permission === "denied") return "bloccate";
  const sub = await iscrizioneLocale();
  if (!sub || Notification.permission !== "granted") return "da-attivare";
  return (await salvata(config, daSalvare(sub))) ? "attive" : "da-attivare";
}

/** Chiede il permesso, iscrive il telefono, avvia imposta.yml e aspetta il salvataggio.
 *  Va chiamata da un tocco. Torna "attive" | "non-salvate" | "bloccate" | "da-attivare" | "no". */
export async function attiva(config, avanzamento) {
  if (!supportate()) return "no";
  const permesso = await Notification.requestPermission(); // prima di ogni altra attesa
  if (permesso !== "granted") return permesso === "denied" ? "bloccate" : "da-attivare";

  avanzamento("Preparo l'iscrizione…");
  const impostazioni = await leggiJson(config, "config-app.json");
  const chiave = daBase64Url(String(impostazioni?.vapid_public || ""));
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Un'iscrizione fatta con un'altra chiave non può ricevere le nostre notifiche.
  const usata = sub?.options?.applicationServerKey;
  if (usata && !stessiByte(new Uint8Array(usata), chiave)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chiave });

  const mia = daSalvare(sub);
  await avviaWorkflow(config, "imposta.yml", {
    richiesta: JSON.stringify({ tipo: "iscrizione", ...mia }),
  });

  avanzamento("Salvataggio in corso: di solito serve meno di un minuto…");
  const scadenza = Date.now() + AL_MASSIMO_MS;
  while (Date.now() < scadenza) {
    await new Promise((fatto) => setTimeout(fatto, OGNI_MS));
    try {
      if (await salvata(config, mia)) return "attive";
    } catch (e) {
      if (e.kind === "accesso") throw e; // un buco di rete invece non ferma l'attesa
    }
  }
  return "non-salvate";
}

/** Toglie l'iscrizione da questo telefono. L'indirizzo rimasto nel repository risponde
 *  poi «scaduta» e il cloud lo rimuove al primo invio. */
export async function disiscrivi() {
  if (!supportate()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe();
}
