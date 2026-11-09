import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { baseUrlValida, criarAdaptador } from "../src/erp/index.js";
import { PadraoAdapter } from "../src/erp/padrao/adaptador.js";
import { criarErpSimulado } from "../tools/erp-simulado.js";

// O adaptador Padrão Kentro contra o ERP simulado (que segue a especificação), de ponta a ponta.

const log = { info() {}, warn() {} };
let erp: FastifyInstance;
let base = "";
const ad = () => new PadraoAdapter({ base_url: base, token: "token-de-teste" }, log);

// Próximo dia útil a partir de amanhã, no fuso da clínica.
const diaUtil = (desde = 1) => {
  for (let n = desde; ; n++) {
    const d = new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    if (![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay())) return d;
  }
};

before(async () => {
  erp = criarErpSimulado();
  await erp.listen({ port: 0, host: "127.0.0.1" });
  const addr = erp.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/v1`;
});
after(async () => {
  await erp.close();
});

test("registro: 'padrao' cria o adaptador da especificação", () => {
  assert.equal(criarAdaptador("padrao", { base_url: "https://erp.exemplo.com/api/v1", token: "t" }, log).erp, "padrao");
});

test("endereço do ERP: só HTTPS público, sem credencial, query ou fragmento", () => {
  assert.equal(baseUrlValida("https://erp.exemplo.com/api/v1/"), "https://erp.exemplo.com/api/v1");
  for (const ruim of [
    "http://erp.exemplo.com/api/v1", "https://user:senha@erp.exemplo.com", "https://erp.exemplo.com/api?x=1", "https://erp.exemplo.com/#a",
    "https://localhost/api", "https://127.0.0.1/api", "https://10.1.2.3/api", "https://192.168.0.5/api", "https://172.20.0.1/api",
    "https://169.254.169.254/latest", "https://[::1]/api", "https://banco.internal/api", "ftp://erp.exemplo.com", "", null,
  ]) {
    assert.equal(baseUrlValida(ruim), null, String(ruim));
  }
});

test("conexão: /status e a lista de profissionais", async () => {
  assert.deepEqual(await ad().testarConexao(), { ok: true, dados: { prestadores: 2 } });
});

test("credencial errada: credencialInvalida, código ERP_CREDENCIAL_INVALIDA", async () => {
  const r = await new PadraoAdapter({ base_url: base, token: "errado" }, log).testarConexao();
  assert.ok(!r.ok && r.credencialInvalida && r.erro === "ERP_CREDENCIAL_INVALIDA" && r.status === 401);
});

test("ERP fora do ar: semResposta (gravação fica incerta)", async () => {
  const r = await new PadraoAdapter({ base_url: "http://127.0.0.1:1/api/v1", token: "t" }, log).mudarStatus("1", "confirmado");
  assert.ok(!r.ok && r.semResposta && r.status === 0);
});

test("paciente: acha pelo telefone com ou sem DDI, e pelo CPF; desconhecido é null", async () => {
  const a = ad();
  for (const busca of [{ telefone: "27999998888" }, { cpf: "12345678909" }]) {
    const r = await a.buscarPaciente(busca);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.dados, { id: "8812", nome: "Maria da Silva", nascimento: "1985-04-12", telefone: "5527999998888", cpf: "12345678909" });
  }
  assert.deepEqual(await a.buscarPaciente({ telefone: "11900000000" }), { ok: true, dados: null });
  assert.deepEqual(await a.consultasFuturas({ telefone: "11900000000" }), { ok: true, dados: { consultas: [], cpf: null } });
});

test("cadastros: especialidades, prestadores, convênios, procedimentos com preço, catálogo e grupos", async () => {
  const a = ad();
  const ep = await a.especialidadesEPrestadores();
  assert.ok(ep.ok);
  if (ep.ok) {
    assert.equal(ep.dados.especialidades.length, 2);
    assert.deepEqual(ep.dados.prestadores[0], { id: "101", nome: "Dra. Ana Souza", especialidade_id: "3", especialidade: "Cardiologia", ordem_chegada: false });
  }
  const vaga = { prestador_id: "101", data: diaUtil(), horario: "08:00", agenda_id: "x" };
  const conv = await a.conveniosDaVaga(vaga);
  assert.deepEqual(conv.ok && conv.dados.map((c) => c.id), ["0", "5"]);
  const procs = await a.procedimentosDaVaga(vaga, "0");
  assert.ok(procs.ok);
  if (procs.ok) assert.deepEqual(procs.dados.find((p) => p.id === "p-consulta-cardio"), { id: "p-consulta-cardio", nome: "Consulta cardiológica", valor: 250, procedimento_id: "p-consulta-cardio" });
  const pag = await a.examesPagina(1, "hemo");
  assert.ok(pag.ok && pag.dados.ultima && pag.dados.exames[0].tipo === "exame");
  const grupos = await a.gruposExames();
  assert.deepEqual(grupos.ok && grupos.dados.map((g) => g.nome), ["Consultas", "Laboratório"]);
  const doGrupo = await a.examesDoGrupo("9");
  assert.deepEqual(doGrupo.ok && doGrupo.dados.map((e) => e.id), ["p-hemograma"]);
  const convExame = await a.conveniosDoExame("p-ecg");
  assert.ok(convExame.ok && convExame.dados.find((c) => c.id === "0")?.valor === 120);
  const prestExame = await a.prestadoresDoExame("p-hemograma", "0");
  assert.ok(prestExame.ok && prestExame.dados[0].id === "102" && prestExame.dados[0].valor === 45);
});

test("ciclo completo: marcar (paciente novo), recusar horário ocupado, remarcar, confirmar, falta e cancelar", async () => {
  const a = ad();
  const data = diaUtil(2);
  const dias = await a.diasDisponiveis("101");
  assert.ok(dias.ok && dias.dados.includes(data));
  const livres = await a.horariosLivres("101", data);
  assert.ok(livres.ok && livres.dados.length === 8);
  if (!livres.ok) return;
  const vaga = { prestador_id: "101", data, horario: livres.dados[0].horario, agenda_id: livres.dados[0].agenda_id };

  // Paciente novo, cadastrado na marcação.
  const novo = { nome: "João Teste", cpf: "52998224725", nascimento: "1990-05-01", telefone: "27988887777" };
  const m = await a.marcar({ vaga, convenio_id: "0", procedimento_id: "p-consulta-cardio", paciente: novo, idempotencia: "chave-marcar-0001", usuario: "agente.teste" }, 5000);
  assert.ok(m.ok);
  if (!m.ok) return;
  const id = m.dados.feito.agendamento_id!;
  assert.ok(id && m.dados.feito.paciente_id);

  // Mesma chave: o ERP devolve a mesma consulta, sem criar outra.
  const repetida = await a.marcar({ vaga, convenio_id: "0", procedimento_id: "p-consulta-cardio", paciente: novo, idempotencia: "chave-marcar-0001" }, 5000);
  assert.ok(repetida.ok && repetida.dados.feito.agendamento_id === id);

  // Outra chave, mesmo horário: recusa de negócio com o código do ERP.
  const ocupado = await a.marcar({ vaga, convenio_id: "0", procedimento_id: "p-consulta-cardio", paciente: { paciente_id: "8812", nome: "Maria da Silva", nascimento: "1985-04-12", telefone: "27999998888" }, idempotencia: "chave-marcar-0002" }, 5000);
  assert.ok(!ocupado.ok && ocupado.recusa && ocupado.erro === "ERP_RECUSOU" && ocupado.codigoErp === "HORARIO_OCUPADO");

  // Aparece na agenda do dia e nas consultas do paciente; o horário sai dos livres.
  const dia = await a.agendaDoDia("101", data);
  assert.ok(dia.ok && dia.dados.some((x) => x.id === id && x.hora === vaga.horario && x.status === "agendado"));
  const futuras = await a.consultasFuturas({ cpf: novo.cpf });
  assert.ok(futuras.ok && futuras.dados.consultas.some((c) => c.id === id && c.data === data));
  const depois = await a.horariosLivres("101", data);
  assert.ok(depois.ok && !depois.dados.some((h) => h.horario === vaga.horario));

  // Paciente novo com CPF já cadastrado: usa o cadastro existente, sem erro.
  const outra = { prestador_id: "101", data, horario: "11:30", agenda_id: "h-1130" };
  const mesmoCpf = await a.marcar({ vaga: outra, convenio_id: "0", procedimento_id: "p-consulta-cardio", paciente: novo, idempotencia: "chave-marcar-0003" }, 5000);
  assert.ok(mesmoCpf.ok && mesmoCpf.dados.feito.paciente_id === m.dados.feito.paciente_id);

  // Remarcar: consulta nova; a antiga sai das futuras.
  const rem = await a.marcar({ vaga: { ...vaga, horario: "10:00", agenda_id: "h-1000" }, convenio_id: "0", procedimento_id: "p-consulta-cardio", paciente: { paciente_id: m.dados.feito.paciente_id!, nome: novo.nome, nascimento: novo.nascimento, telefone: novo.telefone }, remarcar: id, idempotencia: "chave-remarcar-001" }, 5000);
  assert.ok(rem.ok);
  if (!rem.ok) return;
  const novoId = rem.dados.feito.agendamento_id!;
  assert.notEqual(novoId, id);
  const apos = await a.consultasFuturas({ cpf: novo.cpf });
  assert.ok(apos.ok && !apos.dados.consultas.some((c) => c.id === id) && apos.dados.consultas.some((c) => c.id === novoId));

  // Confirmação de véspera: a consulta pendente aparece, o lembrete é registrado e ela sai da lista.
  const pend = await a.consultasParaConfirmar(data, data);
  assert.ok(pend.ok);
  if (!pend.ok) return;
  const c = pend.dados.find((x) => x.agendamento_id === novoId);
  assert.ok(c);
  assert.equal(c!.telefone, "5527988887777");
  assert.equal(c!.hora, "10:00");
  assert.equal(c!.endereco, "Av. Central, 500, Centro, Vila Velha/ES");
  assert.ok((await a.marcarLembretesEnviados([novoId])).ok);
  const pend2 = await a.consultasParaConfirmar(data, data);
  assert.ok(pend2.ok && !pend2.dados.some((x) => x.agendamento_id === novoId));

  // Status: confirmar, pedido de remarcação (nada a gravar), falta; falta não volta a confirmado.
  assert.ok((await a.mudarStatus(novoId, "confirmado")).ok);
  assert.deepEqual(await a.mudarStatus(novoId, "remarcar"), { ok: true, dados: null });
  assert.ok((await a.mudarStatus(novoId, "ausente")).ok);
  const volta = await a.mudarStatus(novoId, "confirmado");
  assert.ok(!volta.ok && volta.recusa && volta.codigoErp === "STATUS_NAO_PERMITE");

  // Cancelar a outra consulta; cancelar de novo não é erro. Id inexistente: não encontrado.
  const idOutra = mesmoCpf.ok ? mesmoCpf.dados.feito.agendamento_id! : "";
  assert.ok((await a.mudarStatus(idOutra, "cancelado")).ok);
  assert.ok((await a.mudarStatus(idOutra, "cancelado")).ok);
  const nada = await a.mudarStatus("nao-existe", "cancelado");
  assert.ok(!nada.ok && nada.naoEncontrado);
});

test("conta: valor em centavos, chave de idempotência e recusa de forma inválida", async () => {
  const a = ad();
  const r = await a.lancarConta({ paciente_id: "8812", valor: "150.00", forma: "pix", id_externo: "chave-conta-000001" });
  assert.ok(r.ok);
  const r2 = await a.lancarConta({ paciente_id: "8812", valor: "150.00", forma: "pix", id_externo: "chave-conta-000001" });
  assert.deepEqual(r2, r);
  const ruim = await a.lancarConta({ paciente_id: "8812", valor: "10.00", forma: "cheque", id_externo: "chave-conta-000002" });
  assert.ok(!ruim.ok && ruim.recusa && /forma_pagamento/.test(ruim.msg ?? ""));
});
