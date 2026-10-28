export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "",
  credKey: process.env.ASA_CRED_KEY ?? "",
  adminKey: process.env.ADMIN_KEY ?? "",
  extensionDir: process.env.EXTENSION_DIR ?? "../extension",
  logLevel: process.env.LOG_LEVEL ?? "info",
  version: process.env.npm_package_version ?? "0.1.0",
};
