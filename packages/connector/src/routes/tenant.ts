import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { instituicaoDa, listarPrestadores, type CredencialAsa } from "../asa.js";
import { cifraDisponivel, cifrar, decifrar } from "../crypto.js";
import { pool } from "../db.js";
import { tenantDaRequisicao } from "../tenant-auth.js";
import { CAMPOS, datasAlvo, hojeEm, lerConfig, MAX_PARAMETROS, preencher, TEXTOS_PADRAO, variaveisTemplate, varsDa, varsResposta } from "../confirmacao.js";
import { adminAutorizado } from "./admin.js";

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

  // Primeiro cadastro do token da Asa, pela tela "Configurar Asa Saúde". TROCAR um token já gravado
  // exige a chave de administrador do Conector: quem só tem a chave da instalação (que está no
  // navegador de todo atendente) não consegue apontar a clínica para outra conta da Asa.
  app.put<{ Body: { token?: string } }>("/v1/tenant/credencial", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    if (tenant.credencial && !adminAutorizado(req)) return reply.code(403).send({ erro: "CREDENCIAL_JA_CADASTRADA" });
    return gravarCredencial(req, reply, tenant.id, req.body?.token);
  });

  // Configuração da confirmação de véspera, pela tela "Configurar Asa Saúde".
  app.get("/v1/tenant/confirmacao", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    const { rows } = await pool!.query<{ confirmacao: unknown; tem_chave: boolean }>(
      "SELECT confirmacao, chave_automacao_hash IS NOT NULL AS tem_chave FROM tenants WHERE id = $1",
      [tenant.id],
    );
    return {
      config: lerConfig(rows[0]?.confirmacao),
      padrao: TEXTOS_PADRAO,
      campos: CAMPOS,
      max_parametros: MAX_PARAMETROS,
      automacao_configurada: !!rows[0]?.tem_chave,
    };
  });

  // Prévia com uma consulta de exemplo, sem gravar: a tela mostra como a mensagem e o template saem.
  app.post<{ Body: { config?: unknown } }>("/v1/tenant/confirmacao/previa", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    const cfg = lerConfig(req.body?.config);
    const hoje = hojeEm(new Date());
    const data = datasAlvo(hoje, cfg).inicio;
    const v = varsDa(
      { paciente: "Maria Aparecida Souza", data, hora: "08:30", prestador: "Dra. Ana Lima", clinica: null, especialidade: "Cardiologia", procedimento: "Consulta", endereco: "Rua das Flores, 100" },
      hoje,
      tenant.nome,
    );
    // As respostas saem com os dados que a rota de resposta realmente tem.
    const vr = varsResposta({ data, hora: "08:30", prestador: "Dra. Ana Lima" }, "Maria", hoje, tenant.nome);
    const textos = Object.fromEntries(Object.entries(cfg.textos).map(([k, t]) => [k, preencher(t, k === "mensagem" ? v : vr)]));
    return { config: cfg, textos, template: variaveisTemplate(v, cfg.template.parametros) };
  });

  // Grava a configuração inteira, já validada (o que vier fora do formato volta ao padrão).
  app.put<{ Body: { config?: unknown; usuario?: string } }>("/v1/tenant/confirmacao", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    if (!req.body?.config || typeof req.body.config !== "object") return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    const cfg = lerConfig(req.body.config);
    await pool!.query("UPDATE tenants SET confirmacao = $1, atualizado_em = now() WHERE id = $2", [cfg, tenant.id]);
    req.log.info({ tenant: tenant.id, usuario: req.body.usuario, ativo: cfg.ativo, teste: cfg.teste.ativo }, "confirmação: configuração gravada");
    return { ok: true, config: cfg };
  });
}

// Valida o token na Asa e grava cifrado. Nunca devolve o token.
export async function gravarCredencial(req: FastifyRequest, reply: FastifyReply, tenantId: string, tokenRecebido: unknown) {
  if (!cifraDisponivel()) return reply.code(503).send({ erro: "CIFRA_NAO_CONFIGURADA" });
  const token = String(tokenRecebido ?? "").trim();
  if (!token || /\s/.test(token)) return reply.code(400).send({ erro: "DADOS_INVALIDOS" });

  const credencial: CredencialAsa = { token };
  const instituicao_id = instituicaoDa(credencial);
  const r = await listarPrestadores(credencial);
  if (!r.ok) {
    const status = r.erro === "ASA_CREDENCIAL_INVALIDA" ? 422 : 502;
    return reply.code(status).send({ erro: r.erro });
  }

  const { rowCount } = await pool!.query("UPDATE tenants SET asa_credencial_cifrada = $1, atualizado_em = now() WHERE id = $2", [
    cifrar(JSON.stringify(credencial)),
    tenantId,
  ]);
  if (!rowCount) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
  req.log.info({ tenant: tenantId, instituicao_id }, "credencial da Asa gravada");
  return { ok: true, instituicao_id, prestadores: r.dados.prestadores?.length ?? 0 };
}
