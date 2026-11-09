import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { cifraDisponivel, cifrar, decifrar } from "../crypto.js";
import { pool } from "../db.js";
import { instituicaoDa, type CredencialAsa } from "../erp/asa/cliente.js";
import { criarAdaptador } from "../erp/index.js";
import { tenantDaRequisicao } from "../tenant-auth.js";
import { CAMPOS, datasAlvo, hojeEm, lerConfig, MAX_PARAMETROS, preencher, TEXTOS_PADRAO, variaveisTemplate, varsDa, varsResposta } from "../confirmacao.js";
import { instituicaoConfere } from "../implantacao.js";
import { adminAutorizado } from "./admin.js";

export async function tenantRoutes(app: FastifyInstance) {
  // Confirma a clínica e, se houver credencial, testa de verdade no ERP. A chave `asa` da resposta é lida
  // pela extensão; o nome fica até a extensão genérica (fase 3).
  app.get("/v1/tenant/conexao/teste", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    const base = { tenant: { id: tenant.id, nome: tenant.nome }, erp: tenant.erp };
    if (!tenant.credencial) return { ...base, asa: "credencial_ausente" };

    let credencial: unknown;
    let erp;
    try {
      credencial = JSON.parse(decifrar(tenant.credencial));
      erp = criarAdaptador(tenant.erp, credencial, req.log);
    } catch (err) {
      req.log.error({ err, erp: tenant.erp }, "falha ao abrir a credencial ou o adaptador do ERP");
      return { ...base, asa: "erro_interno" };
    }
    const r = await erp.testarConexao();
    // O número da instituição só existe no token da Asa.
    if (r.ok) return { ...base, asa: "ok", instituicao_id: tenant.erp === "asa" ? instituicaoDa(credencial as CredencialAsa) : null };
    req.log.warn({ erro: r.erro, status: r.status, erp: tenant.erp }, "teste de conexão com o ERP falhou");
    return { ...base, asa: r.credencialInvalida ? "credencial_invalida" : "fora_do_ar", erro: r.erro };
  });

  // Primeiro cadastro do token da Asa, pela tela "Configurar Asa Saúde". TROCAR um token já gravado
  // exige a chave de administrador do Conector: quem só tem a chave da instalação (que está no
  // navegador de todo atendente) não consegue apontar a clínica para outra conta da Asa.
  app.put<{ Body: { token?: string } }>("/v1/tenant/credencial", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    if (tenant.credencial && !adminAutorizado(req)) return reply.code(403).send({ erro: "CREDENCIAL_JA_CADASTRADA" });
    return gravarCredencial(req, reply, tenant.id, req.body?.token, "clinica");
  });

  // Configuração da confirmação de véspera: a tela "Confirmação Asa" só lê. Quem grava é a implantação
  // (PUT /admin/tenants/:id/confirmacao), com a chave de administrador.
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

  // A chave da instalação está no navegador de todo atendente: desde a 0.19.0 ela não grava a
  // configuração. A rota fica só para a extensão antiga receber um erro claro.
  app.put("/v1/tenant/confirmacao", async (_req, reply) => reply.code(403).send({ erro: "SO_IMPLANTACAO" }));
}

// Valida o token na Asa e grava cifrado. Nunca devolve o token. Com a instituição da Asa cadastrada no
// tenant, token de outra instituição é recusado antes de chamar a Asa.
export async function gravarCredencial(
  req: FastifyRequest,
  reply: FastifyReply,
  tenantId: string,
  tokenRecebido: unknown,
  origem: "clinica" | "implantacao",
) {
  if (!cifraDisponivel()) return reply.code(503).send({ erro: "CIFRA_NAO_CONFIGURADA" });
  const token = String(tokenRecebido ?? "").trim();
  if (!token || /\s/.test(token)) return reply.code(400).send({ erro: "DADOS_INVALIDOS" });

  const { rows: atual } = await pool!.query<{ asa_instituicao_id: string | null; erp: string }>("SELECT asa_instituicao_id, erp FROM tenants WHERE id = $1", [tenantId]);
  if (!atual[0]) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
  // Só a Asa existe por enquanto: a credencial é um token único. Outro ERP terá o próprio formato (fase 3).
  if (atual[0].erp !== "asa") return reply.code(422).send({ erro: "ERP_SEM_CADASTRO_DE_TOKEN" });
  if (!instituicaoConfere(atual[0].asa_instituicao_id, token)) return reply.code(422).send({ erro: "INSTITUICAO_DIVERGENTE" });

  const credencial: CredencialAsa = { token };
  const instituicao_id = instituicaoDa(credencial);
  const r = await criarAdaptador(atual[0].erp, credencial, req.log).testarConexao();
  if (!r.ok) {
    const status = r.credencialInvalida ? 422 : 502;
    return reply.code(status).send({ erro: r.erro });
  }

  const { rowCount } = await pool!.query(
    `UPDATE tenants SET asa_credencial_cifrada = $1, credencial_gravada_em = now(), credencial_origem = $3, atualizado_em = now()
     WHERE id = $2`,
    [cifrar(JSON.stringify(credencial)), tenantId, origem],
  );
  if (!rowCount) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
  req.log.info({ tenant: tenantId, instituicao_id, origem }, "credencial da Asa gravada");
  return { ok: true, instituicao_id, prestadores: r.dados.prestadores };
}
