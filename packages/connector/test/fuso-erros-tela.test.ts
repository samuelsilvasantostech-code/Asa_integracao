import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// Lote 2 da revisão: "hoje" é o de São Paulo (não o do computador), valores com milhar e mensagens
// de erro sem código HTTP nem nomes internos, cada uma dizendo o que fazer.
const C = createRequire(import.meta.url)("../../extension/core.js");

test("hoje no fuso da clínica, mesmo com o computador em outro", () => {
  // 01:30 UTC de 25/11 ainda é 24/11 em São Paulo (22:30).
  assert.equal(C.todayIso(new Date("2026-11-25T01:30:00Z")), "2026-11-24");
  assert.equal(C.todayIso(new Date("2026-11-25T03:00:00Z")), "2026-11-25");
  assert.equal(C.nowClock(new Date("2026-11-25T01:30:00Z")), "22:30");
});

test("idade conta pelo dia de São Paulo", () => {
  // Aniversário em 25/11: às 22:30 de 24/11 em São Paulo ainda não fez.
  assert.equal(C.age("2000-11-25", new Date("2026-11-25T01:30:00Z")), 25);
  assert.equal(C.age("2000-11-25", new Date("2026-11-25T12:00:00Z")), 26);
});

test("valor com separador de milhar", () => {
  assert.equal(C.formatMoney(12345.6), "R$ 12.345,60");
  assert.equal(C.formatMoney(1234567.891), "R$ 1.234.567,89");
  assert.equal(C.formatMoney(89.9), "R$ 89,90");
  assert.equal(C.formatMoney(0), "R$ 0,00");
  assert.equal(C.formatMoney(-1500), "-R$ 1.500,00");
  assert.equal(C.formatMoney(NaN), "");
});

test("mensagens de erro: sem HTTP nem Conector, e cada caso com a sua", () => {
  const casos: [number, unknown][] = [
    [0, null], [-1, null], [400, { erro: "PARAMETROS_INVALIDOS" }], [400, { erro: "VAGA_INVALIDA" }], [404, { erro: "NAO_ENCONTRADO" }],
    [401, { erro: "CHAVE_INVALIDA" }], [421, { erro: "HOST_NAO_PERMITIDO" }], [429, { erro: "ASA_LIMITE" }], [500, { erro: "ERRO_INTERNO" }],
    [502, { erro: "ASA_FORA_DO_AR" }], [502, { erro: "ASA_RESPOSTA_INVALIDA" }], [502, { erro: "ASA_BLOQUEIO_CLOUDFLARE" }],
    [502, { erro: "ERP_FORA_DO_AR" }], [503, { erro: "BANCO_NAO_CONFIGURADO" }], [409, { erro: "ALGO_NOVO" }],
  ];
  const textos = casos.map(([st, b]) => C.readError(st, b) as string);
  for (const t of textos) {
    assert.doesNotMatch(t, /HTTP|Conector|pausa|toque/i, t);
    assert.ok(t.length > 20, t);
  }
  // Pedido inválido não culpa o sistema da clínica.
  assert.doesNotMatch(textos[2], /não respondeu/);
  assert.match(textos[2], /Atualize a tela/);
  assert.match(textos[0], /internet/);
  assert.match(textos[7], /intervalo/);
  assert.match(textos[11], /bloqueou/);
  assert.match(textos[14], /não foi aceito/);
  // Recusa de negócio continua mostrando a mensagem do sistema.
  assert.match(C.readError(422, { erro: "ASA_RECUSOU", msg: "Horário bloqueado" }), /Horário bloqueado/);
  assert.doesNotMatch(C.connectionState(502, null).text, /HTTP|Conector/);
  assert.doesNotMatch(C.bookingError(409, { erro: "AGENDAMENTO_INCERTO" }), /toque/);
});
