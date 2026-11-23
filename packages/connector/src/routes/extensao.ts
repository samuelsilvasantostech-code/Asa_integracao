import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";

const TIPOS: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

// Arquivo lido uma vez por processo (os estáticos só mudam num deploy, que reinicia o Conector), já
// comprimido em brotli e gzip, com uma ETag do conteúdo.
interface Arquivo { tipo: string; puro: Buffer; br: Buffer; gz: Buffer; etag: string }
const arquivos = new Map<string, Promise<Arquivo | null>>();

function carregar(caminho: string, tipo: string): Promise<Arquivo | null> {
  let p = arquivos.get(caminho);
  if (!p) {
    p = readFile(caminho).then(
      (puro) => ({
        tipo,
        puro,
        br: brotliCompressSync(puro, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
        gz: gzipSync(puro, { level: 9 }),
        etag: '"' + createHash("sha256").update(puro).digest("base64url").slice(0, 27) + '"',
      }),
      () => null,
    );
    arquivos.set(caminho, p);
    // Arquivo que não existe não fica guardado: pode aparecer depois.
    p.then((a) => { if (!a) arquivos.delete(caminho); });
  }
  return p;
}

function aceita(req: FastifyRequest, cod: string) {
  const v = req.headers["accept-encoding"];
  return typeof v === "string" && v.split(",").some((x) => x.trim().split(";")[0] === cod);
}

// Serve os estáticos da extensão. O host da Kentro exige CORS e carrega as telas num iframe,
// então aqui não pode haver X-Frame-Options (o tipo "Extensão" do Doca manda DENY).
// `dir` troca a pasta (testes).
export async function extensaoRoutes(app: FastifyInstance, opts: { dir?: string } = {}) {
  const raiz = resolve(opts.dir ?? config.extensionDir);

  app.get<{ Params: { "*": string }; Querystring: { v?: string } }>("/extensao/*", async (req, reply) => {
    const caminho = resolve(raiz, req.params["*"] || "manifest.json");
    const tipo = TIPOS[extname(caminho)];
    if (!caminho.startsWith(raiz + sep) || !tipo) return reply.code(404).send({ erro: "NAO_ENCONTRADO" });
    const a = await carregar(caminho, tipo);
    if (!a) return reply.code(404).send({ erro: "NAO_ENCONTRADO" });

    reply
      .header("Access-Control-Allow-Origin", "*")
      .header("X-Content-Type-Options", "nosniff")
      .header("Vary", "Accept-Encoding")
      .header("ETag", a.etag)
      // Telas e manifesto: o host busca sem versão na URL, então revalida sempre (com a ETag, a resposta
      // é um 304 vazio quando nada mudou). Scripts e estilo vêm com ?v=<versão>: a URL muda a cada versão,
      // então podem ficar guardados no navegador.
      .header("Cache-Control", req.query.v && tipo !== TIPOS[".html"] && tipo !== TIPOS[".json"] ? "public, max-age=31536000, immutable" : "no-cache");

    if (req.headers["if-none-match"] === a.etag) return reply.code(304).send();

    reply.type(a.tipo);
    if (aceita(req, "br")) return reply.header("Content-Encoding", "br").send(a.br);
    if (aceita(req, "gzip")) return reply.header("Content-Encoding", "gzip").send(a.gz);
    return reply.send(a.puro);
  });
}
