import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { adminRoutes } from "../src/routes/admin.js";

// O roteador decodifica %61 → a, mas req.url fica cru: a chave tem que ser cobrada pela rota, não pelo texto da URL.
test("admin: caminho com percent-encoding também exige a chave", async () => {
  const app = Fastify();
  await app.register(adminRoutes);
  for (const url of ["/admin/tenants", "/%61dmin/tenants", "/%61%64min/tenants/x/agendamentos", "/admin%2Ftenants"]) {
    const r = await app.inject({ method: "GET", url });
    assert.ok(r.statusCode === 401 || r.statusCode === 404, `${url} → ${r.statusCode}`);
  }
  const p = await app.inject({ method: "POST", url: "/%61dmin/tenants/x/rotacionar-chave" });
  assert.equal(p.statusCode, 401);
  await app.close();
});
