import assert from "node:assert/strict";
import { test } from "node:test";
import { filtrarLivres, horaEm, lerColunas, MAX_COLUNAS } from "../src/routes/consulta.js";
import type { Agendado, Horario } from "../src/erp/modelo.js";

// Horários livres que a agenda mostra: sem passado de hoje, sem horário já ocupado e sem repetido.
// A Medular relatou horário "livre" no ClinFy que na Asa não estava disponível.

const h = (horario: string, agenda_id = "a" + horario): Horario => ({ horario, agenda_id });
const ag = (hora: string, status: string | null = "agendado"): Agendado => ({
  id: "c" + hora, hora, status, paciente: { id: null, nome: null, telefone: null, idade: null, etiqueta: null }, procedimentos: [], obs: null,
});
// 25/11/2026 10:30 em São Paulo (UTC-3).
const AGORA = new Date("2026-11-25T13:30:00Z");
const horas = (l: Horario[]) => l.map((x) => x.horario);

test("horaEm: hora de São Paulo, também na virada do dia em UTC", () => {
  assert.equal(horaEm(AGORA), "10:30");
  assert.equal(horaEm(new Date("2026-11-26T02:30:00Z")), "23:30");
  assert.equal(horaEm(new Date("2026-11-25T03:05:00Z")), "00:05");
});

test("filtrarLivres: hoje, esconde o que já passou (inclusive o horário em curso)", () => {
  const l = [h("08:00"), h("10:30"), h("10:31"), h("14:00")];
  assert.deepEqual(horas(filtrarLivres(l, [], "2026-11-25", AGORA)), ["10:31", "14:00"]);
  // Dia futuro: nada sai por hora.
  assert.deepEqual(horas(filtrarLivres(l, [], "2026-11-26", AGORA)), ["08:00", "10:30", "10:31", "14:00"]);
});

test("filtrarLivres: hoje em SP mesmo quando em UTC já é amanhã", () => {
  const noite = new Date("2026-11-26T02:30:00Z"); // 25/11 23:30 em SP
  assert.deepEqual(horas(filtrarLivres([h("23:00"), h("23:45")], [], "2026-11-25", noite)), ["23:45"]);
  assert.deepEqual(horas(filtrarLivres([h("08:00")], [], "2026-11-26", noite)), ["08:00"]);
});

test("filtrarLivres: horário com consulta ativa sai; cancelada e desistência liberam", () => {
  const l = [h("14:00"), h("14:20"), h("14:40"), h("15:00")];
  const consultas = [ag("14:00", "confirmado"), ag("14:20", "cancelado"), ag("14:40", "desistência"), ag("15:00", "ausente")];
  assert.deepEqual(horas(filtrarLivres(l, consultas, "2026-11-26", AGORA)), ["14:20", "14:40"]);
  // Status desconhecido (null) ocupa: na dúvida, não oferece.
  assert.deepEqual(horas(filtrarLivres([h("16:00")], [ag("16:00", null)], "2026-11-26", AGORA)), []);
});

test("filtrarLivres: o mesmo horário em duas agendas aparece uma vez (o primeiro agenda_id)", () => {
  const r = filtrarLivres([h("09:00", "x"), h("09:00", "y"), h("09:20", "z")], [], "2026-11-26", AGORA);
  assert.deepEqual(r, [{ horario: "09:00", agenda_id: "x" }, { horario: "09:20", agenda_id: "z" }]);
});

test("filtrarLivres: ordem de chegada mantém turno começado e turno com paciente; tipo desconhecido não esconde ocupado", () => {
  const l = [h("07:00"), h("07:00"), h("13:00")];
  const consultas = [ag("13:00")];
  // Ordem de chegada: só sai o repetido.
  assert.deepEqual(horas(filtrarLivres(l, consultas, "2026-11-25", AGORA, { passados: false, ocupados: false })), ["07:00", "13:00"]);
  // Sem saber o tipo da agenda: sai o passado e o repetido, mas o ocupado fica.
  assert.deepEqual(horas(filtrarLivres(l, consultas, "2026-11-25", AGORA, { passados: true, ocupados: false })), ["13:00"]);
  // Sem a lista de consultas (leitura falhou): não esconde por ocupação.
  assert.deepEqual(horas(filtrarLivres([h("13:00")], null, "2026-11-26", AGORA)), ["13:00"]);
});

test("lerColunas: prestador:data separados por vírgula, sem repetir, até o máximo", () => {
  assert.deepEqual(lerColunas("12:2026-11-23,12:2026-11-24,12:2026-11-23"), [
    { prestador_id: "12", data: "2026-11-23" }, { prestador_id: "12", data: "2026-11-24" },
  ]);
  // Id de texto da especificação Kentro pode ter ":" (o último separa a data).
  assert.deepEqual(lerColunas("prof:abc:2026-11-23"), [{ prestador_id: "prof:abc", data: "2026-11-23" }]);
  const muitos = Array.from({ length: MAX_COLUNAS + 1 }, (_, i) => `p${i}:2026-11-23`).join(",");
  for (const ruim of [undefined, "", "12", ":2026-11-23", "12:2026-13-40", "12:ontem", "<x>:2026-11-23", muitos]) {
    assert.equal(lerColunas(ruim), null, String(ruim));
  }
});
