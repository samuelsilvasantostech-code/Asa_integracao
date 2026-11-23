import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// Tempo de espera na Agenda: cronômetro, cor, próximo botão e mensagens (core.js da extensão).
const C = createRequire(import.meta.url)("../../extension/core.js");

const T0 = Date.parse("2026-11-23T17:00:00Z"); // 14:00 em Brasília
const iso = (min: number) => new Date(T0 + min * 60000).toISOString();

test("sem chegada não há cronômetro; o próximo botão é Confirmar chegada", () => {
  assert.equal(C.attendanceState(null, T0), null);
  assert.equal(C.attendanceState({ chegada: null, chamada: null, fim: null }, T0), null);
  assert.deepEqual(C.attendanceNext(null), { acao: "chegada", label: "Confirmar chegada" });
});

test("aguardando: verde até 15 min, âmbar até 30, vermelho depois", () => {
  const at = { chegada: iso(0), chamada: null, fim: null };
  const st = (min: number) => C.attendanceState(at, T0 + min * 60000);
  assert.equal(st(5).tone, "wait");
  assert.equal(st(5).label, "Aguardando · 5 min");
  assert.equal(st(15).tone, "warn");
  assert.equal(st(30).tone, "err");
  assert.equal(st(75).label, "Aguardando · 1 h 15");
  assert.equal(st(-1).label, "Aguardando · 0 min"); // relógio um pouco atrás não mostra negativo
  assert.deepEqual(C.attendanceNext(st(5)), { acao: "chamada", label: "Chamar para consulta" });
});

test("em consulta e atendido: tempos de espera e de consulta", () => {
  const em = C.attendanceState({ chegada: iso(0), chamada: iso(12), fim: null }, T0 + 20 * 60000);
  assert.equal(em.stage, "chamada");
  assert.equal(em.label, "Em consulta · 8 min");
  assert.equal(em.wait, 12 * 60000);
  assert.deepEqual(C.attendanceNext(em), { acao: "fim", label: "Finalizar consulta" });
  const fim = C.attendanceState({ chegada: iso(0), chamada: iso(12), fim: iso(40) }, T0 + 90 * 60000);
  assert.equal(fim.open, false);
  assert.equal(fim.label, "Atendido · esperou 12 min");
  assert.equal(fim.consult, 28 * 60000);
  assert.equal(C.attendanceNext(fim), null);
});

test("hora no fuso da clínica e mensagens de erro", () => {
  assert.equal(C.clockOf(iso(5)), "14:05");
  assert.equal(C.clockOf(null), "");
  assert.match(C.attendanceError(409, { erro: "SO_HOJE" }), /hoje/);
  assert.match(C.attendanceError(409, { erro: "ETAPA_FORA_DE_ORDEM" }), /Outra pessoa/);
  assert.match(C.attendanceError(409, { erro: "HORA_INVALIDA" }), /futuro/);
  assert.match(C.attendanceDone("desfazer", "chamada"), /chamada para a consulta/);
});
