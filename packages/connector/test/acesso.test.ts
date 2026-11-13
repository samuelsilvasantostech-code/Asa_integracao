import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";

// Sem banco: senha, cookie, validação e o fechamento das rotas.
const CHAVE = "k".repeat(40);
process.env.ADMIN_KEY = CHAVE;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
const { conferirSenha, hashSenha, lerCookie, lerUsuario, senhaValida, usuarioDaSessao, COOKIE } = await import("../src/admin-acesso.js");
const { acessoRoutes } = await import("../src/routes/acesso.js");
const { adminRoutes } = await import("../src/routes/admin.js");

test("senha: scrypt com sal próprio; confere a certa, recusa a errada e o usuário inexistente", async () => {
  const h1 = await hashSenha("senha-muito-boa");
  const h2 = await hashSenha("senha-muito-boa");
  assert.match(h1, /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.notEqual(h1, h2, "sal diferente a cada hash");
  assert.equal(await conferirSenha("senha-muito-boa", h1), true);
  assert.equal(await conferirSenha("senha-muito-ruim", h1), false);
  assert.equal(await conferirSenha("senha-muito-boa", null), false);
  assert.equal(await conferirSenha("x", "lixo"), false);
});

test("usuário e senha: formato", () => {
  assert.equal(lerUsuario(" Samuel@Clinfy.com "), "samuel@clinfy.com");
  assert.equal(lerUsuario("ab"), null);
  assert.equal(lerUsuario("tem espaço"), null);
  assert.equal(senhaValida("123456789"), false);
  assert.equal(senhaValida("1234567890"), true);
});

test("cookie: lê só o da sessão, e só no formato do token", () => {
  const req = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as never;
  const token = "a".repeat(43);
  assert.equal(lerCookie(req(`outro=1; ${COOKIE}=${token}`)), token);
  assert.equal(lerCookie(req(`${COOKIE}=curto`)), null);
  assert.equal(lerCookie(req()), null);
});

test("sessão sem o header da tela não vale (CSRF)", async () => {
  assert.equal(await usuarioDaSessao({ headers: { cookie: `${COOKIE}=${"a".repeat(43)}` } } as never), null);
});

test("rotas de entrada: existem e, sem banco, respondem 503", async () => {
  const app = Fastify();
  await app.register(acessoRoutes);
  for (const [method, url] of [["GET", "/admin/sessao"], ["POST", "/admin/sessao"], ["DELETE", "/admin/sessao"], ["POST", "/admin/primeiro-acesso"]] as const) {
    assert.equal((await app.inject({ method, url })).statusCode, 503, `${method} ${url}`);
  }
  await app.close();
});

test("gestão de usuários: exige chave ou sessão", async () => {
  const app = Fastify();
  await app.register(adminRoutes);
  for (const [method, url] of [["GET", "/admin/usuarios"], ["POST", "/admin/usuarios"], ["PATCH", "/admin/usuarios/0b6c7a3e-1d2f-4a5b-9c8d-7e6f5a4b3c2d"]] as const) {
    assert.equal((await app.inject({ method, url, headers: { "x-clinfy": "1" } })).statusCode, 401, `${method} ${url} sem chave`);
    assert.equal((await app.inject({ method, url, headers: { "x-admin-key": CHAVE } })).statusCode, 503, `${method} ${url} com chave, sem banco`);
  }
  await app.close();
});
