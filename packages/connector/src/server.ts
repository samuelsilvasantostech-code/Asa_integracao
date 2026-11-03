import Fastify from "fastify";
import { config, problemaDeConfig } from "./config.js";
import { migrate, pool } from "./db.js";
import { iniciarRetencao } from "./retencao.js";
import { adminRoutes } from "./routes/admin.js";
import { agendamentoRoutes } from "./routes/agendamento.js";
import { confirmacaoRoutes } from "./routes/confirmacao.js";
import { consultaRoutes } from "./routes/consulta.js";
import { extensaoRoutes } from "./routes/extensao.js";
import { financeiroRoutes } from "./routes/financeiro.js";
import { examesRoutes } from "./routes/exames.js";
import { healthRoutes } from "./routes/health.js";
import { implantacaoRoutes } from "./routes/implantacao.js";
import { painelRoutes } from "./routes/painel.js";
import { tenantRoutes } from "./routes/tenant.js";

// ADMIN_KEY curta não derruba o Conector (as clínicas continuam atendendo): só o /admin fica fechado.
const problema = problemaDeConfig(config);
if (problema) console.error(`[asa-connector] /admin desligado: ${problema}`);

// O log de requisição não leva a query string: a busca de paciente vai por ?cpf= e ?telefone=, e
// esses dados não podem ficar nos logs do Doca.
const app = Fastify({
  // Com TRUST_PROXY, req.ip é o IP do cliente (X-Forwarded-For do proxy do Doca), não o do proxy.
  // Confia nos N saltos mais próximos (o tipo do Fastify não aceita o número direto).
  trustProxy: config.trustProxy ? (_endereco: string, salto: number) => salto < (config.trustProxy as number) : false,
  logger: {
    level: config.logLevel,
    serializers: {
      req: (req) => ({ method: req.method, url: String(req.url ?? "").split("?")[0], hostname: req.hostname, remoteAddress: req.ip }),
    },
  },
});

// 404 sem repetir a URL na resposta nem no log (o tratamento padrão do Fastify faz os dois, com a query).
app.setNotFoundHandler((_req, reply) => reply.code(404).send({ erro: "NAO_ENCONTRADO" }));

// Erro inesperado (banco, bug) vira resposta genérica; o detalhe fica só no log. Erros 4xx do próprio
// Fastify (JSON inválido, corpo grande demais) continuam com o código certo.
app.setErrorHandler((err: { statusCode?: number; code?: string }, req, reply) => {
  const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
  if (status === 500) req.log.error({ err }, "erro inesperado");
  return reply.code(status).send({ erro: status === 500 ? "ERRO_INTERNO" : err.code ?? "REQUISICAO_INVALIDA" });
});

// Só pelo domínio (HTTPS no proxy do Doca): o acesso direto por IP:porta trafegaria chaves em claro.
app.addHook("onRequest", async (req, reply) => {
  if (!config.allowedHosts.length || req.url === "/health") return;
  const host = String(req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!config.allowedHosts.includes(host)) return reply.code(421).send({ erro: "HOST_NAO_PERMITIDO" });
});

await app.register(healthRoutes);
await app.register(tenantRoutes);
await app.register(consultaRoutes);
await app.register(agendamentoRoutes);
await app.register(confirmacaoRoutes);
await app.register(financeiroRoutes);
await app.register(examesRoutes);
await app.register(painelRoutes);
await app.register(adminRoutes);
await app.register(extensaoRoutes);
await app.register(implantacaoRoutes);

try {
  await migrate((msg) => app.log.info(msg));
} catch (err) {
  app.log.error({ err }, "falha ao aplicar migrações");
}
iniciarRetencao(pool, app.log);
if (!config.trustProxy) app.log.warn("TRUST_PROXY não definido: o limite de tentativas de chave por IP está desligado");

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.on(sinal, async () => {
    await app.close();
    await pool?.end();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: "0.0.0.0" });
