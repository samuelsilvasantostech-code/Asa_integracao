import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { dbStatus } from "../db.js";

export async function healthRoutes(app: FastifyInstance) {
  // Sempre 200 enquanto o processo estiver de pé; o estado do banco vai no corpo.
  app.get("/health", async () => ({
    status: "ok",
    versao: config.version,
    banco: await dbStatus(),
  }));
}
