import type { FastifyInstance } from "fastify";
import { hojeEm } from "../confirmacao.js";
import { pool } from "../db.js";
import { lerUso, montarUso, periodoUso } from "../uso.js";

// Aba "Uso" da implantação: como cada clínica usa o ClinFy. Registrada dentro de adminRoutes, que
// aplica a proteção (sessão ou ADMIN_KEY) e confere o banco antes de chegar aqui.
export async function usoAdmin(app: FastifyInstance) {
  app.get<{ Querystring: { dias?: string } }>("/admin/uso", async (req) => {
    const agora = new Date();
    const p = periodoUso(hojeEm(agora), req.query.dias);
    return montarUso(await lerUso(pool!, p), p, agora);
  });
}
