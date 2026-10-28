import Fastify from "fastify";
import { config } from "./config.js";
import { migrate, pool } from "./db.js";
import { adminRoutes } from "./routes/admin.js";
import { extensaoRoutes } from "./routes/extensao.js";
import { healthRoutes } from "./routes/health.js";
import { tenantRoutes } from "./routes/tenant.js";

const app = Fastify({ logger: { level: config.logLevel } });

await app.register(healthRoutes);
await app.register(tenantRoutes);
await app.register(adminRoutes);
await app.register(extensaoRoutes);

try {
  await migrate((msg) => app.log.info(msg));
} catch (err) {
  app.log.error({ err }, "falha ao aplicar migrações");
}

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.on(sinal, async () => {
    await app.close();
    await pool?.end();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: "0.0.0.0" });
