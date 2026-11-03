import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config, problemaDeConfig } from "../config.js";
import { CAMPOS, lerConfig, MAX_PARAMETROS, TEXTOS_PADRAO } from "../confirmacao.js";
import { pool } from "../db.js";
import { FORMAS, lerFinanceiro } from "../financeiro.js";
import { disparoUrlValida, idTenantValido, lerDadosTenant, type CampoTenant } from "../implantacao.js";
import { Limite } from "../limite.js";
import { gravarCredencial } from "./tenant.js";

const hash = (valor: string) => createHash("sha256").update(valor).digest("hex");

export function adminAutorizado(req: FastifyRequest): boolean {
  const recebida = req.headers["x-admin-key"];
  // Chave curta demais conta como ausente: o /admin fica fechado (ver problemaDeConfig).
  if (!config.adminKey || problemaDeConfig(config) || typeof recebida !== "string") return false;
  const a = Buffer.from(hash(recebida));
  const b = Buffer.from(hash(config.adminKey));
  return timingSafeEqual(a, b);
}

// Violação do índice único tenants_instalacao (mesma instalação da Kentro em dois tenants).
const instalacaoRepetida = (err: unknown) => (err as { code?: string })?.code === "23505";

// Corpo {config: {...}} das telas de configuração. null se não vier um objeto.
const configDoCorpo = (corpo: unknown) => {
  const c = corpo && typeof corpo === "object" ? (corpo as { config?: unknown }).config : undefined;
  return c && typeof c === "object" ? c : null;
};

// Cadastro de clientes pela implantação (página /implantacao ou curl). As chaves são devolvidas uma única
// vez; o banco guarda só o hash.
// Admin key errada repetida do mesmo IP: depois de 20 em 10 minutos, 429 antes de conferir a chave. Só aqui:
// o /admin é aberto direto pelo navegador da implantação. As chaves das clínicas chegam pelo proxy da Kentro
// (mesmo IP para todas), e um bloqueio por IP ali derrubaria clínicas inteiras por causa de uma chave velha.
// Só com TRUST_PROXY: sem ele, req.ip é o proxy do Doca.
const falhasPorIp = new Limite(20, 10 * 60 * 1000);

export async function adminRoutes(app: FastifyInstance) {
  // O hook fica preso a este plugin (sem fastify-plugin), então vale só nas rotas daqui. Não filtrar por
  // req.url: ela chega crua (/%61dmin/...) e o roteador decodifica, o que abria as rotas sem chave.
  app.addHook("onRequest", async (req, reply) => {
    if (config.trustProxy && falhasPorIp.excedido(req.ip)) return reply.code(429).send({ erro: "MUITAS_TENTATIVAS" });
    if (!adminAutorizado(req)) {
      if (config.trustProxy) falhasPorIp.registrar(req.ip);
      return reply.code(401).send({ erro: "NAO_AUTORIZADO" });
    }
    const id = (req.params as { id?: unknown } | undefined)?.id;
    if (id !== undefined && !idTenantValido(id)) return reply.code(400).send({ erro: "ID_INVALIDO" });
    if (!pool) return reply.code(503).send({ erro: "BANCO_NAO_CONFIGURADO" });
  });

  // Lista para a página de implantação: vínculo, estado da credencial, uso e configurações. Sem hash nem segredo.
  app.get("/admin/tenants", async () => {
    const { rows } = await pool!.query(
      `SELECT id, nome, ativo, asa_credencial_cifrada IS NOT NULL AS tem_credencial, criado_em,
              kentro_instancia, kentro_instalacao_id, asa_instituicao_id, implantado_por, credencial_gravada_em,
              credencial_origem, ultimo_uso_em, desligado_em, observacao,
              chave_automacao_hash IS NOT NULL AS tem_chave_automacao, disparo_url IS NOT NULL AS tem_disparo,
              disparo_url, confirmacao, financeiro
       FROM tenants ORDER BY criado_em`,
    );
    return {
      tenants: rows.map((t) => ({ ...t, confirmacao: lerConfig(t.confirmacao), financeiro: lerFinanceiro(t.financeiro) })),
      // O que a página precisa para montar os formulários de confirmação e financeiro.
      opcoes: { campos: CAMPOS, max_parametros: MAX_PARAMETROS, textos_padrao: TEXTOS_PADRAO, formas: FORMAS },
    };
  });

  app.post<{ Body: Record<string, unknown> }>("/admin/tenants", async (req, reply) => {
    const r = lerDadosTenant(req.body, ["nome", "kentro_instancia", "asa_instituicao_id", "implantado_por"]);
    if (!r.ok) return reply.code(400).send({ erro: r.erro === "NADA_PARA_ALTERAR" ? "NOME_OBRIGATORIO" : r.erro });
    const c = r.campos;
    if (!c.nome) return reply.code(400).send({ erro: "NOME_OBRIGATORIO" });
    const chave = "asa_" + randomBytes(24).toString("base64url");
    const { rows } = await pool!.query<{ id: string }>(
      `INSERT INTO tenants (nome, chave_instalacao_hash, kentro_instancia, asa_instituicao_id, implantado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [c.nome, hash(chave), c.kentro_instancia ?? null, c.asa_instituicao_id ?? null, c.implantado_por ?? null],
    );
    req.log.info({ tenant: rows[0].id, implantado_por: c.implantado_por }, "implantação: cliente criado");
    return reply.code(201).send({ id: rows[0].id, nome: c.nome, chave_instalacao: chave });
  });

  // Vínculo com a Kentro e a Asa, observação, nome e ativo. Só os campos enviados mudam; "" ou null limpa.
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/admin/tenants/:id", async (req, reply) => {
    const r = lerDadosTenant(req.body, ["nome", "ativo", "kentro_instancia", "kentro_instalacao_id", "asa_instituicao_id", "observacao"]);
    if (!r.ok) return reply.code(400).send({ erro: r.erro });
    // As colunas vêm da lista fixa de lerDadosTenant, nunca do corpo.
    const colunas = Object.keys(r.campos) as CampoTenant[];
    const sets = colunas.map((k, i) => `${k} = $${i + 2}`);
    // Religar um cliente desligado tira a marca de desligado (e o apagar histórico deixa de valer).
    if (r.campos.ativo === true) sets.push("desligado_em = NULL");
    try {
      const { rows } = await pool!.query(
        `UPDATE tenants SET ${sets.join(", ")}, atualizado_em = now() WHERE id = $1
         RETURNING id, nome, ativo, kentro_instancia, kentro_instalacao_id, asa_instituicao_id, observacao, desligado_em`,
        [req.params.id, ...colunas.map((k) => r.campos[k])],
      );
      if (!rows[0]) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
      req.log.info({ tenant: req.params.id, campos: colunas }, "implantação: cliente alterado");
      return rows[0];
    } catch (err) {
      if (instalacaoRepetida(err)) return reply.code(409).send({ erro: "INSTALACAO_JA_CADASTRADA" });
      throw err;
    }
  });

  // Troca o token da Asa de uma clínica (validado na Asa antes de gravar).
  app.put<{ Params: { id: string }; Body: { token?: string } }>("/admin/tenants/:id/credencial", async (req, reply) =>
    gravarCredencial(req, reply, req.params.id, req.body?.token, "implantacao"),
  );

  // Configuração da confirmação de véspera. Só a implantação grava (a extensão só lê, desde a 0.19.0).
  // O que vier fora do formato volta ao padrão (lerConfig, a mesma validação de sempre).
  app.put<{ Params: { id: string }; Body: { config?: unknown } }>("/admin/tenants/:id/confirmacao", async (req, reply) => {
    const bruto = configDoCorpo(req.body);
    if (!bruto) return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    const cfg = lerConfig(bruto);
    const { rowCount } = await pool!.query("UPDATE tenants SET confirmacao = $1, atualizado_em = now() WHERE id = $2", [cfg, req.params.id]);
    if (!rowCount) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
    req.log.info({ tenant: req.params.id, ativo: cfg.ativo, teste: cfg.teste.ativo }, "confirmação: configuração gravada pela implantação");
    return { ok: true, config: cfg };
  });

  // Financeiro (lançar conta a receber na Asa, sem volta). Só a implantação liga.
  app.put<{ Params: { id: string }; Body: { config?: unknown } }>("/admin/tenants/:id/financeiro", async (req, reply) => {
    const bruto = configDoCorpo(req.body);
    if (!bruto) return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    const cfg = lerFinanceiro(bruto);
    const { rowCount } = await pool!.query("UPDATE tenants SET financeiro = $1, atualizado_em = now() WHERE id = $2", [cfg, req.params.id]);
    if (!rowCount) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
    req.log.info({ tenant: req.params.id, ...cfg }, "financeiro: configuração gravada pela implantação");
    return { ok: true, config: cfg };
  });

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

  // Captura de webhook da Kentro que roda a automação de disparo na hora (botão "Enviar confirmação").
  // Só aceita o formato de captura da Kentro, em host da Kentro: o Conector faz POST nesse endereço.
  app.put<{ Params: { id: string }; Body: { url?: string } }>("/admin/tenants/:id/disparo", async (req, reply) => {
    const url = String(req.body?.url ?? "").trim();
    if (url && !disparoUrlValida(url)) return reply.code(400).send({ erro: "URL_INVALIDA" });
    const { rowCount } = await pool!.query("UPDATE tenants SET disparo_url = $1, atualizado_em = now() WHERE id = $2", [url || null, req.params.id]);
    if (!rowCount) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
    return { ok: true, disparo_url: url || null };
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

  // Saída do cliente: desliga e apaga de uma vez tudo o que dá acesso (token da Asa, chaves, captura).
  // A chave da instalação vira o hash de um valor aleatório que ninguém conhece. O histórico fica, até
  // DELETE /historico.
  app.post<{ Params: { id: string } }>("/admin/tenants/:id/desligar", async (req, reply) => {
    const { rows } = await pool!.query(
      `UPDATE tenants SET ativo = false, desligado_em = now(), asa_credencial_cifrada = NULL, chave_automacao_hash = NULL,
              disparo_url = NULL, chave_instalacao_hash = $2, atualizado_em = now()
       WHERE id = $1 RETURNING id, nome, desligado_em`,
      [req.params.id, hash(randomBytes(32).toString("base64url"))],
    );
    if (!rows[0]) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
    req.log.info({ tenant: req.params.id }, "implantação: cliente desligado");
    return { ok: true, ...rows[0] };
  });

  // Apaga as trilhas do cliente (agendamentos, confirmações, cobranças), só depois de desligado e com o
  // nome digitado igual. A linha em tenants fica, para registro.
  app.delete<{ Params: { id: string }; Body: { confirmar?: unknown } }>("/admin/tenants/:id/historico", async (req, reply) => {
    const db = await pool!.connect();
    try {
      await db.query("BEGIN");
      const { rows } = await db.query<{ nome: string; ativo: boolean; desligado_em: Date | null }>(
        "SELECT nome, ativo, desligado_em FROM tenants WHERE id = $1 FOR UPDATE",
        [req.params.id],
      );
      const t = rows[0];
      if (!t) {
        await db.query("ROLLBACK");
        return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
      }
      if (t.ativo || !t.desligado_em) {
        await db.query("ROLLBACK");
        return reply.code(409).send({ erro: "TENANT_NAO_DESLIGADO" });
      }
      if (req.body?.confirmar !== t.nome) {
        await db.query("ROLLBACK");
        return reply.code(400).send({ erro: "CONFIRMACAO_NAO_CONFERE" });
      }
      // Todas as tabelas com tenant_id (migrações 002, 004 e 006).
      const apagados: Record<string, number> = {};
      for (const tabela of ["agendamentos", "confirmacoes", "cobrancas"]) {
        apagados[tabela] = (await db.query(`DELETE FROM ${tabela} WHERE tenant_id = $1`, [req.params.id])).rowCount ?? 0;
      }
      await db.query("COMMIT");
      req.log.info({ tenant: req.params.id, ...apagados }, "implantação: histórico do cliente apagado");
      return { ok: true, apagados };
    } catch (err) {
      await db.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      db.release();
    }
  });
}
