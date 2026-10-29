import assert from "node:assert/strict";
import { test } from "node:test";
import { formaValida, lerFinanceiro, valorAsa } from "../src/financeiro.js";

test("valor: aceita vírgula ou ponto e devolve com duas casas", () => {
  assert.equal(valorAsa("350"), "350.00");
  assert.equal(valorAsa("350,5"), "350.50");
  assert.equal(valorAsa("1234.56"), "1234.56");
  assert.equal(valorAsa(89.9), "89.90");
});

test("valor: recusa zero, negativo, milhar com ponto, três casas e acima do teto", () => {
  for (const v of ["0", "0,00", "-10", "1.234,56", "10.555", "abc", "", null, undefined, "100000.01", 1e9]) {
    assert.equal(valorAsa(v), null, String(v));
  }
});

test("forma de pagamento: só as aceitas pela Asa", () => {
  assert.ok(formaValida("pix"));
  assert.ok(formaValida("cartao_credito"));
  assert.ok(!formaValida("cheque"));
  assert.ok(!formaValida(undefined));
});

test("configuração: nasce desligada, só administradores, e descarta valor fora do formato", () => {
  assert.deepEqual(lerFinanceiro(undefined), { ativo: false, quem: "admin" });
  assert.deepEqual(lerFinanceiro({ ativo: true, quem: "todos" }), { ativo: true, quem: "todos" });
  assert.deepEqual(lerFinanceiro({ ativo: "sim", quem: "gerente" }), { ativo: false, quem: "admin" });
});
