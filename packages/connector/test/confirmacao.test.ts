import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acaoDoBotao,
  dataFalada,
  datasAlvo,
  hojeEm,
  lerConfig,
  preencher,
  proximos,
  telefoneKentro,
  varsDa,
} from "../src/confirmacao.js";

test("datas alvo: dia seguinte, e sexta cobre até segunda", () => {
  assert.deepEqual(datasAlvo("2026-10-29", { dias_antes: 1, sexta_pega_segunda: true }), { inicio: "2026-10-30", fim: "2026-10-30" });
  assert.deepEqual(datasAlvo("2026-10-30", { dias_antes: 1, sexta_pega_segunda: true }), { inicio: "2026-10-31", fim: "2026-11-02" });
  assert.deepEqual(datasAlvo("2026-10-30", { dias_antes: 1, sexta_pega_segunda: false }), { inicio: "2026-10-31", fim: "2026-10-31" });
  assert.deepEqual(datasAlvo("2026-12-31", { dias_antes: 2, sexta_pega_segunda: true }), { inicio: "2027-01-02", fim: "2027-01-02" });
});

test("hoje no fuso de São Paulo, não em UTC", () => {
  assert.equal(hojeEm(new Date("2026-10-30T01:30:00Z")), "2026-10-29");
});

test("telefone no formato da Kentro", () => {
  assert.equal(telefoneKentro("(27) 99812-4471"), "5527998124471");
  assert.equal(telefoneKentro("5527998124471"), "5527998124471");
  assert.equal(telefoneKentro("2732214471"), "552732214471");
  assert.equal(telefoneKentro("123"), null);
});

test("config: padrão em modo teste e valores inválidos descartados", () => {
  const p = lerConfig(undefined);
  assert.equal(p.ativo, false);
  assert.equal(p.teste.ativo, true);
  const c = lerConfig({ ativo: true, lote: 500, dias_antes: 0, teste: { ativo: false, telefones: ["(27) 99812-4471", "x"] }, textos: { confirmado: "  ok {nome}  " } });
  assert.equal(c.ativo, true);
  assert.equal(c.lote, 15);
  assert.equal(c.dias_antes, 1);
  assert.deepEqual(c.teste, { ativo: false, telefones: ["5527998124471"] });
  assert.equal(c.textos.confirmado, "ok {nome}");
});

test("próximos agendamentos: lista em objeto indexado, data com hora", () => {
  const r = proximos({
    agendamentos: {
      "0": { id: 42655586, data: "2026-10-30 08:30:00", profissional: "Dr. Demonstração", paciente: "MARIA APARECIDA", telefone1: "27998124471", clinica: "Clínica X" },
      "1": { id: null, data: "2026-10-30" },
    },
  });
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], {
    agendamento_id: "42655586",
    data: "2026-10-30",
    hora: "08:30",
    prestador: "Dr. Demonstração",
    paciente: "MARIA APARECIDA",
    telefone: "5527998124471",
    clinica: "Clínica X",
  });
});

test("texto montado com primeiro nome e data falada", () => {
  const v = varsDa({ paciente: "MARIA APARECIDA", data: "2026-10-30", hora: "08:30", prestador: "Dr. Demo", clinica: null }, "2026-10-29", "Clínica Demo");
  assert.equal(v.nome, "Maria");
  assert.equal(v.data, "amanhã (30/10)");
  assert.equal(preencher("{nome}, {data} às {hora} com {profissional} na {clinica} {x}", v), "Maria, amanhã (30/10) às 08:30 com Dr. Demo na Clínica Demo {x}");
  assert.equal(dataFalada("2026-11-02", "2026-10-30"), "segunda (02/11)");
});

test("botão → ação", () => {
  assert.equal(acaoDoBotao("confirmar"), "confirmar");
  assert.equal(acaoDoBotao("Confirmo"), "confirmar");
  assert.equal(acaoDoBotao("REMARCAR"), "remarcar");
  assert.equal(acaoDoBotao("Cancelar consulta"), "cancelar");
  assert.equal(acaoDoBotao("qual o endereço?"), null);
});
