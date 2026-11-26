import type { Pool } from "pg";
import { lerConfig } from "./confirmacao.js";
import { lerFinanceiro } from "./financeiro.js";

// Uso do ClinFy por todas as clínicas (aba "Uso" da implantação). Lê só as trilhas do Conector:
// mede o que passou pelo ClinFy, não a agenda inteira da clínica. Nenhum dado de paciente sai daqui.
// Atendentes distintos dependem do campo usuario, que a retenção apaga depois de 90 dias.
// Buscas, aberturas e falhas do ERP vêm da contagem diária (uso_diario, contagem.ts), que só existe desde a 0.35.0.

const FUSO = "America/Sao_Paulo";
export const DIAS_USO = [7, 30, 90];
const DIA_MS = 86400000;

export type PeriodoUso = { dias: number; inicio: string; fim: string; anterior_inicio: string };

const somaDias = (iso: string, n: number) => {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};

// Últimos `dias` dias até hoje, e o período anterior de mesmo tamanho (para a tendência). Fora da lista vira 30.
export function periodoUso(hoje: string, dias: unknown): PeriodoUso {
  const n = DIAS_USO.includes(Number(dias)) ? Number(dias) : 30;
  const inicio = somaDias(hoje, -(n - 1));
  return { dias: n, inicio, fim: hoje, anterior_inicio: somaDias(inicio, -n) };
}

/* ---------- linhas vindas do banco ---------- */
export type TenantUso = {
  id: string; nome: string; ativo: boolean; erp: string | null; criado_em: Date | string;
  ultimo_uso_em: Date | string | null; desligado_em: Date | string | null; tem_credencial: boolean;
  confirmacao: unknown; financeiro: unknown;
  extensao_versao?: string | null; extensao_versao_em?: Date | string | null;
};
export type EntradaUso = {
  tenants: TenantUso[];
  agendamentos: { tenant_id: string; dia: string; tipo: string; situacao: string; n: number }[];
  cobrancas: { tenant_id: string; dia: string; situacao: string; n: number; total: string | number | null }[];
  confirmacoes: { tenant_id: string; estado: string; resposta: string | null; origem: string; n: number }[];
  atendimentos: { tenant_id: string; dia: string; n: number }[];
  usuarios: { tenant_id: string; n: number }[];
  ultimas: { tenant_id: string; ultima: Date | string | null }[];
  eventos?: { tenant_id: string; evento: string; n: number }[];
};

export type Alerta = { tipo: string; nivel: "aviso" | "critico"; texto: string };
export type Situacao = { tom: "ok" | "warn" | "off" | "idle"; texto: string };
export type Saude = { tom: "ok" | "warn" | "err" | "idle"; texto: string };

const TIPOS = ["criar", "remarcar", "cancelar", "confirmar", "ausente"] as const;
const ms = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : NaN);

// Dias inteiros desde `v` até `agora` (NaN sem data).
function diasDesde(v: Date | string | null | undefined, agora: number) {
  const t = ms(v);
  return Number.isNaN(t) ? NaN : Math.floor((agora - t) / DIA_MS);
}

// Expediente de clínica em São Paulo: segunda a sexta, das 10h às 18h (duas horas depois de abrir, para
// não acender logo cedo). Fora disso, ficar sem chamadas é normal.
const fmtSP = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "numeric", hourCycle: "h23" });
export function emExpediente(agora: number): boolean {
  const partes = Object.fromEntries(fmtSP.formatToParts(new Date(agora)).map((x) => [x.type, x.value]));
  const hora = Number(partes.hour);
  return !["Sat", "Sun"].includes(partes.weekday) && hora >= 10 && hora < 18;
}
export const HORAS_SEM_USO = 3;
// Clínica de uso diário: pelo menos isso de chamadas ao Conector por dia, na média do período (Avelar e
// Medular fazem 30–40). A de apresentação e as de teste ficam de fora: ficar um dia sem uso é normal nelas.
export const USO_DIARIO = 15;

// "0.33.6" < "0.34.0": a clínica está uma versão menor (ou maior) atrás. Diferença só de correção não conta.
export function versaoAtrasada(v: string | null | undefined, atual: string | null | undefined): boolean {
  const a = /^(\d+)\.(\d+)\./.exec(v ?? ""), b = /^(\d+)\.(\d+)\./.exec(atual ?? "");
  if (!a || !b) return false;
  return Number(a[1]) < Number(b[1]) || (Number(a[1]) === Number(b[1]) && Number(a[2]) < Number(b[2]));
}

// Contagem diária de uma clínica: telas e buscas, chamadas ao Conector e falhas do ERP por código.
function lerEventos(linhas: { evento: string; n: number }[]) {
  const eventos: Record<string, number> = {};
  const erros = new Map<string, number>();
  let chamadas = 0, falhas = 0;
  for (const r of linhas) {
    if (r.evento === "chamada") chamadas += r.n;
    else if (r.evento.startsWith("erp:")) { falhas += r.n; erros.set(r.evento.slice(4), (erros.get(r.evento.slice(4)) ?? 0) + r.n); }
    else eventos[r.evento] = (eventos[r.evento] ?? 0) + r.n;
  }
  const principais = [...erros].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 3).map(([erro, n]) => ({ erro, n }));
  return { eventos, erros_erp: { total: falhas, chamadas, principais } };
}

export function montarUso(e: EntradaUso, p: PeriodoUso, agora: Date, versaoAtual?: string) {
  const agoraMs = agora.getTime();
  const noPeriodo = (dia: string) => dia >= p.inicio && dia <= p.fim;
  const noAnterior = (dia: string) => dia >= p.anterior_inicio && dia < p.inicio;
  const por = <T extends { tenant_id: string }>(linhas: T[]) => {
    const m = new Map<string, T[]>();
    for (const l of linhas) (m.get(l.tenant_id) ?? m.set(l.tenant_id, []).get(l.tenant_id)!).push(l);
    return (id: string) => m.get(id) ?? [];
  };
  const ag = por(e.agendamentos), cob = por(e.cobrancas), conf = por(e.confirmacoes), esp = por(e.atendimentos), evs = por(e.eventos ?? []);
  const usr = new Map(e.usuarios.map((u) => [u.tenant_id, u.n]));
  const ult = new Map(e.ultimas.map((u) => [u.tenant_id, u.ultima]));

  // Os dias do período, em ordem: a série diária de cada clínica tem um valor por dia (zero se não houve uso).
  const dias = Array.from({ length: p.dias }, (_, i) => somaDias(p.inicio, i));
  const clinicas = e.tenants.map((t) => {
    const diario = new Map<string, number>();
    const somar = (dia: string, n: number) => diario.set(dia, (diario.get(dia) ?? 0) + n);
    const acoes: Record<string, number> = Object.fromEntries(TIPOS.map((k) => [k, 0]));
    const porDia = new Map<string, number>();
    let incertos = 0, anterior = 0;
    for (const r of ag(t.id)) {
      if (r.situacao === "ok" && noPeriodo(r.dia)) {
        acoes[r.tipo] = (acoes[r.tipo] ?? 0) + r.n;
        porDia.set(r.dia, (porDia.get(r.dia) ?? 0) + r.n);
        somar(r.dia, r.n);
      }
      if (r.situacao === "ok" && noAnterior(r.dia)) anterior += r.n;
      if (r.situacao === "incerto" && noPeriodo(r.dia)) incertos += r.n;
    }
    const cobrancas = { n: 0, valor: 0, incertas: 0 };
    let cobAnterior = 0;
    for (const r of cob(t.id)) {
      if (r.situacao === "ok" && noPeriodo(r.dia)) { cobrancas.n += r.n; cobrancas.valor += Number(r.total ?? 0); somar(r.dia, r.n); }
      if (r.situacao === "ok" && noAnterior(r.dia)) cobAnterior += r.n;
      if (r.situacao === "incerto" && noPeriodo(r.dia)) cobrancas.incertas += r.n;
    }
    const confirmacoes = { enviadas: 0, respondidas: 0, confirmadas: 0, falharam: 0, manuais: 0 };
    for (const r of conf(t.id)) {
      if (r.estado === "falhou") { confirmacoes.falharam += r.n; continue; }
      confirmacoes.enviadas += r.n;
      if (r.origem === "manual") confirmacoes.manuais += r.n;
      if (r.estado === "respondido") confirmacoes.respondidas += r.n;
      if (r.resposta === "confirmar") confirmacoes.confirmadas += r.n;
    }
    let espera = 0, esperaAnterior = 0;
    for (const r of esp(t.id)) {
      if (noPeriodo(r.dia)) { espera += r.n; somar(r.dia, r.n); }
      else if (noAnterior(r.dia)) esperaAnterior += r.n;
    }

    const { eventos, erros_erp } = lerEventos(evs(t.id));
    const totalAcoes = Object.values(acoes).reduce((s, n) => s + n, 0);
    const volume = totalAcoes + cobrancas.n + espera;
    const volumeAnterior = anterior + cobAnterior + esperaAnterior;
    const funcoes: string[] = [];
    if (acoes.criar + acoes.remarcar + acoes.cancelar) funcoes.push("agenda");
    if (acoes.confirmar + acoes.ausente) funcoes.push("presenca");
    if (espera) funcoes.push("espera");
    if (cobrancas.n) funcoes.push("cobranca");
    if (confirmacoes.enviadas - confirmacoes.manuais > 0) funcoes.push("confirmacao");
    if (confirmacoes.manuais) funcoes.push("confirmacao_manual");
    if (eventos.busca_paciente) funcoes.push("busca");
    if (eventos.cadastro_paciente) funcoes.push("cadastro");

    const cfgConf = lerConfig(t.confirmacao), cfgFin = lerFinanceiro(t.financeiro);
    const configuradas: string[] = [];
    if (cfgConf.ativo) configuradas.push("confirmacao");
    if (cfgFin.ativo) configuradas.push("cobranca");

    const base = {
      id: t.id, nome: t.nome, ativo: t.ativo, erp: t.erp ?? "asa", criado_em: t.criado_em,
      ultimo_uso_em: t.ultimo_uso_em, ultima_acao_em: ult.get(t.id) ?? null, desligado_em: t.desligado_em,
      acoes, incertos, cobrancas, confirmacoes, espera: { atendimentos: espera },
      usuarios: usr.get(t.id) ?? 0, volume, volume_anterior: volumeAnterior,
      anterior: { acoes: anterior, cobrancas: cobAnterior, espera: esperaAnterior },
      funcoes, configuradas, eventos, erros_erp,
      versao: {
        extensao: t.extensao_versao ?? null, em: t.extensao_versao_em ?? null, atual: versaoAtual ?? null,
        antiga: versaoAtrasada(t.extensao_versao, versaoAtual) && diasDesde(t.extensao_versao_em, agoraMs) < 7,
      },
      por_dia: [...porDia.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([dia, n]) => ({ dia, n })),
      spark: dias.map((d) => diario.get(d) ?? 0),
    };
    const situacao = situacaoDe(t, agoraMs);
    const alertas = alertasDe({ ...base, tem_credencial: t.tem_credencial, confirmacao_ligada: cfgConf.ativo && !cfgConf.teste.ativo }, p, agoraMs);
    return { ...base, situacao, alertas, saude: saudeDe(situacao, alertas) };
  });

  // Alertas críticos primeiro, depois avisos, depois quem tem mais uso.
  const peso = (c: { alertas: Alerta[] }) => c.alertas.reduce((s, a) => s + (a.nivel === "critico" ? 100 : 10), 0);
  clinicas.sort((a, b) => Number(b.ativo) - Number(a.ativo) || peso(b) - peso(a) || b.volume - a.volume || a.nome.localeCompare(b.nome));

  const ativas7d = clinicas.filter((c) => c.ativo && diasDesde(c.ultimo_uso_em, agoraMs) < 7).length;
  const soma = (f: (c: (typeof clinicas)[number]) => number) => clinicas.reduce((s, c) => s + f(c), 0);
  return {
    periodo: p,
    // Uso somado de todas as clínicas, dia a dia (ações na agenda, cobranças e atendimentos na espera).
    serie: dias.map((dia, i) => ({ dia, n: soma((c) => c.spark[i]) })),
    totais_anterior: {
      acoes: soma((c) => c.anterior.acoes),
      cobrancas: soma((c) => c.anterior.cobrancas),
      espera: soma((c) => c.anterior.espera),
      volume: soma((c) => c.volume_anterior),
    },
    totais: {
      clinicas: clinicas.length,
      ativas: clinicas.filter((c) => c.ativo).length,
      usaram_7d: ativas7d,
      acoes: clinicas.reduce((s, c) => s + c.volume - c.cobrancas.n - c.espera.atendimentos, 0),
      cobrancas: { n: clinicas.reduce((s, c) => s + c.cobrancas.n, 0), valor: clinicas.reduce((s, c) => s + c.cobrancas.valor, 0) },
      confirmacoes: clinicas.reduce((s, c) => s + c.confirmacoes.enviadas, 0),
      com_alerta: clinicas.filter((c) => c.alertas.length).length,
      buscas: clinicas.reduce((s, c) => s + (c.eventos.busca_paciente ?? 0), 0),
    },
    clinicas,
  };
}

// Selo de saúde: resume situação e alertas numa palavra. Crítica vence atenção; desligada e nunca usou ficam neutras.
export function saudeDe(situacao: Situacao, alertas: Alerta[]): Saude {
  if (situacao.tom === "off") return { tom: "idle", texto: "Desligada" };
  if (alertas.some((a) => a.nivel === "critico")) return { tom: "err", texto: "Crítica" };
  if (alertas.length) return { tom: "warn", texto: "Atenção" };
  if (situacao.tom === "idle") return { tom: "idle", texto: "Nunca usou" };
  return { tom: "ok", texto: "Saudável" };
}

export function situacaoDe(t: Pick<TenantUso, "ativo" | "ultimo_uso_em" | "criado_em">, agora: number): Situacao {
  if (!t.ativo) return { tom: "off", texto: "Desligada" };
  const d = diasDesde(t.ultimo_uso_em, agora);
  if (Number.isNaN(d)) return { tom: "idle", texto: "Nunca usou" };
  if (d >= 3) return { tom: "warn", texto: `Parada há ${d} dias` };
  return { tom: "ok", texto: "Em uso" };
}

type BaseAlerta = {
  ativo: boolean; criado_em: Date | string; ultimo_uso_em: Date | string | null; tem_credencial: boolean;
  acoes: Record<string, number>; incertos: number; confirmacoes: { enviadas: number; falharam: number };
  volume: number; volume_anterior: number; confirmacao_ligada: boolean;
  erros_erp?: { total: number; chamadas: number; principais: { erro: string; n: number }[] };
  versao?: { extensao: string | null; atual: string | null; antiga: boolean };
};

// Regras dos alertas. Volume mínimo nas taxas, para uma clínica pequena não acender por um caso só.
export function alertasDe(c: BaseAlerta, p: PeriodoUso, agora: number): Alerta[] {
  if (!c.ativo) return [];
  const a: Alerta[] = [];
  const parado = diasDesde(c.ultimo_uso_em, agora);
  if (Number.isNaN(parado)) {
    if (diasDesde(c.criado_em, agora) >= 3) a.push({ tipo: "nunca_usou", nivel: "aviso", texto: "Cadastrada há mais de 3 dias e a extensão nunca chamou o Conector." });
  } else if (parado >= 7) a.push({ tipo: "parada", nivel: "critico", texto: `Sem uso há ${parado} dias.` });
  else if (parado >= 3) a.push({ tipo: "parada", nivel: "aviso", texto: `Sem uso há ${parado} dias.` });
  else if (emExpediente(agora) && (c.erros_erp?.chamadas ?? 0) / p.dias >= USO_DIARIO) {
    // Clínica em uso que de repente para no meio do expediente: extensão que não abre (endereço, instalação)
    // ou Conector fora do ar para ela. Pega em horas o que o alerta de parada só veria em dias.
    const horas = Math.floor((agora - ms(c.ultimo_uso_em)) / 3600000);
    if (horas >= HORAS_SEM_USO) a.push({ tipo: "sem_uso_expediente", nivel: "aviso", texto: `Nenhuma chamada há ${horas} h, em horário de expediente. Confira se o ClinFy abre na Kentro da clínica.` });
  }
  if (!c.tem_credencial) a.push({ tipo: "sem_credencial", nivel: "critico", texto: "Sem o acesso ao sistema (ERP) cadastrado." });

  const ok = Object.values(c.acoes).reduce((s, n) => s + n, 0);
  if (ok + c.incertos >= 20 && c.incertos / (ok + c.incertos) > 0.05) {
    a.push({ tipo: "incertos_altos", nivel: "aviso", texto: `${c.incertos} gravações sem confirmação do sistema (${pct(c.incertos, ok + c.incertos)}).` });
  }
  const tentadas = c.confirmacoes.enviadas + c.confirmacoes.falharam;
  if (tentadas >= 10 && c.confirmacoes.falharam / tentadas > 0.1) {
    a.push({ tipo: "confirmacao_falhando", nivel: "aviso", texto: `${c.confirmacoes.falharam} confirmações não entregues (${pct(c.confirmacoes.falharam, tentadas)}).` });
  }
  if (c.confirmacao_ligada && p.dias >= 7 && tentadas === 0) {
    a.push({ tipo: "confirmacao_parada", nivel: "aviso", texto: "Confirmação automática ligada, mas nenhuma saiu no período." });
  }
  if (c.volume_anterior >= 20 && c.volume < c.volume_anterior * 0.5) {
    a.push({ tipo: "queda_uso", nivel: "aviso", texto: `Uso caiu ${pct(c.volume_anterior - c.volume, c.volume_anterior)} em relação ao período anterior.` });
  }
  const ee = c.erros_erp;
  if (ee && ee.total >= 10 && ee.chamadas && ee.total / ee.chamadas > 0.1) {
    const mais = ee.principais[0] ? ` Mais comum: ${ee.principais[0].erro}.` : "";
    a.push({ tipo: "erp_erro_alto", nivel: ee.total / ee.chamadas > 0.3 ? "critico" : "aviso", texto: `${ee.total} falhas do sistema (ERP) em ${ee.chamadas} chamadas (${pct(ee.total, ee.chamadas)}).${mais}` });
  }
  if (c.versao?.antiga) {
    a.push({ tipo: "versao_antiga", nivel: "aviso", texto: `Extensão na versão ${c.versao.extensao}; a atual é ${c.versao.atual}. Recarregue o ClinFy na Kentro.` });
  }
  return a;
}

const pct = (n: number, d: number) => `${Math.round((n / d) * 100)}%`;

/* ---------- consultas (uma por trilha, todas as clínicas de uma vez) ---------- */
export async function lerUso(pool: Pool, p: PeriodoUso): Promise<EntradaUso> {
  const dia = (col: string) => `(${col} AT TIME ZONE '${FUSO}')::date`;
  // Filtro por instante (meia-noite de $1 até a de $2 + 1 dia, no fuso da clínica): usa os índices de criado_em.
  const entre = (col: string) => `${col} >= ($1::date::timestamp AT TIME ZONE '${FUSO}') AND ${col} < (($2::date + 1)::timestamp AT TIME ZONE '${FUSO}')`;
  const desde = [p.anterior_inicio, p.fim];
  const atual = [p.inicio, p.fim];
  const [tenants, agendamentos, cobrancas, confirmacoes, atendimentos, usuarios, ultimas, eventos] = await Promise.all([
    pool.query<TenantUso>(
      `SELECT id, nome, ativo, erp, criado_em, ultimo_uso_em, desligado_em,
              asa_credencial_cifrada IS NOT NULL AS tem_credencial, confirmacao, financeiro,
              extensao_versao, extensao_versao_em
       FROM tenants`),
    pool.query(
      `SELECT tenant_id, to_char(${dia("criado_em")}, 'YYYY-MM-DD') AS dia, tipo, situacao, count(*)::int AS n
       FROM agendamentos WHERE ${entre("criado_em")} GROUP BY 1, 2, 3, 4`, desde),
    pool.query(
      `SELECT tenant_id, to_char(${dia("criado_em")}, 'YYYY-MM-DD') AS dia, situacao, count(*)::int AS n, sum(valor)::text AS total
       FROM cobrancas WHERE ${entre("criado_em")} GROUP BY 1, 2, 3`, desde),
    pool.query(
      `SELECT tenant_id, estado, resposta, origem, count(*)::int AS n FROM confirmacoes
       WHERE estado IN ('enviado', 'respondido', 'falhou') AND ${entre("coalesce(enviado_em, atualizado_em)")}
       GROUP BY 1, 2, 3, 4`, atual),
    pool.query(
      `SELECT tenant_id, to_char(data, 'YYYY-MM-DD') AS dia, count(*)::int AS n FROM atendimentos
       WHERE chegada IS NOT NULL AND data BETWEEN $1 AND $2 GROUP BY 1, 2`, desde),
    // Atendentes distintos no período, somando as trilhas sem contar a mesma pessoa duas vezes.
    pool.query(
      `SELECT tenant_id, count(DISTINCT regexp_replace(u, '^\\d+\\s+', ''))::int AS n FROM (
         SELECT tenant_id, usuario AS u FROM agendamentos WHERE ${entre("criado_em")}
         UNION ALL SELECT tenant_id, usuario FROM cobrancas WHERE ${entre("criado_em")}
         UNION ALL SELECT tenant_id, chegada_por FROM atendimentos WHERE data BETWEEN $1 AND $2
         UNION ALL SELECT tenant_id, chamada_por FROM atendimentos WHERE data BETWEEN $1 AND $2
         UNION ALL SELECT tenant_id, solicitado_por FROM confirmacoes WHERE ${entre("criado_em")}
       ) x WHERE coalesce(trim(u), '') <> '' GROUP BY 1`, atual),
    // Última ação gravada pelo ClinFy (o ultimo_uso_em conta também leituras, com precisão de 1 h).
    pool.query(
      `SELECT tenant_id, max(m) AS ultima FROM (
         SELECT tenant_id, max(criado_em) AS m FROM agendamentos GROUP BY 1
         UNION ALL SELECT tenant_id, max(criado_em) FROM cobrancas GROUP BY 1
         UNION ALL SELECT tenant_id, max(coalesce(fim, chamada, chegada)) FROM atendimentos GROUP BY 1
       ) x GROUP BY 1`),
    pool.query(
      `SELECT tenant_id, evento, sum(n)::int AS n FROM uso_diario WHERE dia BETWEEN $1 AND $2 GROUP BY 1, 2`, atual),
  ]);
  return {
    tenants: tenants.rows, agendamentos: agendamentos.rows, cobrancas: cobrancas.rows,
    confirmacoes: confirmacoes.rows, atendimentos: atendimentos.rows, usuarios: usuarios.rows, ultimas: ultimas.rows,
    eventos: eventos.rows,
  };
}
