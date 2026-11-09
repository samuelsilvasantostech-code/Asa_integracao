import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { AsaAdapter } from "../src/erp/asa/adaptador.js";
import { criarAdaptador, ErpDesconhecido } from "../src/erp/index.js";

// O adaptador da Asa com a rede simulada: confere o que vai para a Asa (rota e parâmetros) e como cada
// resposta vira o resultado neutro que as rotas usam. Nada sai da máquina.

type Chamada = { rota: string; params: URLSearchParams; metodo: string; auth: string | null; ua: string | null };
const original = globalThis.fetch;
let chamadas: Chamada[] = [];

function simular(...respostas: Array<{ status?: number; corpo: unknown } | Error>) {
  chamadas = [];
  let i = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const h = new Headers(init?.headers);
    chamadas.push({ rota: u.pathname.replace("/api/", ""), params: u.searchParams, metodo: init?.method ?? "GET", auth: h.get("authorization"), ua: h.get("user-agent") });
    const r = respostas[Math.min(i++, respostas.length - 1)];
    if (r instanceof Error) throw r;
    const texto = typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo);
    return new Response(texto, { status: r.status ?? 200 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = original;
});

const log = { info() {}, warn() {} };
const asa = () => new AsaAdapter({ token: "dG9rZW4=" }, log);

test("registro: 'asa' cria o adaptador da Asa; ERP desconhecido é recusado", () => {
  assert.equal(criarAdaptador("asa", { token: "x" }, log).erp, "asa");
  assert.throws(() => criarAdaptador("outro", {}, log), ErpDesconhecido);
});

test("chamada: POST com parâmetros na query, token no Authorization e User-Agent próprio", async () => {
  simular({ corpo: { especialidades: [], prestadores: [{ id: 1 }, { id: 2 }] } });
  const r = await asa().testarConexao();
  assert.deepEqual(r, { ok: true, dados: { prestadores: 2 } });
  assert.equal(chamadas[0].metodo, "POST");
  assert.equal(chamadas[0].rota, "api-agendamento");
  assert.equal(chamadas[0].auth, "dG9rZW4=");
  assert.match(chamadas[0].ua ?? "", /^Kentro-Asa-Connector\//);
});

test("paciente: 'não localizado' com 403 é não encontrado, não credencial", async () => {
  simular({ status: 403, corpo: { status: "error", msg: "Paciente não localizado" } });
  const r = await asa().buscarPaciente({ telefone: "27999998888" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.naoEncontrado, true);
  assert.equal(r.credencialInvalida, false);
  assert.equal(chamadas[0].params.get("telefone"), "27999998888");
});

test("credencial: 401, ou 403 que fala de autorização, é credencial inválida", async () => {
  simular({ status: 401, corpo: { msg: "x" } });
  let r = await asa().buscarPaciente({ cpf: "12345678901" });
  assert.ok(!r.ok && r.credencialInvalida && r.erro === "ASA_CREDENCIAL_INVALIDA");
  simular({ status: 403, corpo: { msg: "Não autorizado." } });
  r = await asa().buscarPaciente({ cpf: "12345678901" });
  assert.ok(!r.ok && r.credencialInvalida);
});

test("recusa de validação com HTTP 200 é recusa, com a mensagem dos campos", async () => {
  simular({ status: 200, corpo: { message: "The given data was invalid.", errors: { nascimento: ["obrigatório"] } } });
  const r = await asa().marcar(
    { vaga: { prestador_id: "1", data: "2026-11-20", horario: "08:30", agenda_id: "9" }, convenio_id: "5", procedimento_id: "7", paciente: { nome: "Maria", cpf: "12345678901", nascimento: "1990-01-01", telefone: "27999998888" } },
    1000,
  );
  assert.ok(!r.ok && r.recusa && r.erro === "ASA_RECUSOU");
  assert.match(!r.ok ? r.msg ?? "" : "", /nascimento: obrigatório/);
});

test("sem resposta (rede): semResposta, para a gravação ficar incerta", async () => {
  simular(Object.assign(new Error("fetch failed"), { name: "TypeError", cause: { code: "ECONNRESET" } }));
  const r = await asa().mudarStatus("42", "cancelado");
  assert.ok(!r.ok && r.semResposta && r.status === 0);
});

test("marcar: vaga em DD/MM/AAAA, paciente cadastrado e remarcação com o id original", async () => {
  simular({ corpo: { agendamento: { id: 42655586 }, paciente: { id: 8812 }, setor: { nome: "Cardio" } } });
  const r = await asa().marcar(
    {
      vaga: { prestador_id: "59632", data: "2026-11-20", horario: "08:30", agenda_id: "358726" },
      convenio_id: "5",
      procedimento_id: "1619420",
      paciente: { paciente_id: "8812", nome: "Maria", nascimento: "1990-01-01", telefone: "27999998888" },
      remarcar: "111",
      obs: "pelo WhatsApp",
    },
    1000,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.dados.feito.agendamento_id, "42655586");
  assert.equal(r.dados.feito.paciente_id, "8812");
  const p = chamadas[0].params;
  assert.equal(chamadas[0].rota, "api-agendamento-agendar-instituicao");
  assert.equal(p.get("data"), "20/11/2026");
  assert.equal(p.get("convenio_procedimento_id"), "1619420");
  assert.equal(p.get("paciente_id"), "8812");
  assert.equal(p.get("agendamento"), "111");
  assert.equal(p.get("obs"), "pelo WhatsApp");
});

test("marcar sem número: sucesso com agendamento_id nulo e o formato da resposta para o log", async () => {
  simular({ corpo: { status: "ok", msg: "Recebido" } });
  const r = await asa().marcar(
    { vaga: { prestador_id: "1", data: "2026-11-20", horario: "08:30", agenda_id: "9" }, convenio_id: "5", procedimento_id: "7", paciente: { nome: "Maria", cpf: "12345678901", nascimento: "1990-01-01", telefone: "27999998888" } },
    1000,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.dados.feito.agendamento_id, null);
  assert.deepEqual(r.dados.diagnostico.chaves, ["status", "msg"]);
  assert.equal(r.dados.diagnostico.msg, "Recebido");
});

test("horários livres: data com hora zerada; agenda do dia: data simples", async () => {
  simular({ corpo: { 1: { horario: "08:30:00", agenda_id: 9 } } });
  const r = await asa().horariosLivres("59632", "2026-11-20");
  assert.deepEqual(r, { ok: true, dados: [{ horario: "08:30", agenda_id: "9" }] });
  assert.equal(chamadas[0].params.get("data"), "2026-11-20 00:00:00");
  simular({ corpo: { agendamentos: [] } });
  await asa().agendaDoDia("59632", "2026-11-20");
  assert.equal(chamadas[0].params.get("data"), "2026-11-20");
});

test("consultas futuras: devolve a lista e o CPF que só ela traz", async () => {
  simular({ corpo: { cpf: "12345678901", nome: "Maria", msg: [{ id: 7, data: "2026-11-20", hora: "08:00", nome_prestador: "Dra. Ana" }] } });
  const r = await asa().consultasFuturas({ telefone: "27999998888" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.dados.cpf, "12345678901");
  assert.equal(r.dados.consultas[0].id, "7");
});

test("exames: página com menos de 100 itens é a última", async () => {
  simular({ corpo: { procedimentos: [{ id: 1, descricao: "Hemograma", tipo: "Exame" }] } });
  const r = await asa().examesPagina(3, "hemo");
  assert.ok(r.ok && r.dados.ultima && r.dados.exames[0].tipo === "exame");
  assert.equal(chamadas[0].params.get("page"), "3");
  assert.equal(chamadas[0].params.get("descricao"), "hemo");
});

test("lembretes enviados: um parâmetro agendamentos[] por consulta", async () => {
  simular({ corpo: { status: "success" } });
  await asa().marcarLembretesEnviados(["1", "2"]);
  assert.deepEqual(chamadas[0].params.getAll("agendamentos[]"), ["1", "2"]);
});

test("conta: id_externo e vencimento com os nomes da Asa; sem status 0/1", async () => {
  simular({ corpo: { msg: "Conta gerada" } });
  const r = await asa().lancarConta({ paciente_id: "8812", valor: "150.00", forma: "pix", id_externo: "chave-1234567890abcd", vencimento: "2026-11-20" });
  assert.deepEqual(r, { ok: true, dados: { msg: "Conta gerada" } });
  const p = chamadas[0].params;
  assert.equal(p.get("valor_parcela"), "150.00");
  assert.equal(p.get("forma_pagamento"), "pix");
  assert.equal(p.get("data_vencimento"), "2026-11-20");
  assert.equal(p.get("id_externo"), "chave-1234567890abcd");
  assert.equal(p.has("status"), false);
});
