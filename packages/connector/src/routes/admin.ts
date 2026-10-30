import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { pool } from "../db.js";
import { gravarCredencial } from "./tenant.js";

const hash = (valor: string) => createHash("sha256").update(valor).digest("hex");

export function adminAutorizado(req: FastifyRequest): boolean {
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

  app.patch<{ Params: { id: string }; Body: { nome?: string; ativo?: boolean } }>("/admin/tenants/:id", async (req, reply) => {
    const nome = req.body?.nome?.trim();
    const ativo = req.body?.ativo;
    if (!nome && typeof ativo !== "boolean") return reply.code(400).send({ erro: "NADA_PARA_ALTERAR" });
    const { rows } = await pool!.query(
      `UPDATE tenants SET nome = COALESCE($1, nome), ativo = COALESCE($2, ativo), atualizado_em = now()
       WHERE id = $3 RETURNING id, nome, ativo`,
      [nome || null, typeof ativo === "boolean" ? ativo : null, req.params.id],
    );
    if (!rows[0]) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
    return rows[0];
  });

  // Troca o token da Asa de uma clínica (validado na Asa antes de gravar).
  app.put<{ Params: { id: string }; Body: { token?: string } }>("/admin/tenants/:id/credencial", async (req, reply) =>
    gravarCredencial(req, reply, req.params.id, req.body?.token),
  );

  // Chave da automação de confirmação (só vale em /v1/confirmacao/*). Gerar de novo invalida a anterior.
  app.post<{ Params: { id: string } }>("/admin/tenants/:id/chave-automacao", async (req, reply) => {
    const chave = "asaauto_" + randomBytes(24).toString("base64url");
    const { rowCount } = await pool!.query(
      "UPDATE tenants SET chave_automacao_hash = $1, atualizado_em = now() WHERE id = $2",
      [hash(chave), req.params.id],
    );
    if (!rowCount) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
    return { id: req.params.id, chave_automacao: chave };
  });

  // Trilha da confirmação de véspera de uma clínica (sem nome nem CPF).
  app.get<{ Params: { id: string }; Querystring: { data?: string } }>("/admin/tenants/:id/confirmacoes", async (req) => {
    const { rows } = await pool!.query(
      `SELECT agendamento_id, to_char(data, 'YYYY-MM-DD') AS data, hora, estado, tentativas, resposta, erro, disparado_asa,
              enviado_em, respondido_em, atualizado_em
       FROM confirmacoes WHERE tenant_id = $1 AND ($2::date IS NULL OR data = $2::date)
       ORDER BY data DESC, hora LIMIT 500`,
      [req.params.id, req.query.data || null],
    );
    return { confirmacoes: rows };
  });

  // Últimas marcações pedidas pelo painel, com o diagnóstico das incertas (sem dados do paciente).
  app.get<{ Params: { id: string } }>("/admin/tenants/:id/agendamentos", async (req) => {
    const { rows } = await pool!.query(
      `SELECT tipo, situacao, prestador_id, to_char(data, 'YYYY-MM-DD') AS data, horario, paciente_id, agendamento_id,
              resposta->>'agendamento_id' AS numero_asa, diagnostico, criado_em, atualizado_em
       FROM agendamentos WHERE tenant_id = $1 ORDER BY criado_em DESC LIMIT 30`,
      [req.params.id],
    );
    return { agendamentos: rows };
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
