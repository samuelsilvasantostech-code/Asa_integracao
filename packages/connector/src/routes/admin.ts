import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { pool } from "../db.js";

const hash = (valor: string) => createHash("sha256").update(valor).digest("hex");

function adminAutorizado(req: FastifyRequest): boolean {
  const recebida = req.headers["x-admin-key"];
  if (!config.adminKey || typeof recebida !== "string") return false;
  const a = Buffer.from(hash(recebida));
  const b = Buffer.from(hash(config.adminKey));
  return timingSafeEqual(a, b);
}

// Cadastro de clientes pela implantação. A chave da instalação é devolvida uma única vez;
// o banco guarda só o hash.
export async function adminRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/admin/")) return;
    if (!adminAutorizado(req)) return reply.code(401).send({ erro: "NAO_AUTORIZADO" });
    if (!pool) return reply.code(503).send({ erro: "BANCO_NAO_CONFIGURADO" });
  });

  app.get("/admin/tenants", async () => {
    const { rows } = await pool!.query(
      "SELECT id, nome, ativo, asa_credencial_cifrada IS NOT NULL AS tem_credencial, criado_em FROM tenants ORDER BY criado_em",
    );
    return { tenants: rows };
  });

  app.post<{ Body: { nome?: string } }>("/admin/tenants", async (req, reply) => {
    const nome = req.body?.nome?.trim();
    if (!nome) return reply.code(400).send({ erro: "NOME_OBRIGATORIO" });
    const chave = "asa_" + randomBytes(24).toString("base64url");
    const { rows } = await pool!.query<{ id: string }>(
      "INSERT INTO tenants (nome, chave_instalacao_hash) VALUES ($1, $2) RETURNING id",
      [nome, hash(chave)],
    );
    return reply.code(201).send({ id: rows[0].id, nome, chave_instalacao: chave });
  });

  // Gera uma chave nova e invalida a anterior.
  app.post<{ Params: { id: string } }>("/admin/tenants/:id/rotacionar-chave", async (req, reply) => {
    const chave = "asa_" + randomBytes(24).toString("base64url");
    const { rowCount } = await pool!.query(
      "UPDATE tenants SET chave_instalacao_hash = $1, atualizado_em = now() WHERE id = $2",
      [hash(chave), req.params.id],
    );
    if (!rowCount) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
    return { id: req.params.id, chave_instalacao: chave };
  });
}
