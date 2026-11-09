import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { decifrar } from "./crypto.js";
import { pool } from "./db.js";
import { criarAdaptador, type ErpAdapter } from "./erp/index.js";
import { precisaMarcarUso } from "./implantacao.js";

const hash = (valor: string) => createHash("sha256").update(valor).digest("hex");

export interface Tenant {
  id: string;
  nome: string;
  erp: string; // qual ERP a clínica usa (erp/index.ts)
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
  const { rows } = await pool.query<{ id: string; nome: string; ativo: boolean; erp: string; asa_credencial_cifrada: Buffer | null; ultimo_uso_em: Date | null }>(
    "SELECT id, nome, ativo, erp, asa_credencial_cifrada, ultimo_uso_em FROM tenants WHERE chave_instalacao_hash = $1",
    [hash(chave)],
  );
  const t = rows[0];
  if (!t || !t.ativo) {
    reply.code(401).send({ erro: "CHAVE_INVALIDA" });
    return null;
  }
  // Último uso, para a página de implantação. Sem esperar: uma falha aqui não derruba a chamada.
  if (precisaMarcarUso(t.ultimo_uso_em, new Date())) {
    pool.query("UPDATE tenants SET ultimo_uso_em = now() WHERE id = $1", [t.id]).catch((err) => {
      req.log.warn({ err, tenant: t.id }, "falha ao marcar o último uso");
    });
  }
  return { id: t.id, nome: t.nome, erp: t.erp, credencial: t.asa_credencial_cifrada };
}

// Adaptador do ERP da clínica, com a credencial decifrada. Responde o erro e devolve null quando não dá.
function adaptadorDe(req: FastifyRequest, reply: FastifyReply, erp: string, cifrada: Buffer | null): ErpAdapter | null {
  if (!cifrada) {
    reply.code(409).send({ erro: "CREDENCIAL_AUSENTE" });
    return null;
  }
  try {
    return criarAdaptador(erp, JSON.parse(decifrar(cifrada)), req.log);
  } catch (err) {
    req.log.error({ err, erp }, "falha ao abrir a credencial ou o adaptador do ERP");
    reply.code(500).send({ erro: "ERRO_INTERNO" });
    return null;
  }
}

// Clínica + adaptador do ERP dela, para as rotas que falam com o ERP.
export async function tenantComErp(req: FastifyRequest, reply: FastifyReply): Promise<{ tenant: Tenant; erp: ErpAdapter } | null> {
  const tenant = await tenantDaRequisicao(req, reply);
  if (!tenant) return null;
  const erp = adaptadorDe(req, reply, tenant.erp, tenant.credencial);
  return erp ? { tenant, erp } : null;
}

export async function erpDaRequisicao(req: FastifyRequest, reply: FastifyReply): Promise<ErpAdapter | null> {
  return (await tenantComErp(req, reply))?.erp ?? null;
}

export interface TenantAutomacao {
  id: string;
  nome: string;
  confirmacao: unknown;
  erp: ErpAdapter;
}

// Identifica a clínica pela chave da automação (header x-automation-key). Essa chave vale só nas
// rotas de confirmação: fica gravada no fluxo da Kentro, que os administradores leem.
export async function tenantDaAutomacao(req: FastifyRequest, reply: FastifyReply): Promise<TenantAutomacao | null> {
  const chave = req.headers["x-automation-key"];
  if (typeof chave !== "string" || !chave) {
    reply.code(401).send({ erro: "CHAVE_AUSENTE" });
    return null;
  }
  if (!pool) {
    reply.code(503).send({ erro: "BANCO_NAO_CONFIGURADO" });
    return null;
  }
  const { rows } = await pool.query<{ id: string; nome: string; ativo: boolean; confirmacao: unknown; erp: string; asa_credencial_cifrada: Buffer | null }>(
    "SELECT id, nome, ativo, confirmacao, erp, asa_credencial_cifrada FROM tenants WHERE chave_automacao_hash = $1",
    [hash(chave)],
  );
  const t = rows[0];
  if (!t || !t.ativo) {
    reply.code(401).send({ erro: "CHAVE_INVALIDA" });
    return null;
  }
  const erp = adaptadorDe(req, reply, t.erp, t.asa_credencial_cifrada);
  if (!erp) return null;
  return { id: t.id, nome: t.nome, confirmacao: t.confirmacao, erp };
}
