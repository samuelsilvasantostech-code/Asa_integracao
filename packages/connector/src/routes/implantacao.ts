import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

// Página de implantação: cadastro e acompanhamento das clínicas pela chave de administrador. A página em si
// é pública (não tem segredo); tudo o que ela mostra vem de /admin/*, que exige a chave a cada chamada.
const publico = fileURLToPath(new URL("../../public/", import.meta.url));

// Só estes arquivos: nada de caminho vindo da URL.
const ARQUIVOS: Record<string, { arquivo: string; tipo: string }> = {
  "/implantacao": { arquivo: "implantacao.html", tipo: "text/html; charset=utf-8" },
  "/implantacao/implantacao.js": { arquivo: "implantacao.js", tipo: "text/javascript; charset=utf-8" },
  "/implantacao/implantacao.css": { arquivo: "implantacao.css", tipo: "text/css; charset=utf-8" },
};

export async function implantacaoRoutes(app: FastifyInstance) {
  for (const [rota, { arquivo, tipo }] of Object.entries(ARQUIVOS)) {
    app.get(rota, async (_req, reply) => {
      let conteudo: Buffer;
      try {
        conteudo = await readFile(publico + arquivo);
      } catch {
        return reply.code(404).send({ erro: "NAO_ENCONTRADO" });
      }
      return reply
        // A chave de administrador é digitada nesta página: nada de cache, iframe, referer ou script de fora.
        .header("Cache-Control", "no-store")
        .header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        .header("X-Frame-Options", "DENY")
        .header("Referrer-Policy", "no-referrer")
        .header("X-Content-Type-Options", "nosniff")
        .type(tipo)
        .send(conteudo);
    });
  }
}
