import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

// Conector da Avelar (sistema Luna) rodando no adaptador padrão, contra um Luna simulado com as respostas da
// documentação "API do Luna para a extensão Kentro". O Luna segue a especificação Kentro: a configuração não
// descreve rotas.
const { PadraoAdapter } = await import("../src/erp/padrao/adaptador.js");
const { lerConfigConector, lerCredencial } = await import("../src/erp/catalogo.js");

const CFG = JSON.parse(readFileSync(new URL("../src/erp/conectores/avelar.json", import.meta.url), "utf8"));
const PREFIXO = "/api/v1/kentro";
const BASE = "https://homolog.sistemaluna.com" + PREFIXO;
const CRED = { base_url: BASE, token: "tok-teste" };
const log = { info() {}, warn() {} };
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

type Chamada = { metodo: string; caminho: string; params: Record<string, string>; corpo: any; headers: Record<string, string> };
function luna(rotas: Record<string, (c: Chamada) => [number, unknown]>) {
  const chamadas: Chamada[] = [];
  globalThis.fetch = (async (url: string, opt: any = {}) => {
    const u = new URL(url);
    assert.ok(u.href.startsWith(BASE + "/"), u.href);
    const c: Chamada = { metodo: opt.method, caminho: u.pathname.slice(PREFIXO.length), params: Object.fromEntries(u.searchParams), corpo: opt.body ? JSON.parse(opt.body) : undefined, headers: opt.headers ?? {} };
    chamadas.push(c);
    const f = rotas[`${c.metodo} ${c.caminho}`];
    const [status, corpo] = f ? f(c) : [404, { erro: { codigo: "NAO_ENCONTRADO", mensagem: "Rota inexistente." } }];
    return new Response(status === 204 ? null : JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return chamadas;
}
const adaptador = () => new PadraoAdapter(CRED, log, CFG, "avelar");
const consulta = (id: string, extra: Record<string, unknown> = {}) => ({
  id, status: "agendado", data: "2026-11-27", horario: "10:00",
  paciente: { id: "paciente-8812", nome: "Maria da Silva", telefone: "5538999998888" },
  profissional: { id: "59632", nome: "Dra. Ana" }, especialidade: { id: "3", nome: "Cardiologia" },
  unidade: { id: "1", nome: "Avelar Centro", endereco: null, telefone: null, link_mapa: null },
  remarcado_de_id: null, remarcado_para_id: null, ...extra,
});
const vaga = (data = "2026-11-27") => ({ prestador_id: "59632", data, horario: "10:00", agenda_id: "9-1000" });

test("a configuração é válida e a migração 017 grava a mesma", () => {
  assert.ok(lerConfigConector(CFG).ok, JSON.stringify(lerConfigConector(CFG)));
  const sql = readFileSync(new URL("../migrations/017_conector_avelar.sql", import.meta.url), "utf8");
  const json = /'(\{.*\})'::jsonb/s.exec(sql)![1].replace(/''/g, "'");
  assert.deepEqual(JSON.parse(json), CFG);
});

test("credencial: os dois endereços do Luna passam; HTTP, endereço interno e token vazio não", () => {
  for (const base_url of [BASE, "https://www.sistemaluna.com/api/v1/kentro/"]) {
    const r = lerCredencial(CFG.campos, { base_url, token: "abc" });
    assert.ok(r.ok, JSON.stringify(r));
  }
  assert.deepEqual(lerCredencial(CFG.campos, { base_url: "http://www.sistemaluna.com/api/v1/kentro", token: "abc" }), { ok: false, erro: "ERP_URL_INVALIDA", campo: "base_url" });
  assert.deepEqual(lerCredencial(CFG.campos, { base_url: "https://127.0.0.1/api", token: "abc" }), { ok: false, erro: "ERP_URL_INVALIDA", campo: "base_url" });
  assert.deepEqual(lerCredencial(CFG.campos, { base_url: BASE }), { ok: false, erro: "CAMPO_OBRIGATORIO", campo: "token" });
});

test("testar conexão: Bearer no endereço da clínica", async () => {
  const ch = luna({
    "GET /status": () => [200, { status: "ok" }],
    "GET /profissionais": () => [200, { dados: [{ id: "59632", nome: "Dra. Ana", tipo_agenda: "horario_marcado" }], paginacao: { pagina: 1, por_pagina: 50, total: 1 } }],
  });
  assert.deepEqual(await adaptador().testarConexao(), { ok: true, dados: { prestadores: 1 } });
  assert.equal(ch[0].headers.Authorization, "Bearer tok-teste");
});

test("token recusado (401 NAO_AUTENTICADO) vira credencial inválida", async () => {
  luna({ "GET /status": () => [401, { erro: { codigo: "NAO_AUTENTICADO", mensagem: "Token inválido." } }] });
  const r: any = await adaptador().testarConexao();
  assert.equal(r.ok, false);
  assert.equal(r.erro, "ERP_CREDENCIAL_INVALIDA");
});

test("capacidades: sem /contas e /confirmacoes no Luna, financeiro e confirmação ficam desligados", async () => {
  luna({ "GET /grupos-procedimento": () => [200, { dados: [{ id: "1", nome: "Exames de imagem" }] }] });
  assert.deepEqual(await adaptador().detectarCapacidades(), { financeiro: false, confirmacao: false, grupos_exames: true });
});

test("marcar paciente novo: telefone com DDI, Idempotency-Key no cadastro e na consulta, id com o tipo", async () => {
  const ch = luna({
    "POST /pacientes": () => [201, { id: "paciente-8812", nome: "Maria da Silva" }],
    "POST /agendamentos": () => [201, consulta("42655586")],
  });
  const r: any = await adaptador().marcar({
    vaga: vaga(), convenio_id: "particular", procedimento_id: "77",
    paciente: { nome: "Maria da Silva", cpf: "52998224725", nascimento: "1985-04-12", telefone: "38999998888" },
    idempotencia: "chave-1",
  }, 30000);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.dados.feito.agendamento_id, "42655586");
  assert.equal(r.dados.feito.paciente_id, "paciente-8812");
  assert.equal(r.dados.feito.clinica, "Avelar Centro");
  assert.equal(ch[0].corpo.telefones[0].numero, "5538999998888");
  assert.equal(ch[0].headers["Idempotency-Key"], "chave-1-paciente");
  assert.equal(ch[1].headers["Idempotency-Key"], "chave-1");
  assert.deepEqual(
    { paciente_id: ch[1].corpo.paciente_id, slot_id: ch[1].corpo.slot_id, convenio_id: ch[1].corpo.convenio_id, procedimento_ids: ch[1].corpo.procedimento_ids },
    { paciente_id: "paciente-8812", slot_id: "9-1000", convenio_id: "particular", procedimento_ids: ["77"] },
  );
});

test("CPF já cadastrado (409 PACIENTE_JA_EXISTE): usa o cadastro achado pelo CPF", async () => {
  const ch = luna({
    "POST /pacientes": () => [409, { erro: { codigo: "PACIENTE_JA_EXISTE", mensagem: "CPF já cadastrado.", paciente_id: "titular-45" } }],
    "GET /pacientes": () => [200, { dados: [{ id: "titular-45", nome: "João Souza", cpf: "52998224725" }] }],
    "POST /agendamentos": (c) => [201, consulta("500", { paciente: { id: c.corpo.paciente_id } })],
  });
  const r: any = await adaptador().marcar({
    vaga: vaga(), convenio_id: "avelar", procedimento_id: "77",
    paciente: { nome: "João Souza", cpf: "52998224725", nascimento: "1980-01-01", telefone: "38988887777" },
    idempotencia: "chave-2",
  }, 30000);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(ch[1].params.cpf, "52998224725");
  assert.equal(ch[2].corpo.paciente_id, "titular-45");
  assert.equal(r.dados.feito.paciente_id, "titular-45");
});

test("remarcar: o Luna move a consulta (200, mesmo id) e não há cancelamento separado", async () => {
  const ch = luna({ "POST /agendamentos/42655586/remarcar": () => [200, consulta("42655586", { data: "2026-11-28" })] });
  const r: any = await adaptador().marcar({
    vaga: vaga("2026-11-28"), convenio_id: "particular", procedimento_id: "77",
    paciente: { paciente_id: "paciente-8812" }, remarcar: "42655586", idempotencia: "chave-3",
  }, 30000);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.dados.feito.agendamento_id, "42655586");
  assert.equal(ch.length, 1);
  assert.equal(ch[0].headers["Idempotency-Key"], "chave-3");
  assert.equal(ch[0].corpo.slot_id, "9-1000");
});

test("recusas do Luna chegam com o código: HORARIO_OCUPADO e FORA_DA_GRADE", async () => {
  for (const [status, codigo] of [[409, "HORARIO_OCUPADO"], [422, "FORA_DA_GRADE"]] as const) {
    luna({ "POST /agendamentos": () => [status, { erro: { codigo, mensagem: "Não foi possível marcar." } }] });
    const r: any = await adaptador().marcar({
      vaga: vaga(), convenio_id: "particular", procedimento_id: "77", paciente: { paciente_id: "paciente-8812" }, idempotencia: "k",
    }, 30000);
    assert.equal(r.ok, false);
    assert.equal(r.erro, "ERP_RECUSOU");
    assert.equal(r.codigoErp, codigo);
  }
});

test("limite de requisições (429) é tratado como indisponibilidade, não como recusa", async () => {
  luna({ "GET /status": () => [429, { erro: { codigo: "LIMITE_REQUISICOES", mensagem: "Tente de novo." } }] });
  const r: any = await adaptador().testarConexao();
  assert.equal(r.erro, "ERP_FORA_DO_AR");
});

test("cadastro avulso: paciente novo volta com o id do Luna; CPF já cadastrado volta o existente, sem alterar", async () => {
  const novo = { nome: "Maria da Silva", cpf: "52998224725", nascimento: "1985-04-12", telefone: "38999998888" };
  let ch = luna({ "POST /pacientes": () => [201, { id: "paciente-8812", nome: "Maria da Silva" }] });
  let r: any = await adaptador().cadastrarPaciente(novo, { idempotencia: "chave-p", timeoutMs: 30000 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([r.dados.paciente.id, r.dados.jaExistia], ["paciente-8812", false]);
  assert.equal(ch[0].headers["Idempotency-Key"], "chave-p");
  assert.equal(ch[0].corpo.telefones[0].numero, "5538999998888");

  ch = luna({
    "POST /pacientes": () => [409, { erro: { codigo: "PACIENTE_JA_EXISTE", mensagem: "CPF já cadastrado.", paciente_id: "titular-45" } }],
    "GET /pacientes": () => [200, { dados: [{ id: "titular-45", nome: "João Souza", cpf: "52998224725" }] }],
  });
  r = await adaptador().cadastrarPaciente(novo, { timeoutMs: 30000 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([r.dados.paciente.id, r.dados.jaExistia], ["titular-45", true]);
  assert.equal(ch.filter((c) => c.metodo === "POST").length, 1);
});

test("cadastro avulso: recusa de validação sem cadastro pelo CPF chega como recusa", async () => {
  luna({
    "POST /pacientes": () => [422, { erro: { codigo: "VALIDACAO", mensagem: "Dados inválidos.", campos: { nascimento: "data futura" } } }],
    "GET /pacientes": () => [200, { dados: [] }],
  });
  const r: any = await adaptador().cadastrarPaciente({ nome: "Maria da Silva", cpf: "52998224725", nascimento: "2030-01-01", telefone: "38999998888" }, { timeoutMs: 30000 });
  assert.equal(r.ok, false);
  assert.equal(r.erro, "ERP_RECUSOU");
  assert.match(r.msg, /nascimento: data futura/);
});
