import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

const TIPOS: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

// Serve os estáticos da extensão. O host da Kentro exige CORS e carrega as telas num iframe,
// então aqui não pode haver X-Frame-Options (o tipo "Extensão" do Doca manda DENY).
export async function extensaoRoutes(app: FastifyInstance) {
  const raiz = resolve(config.extensionDir);

  app.get<{ Params: { "*": string } }>("/extensao/*", async (req, reply) => {
    const caminho = resolve(raiz, req.params["*"] || "manifest.json");
    const tipo = TIPOS[extname(caminho)];
    if (!caminho.startsWith(raiz + sep) || !tipo) return reply.code(404).send({ erro: "NAO_ENCONTRADO" });
    let conteudo: Buffer;
    try {
      conteudo = await readFile(caminho);
    } catch {
      return reply.code(404).send({ erro: "NAO_ENCONTRADO" });
    }
    return reply
      .header("Access-Control-Allow-Origin", "*")
      // O host busca os arquivos sem versão na URL: com cache, uma versão nova demora a aparecer.
      .header("Cache-Control", "no-cache")
      .header("X-Content-Type-Options", "nosniff")
      .type(tipo)
      .send(conteudo);
  });
}
