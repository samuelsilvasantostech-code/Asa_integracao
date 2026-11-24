import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// Gravações da extensão (marcar, cancelar, cobrar): quando a resposta não diz se gravou,
// a tela mantém a chave de idempotência e só confere, para nunca gravar duas vezes.
const C = createRequire(import.meta.url)("../../extension/core.js");

test("incerto: tempo esgotado, 5xx sem código nosso ou 200 sem ok", () => {
  assert.equal(C.uncertain(0, null), true);
  assert.equal(C.uncertain(502, null), true);
  assert.equal(C.uncertain(504, { message: "Gateway Timeout" }), true);
  assert.equal(C.uncertain(500, { statusCode: 500 }), true);
  assert.equal(C.uncertain(200, null), true);
  assert.equal(C.uncertain(200, { ok: false }), true);
});

test("não incerto: recusa com código conhecido, sem chave ou pedido inválido", () => {
  assert.equal(C.uncertain(502, { erro: "ASA_FORA_DO_AR" }), false);
  assert.equal(C.uncertain(409, { erro: "HORARIO_INDISPONIVEL" }), false);
  assert.equal(C.uncertain(400, null), false);
  assert.equal(C.uncertain(401, null), false);
  assert.equal(C.uncertain(-1, null), false);
});

test("cobrança sem resposta manda conferir no financeiro antes de lançar de novo", () => {
  assert.match(C.chargeError(0, null), /pode ter sido lançada/);
  assert.match(C.chargeError(504, null), /pode ter sido lançada/);
  assert.doesNotMatch(C.chargeError(400, { erro: "DADOS_INVALIDOS" }), /pode ter sido lançada/);
});

test("cancelamento sem resposta não usa a mensagem de marcação", () => {
  assert.match(C.cancelError(0, null), /pode ter sido cancelada/);
  assert.doesNotMatch(C.cancelError(0, null), /gravada/);
  assert.match(C.cancelError(404, { erro: "CONSULTA_NAO_ENCONTRADA" }), /não está mais na lista/);
  assert.match(C.bookingError(0, null), /pode ter sido gravada/);
});
