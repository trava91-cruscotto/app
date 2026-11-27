// api.js — l'unico punto che parla con GitHub. Legge i file e avvia i workflow:
// l'app non scrive mai nel repository.
//
// api.github.com ammette le chiamate dal browser, quindi non serve un server.
// Repository e token arrivano da fuori: qui non c'è nessun valore fisso.

const API_ROOT = "https://api.github.com";

// kind: "accesso" (token o repository sbagliati: i dati non vanno mostrati) |
//       "rete" | "temporaneo" | "formato"  (si può mostrare l'ultima copia).
export class ApiError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
  }
}

function errore(resp) {
  const finite = resp.status === 429
    || (resp.status === 403 && resp.headers.get("x-ratelimit-remaining") === "0");
  if (finite) return new ApiError("Troppe richieste a GitHub: riprova più tardi.", "temporaneo");
  if (resp.status === 401) return new ApiError("Token errato o scaduto.", "accesso");
  if (resp.status === 403) return new ApiError("Accesso negato: controlla i permessi del token.", "accesso");
  if (resp.status === 404) {
    return new ApiError("Dati non trovati: controlla il nome del repository e che il token possa leggerlo.", "accesso");
  }
  return new ApiError(`GitHub non risponde come previsto (errore ${resp.status}).`, "temporaneo");
}

// Una chiamata autenticata -> testo della risposta, oppure ApiError.
async function chiama({ repo, token }, percorso, accept, opzioni = {}) {
  try {
    const resp = await fetch(`${API_ROOT}/repos/${repo}/${percorso}`, {
      ...opzioni,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": accept,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw errore(resp);
    return await resp.text();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("Rete assente o troppo lenta.", "rete");
  }
}

// Chiede al cloud di eseguire un workflow già definito, che valida la richiesta.
export async function avviaWorkflow(config, file, inputs) {
  await chiama(config, `actions/workflows/${file}/dispatches`, "application/vnd.github+json", {
    method: "POST",
    body: JSON.stringify({ ref: "main", inputs }),
  });
}

const OGNI_MS = 10 * 1000;
const AL_MASSIMO_MS = 2 * 60 * 1000;

const stessaVoce = (a, b) => ["attiva", "su_pct", "giu_pct"].every((k) => a?.[k] === b[k]);

/** La mappa per asset di soglie.json. */
export async function leggiSoglie(config) {
  const file = await leggiJson(config, "soglie.json");
  if (file?.schema !== 1 || !file.asset || typeof file.asset !== "object") {
    throw new ApiError("Il file delle soglie ha un formato non riconosciuto.", "formato");
  }
  return file.asset;
}

/** Chiede a imposta.yml di salvare le soglie di un asset e rilegge finché non le trova.
 *  Torna { salvate, soglie }: soglie è l'ultima mappa letta. Se nel repository ci sono
 *  già, non avvia nulla. */
export async function salvaSoglie(config, asset, voce, avviato) {
  let soglie = await leggiSoglie(config);
  if (stessaVoce(soglie[asset], voce)) return { salvate: true, soglie };

  await avviaWorkflow(config, "imposta.yml", {
    richiesta: JSON.stringify({ tipo: "soglie", asset, ...voce }),
  });
  avviato();

  const scadenza = Date.now() + AL_MASSIMO_MS;
  // Il controllo sta in fondo: se il telefono ha sospeso l'app oltre la scadenza,
  // si rilegge comunque una volta prima di dire «non salvato».
  do {
    await new Promise((fatto) => setTimeout(fatto, OGNI_MS));
    try {
      soglie = await leggiSoglie(config);
      if (stessaVoce(soglie[asset], voce)) return { salvate: true, soglie };
    } catch (e) {
      if (e.kind === "accesso") throw e; // un buco di rete invece non ferma l'attesa
    }
  } while (Date.now() < scadenza);
  return { salvate: false, soglie };
}

export async function leggiJson(config, percorso) {
  const testo = await chiama(config, `contents/${percorso}`, "application/vnd.github.raw+json");
  try {
    return JSON.parse(testo);
  } catch {
    throw new ApiError("Il file dei dati non è leggibile.", "formato");
  }
}
