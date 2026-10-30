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

test("consulta pedida reencontrada na agenda do dia", async () => {
  const { consultaNoHorario } = await import("../src/normalizar.js");
  const ag = (id: string, hora: string, nome: string | null, status = "agendado", pid: string | null = null) =>
    ({ id, hora, status, paciente: { id: pid, nome, telefone: null, idade: null, etiqueta: null }, procedimentos: [], obs: null });
  const lista = [ag("1", "09:00", "Ana"), ag("2", "10:00", "Bruno Lima", "cancelado"), ag("3", "10:00", "SAMUEL  Silva Santos"), ag("4", "10:00", "Carla", "agendado", "77")];
  assert.equal(consultaNoHorario(lista, { horario: "10:00", nome: "Samuel Sílva Santos" })?.id, "3");
  assert.equal(consultaNoHorario(lista, { horario: "10:00", paciente_id: "77" })?.id, "4");
  assert.equal(consultaNoHorario(lista, { horario: "10:00" }), undefined); // duas ativas: não chuta
  assert.equal(consultaNoHorario(lista, { horario: "09:00" })?.id, "1");
  assert.equal(consultaNoHorario(lista, { horario: "11:00", nome: "Ana" }), undefined);
});
