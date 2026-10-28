export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "",
  credKey: process.env.ASA_CRED_KEY ?? "",
  adminKey: process.env.ADMIN_KEY ?? "",
  extensionDir: process.env.EXTENSION_DIR ?? "../extension",
  logLevel: process.env.LOG_LEVEL ?? "info",
  version: process.env.npm_package_version ?? "0.1.0",
  // Domínios aceitos (separados por vírgula). Requisição por outro host, como o IP:porta direto do
  // Doca em HTTP puro, é recusada, exceto /health. Vazio desliga a checagem.
  allowedHosts: (process.env.ALLOWED_HOSTS ?? "asa-integracao-samuels.kentro.com.br,localhost,127.0.0.1")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
};
