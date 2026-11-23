// Tempo de espera: chegada → chamada → fim, marcados pela recepção na Agenda. Aqui só as regras (sem banco),
// para a rota e os testes. As horas vêm do relógio do Conector, nunca do navegador.

export type Etapa = "chegada" | "chamada" | "fim";
export const ETAPAS: Etapa[] = ["chegada", "chamada", "fim"];
export type Acao = Etapa | "desfazer" | "ajustar";
export const ACOES: Acao[] = [...ETAPAS, "desfazer", "ajustar"];

export interface Tempos {
  chegada: Date | null;
  chamada: Date | null;
  fim: Date | null;
}
export const VAZIO: Tempos = { chegada: null, chamada: null, fim: null };

export type Aplicado =
  | { ok: true; tempos: Tempos; etapa: Etapa | null; mudou: boolean }
  | { ok: false; erro: "ETAPA_FORA_DE_ORDEM" | "HORA_INVALIDA" | "NADA_A_DESFAZER" };

// Folga para "ajustar" uma hora que o relógio do atendente marca um pouco à frente do Conector.
const FOLGA_FUTURO_MS = 2 * 60 * 1000;

// Etapa atual = a última marcada. null = nada marcado.
export function etapaAtual(t: Tempos): Etapa | null {
  return t.fim ? "fim" : t.chamada ? "chamada" : t.chegada ? "chegada" : null;
}

function anterior(e: Etapa): Etapa | null {
  return e === "fim" ? "chamada" : e === "chamada" ? "chegada" : null;
}
function seguinte(e: Etapa): Etapa | null {
  return e === "chegada" ? "chamada" : e === "chamada" ? "fim" : null;
}

// `hora` = a nova hora da etapa, só em "ajustar".
export function aplicar(atual: Tempos, acao: Acao, agora: Date, etapa?: Etapa, hora?: Date): Aplicado {
  const t: Tempos = { ...atual };

  if (acao === "desfazer") {
    const e = etapaAtual(t);
    if (!e) return { ok: false, erro: "NADA_A_DESFAZER" };
    t[e] = null;
    return { ok: true, tempos: t, etapa: e, mudou: true };
  }

  if (acao === "ajustar") {
    if (!etapa || !hora || !(t[etapa] instanceof Date)) return { ok: false, erro: "ETAPA_FORA_DE_ORDEM" };
    if (hora.getTime() > agora.getTime() + FOLGA_FUTURO_MS) return { ok: false, erro: "HORA_INVALIDA" };
    const antes = anterior(etapa), depois = seguinte(etapa);
    if (antes && t[antes] && hora < t[antes]!) return { ok: false, erro: "HORA_INVALIDA" };
    if (depois && t[depois] && hora > t[depois]!) return { ok: false, erro: "HORA_INVALIDA" };
    t[etapa] = hora;
    return { ok: true, tempos: t, etapa, mudou: true };
  }

  // Marcar uma etapa: repetir a mesma (clique duplo, duas recepcionistas) não muda nada.
  if (t[acao]) return { ok: true, tempos: t, etapa: acao, mudou: false };
  const antes = anterior(acao);
  if (antes && !t[antes]) return { ok: false, erro: "ETAPA_FORA_DE_ORDEM" };
  // A hora nunca fica antes da etapa anterior (relógio do banco e do processo podem diferir um pouco).
  t[acao] = antes && t[antes]! > agora ? t[antes] : agora;
  return { ok: true, tempos: t, etapa: acao, mudou: true };
}

// "HH:MM" do dia `data` (YYYY-MM-DD) no fuso da clínica → instante. Brasília sem horário de verão desde 2019.
export function horaNoDia(data: string, hhmm: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  const d = new Date(`${data}T${hhmm}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Para a extensão: horas em ISO.
export function emJson(t: Tempos) {
  return {
    chegada: t.chegada?.toISOString() ?? null,
    chamada: t.chamada?.toISOString() ?? null,
    fim: t.fim?.toISOString() ?? null,
  };
}
