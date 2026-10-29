import type { FastifyInstance } from "fastify";
import { chamarAsa } from "../asa.js";
import * as N from "../normalizar.js";
import { credencialDaRequisicao, tenantComCredencial } from "../tenant-auth.js";
import { falha, idValido, naoEncontrado } from "./consulta.js";

// Agendar por exame (procedimento): achar o procedimento, os convênios que o cobrem e os prestadores que o
// fazem. Tudo LEITURA. Daí em diante o painel segue o fluxo normal (dias → horários → agendamento).

// A lista completa muda pouco: guarda por clínica alguns minutos para o painel abrir rápido.
const CACHE_MS = 10 * 60 * 1000;
const POR_PAGINA = 100; // a Asa pagina de 100 em 100
const MAX_PAGINAS = 10;
const cache = new Map<string, { em: number; exames: N.Exame[] }>();

export async function examesRoutes(app: FastifyInstance) {
  // Procedimentos com agenda online. Sem `busca`, a lista inteira (até 1.000), para o painel mostrar como
  // lista de seleção; com `busca`, filtrada pelo nome na Asa.
  app.get<{ Querystring: { busca?: string } }>("/v1/exames", async (req, reply) => {
    const busca = String(req.query.busca ?? "").trim().slice(0, 60);
    const ctx = await tenantComCredencial(req, reply);
    if (!ctx) return;
    const chave = ctx.tenant.id + "|" + busca.toLowerCase();
    const guardado = cache.get(chave);
    if (guardado && Date.now() - guardado.em < CACHE_MS) return { exames: guardado.exames, completa: true };

    const exames: N.Exame[] = [];
    let completa = false;
    for (let page = 1; page <= MAX_PAGINAS; page++) {
      const r = await chamarAsa<any>(ctx.credencial, "api-agendamento-procedimentos", { page, ...(busca ? { descricao: busca } : {}) });
      if (naoEncontrado(r)) { completa = true; break; }
      if (!r.ok) {
        if (page === 1) return falha(reply, r);
        req.log.warn({ erro: r.erro, page }, "exames: página da Asa falhou; lista parcial");
        break;
      }
      const pagina = N.exames(r.dados);
      exames.push(...pagina.filter((e) => !exames.some((x) => x.id === e.id)));
      if (N.lista(r.dados?.procedimentos ?? r.dados).length < POR_PAGINA) { completa = true; break; }
    }
    exames.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    if (completa) cache.set(chave, { em: Date.now(), exames });
    return { exames, completa };
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
