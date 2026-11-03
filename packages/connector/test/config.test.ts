import assert from "node:assert/strict";
import { test } from "node:test";
import { lerTrustProxy, problemaDeConfig } from "../src/config.js";

test("ADMIN_KEY: vazia ou curta deixa o /admin fechado", () => {
  assert.equal(problemaDeConfig({ adminKey: "" }), null);
  assert.equal(problemaDeConfig({ adminKey: "x".repeat(32) }), null);
  assert.match(problemaDeConfig({ adminKey: "troque-por-uma-chave-longa" }) ?? "", /mínimo é 32/);
});

test("TRUST_PROXY: número de saltos, true = 1, o resto desliga", () => {
  assert.equal(lerTrustProxy(undefined), false);
  assert.equal(lerTrustProxy(""), false);
  assert.equal(lerTrustProxy("1"), 1);
  assert.equal(lerTrustProxy("2"), 2);
  assert.equal(lerTrustProxy("true"), 1);
  assert.equal(lerTrustProxy("0"), false);
  assert.equal(lerTrustProxy("10.0.0.0/8"), false);
});
