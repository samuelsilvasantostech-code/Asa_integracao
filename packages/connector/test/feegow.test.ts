import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

// Feegow simulada com as respostas dos exemplos da documentação (docs.feegow.com).
const { FeegowAdapter, horariosDaResposta, lerVaga } = await import("../src/erp/feegow/adaptador.js");
const { camposDe } = await import("../src/erp/catalogo.js");

const log = { info() {}, warn() {} };
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

type Chamada = { metodo: string; caminho: string; params: Record<string, string>; corpo: any; token: string | null };
function feegow(rotas: Record<string, (c: Chamada) => [number, unknown]>) {
  const chamadas: Chamada[] = [];
  globalThis.fetch = (async (url: string, opt: any = {}) => {
    const u = new URL(url);
    const c: Chamada = {
      metodo: opt.method ?? "GET",
      caminho: u.pathname.replace("/v1/api", ""),
      params: Object.fromEntries(u.searchParams),
      corpo: opt.body ? JSON.parse(opt.body) : undefined,
      token: opt.headers?.["x-access-token"] ?? null,
    };
    chamadas.push(c);
    const f = rotas[`${c.metodo} ${c.caminho}`];
    const [status, corpo] = f ? f(c) : [404, { success: false, content: "rota" }];
    return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return chamadas;
}

const PROFISSIONAIS = { success: true, content: [
  { profissional_id: 11, nome: "Bruno Teste", especialidades: [{ especialidade_id: 4, nome_especialidade: "Acupuntura" }] },
  { profissional_id: 39, nome: "Ana Lima", especialidades: [{ especialidade_id: 95, nome_especialidade: "Clínica geral" }] },
] };
const HORARIOS = { success: true, content: { profissional_id: {
  "39": { local_id: { "0": { "2026-12-10": ["15:00:00", "15:30:00"] }, "15": { "2026-12-10": ["15:00:00", "16:00:00"], "2026-12-11": ["09:00:00"] } }, age_restriction: null },
  "11": { local_id: [{ "2026-12-10": ["08:00:00"] }], age_restriction: null },
} } };

test("horários: objeto por local e a lista (local 0) viram local, data e horas", () => {
  assert.deepEqual(horariosDaResposta(HORARIOS.content, "11"), [{ local: "0", data: "2026-12-10", horarios: ["08:00"] }]);
  assert.equal(horariosDaResposta(HORARIOS.content, "39").length, 3);
  assert.deepEqual(horariosDaResposta(HORARIOS.content, "999"), []);
});

test("horários livres: pela especialidade do profissional, sem repetir hora, vaga com local e especialidade", async () => {
  const ch = feegow({ "GET /professional/list": () => [200, PROFISSIONAIS], "GET /appoints/available-schedule": () => [200, HORARIOS] });
  const a = new FeegowAdapter({ token: "t-1" }, log);
  const r = await a.horariosLivres("39", "2026-12-10");
  assert.ok(r.ok);
  assert.deepEqual(r.dados.map((h) => h.horario), ["15:00", "15:30", "16:00"]);
  assert.deepEqual(lerVaga(r.dados[0].agenda_id), { local: "0", especialidade: "95" });
  const busca = ch.find((c) => c.caminho === "/appoints/available-schedule")!;
  assert.deepEqual([busca.params.tipo, busca.params.especialidade_id, busca.params.data_start, busca.params.data_end], ["E", "95", "10-12-2026", "10-12-2026"]);
  assert.equal(busca.token, "t-1");
  assert.equal(busca.params.unidade_id, undefined, "sem unidade: todas");
});

test("paciente: CPF não encontrado (409) é null; achado vem com nascimento e celular", async () => {
  feegow({ "GET /patient/search": (c) => (c.params.paciente_cpf === "01234567890"
    ? [200, { success: true, content: { id: 6563, nome: "Carlos Luiz", nascimento: "27-02-1986", celulares: ["21999887766", "21"], documentos: { cpf: "01234567890" } } }]
    : [409, { success: false, content: "Paciente não encontrado" }]) });
  const a = new FeegowAdapter({ token: "t" }, log);
  const achado = await a.buscarPaciente({ cpf: "012.345.678-90" });
  assert.deepEqual(achado, { ok: true, dados: { id: "6563", nome: "Carlos Luiz", nascimento: "1986-02-27", telefone: "21999887766", cpf: "01234567890" } });
  assert.deepEqual(await a.buscarPaciente({ cpf: "11111111111" }), { ok: true, dados: null });
});

test("erros: 403 é credencial; 409 de horário ocupado é recusa com código", async () => {
  feegow({ "GET /professional/list": () => [403, { success: false, content: "Chave inativa" }] });
  const r1 = await new FeegowAdapter({ token: "x" }, log).testarConexao();
  assert.ok(!r1.ok && r1.credencialInvalida);

  feegow({
    "GET /professional/list": () => [200, PROFISSIONAIS],
    "GET /procedures/list": () => [200, { success: true, content: [{ procedimento_id: 5, nome: "Consulta", valor: 25000 }] }],
    "POST /appoints/new-appoint": () => [409, { success: false, content: "Horário ocupado" }],
  });
  const r2 = await new FeegowAdapter({ token: "x" }, log).marcar({
    vaga: { prestador_id: "39", data: "2026-12-10", horario: "15:00", agenda_id: "fg:15:95" },
    convenio_id: "0", procedimento_id: "5",
    paciente: { paciente_id: "6563", nome: "Carlos", nascimento: "1986-02-27", telefone: "21999887766" },
  }, 30000);
  assert.ok(!r2.ok && r2.recusa && r2.codigoErp === "HORARIO_OCUPADO");
});

test("marcar paciente novo, particular: cadastra e marca com local, especialidade, valor em centavos e datas da Feegow", async () => {
  const ch = feegow({
    "POST /patient/create": () => [200, { success: true, content: { paciente_id: 6655 } }],
    "GET /procedures/list": () => [200, { success: true, content: [{ procedimento_id: 5, nome: "Consulta", valor: 25000 }] }],
    "POST /appoints/new-appoint": () => [200, { success: true, content: { agendamento_id: 43 } }],
    "GET /specialties/list": () => [200, { success: true, content: [{ especialidade_id: 95, nome: "Clínica geral" }] }],
  });
  const r = await new FeegowAdapter({ token: "t", unidade_id: "2" }, log).marcar({
    vaga: { prestador_id: "39", data: "2026-12-10", horario: "16:00", agenda_id: "fg:15:95" },
    convenio_id: "0", procedimento_id: "5",
    paciente: { nome: "Maria Souza", cpf: "52998224725", nascimento: "1990-05-01", telefone: "21988887777" },
  }, 30000);
  assert.ok(r.ok);
  assert.equal(r.dados.feito.agendamento_id, "43");
  assert.equal(r.dados.feito.paciente_id, "6655");
  assert.equal(r.dados.feito.setor, "Clínica geral");
  const cad = ch.find((c) => c.caminho === "/patient/create")!.corpo;
  assert.deepEqual([cad.nome_completo, cad.cpf, cad.data_nascimento, cad.celular], ["Maria Souza", "52998224725", "1990-05-01", "21988887777"]);
  const m = ch.find((c) => c.caminho === "/appoints/new-appoint")!.corpo;
  assert.deepEqual(
    { local: m.local_id, pac: m.paciente_id, prof: m.profissional_id, esp: m.especialidade_id, proc: m.procedimento_id, data: m.data, hora: m.horario, valor: m.valor, plano: m.plano },
    { local: 15, pac: 6655, prof: 39, esp: 95, proc: 5, data: "10-12-2026", hora: "16:00:00", valor: 25000, plano: 0 },
  );
});

test("status: confirmado e ausente pelo statusUpdate; cancelado pelo cancel-appoint", async () => {
  const ch = feegow({
    "POST /appoints/statusUpdate": () => [200, { success: true, content: { msg: "ok" } }],
    "POST /appoints/cancel-appoint": () => [200, { success: true, content: "Agendamento cancelado" }],
  });
  const a = new FeegowAdapter({ token: "t" }, log);
  assert.ok((await a.mudarStatus("100", "confirmado")).ok);
  assert.ok((await a.mudarStatus("100", "cancelado")).ok);
  assert.ok((await a.mudarStatus("100", "remarcar")).ok);
  assert.deepEqual(ch.map((c) => [c.caminho, c.corpo?.StatusID ?? c.corpo?.motivo_id]), [["/appoints/statusUpdate", 7], ["/appoints/cancel-appoint", 1]]);
});

test("catálogo: a Feegow pede o token e, opcional, a unidade", () => {
  const c = { slug: "feegow", nome: "Feegow", artigo: "o" as const, tipo: "codigo" as const, situacao: "homologacao" as const, versao: 1, config: null };
  assert.deepEqual(camposDe(c).map((f) => [f.chave, !!f.obrigatorio]), [["token", true], ["unidade_id", false]]);
});
