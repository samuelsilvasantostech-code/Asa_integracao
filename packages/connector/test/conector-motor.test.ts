import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { mapearResposta, montarRequisicao, renderizarRequisicao, rotaDaEspecificacao, validarConector, type ConectorConfig } from "../src/erp/conector/motor.js";
import { PadraoAdapter } from "../src/erp/padrao/adaptador.js";

// O motor de conectores: um ERP de outro formato (estilo Feegow: x-access-token, rotas em inglês, datas
// DD-MM-YYYY, recusa com HTTP 200) passa a funcionar com o adaptador padrão só por configuração.

const log = { info() {}, warn() {} };

test("rotas: reconhece a rota da especificação e o id", () => {
  assert.deepEqual(rotaDaEspecificacao("GET", "/pacientes/8812/agendamentos"), { chave: "GET /pacientes/{id}/agendamentos", path: { id: "8812" } });
  assert.deepEqual(rotaDaEspecificacao("POST", "/agendamentos"), { chave: "POST /agendamentos", path: {} });
  assert.equal(rotaDaEspecificacao("DELETE", "/agendamentos"), null);
});

test("modelos: fontes, filtros e tipo preservado", () => {
  const e = { path: { id: "7" }, query: { cpf: "123.456.789-09" }, corpo: { data: "2026-11-20", horario: "08:30", valor: "150.00", ids: ["a"] }, cred: { token: "t" } };
  assert.deepEqual(renderizarRequisicao({
    d: "{{corpo.data | data:DD-MM-YYYY}}", h: "{{corpo.horario | hora:HH:MM:SS}}", v: "{{corpo.valor | centavos}}",
    cpf: "{{query.cpf | digitos}}", ids: "{{corpo.ids}}", url: "/x/{{path.id}}/y", vazio: "{{corpo.nada}}", p: "{{corpo.nada | padrao:0}}",
  }, e), { d: "20-11-2026", h: "08:30:00", v: 15000, cpf: "12345678909", ids: ["a"], url: "/x/7/y", p: "0" });
});

test("resposta: listas, caminhos, datas e mapa de valores", () => {
  const corpo = { content: [{ id: 5, nascimento: "12-04-1985", status_id: 3, hora: "08:30:00" }], total: 1 };
  const mapa = { dados: { $lista: "{{$.content}}", $item: { id: "{{$.id | texto}}", nascimento: "{{$.nascimento | data_iso:DD-MM-YYYY}}", status: "{{$.status_id | mapa:1=agendado,3=confirmado}}", inicio: "{{$.hora | hora_curta}}", fixo: "agendamento" } }, total: "{{$raiz.total}}" };
  assert.deepEqual(mapearResposta(mapa, corpo), { dados: [{ id: "5", nascimento: "1985-04-12", status: "confirmado", inicio: "08:30", fixo: "agendamento" }], total: 1 });
});

test("validação: aponta rota, filtro e campos errados", () => {
  const r = validarConector({ versao: 1, base_url: "x", autenticacao: { tipo: "oauth" }, campos: [{ chave: "Token", tipo: "x" }], rotas: { "GET /nada": { metodo: "GET", caminho: "/a" }, "GET /pacientes": { metodo: "GET", caminho: "a", query: { x: "{{query.a | inventado}}" } } } });
  assert.equal(r.ok, false);
  if (r.ok) return;
  for (const esperado of ["autenticacao.tipo", "campos[0].chave", "campos[0].rotulo", "campos[0].tipo", "rota desconhecida: GET /nada", "GET /pacientes: caminho", "filtro desconhecido: inventado"]) {
    assert.ok(r.erros.some((e) => e.includes(esperado)), esperado);
  }
});

test("requisição: autenticação por header, query de busca e corpo em formulário", () => {
  const c: ConectorConfig = { versao: 1, base_url: "https://erp.exemplo.com/v1", autenticacao: { tipo: "header", header: "x-access-token", campo: "token" }, cabecalhos: { "x-clinica": "{{cred.clinica}}" }, idempotencia_header: null, campos: [], rotas: {} };
  const r = montarRequisicao(c, { metodo: "POST", caminho: "/patient/create", corpo: { nome: "{{corpo.nome}}" }, formato_corpo: "form" }, { metodo: "POST", caminho: "/pacientes" }, { path: {}, query: {}, corpo: { nome: "Ana" }, cred: { token: "abc", clinica: "12" } }, "chave-1");
  assert.equal(r.url, "https://erp.exemplo.com/v1/patient/create");
  assert.equal(r.headers["x-access-token"], "abc");
  assert.equal(r.headers["x-clinica"], "12");
  assert.equal(r.headers["Idempotency-Key"], undefined);
  assert.equal(r.body, "nome=Ana");
});

/* ---------- ERP falso no estilo Feegow ---------- */

const TOKEN = "tok-feegowlike";
let erp: FastifyInstance;
let base = "";
const marcados = new Map<string, { id: string; paciente_id: string; profissional_id: string; data: string; horario: string; status_id: number }>();

before(async () => {
  erp = Fastify();
  erp.addHook("onRequest", async (req, reply) => {
    if (req.headers["x-access-token"] !== TOKEN) return reply.code(401).send({ success: false, content: "Token inválido" });
  });
  erp.get<{ Querystring: Record<string, string> }>("/v1/api/patient/search", async (req) => {
    const achou = req.query.paciente_cpf === "12345678909" || req.query.telefone === "27999998888";
    return { success: true, content: achou ? [{ id: 8812, nome: "Maria da Silva", nascimento: "12-04-1985", cpf: "12345678909", celulares: ["27999998888"] }] : [] };
  });
  erp.get("/v1/api/professional/list", async () => ({ success: true, content: [{ profissional_id: 101, nome: "Dra. Ana", especialidades: [{ especialidade_id: 3, nome_especialidade: "Cardiologia" }] }] }));
  erp.get("/v1/api/specialties/list", async () => ({ success: true, content: [{ especialidade_id: 3, nome: "Cardiologia" }] }));
  erp.get<{ Querystring: Record<string, string> }>("/v1/api/appoints/available-schedule", async (req) => {
    if (!/^\d{2}-\d{2}-\d{4}$/.test(req.query.data_start ?? "")) return { success: false, content: "data_start inválida" };
    const ocupados = [...marcados.values()].filter((m) => m.status_id !== 11).map((m) => m.horario);
    return { success: true, content: { horarios: ["08:00:00", "08:30:00", "09:00:00"].filter((h) => !ocupados.includes(h)) } };
  });
  erp.post<{ Body: Record<string, any> }>("/v1/api/appoints/new-appoint", async (req) => {
    const b = req.body;
    if (!/^\d{2}-\d{2}-\d{4}$/.test(b.data) || !/^\d{2}:\d{2}:\d{2}$/.test(b.horario)) return { success: false, content: "Data ou horário em formato inválido" };
    if ([...marcados.values()].some((m) => m.horario === b.horario && m.status_id !== 11)) return { success: false, content: "Horário indisponível" };
    const id = String(90000 + marcados.size);
    marcados.set(id, { id, paciente_id: String(b.paciente_id), profissional_id: String(b.profissional_id), data: b.data, horario: b.horario, status_id: 1 });
    return { success: true, content: { agendamento_id: Number(id) } };
  });
  erp.post<{ Body: Record<string, any> }>("/v1/api/appoints/statusUpdate", async (req) => {
    const m = marcados.get(String(req.body.agendamento_id));
    if (!m) return { success: false, content: "Agendamento não encontrado" };
    m.status_id = Number(req.body.status_id);
    return { success: true, content: "ok" };
  });
  await erp.listen({ port: 0, host: "127.0.0.1" });
  const a = erp.server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/v1/api`;
});
after(async () => {
  await erp.close();
});

// O conector, como ficaria no catálogo. Só as rotas que este ERP tem.
const conector = (): ConectorConfig => ({
  versao: 1,
  base_url: base,
  autenticacao: { tipo: "header", header: "x-access-token", campo: "token" },
  idempotencia_header: null,
  campos: [{ chave: "token", rotulo: "Token da API", tipo: "segredo", obrigatorio: true }],
  rotas: {
    "GET /status": { metodo: "GET", caminho: "/specialties/list", resposta: { ok: true } },
    "GET /pacientes": {
      metodo: "GET", caminho: "/patient/search",
      query: { paciente_cpf: "{{query.cpf}}", telefone: "{{query.telefone | sem_ddi}}" },
      resposta: { dados: { $lista: "{{$.content}}", $item: { id: "{{$.id | texto}}", nome: "{{$.nome}}", cpf: "{{$.cpf}}", nascimento: "{{$.nascimento | data_iso:DD-MM-YYYY}}", telefones: { $lista: "{{$.celulares}}", $item: { numero: "{{$}}", principal: true } } } } },
    },
    "GET /especialidades": { metodo: "GET", caminho: "/specialties/list", resposta: { dados: { $lista: "{{$.content}}", $item: { id: "{{$.especialidade_id | texto}}", nome: "{{$.nome}}" } } } },
    "GET /profissionais": {
      metodo: "GET", caminho: "/professional/list", query: { ativo: "1" },
      resposta: { dados: { $lista: "{{$.content}}", $item: { id: "{{$.profissional_id | texto}}", nome: "{{$.nome}}", tipo_agenda: "horario_marcado", especialidades: { $lista: "{{$.especialidades}}", $item: { id: "{{$.especialidade_id | texto}}", nome: "{{$.nome_especialidade}}" } } } } },
    },
    "GET /profissionais/{id}/horarios-disponiveis": {
      metodo: "GET", caminho: "/appoints/available-schedule",
      query: { profissional_id: "{{path.id}}", data_start: "{{query.data | data:DD-MM-YYYY}}", data_end: "{{query.data | data:DD-MM-YYYY}}", tipo: "E" },
      resposta: { horarios: { $lista: "{{$.content.horarios}}", $item: { inicio: "{{$ | hora_curta}}" } } },
    },
    "POST /agendamentos": {
      metodo: "POST", caminho: "/appoints/new-appoint",
      corpo: { paciente_id: "{{corpo.paciente_id}}", profissional_id: "{{corpo.profissional_id}}", procedimento_id: "{{corpo.procedimento_ids[0]}}", data: "{{corpo.data | data:DD-MM-YYYY}}", horario: "{{corpo.horario | hora:HH:MM:SS}}" },
      resposta: { id: "{{$.content.agendamento_id | texto}}", status: "agendado" },
    },
    "POST /agendamentos/{id}/cancelar": { metodo: "POST", caminho: "/appoints/statusUpdate", corpo: { agendamento_id: "{{path.id}}", status_id: 11 }, resposta: { status: "cancelado" } },
    "POST /agendamentos/{id}/status": { metodo: "POST", caminho: "/appoints/statusUpdate", corpo: { agendamento_id: "{{path.id}}", status_id: "{{corpo.status | mapa:confirmado=7,ausente=6}}" }, resposta: { status: "{{$raiz.content}}" } },
  },
  erros: {
    credencial: [{ status: 401 }],
    nao_encontrado: [{ caminho: "{{$.content}}", contem: "não encontrado" }],
    recusa: [{ caminho: "{{$.success}}", igual: false }],
    mensagem: "{{$.content}}",
  },
});

test("conector válido pela validação do motor", () => {
  const r = validarConector(conector());
  assert.ok(r.ok, r.ok ? "" : r.erros.join("; "));
});

const ad = (token = TOKEN) => new PadraoAdapter({ token }, log, conector(), "feegowlike");

test("ERP de outro formato: conexão, paciente, profissionais e horários pela configuração", async () => {
  const a = ad();
  assert.equal(a.erp, "feegowlike");
  assert.deepEqual(await a.testarConexao(), { ok: true, dados: { prestadores: 1 } });
  const p = await a.buscarPaciente({ telefone: "27999998888" });
  assert.deepEqual(p, { ok: true, dados: { id: "8812", nome: "Maria da Silva", nascimento: "1985-04-12", telefone: "27999998888", cpf: "12345678909" } });
  const ep = await a.especialidadesEPrestadores();
  assert.ok(ep.ok && ep.dados.prestadores[0].especialidade === "Cardiologia" && ep.dados.especialidades[0].id === "3");
  const h = await a.horariosLivres("101", "2026-11-20");
  assert.deepEqual(h, { ok: true, dados: [{ horario: "08:00", agenda_id: "h-0800" }, { horario: "08:30", agenda_id: "h-0830" }, { horario: "09:00", agenda_id: "h-0900" }] });
});

test("ERP de outro formato: marcar, recusa com HTTP 200, cancelar e status mapeado", async () => {
  const a = ad();
  const vaga = { prestador_id: "101", data: "2026-11-20", horario: "08:30", agenda_id: "h-0830" };
  const pac = { paciente_id: "8812", nome: "Maria da Silva", nascimento: "1985-04-12", telefone: "27999998888" };
  const m = await a.marcar({ vaga, convenio_id: "0", procedimento_id: "p1", paciente: pac }, 5000);
  assert.ok(m.ok && m.dados.feito.agendamento_id === "90000", JSON.stringify(m));
  const marcado = marcados.get("90000")!;
  assert.equal(marcado.data, "20-11-2026");
  assert.equal(marcado.horario, "08:30:00");

  const de_novo = await a.marcar({ vaga, convenio_id: "0", procedimento_id: "p1", paciente: pac }, 5000);
  assert.ok(!de_novo.ok && de_novo.recusa && de_novo.erro === "ERP_RECUSOU" && de_novo.msg === "Horário indisponível", JSON.stringify(de_novo));

  assert.ok((await a.mudarStatus("90000", "confirmado")).ok);
  assert.equal(marcados.get("90000")!.status_id, 7);
  assert.ok((await a.mudarStatus("90000", "cancelado")).ok);
  assert.equal(marcados.get("90000")!.status_id, 11);
  const nada = await a.mudarStatus("1", "cancelado");
  assert.ok(!nada.ok && nada.naoEncontrado, JSON.stringify(nada));
});

test("ERP de outro formato: rota que o conector não descreve é recurso que o ERP não tem", async () => {
  const a = ad();
  const contas = await a.lancarConta({ paciente_id: "8812", valor: "10.00", forma: "pix", id_externo: "k-1" });
  assert.ok(!contas.ok && contas.naoEncontrado);
  assert.deepEqual(await a.detectarCapacidades(), { financeiro: false, confirmacao: false, grupos_exames: false });
});

test("ERP de outro formato: token errado vira credencial inválida", async () => {
  const r = await ad("errado").testarConexao();
  assert.ok(!r.ok && r.credencialInvalida && r.msg === "Token inválido", JSON.stringify(r));
});
