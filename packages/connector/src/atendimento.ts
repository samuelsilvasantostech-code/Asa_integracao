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

/* ---------- relatório (Painel) ---------- */
// Regras: espera conta só com chamada marcada; consulta só com fim marcado (cronômetro esquecido aberto
// não entra). Fora do normal é descartado: espera acima de 4 h, consulta abaixo de 1 min ou acima de 4 h.
const MIN = 60_000;
export const ESPERA_MAX_MIN = 240, CONSULTA_MIN_MIN = 1, CONSULTA_MAX_MIN = 240;
export const FAIXAS = [
  { ate: 15, rotulo: "Até 15 min" },
  { ate: 30, rotulo: "15 a 30 min" },
  { ate: 60, rotulo: "30 min a 1 h" },
  { ate: Infinity, rotulo: "Mais de 1 h" },
];

export interface LinhaEspera {
  prestador_id: string;
  data: string;               // YYYY-MM-DD
  hora_marcada: string | null;
  chegada: Date | null;
  chamada: Date | null;
  fim: Date | null;
}

function media(v: number[]) { return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null; }
function mediana(v: number[]) {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b), m = o.length >> 1;
  return Math.round(o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2);
}

// Minutos, em números inteiros para a tela. `hoje` separa os cronômetros de hoje ainda abertos (quem está
// na sala agora) dos esquecidos em dias anteriores.
export function resumoEspera(linhas: LinhaEspera[], hoje: string) {
  const esperas: number[] = [], consultas: number[] = [], atrasos: number[] = [], antecedencias: number[] = [];
  const faixas = FAIXAS.map((f) => ({ rotulo: f.rotulo, n: 0 }));
  const dias = new Map<string, number[]>();
  const prof = new Map<string, { esperas: number[]; consultas: number[]; atrasos: number[] }>();
  let chegadas = 0, descartadas = 0, esquecidos = 0, aguardando = 0, emConsulta = 0, atrasados = 0;

  for (const l of linhas) {
    if (!l.chegada) continue;
    chegadas++;
    const p = prof.get(l.prestador_id) ?? { esperas: [], consultas: [], atrasos: [] };
    prof.set(l.prestador_id, p);
    const marcada = l.hora_marcada ? horaNoDia(l.data, l.hora_marcada) : null;
    // Paciente: chegou antes (positivo) ou depois (negativo) do horário marcado.
    if (marcada) {
      const ant = (marcada.getTime() - l.chegada.getTime()) / MIN;
      if (Math.abs(ant) <= ESPERA_MAX_MIN) { antecedencias.push(ant); if (ant < -5) atrasados++; }
    }
    if (!l.chamada) {
      if (l.data === hoje) aguardando++; else esquecidos++;
      continue;
    }
    const espera = (l.chamada.getTime() - l.chegada.getTime()) / MIN;
    if (espera > ESPERA_MAX_MIN) descartadas++;
    else {
      esperas.push(espera);
      p.esperas.push(espera);
      faixas[FAIXAS.findIndex((f) => espera < f.ate)].n++;
      (dias.get(l.data) ?? dias.set(l.data, []).get(l.data)!).push(espera);
      // Atraso da clínica: da hora em que o paciente podia ser atendido (marcada, ou a chegada se ele
      // chegou depois) até ser chamado. Chegar cedo não conta como atraso da clínica.
      if (marcada) {
        const a = Math.max(0, (l.chamada.getTime() - Math.max(marcada.getTime(), l.chegada.getTime())) / MIN);
        atrasos.push(a);
        p.atrasos.push(a);
      }
    }
    if (!l.fim) {
      if (l.data === hoje) emConsulta++; else esquecidos++;
      continue;
    }
    const consulta = (l.fim.getTime() - l.chamada.getTime()) / MIN;
    if (consulta < CONSULTA_MIN_MIN || consulta > CONSULTA_MAX_MIN) descartadas++;
    else { consultas.push(consulta); p.consultas.push(consulta); }
  }

  return {
    chegadas,
    esperas_medidas: esperas.length,
    espera_media: media(esperas),
    espera_mediana: mediana(esperas),
    acima_30: esperas.filter((e) => e >= 30).length,
    consultas_medidas: consultas.length,
    consulta_media: media(consultas),
    atraso_medio: media(atrasos),
    antecedencia_media: media(antecedencias),
    pacientes_atrasados: atrasados,
    faixas,
    por_dia: [...dias.keys()].sort().map((dia) => ({ dia, n: dias.get(dia)!.length, media: media(dias.get(dia)!)! })),
    por_profissional: [...prof.entries()]
      .map(([prestador_id, v]) => ({
        prestador_id, pacientes: v.esperas.length, espera_media: media(v.esperas), atraso_medio: media(v.atrasos), consulta_media: media(v.consultas),
      }))
      .filter((x) => x.pacientes)
      .sort((a, b) => (b.espera_media ?? 0) - (a.espera_media ?? 0)),
    agora: { aguardando, em_consulta: emConsulta },
    esquecidos,
    descartadas,
  };
}

// Consultas de hoje que a agenda do dia já devolveu, por clínica, profissional e dia. A chegada de um id que
// nunca apareceu na agenda (inventado, ou de outro profissional) é conferida no ERP antes de gravar.
const VISTOS_MAX = 5000;
const vistos = new Map<string, Set<string>>();
const chaveVisto = (tenantId: string, prestadorId: string, data: string) => `${tenantId}|${prestadorId}|${data}`;

export function lembrarAgendados(tenantId: string, prestadorId: string, data: string, ids: string[]) {
  const k = chaveVisto(tenantId, prestadorId, data);
  vistos.delete(k); // reinsere no fim: o mais antigo sai primeiro
  vistos.set(k, new Set(ids));
  while (vistos.size > VISTOS_MAX) vistos.delete(vistos.keys().next().value as string);
}

export function agendadoVisto(tenantId: string, prestadorId: string, data: string, id: string): boolean {
  return vistos.get(chaveVisto(tenantId, prestadorId, data))?.has(id) ?? false;
}
