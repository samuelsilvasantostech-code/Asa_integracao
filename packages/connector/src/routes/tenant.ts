import type { FastifyInstance } from "fastify";
import { instituicaoDa, listarPrestadores, type CredencialAsa } from "../asa.js";
import { cifraDisponivel, cifrar, decifrar } from "../crypto.js";
import { pool } from "../db.js";
import { tenantDaRequisicao } from "../tenant-auth.js";

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
