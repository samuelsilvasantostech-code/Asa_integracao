import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

const hash = (valor: string) => createHash("sha256").update(valor).digest("hex");

export async function tenantRoutes(app: FastifyInstance) {
  // Confirma que a chave da instalação identifica um cliente ativo.
  // A verificação da credencial na Asa entra junto com o cliente da Asa.
  app.get("/v1/tenant/conexao/teste", async (req, reply) => {
    const chave = req.headers["x-install-key"];
    if (typeof chave !== "string" || !chave) {
      return reply.code(401).send({ erro: "CHAVE_AUSENTE" });
    }
    if (!pool) {
      return reply.code(503).send({ erro: "BANCO_NAO_CONFIGURADO" });
    }
    const { rows } = await pool.query<{ id: string; nome: string; ativo: boolean; tem_credencial: boolean }>(
      "SELECT id, nome, ativo, asa_credencial_cifrada IS NOT NULL AS tem_credencial FROM tenants WHERE chave_instalacao_hash = $1",
      [hash(chave)],
    );
    const tenant = rows[0];
    if (!tenant || !tenant.ativo) {
      return reply.code(401).send({ erro: "CHAVE_INVALIDA" });
    }
    return {
      tenant: { id: tenant.id, nome: tenant.nome },
      asa: tenant.tem_credencial ? "credencial_cadastrada" : "credencial_ausente",
    };
  });
}
