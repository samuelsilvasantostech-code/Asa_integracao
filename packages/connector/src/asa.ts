import { config } from "./config.js";

export interface CredencialAsa {
  instituicao_id: string;
  hash: string;
}

export type ErroAsa =
  | "ASA_CREDENCIAL_INVALIDA"
  | "ASA_BLOQUEIO_CLOUDFLARE"
  | "ASA_ROTA_INEXISTENTE"
  | "ASA_FORA_DO_AR"
  | "ASA_RESPOSTA_INVALIDA";

export type RespostaAsa<T> = { ok: true; dados: T } | { ok: false; erro: ErroAsa; status: number; msg?: string };

const BASE = "https://sistema.asasaude.app.br/api";
// O Cloudflare da Asa bloqueia User-Agent de biblioteca (403 "error code: 1010").
const USER_AGENT = `Kentro-Asa-Connector/${config.version} (+https://asa-integracao-samuels.kentro.com.br)`;

export function authorization(c: CredencialAsa): string {
  return Buffer.from(`${c.instituicao_id}:${c.hash}`, "utf8").toString("base64");
}

// Todas as rotas da Asa são POST com parâmetros na query string.
export async function chamarAsa<T>(
  credencial: CredencialAsa,
  rota: string,
  params: Record<string, string | number | Array<string | number>> = {},
): Promise<RespostaAsa<T>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((item) => qs.append(k, String(item)));
    else qs.append(k, String(v));
  }
  const url = `${BASE}/${rota}${qs.size ? "?" + qs.toString() : ""}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: authorization(credencial), "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, erro: "ASA_FORA_DO_AR", status: 0 };
  }

  const texto = await resp.text();
  let corpo: any = null;
  try {
    corpo = JSON.parse(texto);
  } catch {
    // Bloqueio do Cloudflare vem como texto puro.
  }

  if (resp.status === 403 && corpo === null) {
    return { ok: false, erro: "ASA_BLOQUEIO_CLOUDFLARE", status: 403, msg: texto.slice(0, 120) };
  }
  if (resp.status === 401 || resp.status === 403) {
    return { ok: false, erro: "ASA_CREDENCIAL_INVALIDA", status: resp.status, msg: corpo?.msg };
  }
  if (resp.status === 404) return { ok: false, erro: "ASA_ROTA_INEXISTENTE", status: 404 };
  if (resp.status >= 500) return { ok: false, erro: "ASA_FORA_DO_AR", status: resp.status };
  if (corpo === null) return { ok: false, erro: "ASA_RESPOSTA_INVALIDA", status: resp.status };
  return { ok: true, dados: corpo as T };
}

// Leitura leve, sem parâmetros: serve de teste de conexão.
export function listarPrestadores(c: CredencialAsa) {
  return chamarAsa<{ especialidades?: unknown[]; prestadores?: unknown[] }>(c, "api-agendamento");
}
