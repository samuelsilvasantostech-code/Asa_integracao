import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";

// Sem banco: as funções do catálogo e o controle de acesso das rotas da Central.
const CHAVE = "k".repeat(40);
process.env.ADMIN_KEY = CHAVE;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
const { camposDe, configDe, lerConfigConector, lerCredencial } = await import("../src/erp/catalogo.js");
const { CONECTOR_PADRAO } = await import("../src/erp/conector/motor.js");
const { limparDocumento } = await import("../src/erp/conector/documentos.js");
const { adminRoutes } = await import("../src/routes/admin.js");

const campos = [
  { chave: "base_url", rotulo: "Endereço", tipo: "url" as const, obrigatorio: true },
  { chave: "token", rotulo: "Token", tipo: "segredo" as const, obrigatorio: true },
  { chave: "clinica", rotulo: "Código da clínica", tipo: "texto" as const },
];

test("credencial: obrigatórios, URL só HTTPS público, segredo sem espaço, opcional vazio some", () => {
  assert.deepEqual(lerCredencial(campos, { base_url: "https://erp.exemplo.com/api/", token: " abc ", clinica: "" }), { ok: true, credencial: { base_url: "https://erp.exemplo.com/api", token: "abc" } });
  assert.deepEqual(lerCredencial(campos, { base_url: "https://erp.exemplo.com" }), { ok: false, erro: "CAMPO_OBRIGATORIO", campo: "token" });
  assert.deepEqual(lerCredencial(campos, { base_url: "https://10.0.0.1/api", token: "a" }), { ok: false, erro: "ERP_URL_INVALIDA", campo: "base_url" });
  assert.deepEqual(lerCredencial(campos, { base_url: "https://erp.exemplo.com", token: "a b" }), { ok: false, erro: "CAMPO_INVALIDO", campo: "token" });
  assert.deepEqual(lerCredencial(campos, null), { ok: false, erro: "CAMPO_OBRIGATORIO", campo: "base_url" });
});

test("configuração da Central: o motor valida, e o endereço fixo ou por campo precisa ser seguro", () => {
  assert.ok(lerConfigConector(CONECTOR_PADRAO).ok);
  const base = { versao: 1, autenticacao: { tipo: "bearer" }, campos: [{ chave: "token", rotulo: "Token", tipo: "segredo" }], rotas: {} };
  assert.ok(lerConfigConector({ ...base, base_url: "https://api.feegow.com/v1/api" }).ok);
  const interno = lerConfigConector({ ...base, base_url: "https://127.0.0.1/api" });
  assert.ok(!interno.ok && /HTTPS público/.test(interno.erros[0]));
  const outroCampo = lerConfigConector({ ...base, base_url: "{{cred.token}}/api" });
  assert.ok(!outroCampo.ok && /tipo url/.test(outroCampo.erros[0]));
  const solto = lerConfigConector({ ...base, base_url: "https://{{cred.host}}.erp.com" });
  assert.ok(!solto.ok && /começar por/.test(solto.erros[0]));
});

test("catálogo: a Asa pede o token; o padrão Kentro usa a configuração do código", () => {
  const asa = { slug: "asa", nome: "Asa", artigo: "a" as const, tipo: "codigo" as const, situacao: "publicado" as const, versao: 1, config: null };
  assert.deepEqual(camposDe(asa).map((c) => c.chave), ["token"]);
  assert.equal(configDe(asa), null);
  const padrao = { ...asa, slug: "padrao", tipo: "configuracao" as const };
  assert.equal(configDe(padrao), CONECTOR_PADRAO);
  assert.deepEqual(camposDe(padrao).map((c) => c.chave), ["base_url", "token"]);
});

test("documentação: credenciais de coleção do Postman saem; o resto fica", () => {
  const colecao = {
    info: { name: "API Asa" },
    auth: { type: "bearer", bearer: [{ key: "token", value: "segredo-real-123" }] },
    variable: [{ key: "baseUrl", value: "https://api.exemplo.com" }, { key: "token", value: "abc123" }],
    item: [{ request: { header: [{ key: "Authorization", value: "Bearer eyJhbGciOiJIUzI1NiJ9.x" }, { key: "Accept", value: "application/json" }], url: { query: [{ key: "api_key", value: "k-999" }, { key: "cpf", value: "1" }] } } }],
  };
  const r = limparDocumento("asa.postman_collection.json", Buffer.from(JSON.stringify(colecao)));
  const limpo = JSON.parse(r.conteudo.toString("utf8"));
  assert.equal(r.limpezas, 4);
  assert.equal(limpo.auth.bearer[0].value, "");
  assert.equal(limpo.variable[0].value, "https://api.exemplo.com");
  assert.equal(limpo.variable[1].value, "");
  assert.equal(limpo.item[0].request.header[0].value, "");
  assert.equal(limpo.item[0].request.header[1].value, "application/json");
  assert.equal(limpo.item[0].request.url.query[0].value, "");
  assert.equal(limpo.item[0].request.url.query[1].value, "1");
  assert.ok(!r.conteudo.toString("utf8").includes("segredo-real-123"));
  // PDF e texto não-JSON passam como vieram.
  const pdf = Buffer.from("%PDF-1.4 token=abc");
  assert.equal(limparDocumento("manual.pdf", pdf).conteudo, pdf);
});

test("Central: rotas existem e exigem a chave de administrador", async () => {
  const app = Fastify();
  await app.register(adminRoutes);
  for (const [method, url] of [
    ["GET", "/admin/conectores"], ["GET", "/admin/conectores/feegow"], ["POST", "/admin/conectores"], ["PUT", "/admin/conectores/feegow"],
    ["POST", "/admin/conectores/feegow/situacao"], ["POST", "/admin/conectores/feegow/testar"], ["POST", "/admin/conectores/feegow/documentos"],
    ["PATCH", "/admin/pedidos/0b6c7a3e-1d2f-4a5b-9c8d-7e6f5a4b3c2d"],
  ] as const) {
    assert.equal((await app.inject({ method, url })).statusCode, 401, `${method} ${url} sem chave`);
    assert.equal((await app.inject({ method, url, headers: { "x-admin-key": CHAVE } })).statusCode, 503, `${method} ${url} com chave, sem banco`);
  }
  await app.close();
});

test("tela de conexão: rotas da clínica existem e exigem a chave da instalação", async () => {
  const { tenantRoutes } = await import("../src/routes/tenant.js");
  const app = Fastify();
  await app.register(tenantRoutes);
  for (const [method, url] of [["GET", "/v1/conectores"], ["POST", "/v1/conectores/ligar"], ["POST", "/v1/conectores/pedido"]] as const) {
    assert.equal((await app.inject({ method, url })).statusCode, 401, `${method} ${url} sem chave`);
    assert.equal((await app.inject({ method, url, headers: { "x-install-key": "qualquer" } })).statusCode, 503, `${method} ${url} sem banco`);
  }
  await app.close();
});
