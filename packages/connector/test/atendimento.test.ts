import assert from "node:assert/strict";
import { test } from "node:test";
import { agendadoVisto, aplicar, etapaAtual, horaNoDia, lembrarAgendados, VAZIO, type Tempos } from "../src/atendimento.js";

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

/* ---------- relatório do Painel ---------- */
import { resumoEspera, type LinhaEspera } from "../src/atendimento.js";

const linha = (data: string, marcada: string | null, ch: string | null, cm: string | null, fm: string | null, prest = "101"): LinhaEspera => ({
  prestador_id: prest, data, hora_marcada: marcada,
  chegada: ch ? horaNoDia(data, ch) : null, chamada: cm ? horaNoDia(data, cm) : null, fim: fm ? horaNoDia(data, fm) : null,
});

test("relatório: médias, faixas e atraso da clínica", () => {
  const r = resumoEspera([
    linha("2026-11-20", "14:00", "13:50", "14:10", "14:40"),          // chegou 10 min antes, esperou 20, atraso 10, consulta 30
    linha("2026-11-20", "15:00", "15:10", "15:15", "15:35", "102"),   // chegou 10 min atrasado, esperou 5, atraso 5, consulta 20
    linha("2026-11-21", "09:00", "08:30", "09:35", "10:00"),          // esperou 65 (faixa > 1 h), atraso 35
  ], "2026-11-23");
  assert.equal(r.chegadas, 3);
  assert.equal(r.esperas_medidas, 3);
  assert.equal(r.espera_media, 30);   // (20 + 5 + 65) / 3
  assert.equal(r.espera_mediana, 20);
  assert.equal(r.acima_30, 1);
  assert.equal(r.atraso_medio, 17);   // (10 + 5 + 35) / 3 = 16,7
  assert.equal(r.consulta_media, 25); // (30 + 20 + 25) / 3
  assert.equal(r.pacientes_atrasados, 1);
  assert.deepEqual(r.faixas.map((f) => f.n), [1, 1, 0, 1]);
  assert.deepEqual(r.por_dia, [{ dia: "2026-11-20", n: 2, media: 13, mediana: 13 }, { dia: "2026-11-21", n: 1, media: 65, mediana: 65 }]);
  assert.equal(r.espera_p90, null); // 3 pacientes: pouco para dizer "9 em cada 10"
  assert.equal(r.por_profissional[0].prestador_id, "101");
  assert.equal(r.por_profissional[0].pacientes, 2);
});

test("relatório: mediana e p90, no geral e por profissional (com 5 pacientes ou mais)", () => {
  // Profissional 101: esperas de 5, 10, 10, 15, 20, 25, 30, 40, 60 e 90 min (10 pacientes).
  const esperas = [5, 10, 10, 15, 20, 25, 30, 40, 60, 90];
  const linhas = esperas.map((m) => linha("2026-11-20", null, "08:00", `${String(8 + Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, null, "101"));
  // Profissional 102: 2 pacientes, esperas de 50 e 70 (mediana maior, p90 nulo).
  linhas.push(linha("2026-11-20", null, "08:00", "08:50", null, "102"), linha("2026-11-20", null, "08:00", "09:10", null, "102"));
  const r = resumoEspera(linhas, "2026-11-23");
  assert.equal(r.espera_mediana, 28); // 12 tempos: (25 + 30) / 2 = 27,5
  assert.equal(r.espera_p90, 70);     // posição 11 de 12 (ceil(0,9 × 12))
  const [a, b] = r.por_profissional;
  assert.deepEqual([a.prestador_id, a.espera_mediana, a.espera_p90], ["102", 60, null]); // mediana 60 vem primeiro
  assert.deepEqual([b.prestador_id, b.espera_mediana, b.espera_p90, b.espera_media], ["101", 23, 60, 31]); // p90: posição 9 de 10
});

test("relatório: cronômetro aberto não conta; fora do normal é descartado", () => {
  const r = resumoEspera([
    linha("2026-11-23", "14:00", "13:55", null, null),                // aguardando agora
    linha("2026-11-23", "14:30", "14:20", "14:30", null),             // em consulta agora
    linha("2026-11-20", "10:00", "09:50", null, null),                // esquecido aberto
    linha("2026-11-20", "08:00", "07:00", "12:30", "12:40"),          // espera de 5h30: descartada (a consulta vale)
    linha("2026-11-20", "11:00", "11:00", "11:05", "11:05"),          // consulta de 0 min: descartada
  ], "2026-11-23");
  assert.deepEqual(r.agora, { aguardando: 1, em_consulta: 1 });
  assert.equal(r.esquecidos, 1);
  assert.equal(r.descartadas, 2);
  assert.equal(r.esperas_medidas, 2);  // 10 (em consulta agora) e 5
  assert.equal(r.consultas_medidas, 1); // a espera de 5h30 sai, mas a consulta de 10 min daquela linha vale
  assert.equal(r.consulta_media, 10);
});

test("chegada: só consulta que a agenda do dia mostrou para aquele profissional", () => {
  lembrarAgendados("t1", "p1", "2026-11-23", ["10", "11"]);
  assert.equal(agendadoVisto("t1", "p1", "2026-11-23", "10"), true);
  assert.equal(agendadoVisto("t1", "p1", "2026-11-23", "99"), false, "id inventado");
  assert.equal(agendadoVisto("t1", "p2", "2026-11-23", "10"), false, "outro profissional");
  assert.equal(agendadoVisto("t2", "p1", "2026-11-23", "10"), false, "outra clínica");
  // A agenda nova substitui a antiga: consulta cancelada sai da lista.
  lembrarAgendados("t1", "p1", "2026-11-23", ["11"]);
  assert.equal(agendadoVisto("t1", "p1", "2026-11-23", "10"), false);
});
