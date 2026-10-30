import { config } from "./config.js";

// O token é o valor do header Authorization, como a Asa entrega: base64("ID:hash").
// O formato antigo (ID e hash separados) ainda é lido de credenciais já gravadas.
export type CredencialAsa = { token: string } | { instituicao_id: string; hash: string };

export type ErroAsa =
  | "ASA_CREDENCIAL_INVALIDA"
  | "ASA_BLOQUEIO_CLOUDFLARE"
  | "ASA_ROTA_INEXISTENTE"
  | "ASA_RECUSOU"
  | "ASA_FORA_DO_AR"
  | "ASA_RESPOSTA_INVALIDA";

export type RespostaAsa<T> = { ok: true; dados: T } | { ok: false; erro: ErroAsa; status: number; msg?: string };

const BASE = "https://sistema.asasaude.app.br/api";
// O Cloudflare da Asa bloqueia User-Agent de biblioteca (403 "error code: 1010").
const USER_AGENT = `Kentro-Asa-Connector/${config.version} (+https://asa-integracao-samuels.kentro.com.br)`;

export function authorization(c: CredencialAsa): string {
  if ("token" in c) return c.token;
  return Buffer.from(`${c.instituicao_id}:${c.hash}`, "utf8").toString("base64");
}

// ID da instituição embutido no token, só para exibição. null se o token não seguir o formato.
export function instituicaoDoToken(token: string): string | null {
  const m = /^(\d+):/.exec(Buffer.from(token, "base64").toString("utf8"));
  return m ? m[1] : null;
}

export function instituicaoDa(c: CredencialAsa): string | null {
  return "token" in c ? instituicaoDoToken(c.token) : c.instituicao_id;
}

// Todas as rotas da Asa são POST com parâmetros na query string.
export async function chamarAsa<T>(
  credencial: CredencialAsa,
  rota: string,
  params: Record<string, string | number | Array<string | number>> = {},
  timeoutMs = 15000,
): Promise<RespostaAsa<T>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((item) => qs.append(k, String(item)));
    else qs.append(k, String(v));
  }
  const url = `${BASE}/${rota}${qs.size ? "?" + qs.toString() : ""}`;

  let resp: Response;
  const inicio = Date.now();
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: authorization(credencial), "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    // Distingue tempo esgotado (TimeoutError) de conexão recusada ou cortada (causa com código de rede).
    const causa = err?.cause?.code ?? err?.cause?.name ?? "";
    return { ok: false, erro: "ASA_FORA_DO_AR", status: 0, msg: `${err?.name ?? "erro"}${causa ? " " + causa : ""} em ${Date.now() - inicio} ms` };
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
  // A Asa usa 403 também para recusas de negócio (ex.: paciente não encontrado). Só é credencial
  // quando a mensagem fala de autorização.
  if (resp.status === 401 || (resp.status === 403 && /autoriza/i.test(String(corpo?.msg ?? "")))) {
    return { ok: false, erro: "ASA_CREDENCIAL_INVALIDA", status: resp.status, msg: corpo?.msg };
  }
  if (resp.status === 403 || corpo?.status === "error") {
    return { ok: false, erro: "ASA_RECUSOU", status: resp.status, msg: String(corpo?.msg ?? corpo?.message ?? "") };
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
