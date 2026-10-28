import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { CredencialAsa } from "./asa.js";
import { decifrar } from "./crypto.js";
import { pool } from "./db.js";

const hash = (valor: string) => createHash("sha256").update(valor).digest("hex");

export interface Tenant {
  id: string;
  nome: string;
  credencial: Buffer | null;
}

// Identifica a clínica pela chave da instalação. Responde o erro e devolve null quando não dá.
export async function tenantDaRequisicao(req: FastifyRequest, reply: FastifyReply): Promise<Tenant | null> {
  const chave = req.headers["x-install-key"];
  if (typeof chave !== "string" || !chave) {
    reply.code(401).send({ erro: "CHAVE_AUSENTE" });
    return null;
  }
  if (!pool) {
    reply.code(503).send({ erro: "BANCO_NAO_CONFIGURADO" });
    return null;
  }
  const { rows } = await pool.query<{ id: string; nome: string; ativo: boolean; asa_credencial_cifrada: Buffer | null }>(
    "SELECT id, nome, ativo, asa_credencial_cifrada FROM tenants WHERE chave_instalacao_hash = $1",
    [hash(chave)],
  );
  const t = rows[0];
  if (!t || !t.ativo) {
    reply.code(401).send({ erro: "CHAVE_INVALIDA" });
    return null;
  }
  return { id: t.id, nome: t.nome, credencial: t.asa_credencial_cifrada };
}

// Clínica + credencial da Asa decifrada, para as rotas que falam com a Asa.
export async function tenantComCredencial(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ tenant: Tenant; credencial: CredencialAsa } | null> {
  const tenant = await tenantDaRequisicao(req, reply);
  if (!tenant) return null;
  if (!tenant.credencial) {
    reply.code(409).send({ erro: "CREDENCIAL_AUSENTE" });
    return null;
  }
  try {
    return { tenant, credencial: JSON.parse(decifrar(tenant.credencial)) };
  } catch (err) {
    req.log.error({ err }, "falha ao decifrar credencial");
    reply.code(500).send({ erro: "ERRO_INTERNO" });
    return null;
  }
}

export async function credencialDaRequisicao(req: FastifyRequest, reply: FastifyReply): Promise<CredencialAsa | null> {
  return (await tenantComCredencial(req, reply))?.credencial ?? null;
}
