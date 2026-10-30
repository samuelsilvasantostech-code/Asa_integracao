import type { FastifyInstance } from "fastify";
import * as C from "../confirmacao.js";
import { pool } from "../db.js";
import { tenantDaRequisicao } from "../tenant-auth.js";

// Painel do administrador (tela "Painel Asa"): números do que passou pela Kentro num período.
// Lê só as trilhas do Conector (agendamentos, confirmacoes, cobrancas); não chama a Asa.
// A ocupação da agenda é montada pela tela, com /v1/agenda/dia de cada profissional.

const FUSO = "America/Sao_Paulo";
export const DIAS_PERMITIDOS = [1, 7, 15, 30, 90];

// Últimos `dias` dias até hoje, inclusive. Valor fora da lista vira 7.
export function periodo(hoje: string, dias: unknown): { dias: number; inicio: string; fim: string } {
  const n = DIAS_PERMITIDOS.includes(Number(dias)) ? Number(dias) : 7;
  const [a, m, d] = hoje.split("-").map(Number);
  const inicio = new Date(Date.UTC(a, m - 1, d - (n - 1))).toISOString().slice(0, 10);
  return { dias: n, inicio, fim: hoje };
}

// "123 Maria Souza" (id + nome do usuário do Kentro, como a extensão grava) → "Maria Souza".
export function nomeDoUsuario(u: string | null): string {
  const s = String(u ?? "").trim();
  if (!s) return "Sem identificação";
  return s.replace(/^\d+\s+/, "") || s;
}

export async function painelRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { dias?: string } }>("/v1/painel/resumo", async (req, reply) => {
    const t = await tenantDaRequisicao(req, reply);
    if (!t) return;
    const hoje = C.hojeEm(new Date());
    const p = periodo(hoje, req.query.dias);
    const args = [t.id, p.inicio, p.fim];
    const dia = (col: string) => `(${col} AT TIME ZONE '${FUSO}')::date`;

    const [conf, confDia, tratar, ativ, ativDia, ativUsr, incertos, cob, cobUsr] = await Promise.all([
      // Confirmações que saíram no período e o que o paciente respondeu.
      pool!.query<{ estado: string; resposta: string | null; origem: string; n: number }>(
        `SELECT estado, resposta, origem, count(*)::int AS n FROM confirmacoes
         WHERE tenant_id = $1 AND ${dia("coalesce(enviado_em, atualizado_em)")} BETWEEN $2 AND $3
           AND estado IN ('enviado', 'respondido', 'falhou')
         GROUP BY 1, 2, 3`, args),
      pool!.query<{ dia: string; enviadas: number; confirmadas: number }>(
        `SELECT to_char(${dia("enviado_em")}, 'YYYY-MM-DD') AS dia, count(*)::int AS enviadas,
                count(*) FILTER (WHERE resposta = 'confirmar')::int AS confirmadas
         FROM confirmacoes WHERE tenant_id = $1 AND enviado_em IS NOT NULL AND ${dia("enviado_em")} BETWEEN $2 AND $3
         GROUP BY 1 ORDER BY 1`, args),
      // Consultas futuras que pedem um contato da equipe: pediu para remarcar, cancelou ou não recebeu.
      pool!.query(
        `SELECT agendamento_id, to_char(data, 'YYYY-MM-DD') AS data, hora, prestador, nome, telefone, estado, resposta,
                origem, respondido_em
         FROM confirmacoes
         WHERE tenant_id = $1 AND data >= $2::date
           AND ((estado = 'respondido' AND resposta IN ('remarcar', 'cancelar')) OR estado = 'falhou')
         ORDER BY data, hora LIMIT 100`, [t.id, hoje]),
      pool!.query<{ tipo: string; situacao: string; n: number }>(
        `SELECT tipo, situacao, count(*)::int AS n FROM agendamentos
         WHERE tenant_id = $1 AND ${dia("criado_em")} BETWEEN $2 AND $3 GROUP BY 1, 2`, args),
      pool!.query<{ dia: string; tipo: string; n: number }>(
        `SELECT to_char(${dia("criado_em")}, 'YYYY-MM-DD') AS dia, tipo, count(*)::int AS n FROM agendamentos
         WHERE tenant_id = $1 AND situacao = 'ok' AND ${dia("criado_em")} BETWEEN $2 AND $3 GROUP BY 1, 2 ORDER BY 1`, args),
      pool!.query<{ usuario: string | null; tipo: string; n: number }>(
        `SELECT usuario, tipo, count(*)::int AS n FROM agendamentos
         WHERE tenant_id = $1 AND situacao = 'ok' AND ${dia("criado_em")} BETWEEN $2 AND $3 GROUP BY 1, 2`, args),
      pool!.query(
        `SELECT tipo, prestador_id, to_char(data, 'YYYY-MM-DD') AS data, horario, usuario, diagnostico, criado_em
         FROM agendamentos WHERE tenant_id = $1 AND situacao = 'incerto' AND ${dia("criado_em")} BETWEEN $2 AND $3
         ORDER BY criado_em DESC LIMIT 30`, args),
      pool!.query<{ forma: string; situacao: string; n: number; total: string }>(
        `SELECT forma, situacao, count(*)::int AS n, sum(valor)::text AS total FROM cobrancas
         WHERE tenant_id = $1 AND ${dia("criado_em")} BETWEEN $2 AND $3 GROUP BY 1, 2`, args),
      pool!.query<{ usuario: string | null; n: number; total: string }>(
        `SELECT usuario, count(*)::int AS n, sum(valor)::text AS total FROM cobrancas
         WHERE tenant_id = $1 AND situacao = 'ok' AND ${dia("criado_em")} BETWEEN $2 AND $3 GROUP BY 1`, args),
    ]);

    // Confirmações: um número por desfecho.
    const c = { enviadas: 0, confirmadas: 0, remarcar: 0, canceladas: 0, sem_resposta: 0, falharam: 0, manuais: 0 };
    for (const r of conf.rows) {
      if (r.estado === "falhou") { c.falharam += r.n; continue; }
      c.enviadas += r.n;
      if (r.origem === "manual") c.manuais += r.n;
      if (r.estado === "enviado") c.sem_resposta += r.n;
      else if (r.resposta === "confirmar") c.confirmadas += r.n;
      else if (r.resposta === "remarcar") c.remarcar += r.n;
      else if (r.resposta === "cancelar") c.canceladas += r.n;
    }

    // Atividade: por tipo (só o que a Asa gravou) e por atendente.
    const porTipo: Record<string, number> = { criar: 0, remarcar: 0, cancelar: 0, confirmar: 0, ausente: 0 };
    let incertas = 0;
    for (const r of ativ.rows) {
      if (r.situacao === "ok") porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + r.n;
      if (r.situacao === "incerto") incertas += r.n;
    }
    const dias: Record<string, Record<string, number>> = {};
    for (const r of ativDia.rows) (dias[r.dia] ??= {})[r.tipo] = r.n;
    const equipe = new Map<string, { usuario: string; acoes: Record<string, number>; cobrancas: number; valor: number }>();
    const membro = (u: string | null) => {
      const nome = nomeDoUsuario(u);
      if (!equipe.has(nome)) equipe.set(nome, { usuario: nome, acoes: {}, cobrancas: 0, valor: 0 });
      return equipe.get(nome)!;
    };
    for (const r of ativUsr.rows) { const m = membro(r.usuario); m.acoes[r.tipo] = (m.acoes[r.tipo] ?? 0) + r.n; }
    for (const r of cobUsr.rows) { const m = membro(r.usuario); m.cobrancas += r.n; m.valor += Number(r.total); }

    const formas: Record<string, { n: number; total: number }> = {};
    let cobIncertas = 0;
    for (const r of cob.rows) {
      if (r.situacao === "ok") formas[r.forma] = { n: (formas[r.forma]?.n ?? 0) + r.n, total: (formas[r.forma]?.total ?? 0) + Number(r.total) };
      if (r.situacao === "incerto") cobIncertas += r.n;
    }

    return {
      periodo: p,
      hoje,
      confirmacoes: { ...c, por_dia: confDia.rows, a_tratar: tratar.rows },
      atividade: {
        por_tipo: porTipo,
        incertas,
        por_dia: Object.keys(dias).sort().map((d) => ({ dia: d, ...dias[d] })),
        equipe: [...equipe.values()].sort((a, b) => total(b) - total(a)),
      },
      cobrancas: {
        formas,
        total: Object.values(formas).reduce((s, f) => s + f.total, 0),
        quantidade: Object.values(formas).reduce((s, f) => s + f.n, 0),
        incertas: cobIncertas,
      },
      alertas: { agendamentos_incertos: incertos.rows },
    };
  });
}

function total(m: { acoes: Record<string, number>; cobrancas: number }) {
  return Object.values(m.acoes).reduce((s, n) => s + n, 0) + m.cobrancas;
}
