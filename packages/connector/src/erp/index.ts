// Registro dos ERPs suportados: dado o ERP da clínica (coluna tenants.erp) e a credencial dela, cria o
// adaptador. Um ERP novo = um adaptador em erp/<nome>/ e uma linha aqui.
import type { ErpAdapter } from "./adaptador.js";
import { AsaAdapter, type LogErp } from "./asa/adaptador.js";
import type { CredencialAsa } from "./asa/cliente.js";
import { PadraoAdapter, type CredencialPadrao } from "./padrao/adaptador.js";

export type { BuscaPaciente, ErpAdapter, FalhaErp, Resultado } from "./adaptador.js";
export type { LogErp } from "./asa/adaptador.js";
export type { CredencialPadrao } from "./padrao/adaptador.js";

// "asa": API própria da Asa Saúde. "padrao": qualquer ERP que implemente a especificação da Kentro.
export const ERPS = ["asa", "padrao"] as const;
export type Erp = (typeof ERPS)[number];

export class ErpDesconhecido extends Error {}

// `credencial` = o JSON decifrado de tenants.asa_credencial_cifrada. Apesar do nome, a coluna guarda a
// credencial de qualquer ERP; a troca de nome fica para quando houver um segundo ERP.
export function criarAdaptador(erp: string, credencial: unknown, log: LogErp): ErpAdapter {
  switch (erp) {
    case "asa":
      return new AsaAdapter(credencial as CredencialAsa, log);
    case "padrao":
      return new PadraoAdapter(credencial as Record<string, unknown>, log);
    default:
      throw new ErpDesconhecido(erp);
  }
}

// Endereço da API de um ERP no padrão Kentro: só HTTPS, sem usuário/senha na URL, sem query nem fragmento.
// Devolve a URL normalizada (sem barra no fim) ou null.
export function baseUrlValida(entrada: unknown): string | null {
  let u: URL;
  try {
    u = new URL(String(entrada ?? "").trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return null;
  if (hostInterno(u.hostname)) return null;
  return u.toString().replace(/\/+$/, "");
}

// Nomes e IPs que apontam para dentro da rede do Conector: o endereço do ERP nunca pode ser um deles.
// (Barreira contra cadastro errado ou malicioso pela implantação; um nome público que resolve para IP
// interno não é pego aqui.)
function hostInterno(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return h.includes(":") && (h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:"));
}
