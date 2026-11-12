// Catálogo de conectores e Central de conectores (docs/conectores.md). As rotas /admin/* daqui são
// registradas dentro de adminRoutes, com o mesmo controle da chave de administrador.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { cifraDisponivel, cifrar, decifrar } from "../crypto.js";
import { pool } from "../db.js";
import {
  adaptadorPara, camposDe, carregarConector, configDe, esquecerConector, lerConfigConector, lerCredencial,
  SITUACOES_EM_USO, type Conector, type Situacao,
} from "../erp/catalogo.js";
import { ROTAS_ESPECIFICACAO } from "../erp/conector/motor.js";
import { limparDocumento } from "../erp/conector/documentos.js";

const SLUG = /^[a-z][a-z0-9-]{1,39}$/;
const SITUACOES: Situacao[] = ["rascunho", "homologacao", "publicado", "arquivado"];
const MAX_ARQUIVO = 10 * 1024 * 1024;

/* ---------- ligar a clínica a um sistema (implantação e, depois, a própria clínica) ---------- */

// Testa a credencial no ERP e, dando certo, grava o sistema, a credencial cifrada e o que o ERP suporta.
// `entrada` = os campos do conector. A Asa não passa por aqui: o token dela tem rota própria.
export async function ligarErp(
  req: FastifyRequest,
  reply: FastifyReply,
  tenantId: string,
  slug: string,
  entrada: unknown,
  origem: "clinica" | "implantacao",
) {
  esquecerConector(slug);
  const c = await carregarConector(slug);
  if (!c || !SITUACOES_EM_USO.includes(c.situacao) || c.slug === "asa") return reply.code(400).send({ erro: "ERP_INVALIDO" });
  const lida = lerCredencial(camposDe(c), entrada);
  if (!lida.ok) return reply.code(400).send({ erro: lida.erro, campo: lida.campo });
  if (!cifraDisponivel()) return reply.code(503).send({ erro: "CIFRA_NAO_CONFIGURADA" });

  const adaptador = await adaptadorPara(slug, lida.credencial, req.log, c);
  const r = await adaptador.testarConexao();
  if (!r.ok) return reply.code(r.credencialInvalida ? 422 : 502).send({ erro: r.erro, msg: r.msg, status_erp: r.status });
  const capacidades = await adaptador.detectarCapacidades();

  const { rowCount } = await pool!.query(
    `UPDATE tenants SET erp = $3, asa_credencial_cifrada = $1, credencial_gravada_em = now(), credencial_origem = $4,
            erp_capacidades = $5, erp_testado_em = now(), atualizado_em = now()
     WHERE id = $2`,
    [cifrar(JSON.stringify(lida.credencial)), tenantId, slug, origem, capacidades],
  );
  if (!rowCount) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
  req.log.info({ tenant: tenantId, erp: slug, versao: c.versao, origem, capacidades }, "ERP da clínica ligado");
  return { ok: true, erp: slug, prestadores: r.dados.prestadores, capacidades };
}

// Checagens só de leitura com um conector e uma credencial: o que a Central mostra antes de publicar.
async function checagens(req: FastifyRequest, c: Conector, credencial: Record<string, string>, busca?: { cpf?: string; telefone?: string }) {
  const a = await adaptadorPara(c.slug, credencial, req.log, c);
  const passos: Array<{ passo: string; ok: boolean; detalhe: string }> = [];
  const anotar = (passo: string, r: { ok: boolean; erro?: string; msg?: string; status?: number }, detalhe: string) =>
    passos.push({ passo, ok: r.ok, detalhe: r.ok ? detalhe : `${r.erro ?? "falhou"}${r.status ? " · HTTP " + r.status : ""}${r.msg ? " · " + r.msg : ""}` });

  const con = await a.testarConexao();
  anotar("Conexão", con, con.ok ? `${con.dados.prestadores} profissional(is)` : "");
  if (!con.ok) return { passos, capacidades: null };

  const ep = await a.especialidadesEPrestadores();
  anotar("Especialidades e profissionais", ep, ep.ok ? `${ep.dados.especialidades.length} especialidade(s), ${ep.dados.prestadores.length} profissional(is)` : "");
  const prof = ep.ok ? ep.dados.prestadores[0] : undefined;
  if (prof) {
    const dias = await a.diasDisponiveis(prof.id);
    anotar(`Dias livres de ${prof.nome}`, dias, dias.ok ? `${dias.dados.length} dia(s)` + (dias.dados[0] ? `, o primeiro em ${dias.dados[0]}` : "") : "");
    const dia = dias.ok ? dias.dados[0] : undefined;
    if (dia) {
      const h = await a.horariosLivres(prof.id, dia);
      anotar(`Horários de ${dia}`, h, h.ok ? `${h.dados.length} horário(s)` + (h.dados[0] ? `, o primeiro às ${h.dados[0].horario}` : "") : "");
      const ag = await a.agendaDoDia(prof.id, dia);
      anotar(`Agenda de ${dia}`, ag, ag.ok ? `${ag.dados.length} consulta(s) marcada(s)` : "");
    }
  }
  if (busca?.cpf || busca?.telefone) {
    const b = busca.cpf ? { cpf: busca.cpf } : { telefone: busca.telefone! };
    const p = await a.buscarPaciente(b);
    anotar("Buscar paciente", p, p.ok ? (p.dados ? `achou ${p.dados.nome} (id ${p.dados.id})` : "nenhum paciente") : "");
    if (p.ok && p.dados) {
      const cf = await a.consultasFuturas(b);
      anotar("Consultas do paciente", cf, cf.ok ? `${cf.dados.consultas.length} consulta(s) futura(s)` : "");
    }
  }
  const capacidades = await a.detectarCapacidades();
  return { passos, capacidades };
}

/* ---------- Central de conectores (admin) ---------- */

export async function conectoresAdmin(app: FastifyInstance) {
  app.get("/admin/conectores", async () => {
    const { rows } = await pool!.query(
      `SELECT c.slug, c.nome, c.artigo, c.tipo, c.situacao, c.versao, c.observacao, c.atualizado_em, c.publicado_em,
              (SELECT count(*)::int FROM conector_documentos d WHERE d.conector_slug = c.slug) AS documentos,
              (SELECT count(*)::int FROM tenants t WHERE t.erp = c.slug) AS clinicas
         FROM conectores c ORDER BY (c.situacao = 'arquivado'), c.nome`,
    );
    const { rows: pedidos } = await pool!.query(
      `SELECT p.id, p.sistema, p.contato, p.observacao, p.situacao, p.conector_slug, p.criado_em, t.nome AS clinica
         FROM conector_pedidos p LEFT JOIN tenants t ON t.id = p.tenant_id
        ORDER BY (p.situacao IN ('atendido', 'recusado')), p.criado_em DESC LIMIT 200`,
    );
    return { conectores: rows, pedidos, rotas: ROTAS_ESPECIFICACAO };
  });

  app.get<{ Params: { slug: string } }>("/admin/conectores/:slug", async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ erro: "SLUG_INVALIDO" });
    const { rows } = await pool!.query("SELECT slug, nome, artigo, tipo, situacao, versao, config, observacao, criado_em, atualizado_em, publicado_em FROM conectores WHERE slug = $1", [req.params.slug]);
    if (!rows[0]) return reply.code(404).send({ erro: "CONECTOR_NAO_ENCONTRADO" });
    const c = rows[0] as Conector & Record<string, unknown>;
    const { rows: docs } = await pool!.query(
      "SELECT id, tipo, url, nome_arquivo, mime, tamanho, limpezas, origem, enviado_por, criado_em FROM conector_documentos WHERE conector_slug = $1 ORDER BY criado_em DESC",
      [req.params.slug],
    );
    // A configuração efetiva (o padrão Kentro mostra a do código) e os campos que a clínica preenche.
    return { ...c, config_efetiva: configDe(c), campos: camposDe(c), documentos: docs };
  });

  app.post<{ Body: { slug?: string; nome?: string; artigo?: string; observacao?: string; pedido_id?: string } }>("/admin/conectores", async (req, reply) => {
    const b = req.body ?? {};
    const slug = String(b.slug ?? "").trim().toLowerCase();
    const nome = String(b.nome ?? "").trim();
    if (!SLUG.test(slug)) return reply.code(400).send({ erro: "SLUG_INVALIDO" });
    if (!nome || nome.length > 40) return reply.code(400).send({ erro: "NOME_OBRIGATORIO" });
    const artigo = b.artigo === "a" ? "a" : "o";
    const ins = await pool!.query(
      "INSERT INTO conectores (slug, nome, artigo, tipo, situacao, observacao) VALUES ($1, $2, $3, 'configuracao', 'rascunho', $4) ON CONFLICT DO NOTHING",
      [slug, nome, artigo, String(b.observacao ?? "").slice(0, 1000) || null],
    );
    if (!ins.rowCount) return reply.code(409).send({ erro: "SLUG_JA_EXISTE" });
    if (b.pedido_id && /^[0-9a-f-]{36}$/.test(b.pedido_id)) {
      await pool!.query("UPDATE conector_pedidos SET conector_slug = $2, situacao = 'em_andamento', atualizado_em = now() WHERE id = $1", [b.pedido_id, slug]);
    }
    req.log.info({ conector: slug }, "central: conector criado");
    return reply.code(201).send({ ok: true, slug });
  });

  // Nome, artigo, observação e configuração. A configuração é validada pelo motor antes de gravar; cada
  // gravação de configuração sobe a versão (as clínicas passam a usar a nova em até 30 s).
  app.put<{ Params: { slug: string }; Body: { nome?: string; artigo?: string; observacao?: string; config?: unknown } }>("/admin/conectores/:slug", async (req, reply) => {
    const slug = req.params.slug;
    if (!SLUG.test(slug)) return reply.code(400).send({ erro: "SLUG_INVALIDO" });
    const atual = (await pool!.query<{ tipo: string }>("SELECT tipo FROM conectores WHERE slug = $1", [slug])).rows[0];
    if (!atual) return reply.code(404).send({ erro: "CONECTOR_NAO_ENCONTRADO" });
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [slug];
    const definir = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (b.nome !== undefined) {
      const n = String(b.nome).trim();
      if (!n || n.length > 40) return reply.code(400).send({ erro: "NOME_OBRIGATORIO" });
      definir("nome", n);
    }
    if (b.artigo !== undefined) definir("artigo", b.artigo === "a" ? "a" : "o");
    if (b.observacao !== undefined) definir("observacao", String(b.observacao).slice(0, 1000) || null);
    if (b.config !== undefined) {
      if (atual.tipo === "codigo") return reply.code(400).send({ erro: "CONECTOR_EM_CODIGO" });
      const v = lerConfigConector(b.config);
      if (!v.ok) return reply.code(422).send({ erro: "CONFIG_INVALIDA", erros: v.erros });
      definir("config", v.config);
      sets.push("versao = versao + 1");
    }
    if (!sets.length) return reply.code(400).send({ erro: "NADA_PARA_ALTERAR" });
    const { rows } = await pool!.query<{ versao: number }>(`UPDATE conectores SET ${sets.join(", ")}, atualizado_em = now() WHERE slug = $1 RETURNING versao`, vals);
    esquecerConector(slug);
    req.log.info({ conector: slug, versao: rows[0]?.versao, config: b.config !== undefined }, "central: conector alterado");
    return { ok: true, versao: rows[0]?.versao };
  });

  // Situação: rascunho → homologacao (uma clínica testa) → publicado (aparece para todas) → arquivado.
  app.post<{ Params: { slug: string }; Body: { situacao?: string } }>("/admin/conectores/:slug/situacao", async (req, reply) => {
    const slug = req.params.slug;
    const s = String(req.body?.situacao ?? "") as Situacao;
    if (!SLUG.test(slug) || !SITUACOES.includes(s)) return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    const c = (await pool!.query<Conector>("SELECT slug, nome, artigo, tipo, situacao, versao, config FROM conectores WHERE slug = $1", [slug])).rows[0];
    if (!c) return reply.code(404).send({ erro: "CONECTOR_NAO_ENCONTRADO" });
    if ((s === "homologacao" || s === "publicado") && !configDe(c) && c.tipo !== "codigo") return reply.code(409).send({ erro: "CONECTOR_SEM_CONFIG" });
    if (s === "arquivado" || s === "rascunho") {
      const { rows } = await pool!.query<{ n: number }>("SELECT count(*)::int AS n FROM tenants WHERE erp = $1 AND ativo", [slug]);
      if (rows[0].n > 0) return reply.code(409).send({ erro: "CONECTOR_EM_USO", clinicas: rows[0].n });
    }
    await pool!.query(
      `UPDATE conectores SET situacao = $2, atualizado_em = now(), publicado_em = CASE WHEN $2 = 'publicado' THEN now() ELSE publicado_em END WHERE slug = $1`,
      [slug, s],
    );
    esquecerConector(slug);
    req.log.info({ conector: slug, situacao: s }, "central: situação do conector alterada");
    return { ok: true, situacao: s };
  });

  // Teste só de leitura com uma credencial de homologação. A credencial não é gravada. Vale também para
  // rascunho: é assim que se confere um conector antes de liberar.
  app.post<{ Params: { slug: string }; Body: { credencial?: unknown; busca?: { cpf?: string; telefone?: string } } }>("/admin/conectores/:slug/testar", async (req, reply) => {
    if (!SLUG.test(req.params.slug)) return reply.code(400).send({ erro: "SLUG_INVALIDO" });
    esquecerConector(req.params.slug);
    const c = await carregarConector(req.params.slug);
    if (!c) return reply.code(404).send({ erro: "CONECTOR_NAO_ENCONTRADO" });
    if (c.tipo !== "codigo" && !configDe(c)) return reply.code(409).send({ erro: "CONECTOR_SEM_CONFIG" });
    const lida = lerCredencial(camposDe(c), req.body?.credencial);
    if (!lida.ok) return reply.code(400).send({ erro: lida.erro, campo: lida.campo });
    const b = req.body?.busca;
    const busca = b ? { cpf: String(b.cpf ?? "").replace(/\D/g, "") || undefined, telefone: String(b.telefone ?? "").replace(/\D/g, "") || undefined } : undefined;
    const r = await checagens(req, c, lida.credencial, busca);
    req.log.info({ conector: c.slug, versao: c.versao, ok: r.passos.every((p) => p.ok) }, "central: conector testado");
    return { ok: r.passos.every((p) => p.ok), versao: c.versao, ...r };
  });

  /* ---------- documentação ---------- */

  // Link, ou arquivo em base64 (até 10 MB). Coleções do Postman e OpenAPI em JSON têm as credenciais
  // removidas ao chegar; o resto é guardado como veio.
  app.post<{ Params: { slug: string }; Body: { tipo?: string; url?: string; nome_arquivo?: string; mime?: string; conteudo_base64?: string; origem?: string; enviado_por?: string } }>(
    "/admin/conectores/:slug/documentos",
    { bodyLimit: Math.ceil(MAX_ARQUIVO * 1.4) + 4096 },
    async (req, reply) => {
      const slug = req.params.slug;
      if (!SLUG.test(slug)) return reply.code(400).send({ erro: "SLUG_INVALIDO" });
      if (!(await carregarConector(slug))) return reply.code(404).send({ erro: "CONECTOR_NAO_ENCONTRADO" });
      const b = req.body ?? {};
      const origem = String(b.origem ?? "").slice(0, 200) || null;
      const por = String(b.enviado_por ?? "").slice(0, 120) || null;
      if (b.tipo === "link") {
        let u: URL;
        try { u = new URL(String(b.url ?? "")); } catch { return reply.code(400).send({ erro: "URL_INVALIDA" }); }
        if (u.protocol !== "https:" && u.protocol !== "http:") return reply.code(400).send({ erro: "URL_INVALIDA" });
        const { rows } = await pool!.query("INSERT INTO conector_documentos (conector_slug, tipo, url, origem, enviado_por) VALUES ($1, 'link', $2, $3, $4) RETURNING id", [slug, u.toString(), origem, por]);
        return reply.code(201).send({ ok: true, id: rows[0].id });
      }
      if (b.tipo !== "arquivo") return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
      const nome = String(b.nome_arquivo ?? "").replace(/[\\/\r\n]/g, "_").slice(0, 200);
      if (!nome || !b.conteudo_base64) return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
      const bruto = Buffer.from(String(b.conteudo_base64), "base64");
      if (!bruto.length || bruto.length > MAX_ARQUIVO) return reply.code(413).send({ erro: "ARQUIVO_GRANDE_DEMAIS", max_bytes: MAX_ARQUIVO });
      const limpo = limparDocumento(nome, bruto);
      const { rows } = await pool!.query(
        `INSERT INTO conector_documentos (conector_slug, tipo, nome_arquivo, mime, tamanho, conteudo, limpezas, origem, enviado_por)
         VALUES ($1, 'arquivo', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [slug, nome, String(b.mime ?? "").slice(0, 120) || null, limpo.conteudo.length, limpo.conteudo, limpo.limpezas, origem, por],
      );
      req.log.info({ conector: slug, arquivo: nome, bytes: limpo.conteudo.length, limpezas: limpo.limpezas }, "central: documentação recebida");
      return reply.code(201).send({ ok: true, id: rows[0].id, limpezas: limpo.limpezas });
    },
  );

  app.get<{ Params: { slug: string; id: string } }>("/admin/conectores/:slug/documentos/:id", async (req, reply) => {
    if (!SLUG.test(req.params.slug) || !/^[0-9a-f-]{36}$/.test(req.params.id)) return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    const { rows } = await pool!.query<{ tipo: string; url: string | null; nome_arquivo: string | null; conteudo: Buffer | null }>(
      "SELECT tipo, url, nome_arquivo, conteudo FROM conector_documentos WHERE id = $1 AND conector_slug = $2",
      [req.params.id, req.params.slug],
    );
    const d = rows[0];
    if (!d) return reply.code(404).send({ erro: "DOCUMENTO_NAO_ENCONTRADO" });
    if (d.tipo === "link") return { tipo: "link", url: d.url };
    // Sempre como download: o arquivo veio de fora e nunca é exibido como página deste endereço.
    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(d.nome_arquivo ?? "documento")}"`)
      .header("X-Content-Type-Options", "nosniff")
      .send(d.conteudo);
  });

  app.delete<{ Params: { slug: string; id: string } }>("/admin/conectores/:slug/documentos/:id", async (req, reply) => {
    if (!SLUG.test(req.params.slug) || !/^[0-9a-f-]{36}$/.test(req.params.id)) return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    const { rowCount } = await pool!.query("DELETE FROM conector_documentos WHERE id = $1 AND conector_slug = $2", [req.params.id, req.params.slug]);
    if (!rowCount) return reply.code(404).send({ erro: "DOCUMENTO_NAO_ENCONTRADO" });
    return { ok: true };
  });

  /* ---------- pedidos ---------- */

  app.patch<{ Params: { id: string }; Body: { situacao?: string; conector_slug?: string | null } }>("/admin/pedidos/:id", async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return reply.code(400).send({ erro: "ID_INVALIDO" });
    const s = req.body?.situacao;
    if (s && !["aberto", "em_andamento", "atendido", "recusado"].includes(s)) return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    const slug = req.body?.conector_slug;
    if (slug && !SLUG.test(slug)) return reply.code(400).send({ erro: "SLUG_INVALIDO" });
    const { rowCount } = await pool!.query(
      `UPDATE conector_pedidos SET situacao = COALESCE($2, situacao), conector_slug = CASE WHEN $4 THEN $3 ELSE conector_slug END, atualizado_em = now() WHERE id = $1`,
      [req.params.id, s ?? null, slug ?? null, slug !== undefined],
    );
    if (!rowCount) return reply.code(404).send({ erro: "PEDIDO_NAO_ENCONTRADO" });
    return { ok: true };
  });

  /* ---------- clínica: ligar e testar (implantação) ---------- */

  // Liga a clínica a um sistema do catálogo. {erp: "asa"} volta para a Asa sem credencial (o token é
  // cadastrado em seguida, pela clínica ou por PUT .../credencial). Aceita também {base_url, token} soltos
  // (formato da 0.21.0) para o padrão Kentro.
  app.put<{ Params: { id: string }; Body: { erp?: string; credencial?: unknown; base_url?: string; token?: string } }>("/admin/tenants/:id/erp", async (req, reply) => {
    const b = req.body ?? {};
    const slug = String(b.erp ?? "");
    if (slug === "asa") {
      const { rowCount } = await pool!.query(
        "UPDATE tenants SET erp = 'asa', asa_credencial_cifrada = NULL, erp_capacidades = NULL, erp_testado_em = NULL, atualizado_em = now() WHERE id = $1",
        [req.params.id],
      );
      if (!rowCount) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
      req.log.info({ tenant: req.params.id, erp: "asa" }, "ERP da clínica trocado pela implantação");
      return { ok: true, erp: "asa", credencial: false };
    }
    if (!SLUG.test(slug)) return reply.code(400).send({ erro: "ERP_INVALIDO" });
    const entrada = b.credencial ?? { base_url: b.base_url, token: b.token };
    return ligarErp(req, reply, req.params.id, slug, entrada, "implantacao");
  });

  // Testa a conexão com o sistema já cadastrado e detecta de novo o que ele suporta.
  app.post<{ Params: { id: string } }>("/admin/tenants/:id/erp/testar", async (req, reply) => {
    const { rows } = await pool!.query<{ erp: string; asa_credencial_cifrada: Buffer | null }>(
      "SELECT erp, asa_credencial_cifrada FROM tenants WHERE id = $1",
      [req.params.id],
    );
    const t = rows[0];
    if (!t) return reply.code(404).send({ erro: "TENANT_NAO_ENCONTRADO" });
    if (!t.asa_credencial_cifrada) return { ok: false, erp: t.erp, conexao: "credencial_ausente" };
    let adaptador;
    try {
      adaptador = await adaptadorPara(t.erp, JSON.parse(decifrar(t.asa_credencial_cifrada)), req.log);
    } catch (err) {
      req.log.error({ err, erp: t.erp }, "implantação: falha ao abrir a credencial ou o adaptador do ERP");
      return reply.code(500).send({ erro: "ERRO_INTERNO" });
    }
    const r = await adaptador.testarConexao();
    if (!r.ok) return { ok: false, erp: t.erp, conexao: r.credencialInvalida ? "credencial_invalida" : "fora_do_ar", erro: r.erro, msg: r.msg };
    const capacidades = await adaptador.detectarCapacidades();
    await pool!.query("UPDATE tenants SET erp_capacidades = $2, erp_testado_em = now() WHERE id = $1", [req.params.id, capacidades]);
    req.log.info({ tenant: req.params.id, erp: t.erp, capacidades }, "implantação: conexão com o ERP testada");
    return { ok: true, erp: t.erp, conexao: "ok", prestadores: r.dados.prestadores, capacidades };
  });
}
