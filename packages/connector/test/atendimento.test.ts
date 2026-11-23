import assert from "node:assert/strict";
import { test } from "node:test";
import { aplicar, etapaAtual, horaNoDia, VAZIO, type Tempos } from "../src/atendimento.js";

// Tempo de espera: chegada → chamada → fim, com desfazer e ajuste de hora.

const h = (hhmm: string) => horaNoDia("2026-11-23", hhmm)!;
const ok = (r: ReturnType<typeof aplicar>): Tempos => {
  assert.ok(r.ok, JSON.stringify(r));
  return r.tempos;
};

test("etapas em ordem: chegada, chamada, fim", () => {
  let t = ok(aplicar(VAZIO, "chegada", h("14:00")));
  assert.equal(etapaAtual(t), "chegada");
  t = ok(aplicar(t, "chamada", h("14:12")));
  t = ok(aplicar(t, "fim", h("14:40")));
  assert.deepEqual(t, { chegada: h("14:00"), chamada: h("14:12"), fim: h("14:40") });
});

test("fora de ordem é recusado; repetir a mesma etapa não muda a hora", () => {
  assert.deepEqual(aplicar(VAZIO, "chamada", h("14:00")), { ok: false, erro: "ETAPA_FORA_DE_ORDEM" });
  assert.deepEqual(aplicar(VAZIO, "fim", h("14:00")), { ok: false, erro: "ETAPA_FORA_DE_ORDEM" });
  const t = ok(aplicar(VAZIO, "chegada", h("14:00")));
  const r = aplicar(t, "chegada", h("14:05"));
  assert.ok(r.ok && !r.mudou && r.tempos.chegada?.getTime() === h("14:00").getTime());
});

test("desfazer volta uma etapa por vez; sem nada marcado é recusado", () => {
  let t: Tempos = { chegada: h("14:00"), chamada: h("14:10"), fim: h("14:30") };
  t = ok(aplicar(t, "desfazer", h("14:31")));
  assert.equal(etapaAtual(t), "chamada");
  t = ok(aplicar(t, "desfazer", h("14:31")));
  t = ok(aplicar(t, "desfazer", h("14:31")));
  assert.deepEqual(t, VAZIO);
  assert.deepEqual(aplicar(t, "desfazer", h("14:31")), { ok: false, erro: "NADA_A_DESFAZER" });
});

test("ajustar: mantém a ordem e não aceita hora no futuro", () => {
  const t: Tempos = { chegada: h("14:00"), chamada: h("14:10"), fim: null };
  assert.equal(ok(aplicar(t, "ajustar", h("14:20"), "chegada", h("13:50"))).chegada?.getTime(), h("13:50").getTime());
  assert.deepEqual(aplicar(t, "ajustar", h("14:20"), "chegada", h("14:15")), { ok: false, erro: "HORA_INVALIDA" });
  assert.deepEqual(aplicar(t, "ajustar", h("14:20"), "chamada", h("13:55")), { ok: false, erro: "HORA_INVALIDA" });
  assert.deepEqual(aplicar(t, "ajustar", h("14:20"), "chamada", h("14:40")), { ok: false, erro: "HORA_INVALIDA" });
  assert.deepEqual(aplicar(t, "ajustar", h("14:20"), "fim", h("14:15")), { ok: false, erro: "ETAPA_FORA_DE_ORDEM" });
});

test("hora no dia: fuso de Brasília e formato", () => {
  assert.equal(horaNoDia("2026-11-23", "14:05")?.toISOString(), "2026-11-23T17:05:00.000Z");
  for (const ruim of ["24:00", "9:00", "14:60", ""]) assert.equal(horaNoDia("2026-11-23", ruim), null, ruim);
  assert.equal(horaNoDia("23/11/2026", "14:00"), null);
});
