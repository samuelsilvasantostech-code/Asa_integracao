import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// Tela Início: números do dia e próximos pacientes, a partir das colunas da agenda (core.js da extensão).
const C = createRequire(import.meta.url)("../../extension/core.js");

const AGORA = Date.parse("2026-11-26T13:00:00Z"); // 10:00 em Brasília
const iso = (min: number) => new Date(AGORA + min * 60000).toISOString();
const ap = (hora: string, nome: string, extra: Record<string, unknown> = {}) => ({ id: hora + nome, hora, status: "Agendado", paciente: { nome }, ...extra });

test("início: conta consultas, confirmadas, aguardando e em consulta; lista os próximos em ordem", () => {
  const cols = [
    {
      prestador: "Dra. Ana",
      agendados: [
        ap("08:00", "Atendida", { status: "Atendido" }),
        ap("09:00", "Esperando", { atendimento: { chegada: iso(-12), chamada: null, fim: null } }),
        ap("09:20", "Na sala", { status: "Confirmado", atendimento: { chegada: iso(-40), chamada: iso(-5), fim: null } }),
        ap("09:40", "Atrasada"),
        ap("11:00", "Confirmou pelo WhatsApp", { confirmacao: { estado: "respondido", resposta: "confirmar" } }),
        ap("10:30", "Cancelou", { status: "Cancelado" }),
      ],
    },
    {
      prestador: "Dr. Bruno",
      agendados: [
        ap("09:10", "Muito atrasado"),
        ap("10:15", "Confirmada na Asa", { status: "Confirmado" }),
        ap("10:20", "Faltou", { status: "Ausente" }),
        ap("14:00", "Fim marcado", { atendimento: { chegada: iso(-90), chamada: iso(-60), fim: iso(-30) } }),
      ],
    },
  ];
  const t = C.todayOverview(cols, AGORA);
  assert.equal(t.consultas, 9); // sem a cancelada
  assert.equal(t.confirmadas, 3); // "Na sala", WhatsApp e Asa
  assert.equal(t.aguardando, 1);
  assert.equal(t.em_consulta, 1);
  assert.equal(t.atendidas, 2);
  assert.deepEqual(t.proximos.map((p: any) => p.hora + " " + p.nome), ["09:40 Atrasada", "10:15 Confirmada na Asa", "11:00 Confirmou pelo WhatsApp"]);
  assert.equal(t.proximos[0].atrasado, true);
  assert.equal(t.proximos[0].prestador, "Dra. Ana");
  assert.equal(t.proximos[1].atrasado, false);
  assert.equal(t.proximos[2].selo.label, "Confirmada pelo paciente");
  assert.equal(t.mais, 0);
});

test("início: no máximo 8 próximos, com quantos ficaram de fora; colunas vazias e sem nome não quebram", () => {
  const muitos = Array.from({ length: 11 }, (_, i) => ap(`1${i % 10}:${i < 10 ? "00" : "30"}`, "P" + i));
  const t = C.todayOverview([{ prestador: "X", agendados: muitos }, { prestador: "Y" }, { agendados: [{ hora: "12:00", status: "", paciente: null }] }], AGORA);
  assert.equal(t.consultas, 12);
  assert.equal(t.proximos.length, 8);
  assert.equal(t.mais, 4);
  assert.deepEqual(C.todayOverview([], AGORA), { consultas: 0, confirmadas: 0, aguardando: 0, em_consulta: 0, atendidas: 0, proximos: [], mais: 0 });
  const semNome = C.todayOverview([{ agendados: [{ hora: "12:00", status: "", paciente: null }] }], AGORA);
  assert.equal(semNome.proximos[0].nome, "Paciente sem nome");
});
