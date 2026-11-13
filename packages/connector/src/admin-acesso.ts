// Acesso à implantação por usuário e senha. Senha com scrypt (sal próprio); sessão = token aleatório num cookie
// HttpOnly/Secure/SameSite=Strict, e o banco guarda só o hash do token. A ADMIN_KEY continua valendo (header
// x-admin-key) para o primeiro acesso, para scripts e como emergência.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "./db.js";

export const COOKIE = "__Host-clinfy_sessao";
export const SESSAO_HORAS = 12;
export const SENHA_MIN = 10;
// Pedidos com sessão precisam deste header: um site de fora não consegue mandá-lo sem CORS (que o Conector não
// abre), então o cookie sozinho não basta para agir (proteção contra CSRF, junto com SameSite=Strict).
export const HEADER_TELA = "x-clinfy";

const N = 16384, R = 8, P = 1, TAM = 32;

function scrypt(senha: string, sal: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const opt: ScryptOptions = { N: n, r, p, maxmem: 64 * 1024 * 1024 };
  return new Promise((ok, falha) => scryptCb(senha.normalize("NFKC"), sal, TAM, opt, (e, k) => (e ? falha(e) : ok(k))));
}

export async function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const k = await scrypt(senha, sal, N, R, P);
  return ["scrypt", N, R, P, sal.toString("base64url"), k.toString("base64url")].join("$");
}

// Hash fixo usado quando o usuário não existe: o tempo de resposta não revela quem tem cadastro.
const FALSO = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(43);

export async function conferirSenha(senha: string, guardado: string | null): Promise<boolean> {
  const partes = (guardado ?? FALSO).split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, n, r, p, sal, hash] = partes;
  const esperado = Buffer.from(hash, "base64url");
  const k = await scrypt(senha, Buffer.from(sal, "base64url"), Number(n), Number(r), Number(p));
  return guardado !== null && esperado.length === k.length && timingSafeEqual(esperado, k);
}

// Usuário: minúsculas, dígitos e . _ @ - (dá para usar o e-mail). 3 a 80 caracteres.
export function lerUsuario(v: unknown): string | null {
  const u = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[a-z0-9][a-z0-9._@-]{2,79}$/.test(u) ? u : null;
}
export function lerNome(v: unknown): string | null {
  const n = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  return n.length >= 1 && n.length <= 120 ? n : null;
}
export function senhaValida(v: unknown): v is string {
  return typeof v === "string" && v.length >= SENHA_MIN && v.length <= 200;
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function lerCookie(req: FastifyRequest): string | null {
  const bruto = req.headers.cookie;
  if (typeof bruto !== "string") return null;
  for (const parte of bruto.split(";")) {
    const i = parte.indexOf("=");
    if (i > 0 && parte.slice(0, i).trim() === COOKIE) {
      const v = parte.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{20,100}$/.test(v) ? v : null;
    }
  }
  return null;
}

export type UsuarioAdmin = { id: string; usuario: string; nome: string };

// Sessão válida do cookie (e o header da tela presente). null se não houver.
export async function usuarioDaSessao(req: FastifyRequest): Promise<UsuarioAdmin | null> {
  if (!pool || req.headers[HEADER_TELA] !== "1") return null;
  const token = lerCookie(req);
  if (!token) return null;
  const { rows } = await pool.query<UsuarioAdmin>(
    `SELECT u.id, u.usuario, u.nome FROM admin_sessoes s JOIN admin_usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.expira_em > now() AND u.ativo`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function abrirSessao(reply: FastifyReply, usuarioId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await pool!.query(
    `INSERT INTO admin_sessoes (token_hash, usuario_id, expira_em) VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [hashToken(token), usuarioId, SESSAO_HORAS],
  );
  await pool!.query("UPDATE admin_usuarios SET ultimo_acesso_em = now() WHERE id = $1", [usuarioId]);
  // Limpeza oportunista das vencidas.
  await pool!.query("DELETE FROM admin_sessoes WHERE expira_em < now()");
  reply.header("set-cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSAO_HORAS * 3600}`);
}

export async function fecharSessao(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = lerCookie(req);
  if (token && pool) await pool.query("DELETE FROM admin_sessoes WHERE token_hash = $1", [hashToken(token)]);
  reply.header("set-cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
