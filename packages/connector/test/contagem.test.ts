import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import {
  contar, contarResposta, eventoDa, gravarUso, marcarErroErp, marcarTenant, pendentesUso, SQL_GRAVAR_USO,
} from "../src/contagem.js";
import { versaoDoHeader } from "../src/tenant-auth.js";

const T = "11111111-1111-1111-1111-111111111111";

// Esvazia o acumulado entre os testes (gravarUso limpa o que mandou).
const esvaziar = () => gravarUso({ query: async () => ({}) } as any);

test("evento: só rotas da lista, pelo molde; erro de sistema separado, recusa do pedido ignorada", () => {
  assert.equal(eventoDa("GET", "/v1/paciente", 200), "busca_paciente");
  assert.equal(eventoDa("GET", "/v1/paciente", 502), "busca_paciente:erro");
  assert.equal(eventoDa("GET", "/v1/paciente", 422), "busca_paciente:erro");
  assert.equal(eventoDa("GET", "/v1/paciente", 400), null);
  assert.equal(eventoDa("POST", "/v1/paciente", 200), null);
  assert.equal(eventoDa("GET", "/v1/exames/:id/convenios", 200), null);
  assert.equal(eventoDa("GET", undefined, 200), null);
});

test("contagem pela resposta: molde da rota (nunca a URL com CPF), chamada e falha do ERP", async () => {
  await esvaziar();
  const app = Fastify();
  app.addHook("onResponse", async (req, reply) => contarResposta(req, reply.statusCode));
  app.get("/v1/paciente", async (req, reply) => {
    marcarTenant(req, T);
    if ((req.query as { cpf?: string }).cpf === "0") {
      marcarErroErp(req, "ASA_FORA_DO_AR");
      return reply.code(502).send({ erro: "ASA_FORA_DO_AR" });
    }
    return { encontrado: false };
  });
  app.get("/v1/exames/:id/convenios", async (req) => (marcarTenant(req, T), []));
  app.get("/v1/sem-clinica", async () => ({}));
  await app.inject("/v1/paciente?cpf=12345678901");
  await app.inject("/v1/paciente?cpf=12345678901");
  await app.inject("/v1/paciente?cpf=0");
  await app.inject("/v1/exames/9/convenios");
  await app.inject("/v1/sem-clinica");
  await app.close();

  const chamadas: unknown[][] = [];
  const n = await gravarUso({ query: async (sql: string, args: unknown[]) => (chamadas.push([sql, args]), {}) } as any);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0][0], SQL_GRAVAR_USO);
  const [tenants, dias, eventos, ns] = chamadas[0][1] as [string[], string[], string[], number[]];
  const porEvento = Object.fromEntries(eventos.map((e, i) => [e, ns[i]]));
  assert.deepEqual(porEvento, { chamada: 4, busca_paciente: 2, "busca_paciente:erro": 1, "erp:ASA_FORA_DO_AR": 1 });
  assert.equal(n, 4);
  assert.ok(tenants.every((t) => t === T));
  assert.ok(dias.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
  assert.ok(!JSON.stringify(chamadas).includes("12345678901"));
});

test("gravação: soma no mesmo dia e evento; numa falha do banco, guarda para a próxima", async () => {
  await esvaziar();
  const dia = new Date("2026-11-24T15:00:00Z");
  contar(T, "abertura", dia);
  contar(T, "abertura", dia);
  contar(T, "abertura", new Date("2026-11-25T02:59:00Z")); // ainda 24/11 em São Paulo
  contar(T, "abertura", new Date("2026-11-25T03:00:00Z"));
  assert.equal(pendentesUso(), 2);

  await assert.rejects(gravarUso({ query: async () => { throw new Error("banco fora"); } } as any));
  contar(T, "abertura", dia);
  assert.equal(pendentesUso(), 2);

  let args: unknown[] = [];
  await gravarUso({ query: async (_s: string, a: unknown[]) => ((args = a), {}) } as any);
  assert.deepEqual(args, [[T, T], ["2026-11-24", "2026-11-25"], ["abertura", "abertura"], [4, 1]]);
  assert.equal(pendentesUso(), 0);
  assert.match(SQL_GRAVAR_USO, /n = uso_diario\.n \+ EXCLUDED\.n/);
});

test("código de falha do ERP fora do padrão vira OUTRO; versão só no formato 1.2.3", async () => {
  await esvaziar();
  const app = Fastify();
  app.addHook("onResponse", async (req, reply) => contarResposta(req, reply.statusCode));
  app.get("/v1/agenda", async (req, reply) => (marcarTenant(req, T), marcarErroErp(req, "erro com texto livre"), reply.code(502).send({})));
  await app.inject("/v1/agenda");
  await app.close();
  let args: unknown[][] = [];
  await gravarUso({ query: async (_s: string, a: unknown[][]) => ((args = a), {}) } as any);
  assert.deepEqual(args[2], ["chamada", "erp:OUTRO"]);

  assert.equal(versaoDoHeader("0.35.0"), "0.35.0");
  for (const v of [undefined, "", "0.35", "0.35.0-beta", "1.2.3; drop", ["0.35.0"], "1234.0.0"]) assert.equal(versaoDoHeader(v), null);
});
