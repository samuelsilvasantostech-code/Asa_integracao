// Financeiro: configuração por clínica e validação do lançamento. Funções puras.

export type QuemLanca = "admin" | "todos";

export interface ConfigFinanceiro {
  ativo: boolean;
  quem: QuemLanca; // quem vê o botão de lançar; a regra é aplicada no painel (o Conector não conhece o usuário)
}

// Nasce desligado: lançar conta é gravação sem volta na Asa, a clínica liga quando quiser.
export const PADRAO_FINANCEIRO: ConfigFinanceiro = { ativo: false, quem: "admin" };

export function lerFinanceiro(gravado: unknown): ConfigFinanceiro {
  const g = gravado && typeof gravado === "object" ? (gravado as any) : {};
  return {
    ativo: typeof g.ativo === "boolean" ? g.ativo : PADRAO_FINANCEIRO.ativo,
    quem: g.quem === "todos" || g.quem === "admin" ? g.quem : PADRAO_FINANCEIRO.quem,
  };
}

// Valores aceitos pela Asa em `forma_pagamento`.
export const FORMAS = ["pix", "cartao_credito", "cartao_debito", "dinheiro", "boleto"] as const;
export type Forma = (typeof FORMAS)[number];

const VALOR_MAXIMO = 100000;

// Valor em reais ("350", "350.5", "350,50", 350.5) → "350.50", formato que a Asa pede. null se inválido.
export function valorAsa(raw: unknown): string | null {
  const s = typeof raw === "number" ? String(raw) : String(raw ?? "").trim().replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!(n > 0) || n > VALOR_MAXIMO) return null;
  return n.toFixed(2);
}

export function formaValida(s: unknown): s is Forma {
  return typeof s === "string" && (FORMAS as readonly string[]).includes(s);
}
