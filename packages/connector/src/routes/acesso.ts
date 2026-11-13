// Entrada na implantação por usuário e senha (src/admin-acesso.ts). Estas rotas ficam fora do hook do /admin:
// são elas que abrem a sessão. A gestão de usuários (usuariosAdmin) fica dentro dele.
import type { FastifyInstance } from "fastify";
import {
  abrirSessao, conferirSenha, fecharSessao, hashSenha, lerNome, lerUsuario, senhaValida, SENHA_MIN, usuarioDaSessao,
  type UsuarioAdmin,
} from "../admin-acesso.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import { Limite } from "../limite.js";
import { adminAutorizado } from "./admin.js";

// Senha errada: 5 por usuário em 15 minutos; com TRUST_PROXY, também 20 por IP em 10 minutos.
const falhasPorUsuario = new Limite(5, 15 * 60 * 1000);
const falhasPorIp = new Limite(20, 10 * 60 * 1000);

async function haUsuarios(): Promise<boolean> {
  const { rows } = await pool!.query("SELECT 1 FROM admin_usuarios LIMIT 1");
  return rows.length > 0;
}

export async function acessoRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (_req, reply) => {
    if (!pool) return reply.code(503).send({ erro: "BANCO_NAO_CONFIGURADO" });
  });

  // Quem está entrando. Sem sessão: 401, e diz se ainda falta criar o primeiro acesso.
  app.get("/admin/sessao", async (req, reply) => {
    const u = await usuarioDaSessao(req);
    if (u) return { usuario: u };
    return reply.code(401).send({ erro: "SEM_SESSAO", primeiro_acesso: !(await haUsuarios()) });
  });

  app.post<{ Body: { usuario?: unknown; senha?: unknown } }>("/admin/sessao", async (req, reply) => {
    const usuario = lerUsuario(req.body?.usuario);
    const senha = req.body?.senha;
    if (config.trustProxy && falhasPorIp.excedido(req.ip)) return reply.code(429).send({ erro: "MUITAS_TENTATIVAS" });
    if (usuario && falhasPorUsuario.excedido(usuario)) return reply.code(429).send({ erro: "MUITAS_TENTATIVAS" });
    const { rows } = usuario
      ? await pool!.query<{ id: string; senha_hash: string; ativo: boolean }>(
          "SELECT id, senha_hash, ativo FROM admin_usuarios WHERE usuario = $1", [usuario])
      : { rows: [] };
    const achado = rows[0];
    const ok = await conferirSenha(typeof senha === "string" ? senha : "", achado?.senha_hash ?? null);
    if (!ok || !achado?.ativo) {
      if (usuario) falhasPorUsuario.registrar(usuario);
      if (config.trustProxy) falhasPorIp.registrar(req.ip);
      req.log.warn({ usuario }, "implantação: entrada recusada");
      return reply.code(401).send({ erro: "LOGIN_INVALIDO" });
    }
    await abrirSessao(reply, achado.id);
    req.log.info({ usuario }, "implantação: entrada");
    return { ok: true };
  });

  app.delete("/admin/sessao", async (req, reply) => {
    await fecharSessao(req, reply);
    return { ok: true };
  });

  // Primeiro acesso: só enquanto não houver nenhum usuário, e só com a ADMIN_KEY (header x-admin-key).
  app.post<{ Body: { usuario?: unknown; nome?: unknown; senha?: unknown } }>("/admin/primeiro-acesso", async (req, reply) => {
    if (config.trustProxy && falhasPorIp.excedido(req.ip)) return reply.code(429).send({ erro: "MUITAS_TENTATIVAS" });
    if (!adminAutorizado(req)) {
      if (config.trustProxy) falhasPorIp.registrar(req.ip);
      return reply.code(401).send({ erro: "NAO_AUTORIZADO" });
    }
    if (await haUsuarios()) return reply.code(409).send({ erro: "JA_HA_USUARIOS" });
    const r = await criarUsuario(req.body, "primeiro acesso (ADMIN_KEY)");
    if ("erro" in r) return reply.code(r.status).send({ erro: r.erro });
    await abrirSessao(reply, r.id);
    req.log.info({ usuario: r.usuario }, "implantação: primeiro usuário criado");
    return reply.code(201).send({ ok: true });
  });
}

type Criado = { id: string; usuario: string } | { status: number; erro: string };

async function criarUsuario(corpo: { usuario?: unknown; nome?: unknown; senha?: unknown } | undefined, por: string): Promise<Criado> {
  const usuario = lerUsuario(corpo?.usuario);
  const nome = lerNome(corpo?.nome);
  if (!usuario) return { status: 400, erro: "USUARIO_INVALIDO" };
  if (!nome) return { status: 400, erro: "NOME_OBRIGATORIO" };
  if (!senhaValida(corpo?.senha)) return { status: 400, erro: "SENHA_FRACA" };
  const { rows } = await pool!.query<{ id: string }>(
    `INSERT INTO admin_usuarios (usuario, nome, senha_hash, criado_por) VALUES ($1, $2, $3, $4)
     ON CONFLICT (usuario) DO NOTHING RETURNING id`,
    [usuario, nome, await hashSenha(corpo!.senha as string), por],
  );
  if (!rows.length) return { status: 409, erro: "USUARIO_JA_EXISTE" };
  return { id: rows[0].id, usuario };
}

// Gestão de usuários, registrada dentro de adminRoutes (já passou pela chave ou pela sessão).
export function usuariosAdmin(app: FastifyInstance) {
  const quem = (req: unknown) => (req as { usuarioAdmin?: UsuarioAdmin }).usuarioAdmin ?? null;

  app.get("/admin/usuarios", async (req) => {
    const { rows } = await pool!.query(
      `SELECT id, usuario, nome, ativo, criado_em, criado_por, ultimo_acesso_em, senha_trocada_em
         FROM admin_usuarios ORDER BY criado_em`,
    );
    return { usuarios: rows, eu: quem(req), senha_min: SENHA_MIN };
  });

  app.post<{ Body: { usuario?: unknown; nome?: unknown; senha?: unknown } }>("/admin/usuarios", async (req, reply) => {
    const eu = quem(req);
    const r = await criarUsuario(req.body, eu ? eu.usuario : "ADMIN_KEY");
    if ("erro" in r) return reply.code(r.status).send({ erro: r.erro });
    req.log.info({ usuario: r.usuario, por: eu?.usuario ?? "ADMIN_KEY" }, "implantação: usuário criado");
    return reply.code(201).send({ id: r.id });
  });

  // Ativar/desativar ou trocar a senha. Desativar e trocar a senha encerram as sessões abertas daquele usuário.
  app.patch<{ Params: { uid: string }; Body: { ativo?: unknown; senha?: unknown } }>("/admin/usuarios/:uid", async (req, reply) => {
    const uid = req.params.uid;
    if (!/^[0-9a-f-]{36}$/.test(uid)) return reply.code(400).send({ erro: "ID_INVALIDO" });
    const eu = quem(req);
    const b = req.body ?? {};
    if (b.ativo !== undefined && typeof b.ativo !== "boolean") return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    if (b.senha !== undefined && !senhaValida(b.senha)) return reply.code(400).send({ erro: "SENHA_FRACA" });
    if (b.ativo === undefined && b.senha === undefined) return reply.code(400).send({ erro: "NADA_PARA_ALTERAR" });
    if (b.ativo === false && eu?.id === uid) return reply.code(409).send({ erro: "NAO_PODE_DESATIVAR_A_SI" });
    const { rowCount } = await pool!.query(
      `UPDATE admin_usuarios SET ativo = COALESCE($2, ativo),
              senha_hash = COALESCE($3, senha_hash),
              senha_trocada_em = CASE WHEN $3::text IS NULL THEN senha_trocada_em ELSE now() END
        WHERE id = $1`,
      [uid, b.ativo ?? null, typeof b.senha === "string" ? await hashSenha(b.senha) : null],
    );
    if (!rowCount) return reply.code(404).send({ erro: "USUARIO_NAO_ENCONTRADO" });
    if (b.ativo === false || b.senha !== undefined) {
      await pool!.query("DELETE FROM admin_sessoes WHERE usuario_id = $1", [uid]);
      // Quem trocou a própria senha ganha uma sessão nova e segue na tela.
      if (eu?.id === uid) await abrirSessao(reply, uid);
    }
    req.log.info({ alvo: uid, por: eu?.usuario ?? "ADMIN_KEY", ativo: b.ativo, senha: b.senha !== undefined }, "implantação: usuário alterado");
    return { ok: true };
  });
}
