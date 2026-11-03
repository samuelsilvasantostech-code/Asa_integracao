import assert from "node:assert/strict";
import { test } from "node:test";
import { Limite } from "../src/limite.js";

test("limite: conta na janela e libera na seguinte", () => {
  const l = new Limite(3, 60_000);
  const t0 = 1_000_000;
  assert.equal(l.registrar("a", t0), true);
  assert.equal(l.registrar("a", t0 + 1), true);
  assert.equal(l.registrar("a", t0 + 2), true);
  assert.equal(l.excedido("a", t0 + 3), true);
  assert.equal(l.registrar("a", t0 + 3), false);
  assert.equal(l.excedido("b", t0 + 3), false, "outra chave tem a própria conta");
  assert.equal(l.excedido("a", t0 + 60_000), false, "janela nova");
  assert.equal(l.registrar("a", t0 + 60_000), true);
});

test("limite: excedido não conta, só consulta", () => {
  const l = new Limite(1, 1000);
  for (let i = 0; i < 5; i++) assert.equal(l.excedido("x", i), false);
  assert.equal(l.registrar("x", 10), true);
  assert.equal(l.excedido("x", 11), true);
});

test("limite: o mapa não passa do teto", () => {
  const l = new Limite(5, 60_000, 100);
  for (let i = 0; i < 1000; i++) l.registrar("ip" + i, 1000 + i);
  assert.ok(l.tamanho() <= 100, String(l.tamanho()));
  // As chaves vencidas saem primeiro.
  const v = new Limite(5, 10, 3);
  v.registrar("a", 0);
  v.registrar("b", 0);
  v.registrar("c", 0);
  v.registrar("d", 100);
  assert.equal(v.tamanho(), 1);
});
