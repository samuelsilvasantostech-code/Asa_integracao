import assert from "node:assert/strict";
import { test } from "node:test";
import { aplicarRetencao, corteRetencao, RETENCAO_DIAS, SQL_RETENCAO } from "../src/retencao.js";

test("retenção: 90 dias, corte contado no calendário", () => {
  assert.equal(RETENCAO_DIAS, 90);
  assert.equal(corteRetencao("2026-11-03"), "2026-08-05");
  assert.equal(corteRetencao("2026-03-01"), "2025-12-01");
  assert.equal(corteRetencao("2026-11-03", 1), "2026-11-02");
});

test("retenção: só limpa campos pessoais, sem mexer na data que o painel usa", () => {
  assert.match(SQL_RETENCAO.confirmacoes, /telefone = NULL/);
  assert.match(SQL_RETENCAO.confirmacoes, /nome = NULL/);
  assert.match(SQL_RETENCAO.agendamentos, /resposta = NULL/);
  assert.match(SQL_RETENCAO.cobrancas, /paciente_id = NULL/);
  for (const sql of Object.values(SQL_RETENCAO)) {
    assert.doesNotMatch(sql, /^\s*DELETE/i);
    assert.doesNotMatch(sql, /atualizado_em|enviado_em|criado_em\s*=|valor|estado\s*=|situacao\s*=/);
    assert.match(sql, /< \$1::date/);
  }
});

test("retenção: aplica nas três tabelas com o corte de hoje em São Paulo", async () => {
  const chamadas: unknown[][] = [];
  const db = { query: async (sql: string, args: unknown[]) => (chamadas.push([sql, args]), { rowCount: 2 }) };
  // 02:00 UTC de 04/11 ainda é 03/11 em São Paulo.
  const r = await aplicarRetencao(db as any, new Date("2026-11-04T02:00:00Z"));
  assert.deepEqual(r, { corte: "2026-08-05", confirmacoes: 2, agendamentos: 2, cobrancas: 2 });
  assert.equal(chamadas.length, 3);
  for (const [, args] of chamadas) assert.deepEqual(args, ["2026-08-05"]);
});
