import assert from "node:assert/strict";
import { test } from "node:test";
import { agendados } from "../src/normalizar.js";

test("agenda do dia: formato documentado, ordenado pela hora", () => {
  const r = agendados({
    agendamentos: [
      { id: 7, data_hora: "2026-10-30 10:30:00", status: "Confirmado", obs: "", paciente: { id: 3, nome: "Ana Lima", telefone: "27999990000", idade: "41", etiqueta: { nome: "VIP" } }, procedimentos: [{ descricao: "Consulta" }] },
      { id: 5, data_hora: "2026-10-30 08:00:00", status: "agendado", paciente: { nome: "Bruno" }, procedimentos: ["Retorno"] },
    ],
  });
  assert.equal(r.length, 2);
  assert.equal(r[0].id, "5");
  assert.equal(r[0].hora, "08:00");
  assert.equal(r[1].status, "confirmado");
  assert.deepEqual(r[1].paciente, { id: "3", nome: "Ana Lima", telefone: "27999990000", idade: 41, etiqueta: "VIP" });
  assert.deepEqual(r[1].procedimentos, ["Consulta"]);
  assert.equal(r[1].obs, null);
});

test("agenda do dia: objeto indexado e itens sem id descartados", () => {
  const r = agendados({ agendamentos: { "1": { id: 9, hora: "9:15", paciente: "Carla" }, "2": { nome: "sem id" } } });
  assert.equal(r.length, 1);
  assert.equal(r[0].hora, "09:15");
  assert.equal(r[0].paciente.nome, "Carla");
});
