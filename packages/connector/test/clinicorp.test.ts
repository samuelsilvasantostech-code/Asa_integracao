import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

// Conector da Clinicorp (configuração) rodando no adaptador padrão, contra uma Clinicorp simulada com as
// respostas do Swagger (sistema.clinicorp.com/api-docs).
const { PadraoAdapter } = await import("../src/erp/padrao/adaptador.js");
const { lerConfigConector } = await import("../src/erp/catalogo.js");
const { mapearResposta } = await import("../src/erp/conector/motor.js");

const CFG = JSON.parse(readFileSync(new URL("../src/erp/conectores/clinicorp.json", import.meta.url), "utf8"));
const CRED = { usuario: "clinica-teste", token: "tok-1", clinica_id: "5759793708400640" };
const log = { info() {}, warn() {} };
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

type Chamada = { metodo: string; caminho: string; params: Record<string, string>; corpo: any; auth: string };
function clinicorp(rotas: Record<string, (c: Chamada) => [number, unknown]>) {
  const chamadas: Chamada[] = [];
  globalThis.fetch = (async (url: string, opt: any = {}) => {
    const u = new URL(url);
    const c: Chamada = { metodo: opt.method, caminho: u.pathname.replace("/rest/v1", ""), params: Object.fromEntries(u.searchParams), corpo: opt.body ? JSON.parse(opt.body) : undefined, auth: opt.headers?.Authorization ?? "" };
    chamadas.push(c);
    const f = rotas[`${c.metodo} ${c.caminho}`];
    const [status, corpo] = f ? f(c) : [404, { Error: 404, Message: "rota" }];
    return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return chamadas;
}
const adaptador = () => new PadraoAdapter(CRED, log, CFG, "clinicorp");

test("a configuração é válida e a migração 016 grava a mesma", () => {
  assert.ok(lerConfigConector(CFG).ok, JSON.stringify(lerConfigConector(CFG)));
  const sql = readFileSync(new URL("../migrations/016_conector_clinicorp.sql", import.meta.url), "utf8");
  const json = /'(\{.*\})'::jsonb/s.exec(sql)![1].replace(/''/g, "'");
  assert.deepEqual(JSON.parse(json), CFG);
});

test("motor: $se/$exceto filtram, $req lê o pedido, mais_dias soma datas", () => {
  const lista = [{ t: "A", p: 1, c: "" }, { t: "A", p: 2, c: "" }, { t: "E", p: 1, c: "" }, { t: "A", p: 1, c: "X" }];
  const r = mapearResposta({ $lista: "{{$raiz}}", $se: [["{{$.t}}", "A"], ["{{$.p | texto}}", "{{$req.query.p}}"]], $exceto: [["{{$.c}}", "X"]], $item: "{{$.p}}" }, lista, { query: { p: "1" } });
  assert.deepEqual(r, [1]);
  assert.equal(mapearResposta("{{$raiz | mais_dias:30}}", "2026-11-20"), "2026-12-20");
});

test("horários livres: profissional + clínica + dia em YYYYMMDD, Basic com ID de acesso e token, fim do horário na vaga", async () => {
  const ch = clinicorp({ "GET /business/list_available_times": () => [200, [{ date: 20261210, slots: [{ fromTime: "9:00", toTime: "9:30" }, { fromTime: "10:00", toTime: "10:30" }] }]] });
  const r = await adaptador().horariosLivres("5670262998564864", "2026-12-10");
  assert.deepEqual(r, { ok: true, dados: [{ horario: "09:00", agenda_id: "09:30" }, { horario: "10:00", agenda_id: "10:30" }] });
  assert.deepEqual(ch[0].params, { professionalId: "5670262998564864", clinicId: CRED.clinica_id, fromDate: "20261210", toDate: "20261210" });
  assert.equal(ch[0].auth, "Basic " + Buffer.from("clinica-teste:tok-1").toString("base64"));
});

test("dias disponíveis: só os dias com horário", async () => {
  clinicorp({ "GET /business/list_available_times": () => [200, [{ date: 20261210, slots: [{ fromTime: "09:00", toTime: "09:30" }] }, { date: 20261211, slots: [] }]] });
  assert.deepEqual(await adaptador().diasDisponiveis("1"), { ok: true, dados: ["2026-12-10"] });
});

test("paciente por CPF: objeto único vira o paciente; sem achar, null", async () => {
  clinicorp({ "GET /patient/get": (c) => [200, c.params.OtherDocumentId === "01234567890"
    ? { PatientId: 333, Name: "Lucas Gonçalves", Phone: "+55 (47) 98870-0805", OtherDocumentId: "012.345.678-90", BirthDate: "1990-05-01" }
    : {}] });
  const a = adaptador();
  assert.deepEqual(await a.buscarPaciente({ cpf: "01234567890" }), { ok: true, dados: { id: "333", nome: "Lucas Gonçalves", nascimento: "1990-05-01", telefone: "47988700805", cpf: "01234567890" } });
  assert.deepEqual(await a.buscarPaciente({ cpf: "99999999999" }), { ok: true, dados: null });
});

test("marcar paciente novo: o cadastro não devolve id, então busca pelo CPF; marca com início e fim", async () => {
  let criado = false;
  const ch = clinicorp({
    "POST /patient/create": () => { criado = true; return [200, { Name: "Maria Souza" }]; },
    "GET /patient/get": () => [200, criado ? { PatientId: 777, Name: "Maria Souza" } : {}],
    "POST /appointment/create_appointment_by_api": () => [200, [{ Status: "CREATED", id: 987654321 }]],
  });
  const r = await adaptador().marcar({
    vaga: { prestador_id: "5670262998564864", data: "2026-12-10", horario: "10:00", agenda_id: "10:30" },
    convenio_id: "0", procedimento_id: "1",
    paciente: { nome: "Maria Souza", cpf: "52998224725", nascimento: "1990-05-01", telefone: "47988887777" },
  }, 30000);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.dados.feito.agendamento_id, "987654321");
  assert.equal(r.dados.feito.paciente_id, "777");
  const cad = ch.find((c) => c.caminho === "/patient/create")!.corpo;
  assert.deepEqual(cad, { subscriber_id: "clinica-teste", Name: "Maria Souza", BirthDate: "1990-05-01", MobilePhone: "47988887777", OtherDocumentId: "52998224725" });
  const m = ch.find((c) => c.caminho === "/appointment/create_appointment_by_api")!.corpo;
  assert.deepEqual(m, { Patient_PersonId: 777, date: "2026-12-10T03:00:00.000Z", fromTime: "10:00", toTime: "10:30", Clinic_BusinessId: 5759793708400640, Dentist_PersonId: 5670262998564864 });
});

test("remarcar sem rota na Clinicorp: marca a nova e desmarca a antiga", async () => {
  const ch = clinicorp({
    "POST /appointment/create_appointment_by_api": () => [200, [{ Status: "CREATED", id: 2 }]],
    "POST /appointment/cancel_appointment": () => [200, [{ Id: 1, Deleted: "X" }]],
  });
  const r = await adaptador().marcar({
    vaga: { prestador_id: "9", data: "2026-12-11", horario: "09:00", agenda_id: "09:30" }, convenio_id: "0", procedimento_id: "1",
    paciente: { paciente_id: "333", nome: "Lucas", nascimento: "1990-05-01", telefone: "47988700805" }, remarcar: "1",
  }, 30000);
  assert.ok(r.ok);
  assert.deepEqual(ch.map((c) => c.caminho), ["/appointment/create_appointment_by_api", "/appointment/cancel_appointment"]);
  assert.deepEqual(ch[1].corpo, { subscriber_id: "clinica-teste", id: "1" });
});

test("agenda do dia: só o profissional pedido, sem eventos nem excluídos", async () => {
  clinicorp({ "GET /appointment/list": () => [200, [
    { ItemType: "APPOINTMENT", id: 10, fromTime: "09:00", Dentist_PersonId: 5, PatientName: "A", MobilePhone: "(47) 99999-0001" },
    { ItemType: "APPOINTMENT", id: 11, fromTime: "08:00", Dentist_PersonId: 6, PatientName: "B" },
    { ItemType: "EVENT", id: 12, fromTime: "12:00", Dentist_PersonId: 5, Name: "Almoço" },
    { ItemType: "APPOINTMENT", id: 13, fromTime: "10:00", Dentist_PersonId: 5, PatientName: "C", Deleted: "X" },
    { ItemType: "APPOINTMENT", id: 14, fromTime: "11:00", Dentist_PersonId: 5, PatientName: "D", Canceled: "X" },
  ]] });
  const r = await adaptador().agendaDoDia("5", "2026-12-10");
  assert.ok(r.ok);
  assert.deepEqual(r.dados.map((a) => [a.id, a.hora, a.paciente.nome, a.status]), [["10", "09:00", "A", null], ["14", "11:00", "D", "desmarcado"]]);
  assert.equal(r.dados[0].paciente.telefone, "47999990001");
});

test("status: confirmado vai ao confirm_appointment; ausente não tem rota e não chama a Clinicorp; cancelar", async () => {
  const ch = clinicorp({
    "POST /appointment/confirm_appointment": () => [200, [{ PatientConfirm: "X" }]],
    "POST /appointment/cancel_appointment": () => [200, [{ Deleted: "X" }]],
  });
  const a = adaptador();
  assert.ok((await a.mudarStatus("5778927598043136", "confirmado")).ok);
  const ausente = await a.mudarStatus("5778927598043136", "ausente");
  assert.ok(!ausente.ok && ausente.naoEncontrado);
  assert.ok((await a.mudarStatus("5778927598043136", "cancelado")).ok);
  assert.deepEqual(ch.map((c) => [c.caminho, c.corpo.id]), [["/appointment/confirm_appointment", 5778927598043136], ["/appointment/cancel_appointment", "5778927598043136"]]);
});

test("convênios: só Particular, sem chamar a Clinicorp; capacidades: confirmação sim, financeiro e grupos não", async () => {
  const ch = clinicorp({ "GET /appointment/list": () => [200, []] });
  const a = adaptador();
  assert.deepEqual(await a.conveniosDaVaga({ prestador_id: "1", data: "2026-12-10", horario: "09:00", agenda_id: "09:30" }), { ok: true, dados: [{ id: "0", nome: "Particular" }] });
  assert.deepEqual(await a.detectarCapacidades(), { financeiro: false, confirmacao: true, grupos_exames: false });
  assert.deepEqual(ch.map((c) => c.caminho), ["/appointment/list"]);
});

test("consultas a confirmar: do dia, sem desmarcadas, com celular para o WhatsApp", async () => {
  clinicorp({ "GET /appointment/list": () => [200, [
    { ItemType: "APPOINTMENT", id: 20, AtomicDate: 20261210, fromTime: "14:00", PatientName: "Lucas", MobilePhone: "(47) 98870-0805" },
    { ItemType: "APPOINTMENT", id: 21, AtomicDate: 20261210, fromTime: "15:00", PatientName: "X", Canceled: "X" },
  ]] });
  const r = await adaptador().consultasParaConfirmar("2026-12-10", "2026-12-10");
  assert.ok(r.ok);
  assert.deepEqual(r.dados.map((c) => [c.agendamento_id, c.data, c.hora, c.paciente, c.telefone]), [["20", "2026-12-10", "14:00", "Lucas", "5547988700805"]]);
});
