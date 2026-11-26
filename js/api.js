// api.js — l'unico punto che parla con GitHub. Solo lettura.
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

export async function leggiJson({ repo, token }, percorso) {
  let resp;
  let testo;
  try {
    resp = await fetch(`${API_ROOT}/repos/${repo}/contents/${percorso}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw errore(resp);
    testo = await resp.text();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("Rete assente o troppo lenta.", "rete");
  }
  try {
    return JSON.parse(testo);
  } catch {
    throw new ApiError("Il file dei dati non è leggibile.", "formato");
  }
}
