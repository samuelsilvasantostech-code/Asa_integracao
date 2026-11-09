import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";

// Cada arquivo de teste roda num processo: a chave é definida antes de carregar a configuração. Sem banco.
const CHAVE = "k".repeat(40);
process.env.ADMIN_KEY = CHAVE;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
const { adminRoutes } = await import("../src/routes/admin.js");
const { tenantRoutes } = await import("../src/routes/tenant.js");
const { financeiroRoutes } = await import("../src/routes/financeiro.js");
const { implantacaoRoutes } = await import("../src/routes/implantacao.js");

const UUID = "0b6c7a3e-1d2f-4a5b-9c8d-7e6f5a4b3c2d";

test("admin: chave errada é 401; :id fora do formato é 400 antes de tocar no banco", async () => {
  const app = Fastify();
  await app.register(adminRoutes);
  const errada = await app.inject({ method: "GET", url: "/admin/tenants", headers: { "x-admin-key": "outra" } });
  assert.equal(errada.statusCode, 401);
  for (const [method, url] of [
    ["PATCH", "/admin/tenants/1"],
    ["POST", "/admin/tenants/x/desligar"],
    ["DELETE", "/admin/tenants/abc/historico"],
    ["PUT", "/admin/tenants/1%27%3B--/financeiro"],
    ["GET", "/admin/tenants/123/agendamentos"],
  ] as const) {
    const r = await app.inject({ method, url, headers: { "x-admin-key": CHAVE } });
    assert.equal(r.statusCode, 400, `${method} ${url}`);
    assert.equal(r.json().erro, "ID_INVALIDO");
  }
  // UUID válido passa da validação e para no banco ausente.
  const ok = await app.inject({ method: "POST", url: `/admin/tenants/${UUID}/desligar`, headers: { "x-admin-key": CHAVE } });
  assert.equal(ok.statusCode, 503);
  await app.close();
});

test("admin: rotas novas de configuração e saída existem e exigem a chave", async () => {
  const app = Fastify();
  await app.register(adminRoutes);
  for (const [method, url] of [
    ["PUT", `/admin/tenants/${UUID}/confirmacao`],
    ["PUT", `/admin/tenants/${UUID}/financeiro`],
    ["POST", `/admin/tenants/${UUID}/desligar`],
    ["DELETE", `/admin/tenants/${UUID}/historico`],
  ] as const) {
    assert.equal((await app.inject({ method, url })).statusCode, 401, `${method} ${url} sem chave`);
    assert.equal((await app.inject({ method, url, headers: { "x-admin-key": CHAVE } })).statusCode, 503, `${method} ${url} com chave`);
  }
  await app.close();
});

test("tenant: a chave da instalação não grava mais financeiro nem confirmação", async () => {
  const app = Fastify();
  await app.register(tenantRoutes);
  await app.register(financeiroRoutes);
  for (const url of ["/v1/tenant/financeiro", "/v1/tenant/confirmacao"]) {
    const r = await app.inject({ method: "PUT", url, headers: { "x-install-key": "asa_qualquer" }, payload: { config: { ativo: true } } });
    assert.equal(r.statusCode, 403, url);
    assert.equal(r.json().erro, "SO_IMPLANTACAO");
  }
  await app.close();
});

test("página de implantação: servida com cabeçalhos de proteção, só os arquivos dela", async () => {
  const app = Fastify();
  await app.register(implantacaoRoutes);
  for (const [url, tipo] of [
    ["/implantacao", "text/html"],
    ["/implantacao/implantacao.js", "text/javascript"],
    ["/implantacao/implantacao.css", "text/css"],
  ]) {
    const r = await app.inject({ method: "GET", url });
    assert.equal(r.statusCode, 200, url);
    assert.ok(String(r.headers["content-type"]).startsWith(tipo), url);
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal(r.headers["content-security-policy"], "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    assert.equal(r.headers["x-frame-options"], "DENY");
    assert.equal(r.headers["referrer-policy"], "no-referrer");
  }
  for (const url of ["/implantacao/../src/config.ts", "/implantacao/outro.js", "/implantacao/%2e%2e/package.json"]) {
    assert.equal((await app.inject({ method: "GET", url })).statusCode, 404, url);
  }
  const html = (await app.inject({ method: "GET", url: "/implantacao" })).body;
  assert.doesNotMatch(html, /<script>|onclick=|style=/i, "sem script ou estilo inline (CSP)");
  const js = (await app.inject({ method: "GET", url: "/implantacao/implantacao.js" })).body;
  assert.doesNotMatch(js, /innerHTML|localStorage|sessionStorage/);
  await app.close();
});

test("admin: rota de ligar o ERP existe e exige a chave (a validação do endereço está em erp-padrao.test.ts)", async () => {
  const app = Fastify();
  await app.register(adminRoutes);
  const url = `/admin/tenants/${UUID}/erp`;
  assert.equal((await app.inject({ method: "PUT", url, payload: { erp: "padrao" } })).statusCode, 401);
  assert.equal((await app.inject({ method: "PUT", url, headers: { "x-admin-key": CHAVE }, payload: { erp: "padrao" } })).statusCode, 503);
  await app.close();
});
