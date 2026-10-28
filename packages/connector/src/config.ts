export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "",
  adminKey: process.env.ADMIN_KEY ?? "",
  logLevel: process.env.LOG_LEVEL ?? "info",
  version: process.env.npm_package_version ?? "0.1.0",
};
