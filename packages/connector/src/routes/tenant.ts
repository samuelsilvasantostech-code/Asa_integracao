import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { instituicaoDa, listarPrestadores, type CredencialAsa } from "../asa.js";
import { cifraDisponivel, cifrar, decifrar } from "../crypto.js";
import { pool } from "../db.js";

const hash = (valor: string) => createHash("sha256").update(valor).digest("hex");

interface Tenant {
  id: string;
  nome: string;
  credencial: Buffer | null;
}

// Identifica a clínica pela chave da instalação. Responde o erro e devolve null quando não dá.
async function tenantDaRequisicao(req: FastifyRequest, reply: FastifyReply): Promise<Tenant | null> {
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

export async function tenantRoutes(app: FastifyInstance) {
  // Confirma a clínica e, se houver credencial, testa de verdade na Asa.
  app.get("/v1/tenant/conexao/teste", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    const base = { tenant: { id: tenant.id, nome: tenant.nome } };
    if (!tenant.credencial) return { ...base, asa: "credencial_ausente" };

    let credencial: CredencialAsa;
    try {
      credencial = JSON.parse(decifrar(tenant.credencial));
    } catch (err) {
      req.log.error({ err }, "falha ao decifrar credencial");
      return { ...base, asa: "erro_interno" };
    }
    const r = await listarPrestadores(credencial);
    if (r.ok) return { ...base, asa: "ok", instituicao_id: instituicaoDa(credencial) };
    req.log.warn({ erro: r.erro, status: r.status }, "teste de conexão com a Asa falhou");
    return { ...base, asa: r.erro === "ASA_CREDENCIAL_INVALIDA" ? "credencial_invalida" : "fora_do_ar", erro: r.erro };
  });

  // Grava o token da Asa da clínica. Só grava se a Asa aceitar; nunca devolve o token.
  app.put<{ Body: { token?: string } }>("/v1/tenant/credencial", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    if (!cifraDisponivel()) return reply.code(503).send({ erro: "CIFRA_NAO_CONFIGURADA" });

    const token = String(req.body?.token ?? "").trim();
    if (!token || /\s/.test(token)) return reply.code(400).send({ erro: "DADOS_INVALIDOS" });

    const credencial: CredencialAsa = { token };
    const instituicao_id = instituicaoDa(credencial);
    const r = await listarPrestadores(credencial);
    if (!r.ok) {
      const status = r.erro === "ASA_CREDENCIAL_INVALIDA" ? 422 : 502;
      return reply.code(status).send({ erro: r.erro });
    }

    await pool!.query("UPDATE tenants SET asa_credencial_cifrada = $1, atualizado_em = now() WHERE id = $2", [
      cifrar(JSON.stringify(credencial)),
      tenant.id,
    ]);
    req.log.info({ tenant: tenant.id, instituicao_id }, "credencial da Asa gravada");
    return { ok: true, instituicao_id, prestadores: r.dados.prestadores?.length ?? 0 };
  });
}
