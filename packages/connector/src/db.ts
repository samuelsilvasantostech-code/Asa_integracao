import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.js";

export const pool = config.databaseUrl
  ? new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
  : null;

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

// Aplica, em ordem e uma única vez, os arquivos .sql de migrations/.
export async function migrate(log: (msg: string) => void): Promise<void> {
  if (!pool) {
    log("DATABASE_URL ausente: migrações não aplicadas");
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(728311)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())",
    );
    const { rows } = await client.query<{ nome: string }>("SELECT nome FROM schema_migrations");
    const aplicadas = new Set(rows.map((r) => r.nome));
    const arquivos = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const arquivo of arquivos) {
      if (aplicadas.has(arquivo)) continue;
      const sql = await readFile(migrationsDir + arquivo, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (nome) VALUES ($1)", [arquivo]);
        await client.query("COMMIT");
        log(`migração aplicada: ${arquivo}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(728311)").catch(() => {});
    client.release();
  }
}

export async function dbStatus(): Promise<"ok" | "nao_configurado" | "erro"> {
  if (!pool) return "nao_configurado";
  try {
    await pool.query("SELECT 1");
    return "ok";
  } catch {
    return "erro";
  }
}
