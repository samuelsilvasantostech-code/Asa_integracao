import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { cifraDisponivel, cifrar, decifrar } from "../crypto.js";
import { pool } from "../db.js";
import { instituicaoDa, type CredencialAsa } from "../erp/asa/cliente.js";
import { adaptadorPara, camposDe, carregarConector, type Conector } from "../erp/catalogo.js";
import { perfilErp, tenantDaRequisicao } from "../tenant-auth.js";
import { CAMPOS, datasAlvo, hojeEm, lerConfig, MAX_PARAMETROS, preencher, TEXTOS_PADRAO, variaveisTemplate, varsDa, varsResposta } from "../confirmacao.js";
import { instituicaoConfere } from "../implantacao.js";
import { adminAutorizado } from "./admin.js";
import { ligarErp } from "./conectores.js";

export async function tenantRoutes(app: FastifyInstance) {
  // O ERP da clínica para as telas: qual é, como as telas escrevem o nome dele e o que ele suporta. Não
  // chama o ERP; a extensão pede ao abrir cada tela.
  app.get("/v1/capacidades", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    const p = await perfilErp(tenant.id);
    if (!p) return reply.code(401).send({ erro: "CHAVE_INVALIDA" });
    return p;
  });

  // Confirma a clínica e, se houver credencial, testa de verdade no ERP. `conexao` é o estado; `asa` repete
  // o mesmo valor para a extensão anterior à 0.22.0.
  app.get("/v1/tenant/conexao/teste", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    const perfil = await perfilErp(tenant.id);
    const base = { tenant: { id: tenant.id, nome: tenant.nome }, erp: tenant.erp, sistema: perfil?.sistema };
    const estado = (s: string) => ({ conexao: s, asa: s });
    if (!tenant.credencial) return { ...base, ...estado("credencial_ausente") };

    let credencial: unknown;
    let erp;
    try {
      credencial = JSON.parse(decifrar(tenant.credencial));
      erp = await adaptadorPara(tenant.erp, credencial, req.log);
    } catch (err) {
      req.log.error({ err, erp: tenant.erp }, "falha ao abrir a credencial ou o adaptador do ERP");
      return { ...base, ...estado("erro_interno") };
    }
    const r = await erp.testarConexao();
    // O número da instituição só existe no token da Asa.
    if (r.ok) return { ...base, ...estado("ok"), instituicao_id: tenant.erp === "asa" ? instituicaoDa(credencial as CredencialAsa) : null };
    req.log.warn({ erro: r.erro, status: r.status, erp: tenant.erp }, "teste de conexão com o ERP falhou");
    return { ...base, ...estado(r.credencialInvalida ? "credencial_invalida" : "fora_do_ar"), erro: r.erro };
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

  /* ---------- tela de conexão da clínica (Configurar ClinFy) ---------- */

  // Sistemas que a clínica pode escolher (publicados), com os campos de cada um. O conector em homologação
  // só aparece para a clínica que já está nele.
  app.get("/v1/conectores", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    const { rows } = await pool!.query<Conector>(
      `SELECT slug, nome, artigo, tipo, situacao, versao, config FROM conectores
        WHERE situacao = 'publicado' OR (situacao = 'homologacao' AND slug = $1) ORDER BY nome`,
      [tenant.erp],
    );
    return {
      atual: tenant.erp,
      tem_credencial: !!tenant.credencial,
      conectores: rows
        .map((c) => ({ slug: c.slug, nome: c.slug === "padrao" ? "Sistema próprio (padrão Kentro)" : c.nome, artigo: c.artigo, campos: camposDe(c) }))
        .filter((c) => c.campos.length > 0),
    };
  });

  // Liga a clínica ao sistema escolhido. Só no primeiro cadastro: com credencial gravada, trocar é com a
  // implantação (a chave da instalação está no navegador de todo atendente).
  app.post<{ Body: { erp?: string; credencial?: Record<string, unknown> } }>("/v1/conectores/ligar", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    if (tenant.credencial && !adminAutorizado(req)) return reply.code(403).send({ erro: "CREDENCIAL_JA_CADASTRADA" });
    const slug = String(req.body?.erp ?? "");
    const c = /^[a-z][a-z0-9-]{1,39}$/.test(slug) ? await carregarConector(slug) : null;
    if (!c || !(c.situacao === "publicado" || (c.situacao === "homologacao" && tenant.erp === slug))) return reply.code(400).send({ erro: "ERP_INVALIDO" });
    if (slug === "asa") {
      // A Asa tem o próprio cadastro de token (instituição conferida). A clínica passa a ser da Asa antes.
      if (tenant.erp !== "asa") await pool!.query("UPDATE tenants SET erp = 'asa', erp_capacidades = NULL, erp_testado_em = NULL WHERE id = $1", [tenant.id]);
      return gravarCredencial(req, reply, tenant.id, req.body?.credencial?.token, "clinica");
    }
    return ligarErp(req, reply, tenant.id, slug, req.body?.credencial, "clinica");
  });

  // Sistema que não está na lista: vira pedido na Central de conectores. Até 5 pedidos abertos por clínica.
  app.post<{ Body: { sistema?: string; contato?: string; observacao?: string } }>("/v1/conectores/pedido", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    const sistema = String(req.body?.sistema ?? "").trim();
    if (sistema.length < 2 || sistema.length > 80) return reply.code(400).send({ erro: "SISTEMA_INVALIDO" });
    const contato = String(req.body?.contato ?? "").trim().slice(0, 120) || null;
    const observacao = String(req.body?.observacao ?? "").trim().slice(0, 1000) || null;
    const { rows } = await pool!.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM conector_pedidos WHERE tenant_id = $1 AND situacao IN ('aberto', 'em_andamento')",
      [tenant.id],
    );
    if (rows[0].n >= 5) return reply.code(429).send({ erro: "MUITOS_PEDIDOS" });
    await pool!.query("INSERT INTO conector_pedidos (tenant_id, sistema, contato, observacao) VALUES ($1, $2, $3, $4)", [tenant.id, sistema, contato, observacao]);
    req.log.info({ tenant: tenant.id, sistema }, "pedido de conector aberto pela clínica");
    return reply.code(201).send({ ok: true });
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
  const r = await (await adaptadorPara(atual[0].erp, credencial, req.log)).testarConexao();
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
