import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { after, before, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { Cache, chaveDaClinica, guardavel } from "../src/cache.js";
import { PadraoAdapter } from "../src/erp/padrao/adaptador.js";
import { extensaoRoutes } from "../src/routes/extensao.js";
import { criarErpSimulado } from "../tools/erp-simulado.js";

// Otimizações de latência: cache com validade, chamadas repetidas ao ERP que viram uma só, estáticos
// comprimidos e com ETag.

test("cache: pedidos iguais em andamento viram um; resposta boa fica guardada", async () => {
  const c = new Cache<number>(60_000);
  let chamadas = 0;
  const buscar = () => new Promise<number>((r) => { chamadas++; setTimeout(() => r(7), 10); });
  const [a, b] = await Promise.all([c.obter("k", buscar), c.obter("k", buscar)]);
  assert.equal(a + b, 14);
  assert.equal(await c.obter("k", buscar), 7);
  assert.equal(chamadas, 1);
});

test("cache: falha não fica guardada; validade vencida busca de novo", async () => {
  const c = new Cache<{ ok: boolean; naoEncontrado?: boolean }>(20);
  let n = 0;
  await c.obter("x", async () => { n++; return { ok: false }; }, guardavel);
  await c.obter("x", async () => { n++; return { ok: true }; }, guardavel);
  assert.equal(n, 2);
  await new Promise((r) => setTimeout(r, 30));
  await c.obter("x", async () => { n++; return { ok: true }; }, guardavel);
  assert.equal(n, 3);
  await assert.rejects(c.obter("y", async () => { throw new Error("boom"); }));
  assert.deepEqual(await c.obter("y", async () => ({ ok: true })), { ok: true });
});

test("cache: tamanho máximo tira o mais antigo; esquecer limpa por prefixo", async () => {
  const c = new Cache<number>(60_000, 2);
  let n = 0;
  const f = async () => ++n;
  await c.obter("a|1", f); await c.obter("a|2", f); await c.obter("b|1", f);
  assert.equal(await c.obter("a|1", f), 4); // saiu e foi buscada de novo
  c.esquecer("a|");
  assert.equal(await c.obter("a|2", f), 5);
});

test("chave da clínica muda com a credencial", () => {
  const t = { id: "t1", erp: "avelar", credencial: Buffer.from("um") };
  assert.notEqual(chaveDaClinica(t), chaveDaClinica({ ...t, credencial: Buffer.from("dois") }));
  assert.ok(chaveDaClinica(t).startsWith("t1|avelar|"));
});

/* ---------- adaptador padrão (Luna e afins) contra o ERP simulado, contando as chamadas ---------- */
const log = { info() {}, warn() {} };
let erp: FastifyInstance;
let base = "";
const chamadas: string[] = [];
const conta = (prefixo: string) => chamadas.filter((c) => c.startsWith(prefixo)).length;
const diaUtil = () => {
  for (let n = 1; ; n++) {
    const d = new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    if (![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay())) return d;
  }
};

before(async () => {
  erp = criarErpSimulado();
  erp.addHook("onRequest", async (req) => { chamadas.push(String(req.url).split("?")[0].replace(/^\/api\/v1/, "")); });
  await erp.listen({ port: 0, host: "127.0.0.1" });
  const addr = erp.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/v1`;
});
after(async () => { await erp.close(); });

test("paciente + consultas na mesma requisição: uma só busca do paciente no ERP", async () => {
  chamadas.length = 0;
  const a = new PadraoAdapter({ base_url: base, token: "token-de-teste" }, log);
  const [rp, rc] = await Promise.all([a.buscarPaciente({ cpf: "12345678909" }), a.consultasFuturas({ cpf: "12345678909" })]);
  assert.ok(rp.ok && rc.ok);
  assert.equal(conta("/pacientes"), 2); // /pacientes (1x) + /pacientes/{id}/agendamentos
  assert.equal(chamadas.filter((c) => c === "/pacientes").length, 1);
});

test("preços: guardados entre requisições da mesma credencial, e não entre credenciais", async () => {
  const vaga = { prestador_id: "101", data: diaUtil(), horario: "08:00", agenda_id: "x" };
  chamadas.length = 0;
  const r1 = await new PadraoAdapter({ base_url: base, token: "token-de-teste" }, log).procedimentosDaVaga(vaga, "0");
  const primeira = conta("/precos");
  assert.ok(r1.ok && primeira > 0);
  const r2 = await new PadraoAdapter({ base_url: base, token: "token-de-teste" }, log).procedimentosDaVaga({ ...vaga, horario: "09:00" }, "0");
  assert.deepEqual(r2, r1);
  assert.equal(conta("/precos"), primeira);
  await new PadraoAdapter({ base_url: base + "/", token: "token-de-teste", outra: 1 }, log).procedimentosDaVaga(vaga, "0");
  assert.equal(conta("/precos"), primeira * 2);
});

test("conexão: /status e /profissionais em paralelo, mesmo resultado", async () => {
  assert.deepEqual(await new PadraoAdapter({ base_url: base, token: "token-de-teste" }, log).testarConexao(), { ok: true, dados: { prestadores: 2 } });
});

/* ---------- estáticos da extensão ---------- */
test("extensão: brotli/gzip, ETag com 304, e cache longo só para arquivo com versão", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ext-"));
  writeFileSync(join(dir, "app.js"), "console.log('ola');\n".repeat(200));
  writeFileSync(join(dir, "chat.html"), "<!doctype html><p>oi</p>");
  const app = Fastify();
  await app.register(extensaoRoutes, { dir });

  const gz = await app.inject({ url: "/extensao/app.js?v=1", headers: { "accept-encoding": "gzip" } });
  assert.equal(gz.statusCode, 200);
  assert.equal(gz.headers["content-encoding"], "gzip");
  assert.equal(gz.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.equal(gunzipSync(gz.rawPayload).toString(), "console.log('ola');\n".repeat(200));
  assert.ok(gz.rawPayload.length < 200);

  const br = await app.inject({ url: "/extensao/app.js?v=1", headers: { "accept-encoding": "gzip, br" } });
  assert.equal(br.headers["content-encoding"], "br");

  const html = await app.inject({ url: "/extensao/chat.html" });
  assert.equal(html.headers["cache-control"], "no-cache");
  assert.equal(html.headers["content-encoding"], undefined);
  assert.equal(html.headers["content-security-policy"], "object-src 'none'; base-uri 'none'; form-action 'none'");
  assert.equal(gz.headers["content-security-policy"], undefined, "CSP só nas telas");
  const mesmo = await app.inject({ url: "/extensao/chat.html", headers: { "if-none-match": String(html.headers.etag) } });
  assert.equal(mesmo.statusCode, 304);

  assert.equal((await app.inject({ url: "/extensao/nada.js" })).statusCode, 404);
  assert.equal((await app.inject({ url: "/extensao/../package.json" })).statusCode, 404);
  await app.close();
});
