import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { lerCapacidades, sistemaDe } from "../src/erp/capacidades.js";
import { PadraoAdapter } from "../src/erp/padrao/adaptador.js";
import { lerDadosTenant } from "../src/implantacao.js";
import { criarErpSimulado } from "../tools/erp-simulado.js";

const log = { info() {}, warn() {} };

test("capacidades: padrão por ERP antes da detecção; o gravado vale por cima", () => {
  assert.deepEqual(lerCapacidades("asa", null), { financeiro: true, confirmacao: true, grupos_exames: true });
  assert.deepEqual(lerCapacidades("padrao", null), { financeiro: false, confirmacao: false, grupos_exames: false });
  assert.deepEqual(lerCapacidades("padrao", { financeiro: true, lixo: 1, confirmacao: "sim" }), { financeiro: true, confirmacao: false, grupos_exames: false });
  assert.deepEqual(lerCapacidades("outro", null), { financeiro: false, confirmacao: false, grupos_exames: false });
});

test("sistema: nome e artigo cadastrados; sem nome, 'o sistema da clínica'", () => {
  assert.deepEqual(sistemaDe("Asa", "a"), { nome: "Asa", artigo: "a" });
  assert.deepEqual(sistemaDe("Feegow", null), { nome: "Feegow", artigo: "o" });
  assert.deepEqual(sistemaDe("  ", "a"), { nome: "sistema da clínica", artigo: "o" });
  assert.deepEqual(sistemaDe(null, null, "asa"), { nome: "Asa", artigo: "a" });
  assert.deepEqual(sistemaDe(null, null, "padrao"), { nome: "sistema da clínica", artigo: "o" });
});

test("implantação: nome do sistema e artigo validados", () => {
  assert.deepEqual(lerDadosTenant({ sistema_nome: " Clínica Saúde+ ", sistema_artigo: "a" }, ["sistema_nome", "sistema_artigo"]), { ok: false, erro: "SISTEMA_INVALIDO" });
  assert.deepEqual(lerDadosTenant({ sistema_nome: " Feegow ", sistema_artigo: "o" }, ["sistema_nome", "sistema_artigo"]), { ok: true, campos: { sistema_nome: "Feegow", sistema_artigo: "o" } });
  assert.deepEqual(lerDadosTenant({ sistema_artigo: "os" }, ["sistema_artigo"]), { ok: false, erro: "ARTIGO_INVALIDO" });
  assert.deepEqual(lerDadosTenant({ sistema_nome: "<b>x</b>" }, ["sistema_nome"]), { ok: false, erro: "SISTEMA_INVALIDO" });
  assert.deepEqual(lerDadosTenant({ sistema_nome: "" }, ["sistema_nome"]), { ok: true, campos: { sistema_nome: null } });
});

let completo: FastifyInstance;
let minimo: FastifyInstance;
const urlDe = (app: FastifyInstance) => {
  const a = app.server.address();
  return `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/api/v1`;
};

before(async () => {
  completo = criarErpSimulado();
  minimo = criarErpSimulado({ semRotas: ["/contas", "/confirmacoes", "/grupos-procedimento"] });
  await completo.listen({ port: 0, host: "127.0.0.1" });
  await minimo.listen({ port: 0, host: "127.0.0.1" });
});
after(async () => {
  await completo.close();
  await minimo.close();
});

test("detecção no padrão Kentro: ERP com as rotas desejáveis", async () => {
  const caps = await new PadraoAdapter({ base_url: urlDe(completo), token: "token-de-teste" }, log).detectarCapacidades();
  assert.deepEqual(caps, { financeiro: true, confirmacao: true, grupos_exames: true });
});

test("detecção no padrão Kentro: ERP só com as obrigatórias", async () => {
  const a = new PadraoAdapter({ base_url: urlDe(minimo), token: "token-de-teste" }, log);
  assert.ok((await a.testarConexao()).ok, "as obrigatórias continuam funcionando");
  assert.deepEqual(await a.detectarCapacidades(), { financeiro: false, confirmacao: false, grupos_exames: false });
});
