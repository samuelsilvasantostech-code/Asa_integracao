import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { ACOES, aplicar, emJson, ETAPAS, horaNoDia, VAZIO, type Acao, type Etapa, type Tempos } from "../atendimento.js";
import { hojeEm } from "../confirmacao.js";
import { tenantDaRequisicao } from "../tenant-auth.js";
import { dataValida, idValido } from "./consulta.js";

// Tempo de espera: a recepção marca chegada, chamada e fim de uma consulta de HOJE. Fica só no banco do
// Conector; o ERP não é chamado (a resposta é imediata e vale para qualquer sistema).

interface Linha { chegada: Date | null; chamada: Date | null; fim: Date | null }

// Tempos das consultas de uma lista, para a agenda do dia.
export async function atendimentosDe(tenantId: string, ids: string[]) {
  const mapa = new Map<string, ReturnType<typeof emJson>>();
  if (!ids.length || !pool) return mapa;
  const { rows } = await pool.query<Linha & { agendamento_id: string }>(
    "SELECT agendamento_id, chegada, chamada, fim FROM atendimentos WHERE tenant_id = $1 AND agendamento_id = ANY($2::text[])",
    [tenantId, ids],
  );
  for (const r of rows) mapa.set(r.agendamento_id, emJson(r));
  return mapa;
}

export async function atendimentoRoutes(app: FastifyInstance) {
  app.post<{
    Params: { id: string };
    Body: { acao?: string; etapa?: string; hora?: string; prestador_id?: string; data?: string; hora_marcada?: string; usuario?: string };
  }>("/v1/atendimentos/:id", async (req, reply) => {
    const id = req.params.id;
    const b = req.body ?? {};
    const acao = b.acao as Acao;
    if (!idValido(id) || !ACOES.includes(acao) || !idValido(b.prestador_id) || !b.data || !dataValida(b.data)) {
      return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    }
    const etapa = b.etapa as Etapa | undefined;
    let hora: Date | null = null;
    if (acao === "ajustar") {
      hora = etapa && ETAPAS.includes(etapa) && typeof b.hora === "string" ? horaNoDia(b.data, b.hora) : null;
      if (!hora) return reply.code(400).send({ erro: "HORA_INVALIDA" });
    }
    const marcada = typeof b.hora_marcada === "string" && /^\d{2}:\d{2}$/.test(b.hora_marcada) ? b.hora_marcada : null;
    const usuario = b.usuario ? String(b.usuario).slice(0, 120) : null;

    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    // Só o dia de hoje: chegada num dia que não é hoje é engano (e estragaria o relatório).
    if (b.data !== hojeEm(new Date())) return reply.code(409).send({ erro: "SO_HOJE" });

    const db = await pool!.connect();
    try {
      await db.query("BEGIN");
      const { rows } = await db.query<Linha>(
        "SELECT chegada, chamada, fim FROM atendimentos WHERE tenant_id = $1 AND agendamento_id = $2 FOR UPDATE",
        [tenant.id, id],
      );
      const atual: Tempos = rows[0] ?? VAZIO;
      const r = aplicar(atual, acao, new Date(), etapa, hora ?? undefined);
      if (!r.ok) {
        await db.query("ROLLBACK");
        return reply.code(409).send({ erro: r.erro, atendimento: emJson(atual) });
      }
      if (r.mudou) {
        if (!r.tempos.chegada) {
          await db.query("DELETE FROM atendimentos WHERE tenant_id = $1 AND agendamento_id = $2", [tenant.id, id]);
        } else {
          // Quem marcou: só a etapa marcada agora (ou ajustada) troca de autor; desfazer apaga o da etapa.
          const por = (e: Etapa) => (r.etapa === e ? (r.tempos[e] ? usuario : null) : undefined);
          await db.query(
            `INSERT INTO atendimentos (tenant_id, agendamento_id, prestador_id, data, hora_marcada, chegada, chamada, fim, chegada_por, chamada_por, fim_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (tenant_id, agendamento_id) DO UPDATE SET
               prestador_id = EXCLUDED.prestador_id, data = EXCLUDED.data,
               hora_marcada = COALESCE(EXCLUDED.hora_marcada, atendimentos.hora_marcada),
               chegada = EXCLUDED.chegada, chamada = EXCLUDED.chamada, fim = EXCLUDED.fim,
               chegada_por = CASE WHEN $12 THEN EXCLUDED.chegada_por ELSE atendimentos.chegada_por END,
               chamada_por = CASE WHEN $13 THEN EXCLUDED.chamada_por ELSE atendimentos.chamada_por END,
               fim_por = CASE WHEN $14 THEN EXCLUDED.fim_por ELSE atendimentos.fim_por END,
               atualizado_em = now()`,
            [
              tenant.id, id, b.prestador_id, b.data, marcada, r.tempos.chegada, r.tempos.chamada, r.tempos.fim,
              por("chegada") ?? null, por("chamada") ?? null, por("fim") ?? null,
              por("chegada") !== undefined, por("chamada") !== undefined, por("fim") !== undefined,
            ],
          );
        }
      }
      await db.query("COMMIT");
      if (r.mudou) req.log.info({ tenant: tenant.id, agendamento: id, acao, etapa: r.etapa, usuario }, "tempo de espera: etapa marcada");
      return { ok: true, atendimento: emJson(r.tempos), agora: new Date().toISOString() };
    } catch (err) {
      await db.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      db.release();
    }
  });
}
