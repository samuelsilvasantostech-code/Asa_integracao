// O que o ERP da clínica suporta além do essencial (paciente, agenda, marcar, remarcar, cancelar), e como as
// telas escrevem o nome dele. As capacidades são detectadas pela implantação no teste de conexão e gravadas
// em tenants.erp_capacidades; o Conector e a extensão só oferecem o que estiver ligado aqui.

export interface Capacidades {
  financeiro: boolean; // lançar conta a receber do paciente
  confirmacao: boolean; // consultas a confirmar e registro do lembrete enviado (confirmação de véspera)
  grupos_exames: boolean; // grupos de procedimentos para navegar o catálogo
}

export const NOMES_CAPACIDADES: Array<keyof Capacidades> = ["financeiro", "confirmacao", "grupos_exames"];

// Antes da primeira detecção: a Asa tem tudo (rotas conhecidas); um ERP no padrão Kentro só o obrigatório.
const PADRAO_POR_ERP: Record<string, Capacidades> = {
  asa: { financeiro: true, confirmacao: true, grupos_exames: true },
  padrao: { financeiro: false, confirmacao: false, grupos_exames: false },
};
const NENHUMA: Capacidades = { financeiro: false, confirmacao: false, grupos_exames: false };

export function lerCapacidades(erp: string, gravado: unknown): Capacidades {
  const base = PADRAO_POR_ERP[erp] ?? NENHUMA;
  if (!gravado || typeof gravado !== "object") return { ...base };
  const g = gravado as Record<string, unknown>;
  const out = { ...base };
  for (const k of NOMES_CAPACIDADES) if (typeof g[k] === "boolean") out[k] = g[k] as boolean;
  return out;
}

export interface Sistema {
  nome: string; // "Asa", "Feegow", "sistema da clínica"
  artigo: "a" | "o";
}

// Sem nome cadastrado: "a Asa" para clínica na Asa; nos outros, as telas falam do "sistema da clínica".
export function sistemaDe(nome: string | null | undefined, artigo: string | null | undefined, erp?: string): Sistema {
  const n = String(nome ?? "").trim();
  if (!n) return erp === "asa" ? { nome: "Asa", artigo: "a" } : { nome: "sistema da clínica", artigo: "o" };
  return { nome: n, artigo: artigo === "a" ? "a" : "o" };
}
