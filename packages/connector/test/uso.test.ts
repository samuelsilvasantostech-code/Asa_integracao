import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";

const CHAVE = "k".repeat(40);
process.env.ADMIN_KEY = CHAVE;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
const { adminRoutes } = await import("../src/routes/admin.js");
const { alertasDe, emExpediente, montarUso, periodoUso, saudeDe, situacaoDe, versaoAtrasada } = await import("../src/uso.js");

const AGORA = new Date("2026-11-24T15:00:00Z");
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 86400000).toISOString();

test("período: últimos N dias com o anterior de mesmo tamanho; fora da lista vira 30", () => {
  assert.deepEqual(periodoUso("2026-11-24", "7"), { dias: 7, inicio: "2026-11-18", fim: "2026-11-24", anterior_inicio: "2026-11-11" });
  assert.equal(periodoUso("2026-11-24", "15").dias, 30);
  assert.equal(periodoUso("2026-03-01", 30).inicio, "2026-01-31");
});

test("situação: desligada, nunca usou, parada há N dias, em uso", () => {
  const t = (ultimo: string | null, ativo = true) => situacaoDe({ ativo, ultimo_uso_em: ultimo, criado_em: diasAtras(30) }, AGORA.getTime());
  assert.equal(t(diasAtras(1), false).texto, "Desligada");
  assert.equal(t(null).texto, "Nunca usou");
  assert.equal(t(diasAtras(4)).texto, "Parada há 4 dias");
  assert.equal(t(diasAtras(1)).tom, "ok");
});

const base = {
  ativo: true, criado_em: diasAtras(60), ultimo_uso_em: diasAtras(0), tem_credencial: true,
  acoes: { criar: 30, remarcar: 0, cancelar: 0, confirmar: 0, ausente: 0 }, incertos: 0,
  confirmacoes: { enviadas: 0, falharam: 0 }, volume: 30, volume_anterior: 30, confirmacao_ligada: false,
};
const P = periodoUso("2026-11-24", 30);
const tipos = (c: typeof base) => alertasDe(c, P, AGORA.getTime()).map((a) => `${a.tipo}:${a.nivel}`);

test("alertas: clínica saudável não tem nenhum; desligada nunca tem", () => {
  assert.deepEqual(tipos(base), []);
  assert.deepEqual(tipos({ ...base, ativo: false, tem_credencial: false, ultimo_uso_em: null }), []);
});

test("alertas: parada (aviso com 3 dias, crítico com 7), nunca usou e sem credencial", () => {
  assert.deepEqual(tipos({ ...base, ultimo_uso_em: diasAtras(3) }), ["parada:aviso"]);
  assert.deepEqual(tipos({ ...base, ultimo_uso_em: diasAtras(8) }), ["parada:critico"]);
  assert.deepEqual(tipos({ ...base, ultimo_uso_em: null }), ["nunca_usou:aviso"]);
  assert.deepEqual(tipos({ ...base, ultimo_uso_em: null, criado_em: diasAtras(1) }), []);
  assert.deepEqual(tipos({ ...base, tem_credencial: false }), ["sem_credencial:critico"]);
});

test("alertas de taxa só acendem com volume mínimo", () => {
  assert.deepEqual(tipos({ ...base, incertos: 3 }), ["incertos_altos:aviso"]); // 3 de 33
  assert.deepEqual(tipos({ ...base, acoes: { ...base.acoes, criar: 5 }, incertos: 2 }), []); // só 7 no total
  assert.deepEqual(tipos({ ...base, confirmacoes: { enviadas: 8, falharam: 2 } }), ["confirmacao_falhando:aviso"]);
  assert.deepEqual(tipos({ ...base, confirmacoes: { enviadas: 3, falharam: 2 } }), []);
  assert.deepEqual(tipos({ ...base, confirmacao_ligada: true }), ["confirmacao_parada:aviso"]);
  assert.deepEqual(tipos({ ...base, volume: 9, volume_anterior: 20 }), ["queda_uso:aviso"]);
  assert.deepEqual(tipos({ ...base, volume: 1, volume_anterior: 10 }), []);
});

test("montagem: soma por período, separa o anterior, lista funções e ordena alertas primeiro", () => {
  const p = periodoUso("2026-11-24", 7);
  const tenant = (id: string, nome: string, ultimo: string | null) => ({
    id, nome, ativo: true, erp: "asa", criado_em: diasAtras(60), ultimo_uso_em: ultimo, desligado_em: null,
    tem_credencial: true, confirmacao: { ativo: true, teste: { ativo: false } }, financeiro: { ativo: true },
  });
  const r = montarUso({
    tenants: [tenant("a", "Alfa", diasAtras(0)), tenant("b", "Beta", diasAtras(10))],
    agendamentos: [
      { tenant_id: "a", dia: "2026-11-20", tipo: "criar", situacao: "ok", n: 4 },
      { tenant_id: "a", dia: "2026-11-21", tipo: "confirmar", situacao: "ok", n: 2 },
      { tenant_id: "a", dia: "2026-11-21", tipo: "criar", situacao: "incerto", n: 1 },
      { tenant_id: "a", dia: "2026-11-12", tipo: "criar", situacao: "ok", n: 5 }, // período anterior
    ],
    cobrancas: [{ tenant_id: "a", dia: "2026-11-22", situacao: "ok", n: 2, total: "300.50" }],
    confirmacoes: [
      { tenant_id: "a", estado: "respondido", resposta: "confirmar", origem: "automatica", n: 3 },
      { tenant_id: "a", estado: "enviado", resposta: null, origem: "manual", n: 1 },
    ],
    atendimentos: [{ tenant_id: "a", dia: "2026-11-24", n: 6 }],
    usuarios: [{ tenant_id: "a", n: 3 }],
    ultimas: [],
  }, p, AGORA);

  assert.equal(r.clinicas[0].nome, "Beta"); // parada há 10 dias: alerta crítico vem primeiro
  const a = r.clinicas.find((c) => c.id === "a")!;
  assert.deepEqual(a.acoes, { criar: 4, remarcar: 0, cancelar: 0, confirmar: 2, ausente: 0 });
  assert.equal(a.incertos, 1);
  assert.deepEqual(a.cobrancas, { n: 2, valor: 300.5, incertas: 0 });
  assert.deepEqual(a.confirmacoes, { enviadas: 4, respondidas: 3, confirmadas: 3, falharam: 0, manuais: 1 });
  assert.equal(a.volume, 4 + 2 + 2 + 6);
  assert.equal(a.volume_anterior, 5);
  assert.deepEqual(a.funcoes, ["agenda", "presenca", "espera", "cobranca", "confirmacao", "confirmacao_manual"]);
  assert.deepEqual(a.por_dia, [{ dia: "2026-11-20", n: 4 }, { dia: "2026-11-21", n: 2 }]);
  assert.equal(r.totais.usaram_7d, 1);
  assert.equal(r.totais.acoes, 6);
  // Série diária: um valor por dia do período (18 a 24), zeros incluídos; soma agenda, cobranças e espera.
  assert.deepEqual(a.spark, [0, 0, 4, 2, 2, 0, 6]);
  assert.equal(a.spark.reduce((x, y) => x + y, 0), a.volume);
  assert.deepEqual(r.serie.map((d) => d.dia), ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]);
  assert.deepEqual(r.serie.map((d) => d.n), [0, 0, 4, 2, 2, 0, 6]);
  assert.deepEqual(r.totais_anterior, { acoes: 5, cobrancas: 0, espera: 0, volume: 5 });
  assert.deepEqual(a.saude, { tom: "ok", texto: "Saudável" });
  assert.deepEqual(r.clinicas[0].saude, { tom: "err", texto: "Crítica" });
});

test("saúde: desligada e nunca usou neutras; crítica vence atenção", () => {
  const ok = { tom: "ok" as const, texto: "Em uso" };
  const av = { tipo: "x", nivel: "aviso" as const, texto: "" }, cr = { ...av, nivel: "critico" as const };
  assert.equal(saudeDe({ tom: "off", texto: "" }, [cr]).texto, "Desligada");
  assert.equal(saudeDe(ok, [av, cr]).tom, "err");
  assert.equal(saudeDe(ok, [av]).texto, "Atenção");
  assert.equal(saudeDe({ tom: "idle", texto: "" }, []).texto, "Nunca usou");
  assert.equal(saudeDe({ tom: "idle", texto: "" }, [av]).tom, "warn");
  assert.equal(saudeDe(ok, []).texto, "Saudável");
});

test("contagem diária: buscas, chamadas e falhas do ERP por código; versão atrasada", () => {
  const p = periodoUso("2026-11-24", 30);
  const r = montarUso({
    tenants: [{
      id: "a", nome: "Alfa", ativo: true, erp: "asa", criado_em: diasAtras(60), ultimo_uso_em: diasAtras(0), desligado_em: null,
      tem_credencial: true, confirmacao: {}, financeiro: {}, extensao_versao: "0.33.6", extensao_versao_em: diasAtras(1),
    }],
    agendamentos: [], cobrancas: [], confirmacoes: [], atendimentos: [], usuarios: [], ultimas: [],
    eventos: [
      { tenant_id: "a", evento: "chamada", n: 100 },
      { tenant_id: "a", evento: "busca_paciente", n: 40 },
      { tenant_id: "a", evento: "busca_paciente:erro", n: 3 },
      { tenant_id: "a", evento: "erp:ASA_FORA_DO_AR", n: 9 },
      { tenant_id: "a", evento: "erp:ASA_LIMITE", n: 3 },
    ],
  }, p, AGORA, "0.35.0");
  const a = r.clinicas[0];
  assert.equal(a.eventos.busca_paciente, 40);
  assert.deepEqual(a.erros_erp, { total: 12, chamadas: 100, principais: [{ erro: "ASA_FORA_DO_AR", n: 9 }, { erro: "ASA_LIMITE", n: 3 }] });
  assert.ok(a.funcoes.includes("busca"));
  assert.equal(a.versao.antiga, true);
  assert.deepEqual(a.alertas.map((x) => `${x.tipo}:${x.nivel}`), ["erp_erro_alto:aviso", "versao_antiga:aviso"]);
  assert.equal(r.totais.buscas, 40);
});

test("alertas novos: falha do ERP só com volume, crítica acima de 30%; versão só por versão menor e recente", () => {
  const ee = (total: number, chamadas: number) => ({ ...base, erros_erp: { total, chamadas, principais: [] } });
  assert.deepEqual(tipos(ee(9, 20)), []);
  assert.deepEqual(tipos(ee(10, 200)), []);
  assert.deepEqual(tipos(ee(31, 100)), ["erp_erro_alto:critico"]);
  assert.equal(versaoAtrasada("0.34.9", "0.35.0"), true);
  assert.equal(versaoAtrasada("0.35.0", "0.35.2"), false);
  assert.equal(versaoAtrasada("1.0.0", "0.35.0"), false);
  assert.equal(versaoAtrasada(null, "0.35.0"), false);
  // Versão vista há mais de 7 dias: a clínica parou (o alerta de parada já cobre), não é versão antiga.
  const p = periodoUso("2026-11-24", 30);
  const r = montarUso({
    tenants: [{ id: "a", nome: "A", ativo: true, erp: "asa", criado_em: diasAtras(60), ultimo_uso_em: diasAtras(0), desligado_em: null,
      tem_credencial: true, confirmacao: {}, financeiro: {}, extensao_versao: "0.30.0", extensao_versao_em: diasAtras(8) }],
    agendamentos: [], cobrancas: [], confirmacoes: [], atendimentos: [], usuarios: [], ultimas: [],
  }, p, AGORA, "0.35.0");
  assert.equal(r.clinicas[0].versao.antiga, false);
});

test("rota /admin/uso exige a chave e para no banco ausente", async () => {
  const app = Fastify();
  await app.register(adminRoutes);
  assert.equal((await app.inject({ method: "GET", url: "/admin/uso" })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/admin/uso?dias=7", headers: { "x-admin-key": CHAVE } })).statusCode, 503);
  await app.close();
});

test("alerta sem uso no expediente: clínica de uso diário, 3 h sem chamada, de segunda a sexta, das 10h às 18h de SP", () => {
  const horasAtras = (agora: Date, h: number) => new Date(agora.getTime() - h * 3600000).toISOString();
  const diaria = { total: 0, chamadas: 30 * 20, principais: [] }; // 20 chamadas por dia no período de 30
  const em = (agora: Date, h: number, erros_erp = diaria) => alertasDe({ ...base, erros_erp, ultimo_uso_em: horasAtras(agora, h) }, P, agora.getTime()).map((a) => a.tipo);
  const terca12h = new Date("2026-11-24T15:00:00Z"); // terça, 12h em SP
  assert.deepEqual(em(terca12h, 2), []);
  assert.deepEqual(em(terca12h, 3), ["sem_uso_expediente"]);
  assert.deepEqual(em(terca12h, 20), ["sem_uso_expediente"]); // parou ontem à tarde e não voltou hoje
  assert.deepEqual(em(terca12h, 20, { total: 0, chamadas: 30 * 3, principais: [] }), []); // uso eventual (apresentação, teste)
  assert.deepEqual(em(new Date("2026-11-24T12:30:00Z"), 15), []); // 9h30: cedo demais
  assert.deepEqual(em(new Date("2026-11-24T21:30:00Z"), 5), []); // 18h30: fora do expediente
  assert.deepEqual(em(new Date("2026-11-28T15:00:00Z"), 20), []); // sábado
  // Parada há dias: vale o alerta de parada, sem repetir.
  assert.deepEqual(em(terca12h, 24 * 4), ["parada"]);
  assert.equal(emExpediente(new Date("2026-11-24T13:00:00Z").getTime()), true); // 10h
  assert.equal(emExpediente(new Date("2026-11-24T21:00:00Z").getTime()), false); // 18h
});
