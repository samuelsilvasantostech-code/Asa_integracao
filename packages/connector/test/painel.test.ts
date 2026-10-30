import assert from "node:assert/strict";
import { test } from "node:test";
import { nomeDoUsuario, periodo } from "../src/routes/painel.js";

test("periodo: últimos N dias até hoje, com padrão de 7", () => {
  assert.deepEqual(periodo("2026-10-30", "7"), { dias: 7, inicio: "2026-10-24", fim: "2026-10-30" });
  assert.deepEqual(periodo("2026-10-30", "1"), { dias: 1, inicio: "2026-10-30", fim: "2026-10-30" });
  assert.deepEqual(periodo("2026-03-01", "30"), { dias: 30, inicio: "2026-01-31", fim: "2026-03-01" });
  assert.equal(periodo("2026-10-30", "999").dias, 7);
  assert.equal(periodo("2026-10-30", undefined).dias, 7);
});

test("nomeDoUsuario: tira o id do Kentro", () => {
  assert.equal(nomeDoUsuario("12 Maria Souza"), "Maria Souza");
  assert.equal(nomeDoUsuario("Maria"), "Maria");
  assert.equal(nomeDoUsuario(null), "Sem identificação");
  assert.equal(nomeDoUsuario("42"), "42");
});
