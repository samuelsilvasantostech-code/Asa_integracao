// Catálogo de conectores (tabela conectores): qual adaptador cada sistema usa e o que a clínica preenche
// para ligar. tenants.erp guarda o slug. Ver docs/conectores.md.
import { pool } from "../db.js";
import type { ErpAdapter } from "./adaptador.js";
import { AsaAdapter, type LogErp } from "./asa/adaptador.js";
import type { CredencialAsa } from "./asa/cliente.js";
import { CONECTOR_PADRAO, validarConector, type CampoConector, type ConectorConfig } from "./conector/motor.js";
import { baseUrlValida, ErpDesconhecido } from "./index.js";
import { PadraoAdapter } from "./padrao/adaptador.js";

export type Situacao = "rascunho" | "homologacao" | "publicado" | "arquivado";

export interface Conector {
  slug: string;
  nome: string;
  artigo: "a" | "o";
  tipo: "codigo" | "configuracao";
  situacao: Situacao;
  versao: number;
  config: ConectorConfig | null;
}

// Clínicas só usam conector em homologação (teste com uma clínica) ou publicado.
export const SITUACOES_EM_USO: Situacao[] = ["homologacao", "publicado"];

const CACHE_MS = 30 * 1000;
const cache = new Map<string, { em: number; c: Conector | null }>();

export function esquecerConector(slug?: string) {
  if (slug) cache.delete(slug);
  else cache.clear();
}

export async function carregarConector(slug: string): Promise<Conector | null> {
  const guardado = cache.get(slug);
  if (guardado && Date.now() - guardado.em < CACHE_MS) return guardado.c;
  if (!pool) return null;
  const { rows } = await pool.query<Conector>(
    "SELECT slug, nome, artigo, tipo, situacao, versao, config FROM conectores WHERE slug = $1",
    [slug],
  );
  const c = rows[0] ?? null;
  cache.set(slug, { em: Date.now(), c });
  return c;
}

// A configuração que vale para o conector (o padrão Kentro guarda NULL e usa a do código).
export function configDe(c: Conector): ConectorConfig | null {
  if (c.tipo === "codigo") return null;
  return c.config ?? (c.slug === "padrao" ? CONECTOR_PADRAO : null);
}

// Campos que a clínica preenche para ligar este sistema.
export function camposDe(c: Conector): CampoConector[] {
  if (c.slug === "asa") return [{ chave: "token", rotulo: "Token da Asa", tipo: "segredo", obrigatorio: true, ajuda: "Fornecido pela Asa: o mesmo valor do header Authorization." }];
  return configDe(c)?.campos ?? [];
}

// O adaptador de um conector, com a credencial da clínica. `conector` já carregado evita outra leitura
// (a Central testa rascunhos assim); sem ele, o conector precisa estar em homologação ou publicado.
export async function adaptadorPara(slug: string, credencial: unknown, log: LogErp, conector?: Conector): Promise<ErpAdapter> {
  const c = conector ?? (await carregarConector(slug));
  if (!c) throw new ErpDesconhecido(slug);
  if (!conector && !SITUACOES_EM_USO.includes(c.situacao)) throw new ErpDesconhecido(`${slug} (${c.situacao})`);
  if (c.tipo === "codigo") {
    if (c.slug === "asa") return new AsaAdapter(credencial as CredencialAsa, log);
    throw new ErpDesconhecido(slug);
  }
  const cfg = configDe(c);
  if (!cfg) throw new ErpDesconhecido(`${slug} (sem configuração)`);
  return new PadraoAdapter((credencial ?? {}) as Record<string, unknown>, log, cfg, c.slug);
}

// Confere a credencial que a clínica preencheu contra os campos do conector. Campos de URL só HTTPS público.
export function lerCredencial(campos: CampoConector[], entrada: unknown): { ok: true; credencial: Record<string, string> } | { ok: false; erro: string; campo?: string } {
  const e = entrada && typeof entrada === "object" ? (entrada as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const f of campos) {
    const bruto = typeof e[f.chave] === "string" ? (e[f.chave] as string).trim() : "";
    if (!bruto) {
      if (f.obrigatorio) return { ok: false, erro: "CAMPO_OBRIGATORIO", campo: f.chave };
      continue;
    }
    if (bruto.length > 4096) return { ok: false, erro: "CAMPO_INVALIDO", campo: f.chave };
    if (f.tipo === "url") {
      const u = baseUrlValida(bruto);
      if (!u) return { ok: false, erro: "ERP_URL_INVALIDA", campo: f.chave };
      out[f.chave] = u;
    } else {
      if (f.tipo === "segredo" && /\s/.test(bruto)) return { ok: false, erro: "CAMPO_INVALIDO", campo: f.chave };
      out[f.chave] = bruto;
    }
  }
  return { ok: true, credencial: out };
}

// Configuração vinda da Central: forma válida e, se o endereço for fixo, HTTPS público.
export function lerConfigConector(bruto: unknown): { ok: true; config: ConectorConfig } | { ok: false; erros: string[] } {
  const v = validarConector(bruto);
  if (!v.ok) return v;
  const base = v.conector.base_url;
  if (!base.includes("{{") && !baseUrlValida(base)) return { ok: false, erros: ["base_url fixo precisa ser HTTPS público (ou use {{cred.base_url}})"] };
  if (base.includes("{{") && !/^\{\{cred\.[a-z][a-z0-9_]*\}\}/.test(base)) return { ok: false, erros: ["base_url com modelo precisa começar por {{cred.<campo url>}}"] };
  const m = /^\{\{cred\.([a-z][a-z0-9_]*)\}\}/.exec(base);
  if (m && v.conector.campos.find((f) => f.chave === m[1])?.tipo !== "url") return { ok: false, erros: [`o campo ${m[1]} usado no base_url precisa ser do tipo url`] };
  return { ok: true, config: v.conector };
}
