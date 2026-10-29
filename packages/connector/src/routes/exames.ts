import type { FastifyInstance } from "fastify";
import { chamarAsa } from "../asa.js";
import * as N from "../normalizar.js";
import { credencialDaRequisicao } from "../tenant-auth.js";
import { falha, idValido, naoEncontrado } from "./consulta.js";

// Agendar por exame (procedimento): achar o procedimento, os convênios que o cobrem e os prestadores que o
// fazem. Tudo LEITURA. Daí em diante o painel segue o fluxo normal (dias → horários → agendamento).

export async function examesRoutes(app: FastifyInstance) {
  // Procedimentos com agenda online, filtrados pelo nome e, se vier, pelo convênio.
  app.get<{ Querystring: { busca?: string; convenio_id?: string } }>("/v1/exames", async (req, reply) => {
    const busca = String(req.query.busca ?? "").trim().slice(0, 60);
    const conv = req.query.convenio_id;
    if (busca.length < 2) return reply.code(400).send({ erro: "BUSCA_CURTA" });
    if (conv && !idValido(conv)) return reply.code(400).send({ erro: "CONVENIO_INVALIDO" });
    const credencial = await credencialDaRequisicao(req, reply);
    if (!credencial) return;
    const r = await chamarAsa<any>(credencial, "api-agendamento-procedimentos", { descricao: busca, page: 1, ...(conv ? { convenio_id: conv } : {}) });
    if (naoEncontrado(r)) return { exames: [] };
    if (!r.ok) return falha(reply, r);
    return { exames: N.exames(r.dados) };
  });

  // Convênios que cobrem o procedimento, com o valor.
  app.get<{ Params: { id: string } }>("/v1/exames/:id/convenios", async (req, reply) => {
    if (!idValido(req.params.id)) return reply.code(400).send({ erro: "EXAME_INVALIDO" });
    const credencial = await credencialDaRequisicao(req, reply);
    if (!credencial) return;
    const r = await chamarAsa<any>(credencial, "api-agendamento-get-convenios-procedimento", { procedimento_id: req.params.id });
    if (naoEncontrado(r)) return { convenios: [] };
    if (!r.ok) return falha(reply, r);
    return { convenios: N.conveniosDoExame(r.dados) };
  });

  // Prestadores que fazem o procedimento (pelo convênio, se vier), com o valor naquele convênio.
  app.get<{ Params: { id: string }; Querystring: { convenio_id?: string } }>("/v1/exames/:id/prestadores", async (req, reply) => {
    const conv = req.query.convenio_id;
    if (!idValido(req.params.id) || (conv && !idValido(conv))) return reply.code(400).send({ erro: "EXAME_INVALIDO" });
    const credencial = await credencialDaRequisicao(req, reply);
    if (!credencial) return;
    const r = await chamarAsa<any>(credencial, "api-agendamento-get-prestadores-procedimento", {
      procedimento_id: req.params.id,
      ...(conv ? { convenio_id: conv } : {}),
    });
    if (naoEncontrado(r)) return { prestadores: [] };
    if (!r.ok) return falha(reply, r);
    return { prestadores: N.prestadoresDoExame(r.dados, conv) };
  });
}
