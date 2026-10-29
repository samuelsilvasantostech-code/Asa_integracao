import type { FastifyInstance } from "fastify";
import { chamarAsa } from "../asa.js";
import * as N from "../normalizar.js";
import { credencialDaRequisicao, tenantComCredencial } from "../tenant-auth.js";
import { falha, idValido, naoEncontrado } from "./consulta.js";

// Agendar por exame (procedimento): achar o procedimento, os convênios que o cobrem e os prestadores que o
// fazem. Tudo LEITURA. Daí em diante o painel segue o fluxo normal (dias → horários → agendamento).

// A lista completa muda pouco e é grande (a clínica de teste passa de 1.000 itens): guarda por clínica
// por uma hora e busca as páginas da Asa em lotes paralelos.
const CACHE_MS = 60 * 60 * 1000;
const POR_PAGINA = 100; // a Asa pagina de 100 em 100
const MAX_PAGINAS = 60;
const LOTE = 6;
const cache = new Map<string, { em: number; exames: N.Exame[] }>();

export async function examesRoutes(app: FastifyInstance) {
  // Procedimentos com agenda online, a lista inteira (até 6.000), em ordem alfabética: o painel mostra numa
  // lista de seleção com filtro local. Com `busca`, filtrada pelo nome na própria Asa.
  app.get<{ Querystring: { busca?: string } }>("/v1/exames", async (req, reply) => {
    const busca = String(req.query.busca ?? "").trim().slice(0, 60);
    const ctx = await tenantComCredencial(req, reply);
    if (!ctx) return;
    const chave = ctx.tenant.id + "|" + busca.toLowerCase();
    const guardado = cache.get(chave);
    if (guardado && Date.now() - guardado.em < CACHE_MS) return { exames: guardado.exames, completa: true };

    const porId = new Map<string, N.Exame>();
    let completa = false;
    paginas: for (let inicio = 1; inicio <= MAX_PAGINAS; inicio += LOTE) {
      const nums = Array.from({ length: Math.min(LOTE, MAX_PAGINAS - inicio + 1) }, (_, i) => inicio + i);
      const rs = await Promise.all(
        nums.map((page) => chamarAsa<any>(ctx.credencial, "api-agendamento-procedimentos", { page, ...(busca ? { descricao: busca } : {}) })),
      );
      for (const [i, r] of rs.entries()) {
        if (naoEncontrado(r)) { completa = true; break paginas; }
        if (!r.ok) {
          if (nums[i] === 1) return falha(reply, r);
          req.log.warn({ erro: r.erro, page: nums[i] }, "exames: página da Asa falhou; lista parcial");
          break paginas;
        }
        for (const e of N.exames(r.dados)) porId.set(e.id, e);
        if (N.lista(r.dados?.procedimentos ?? r.dados).length < POR_PAGINA) { completa = true; break paginas; }
      }
    }
    const exames = [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    if (completa) cache.set(chave, { em: Date.now(), exames });
    req.log.info({ tenant: ctx.tenant.id, itens: exames.length, completa }, "exames: lista carregada da Asa");
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
