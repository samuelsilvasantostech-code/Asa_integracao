import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { hojeEm } from "../confirmacao.js";
import { pool } from "../db.js";
import { lerUso, MAX_DIAS_USO, montarUso, periodoPersonalizado, periodoUso } from "../uso.js";

// Aba "Uso" da implantação: como cada clínica usa o ClinFy. Registrada dentro de adminRoutes, que
// aplica a proteção (sessão ou ADMIN_KEY) e confere o banco antes de chegar aqui.
export async function usoAdmin(app: FastifyInstance) {
  // ?dias=7|30|90 (até hoje) ou ?inicio=AAAA-MM-DD&fim=AAAA-MM-DD (até 400 dias atrás).
  app.get<{ Querystring: { dias?: string; inicio?: string; fim?: string } }>("/admin/uso", async (req, reply) => {
    const agora = new Date(), hoje = hojeEm(agora);
    const pediuDatas = req.query.inicio !== undefined || req.query.fim !== undefined;
    const p = pediuDatas ? periodoPersonalizado(hoje, req.query.inicio, req.query.fim) : periodoUso(hoje, req.query.dias);
    if (!p) return reply.code(400).send({ erro: "PERIODO_INVALIDO", max_dias: MAX_DIAS_USO });
    return montarUso(await lerUso(pool!, p), p, agora, config.version);
  });
}
