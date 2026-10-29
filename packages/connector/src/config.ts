import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const extensionDir = process.env.EXTENSION_DIR ?? "../extension";

// A versão do produto é a do manifest da extensão, que sobe a cada publicação. Rodando com `node`
// (como no Doca) não existe npm_package_version.
function versao(): string {
  try {
    const v = JSON.parse(readFileSync(resolve(extensionDir, "manifest.json"), "utf8")).version;
    if (typeof v === "string" && v) return v;
  } catch {
    // sem manifest: usa o que houver
  }
  return process.env.npm_package_version ?? "0.0.0";
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "",
  credKey: process.env.ASA_CRED_KEY ?? "",
  adminKey: process.env.ADMIN_KEY ?? "",
  extensionDir,
  logLevel: process.env.LOG_LEVEL ?? "info",
  version: versao(),
  // Domínios aceitos (separados por vírgula). Requisição por outro host, como o IP:porta direto do
  // Doca em HTTP puro, é recusada, exceto /health. Vazio desliga a checagem.
  allowedHosts: (process.env.ALLOWED_HOSTS ?? "asa-integracao-samuels.kentro.com.br,localhost,127.0.0.1")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
};
