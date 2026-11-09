import type { FastifyInstance } from "fastify";
import type { Exame, GrupoExame } from "../erp/modelo.js";
import { erpDaRequisicao, tenantComErp } from "../tenant-auth.js";
import { falha, idValido, naoEncontrado } from "./consulta.js";

// Agendar por exame (procedimento): achar o procedimento, os convênios que o cobrem e os prestadores que o
// fazem. Tudo LEITURA. Daí em diante o painel segue o fluxo normal (dias → horários → agendamento).

// A lista completa muda pouco e é grande (a clínica de teste passa de 1.000 itens): guarda por clínica
// por uma hora e busca as páginas do ERP em lotes paralelos.
const CACHE_MS = 60 * 60 * 1000;
const MAX_PAGINAS = 60;
const LOTE = 6;
const cache = new Map<string, { em: number; exames: Exame[] }>();
// Só a lista inteira de cada clínica é guardada (busca digitada não entra); o teto protege a memória do
// Conector (512 MB, todas as clínicas).
const MAX_CACHE = 50;
function guardar(chave: string, exames: Exame[]) {
  cache.delete(chave);
  cache.set(chave, { em: Date.now(), exames });
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
}

// Grupos e procedimentos por grupo: pequenos, mesma hora de validade e o mesmo teto de entradas.
const grupos = new Map<string, { em: number; dados: Array<GrupoExame | Exame> }>();
function guardarGrupo(chave: string, dados: Array<GrupoExame | Exame>) {
  grupos.delete(chave);
  grupos.set(chave, { em: Date.now(), dados });
  while (grupos.size > MAX_CACHE * 4) grupos.delete(grupos.keys().next().value!);
}

export async function examesRoutes(app: FastifyInstance) {
  // Procedimentos com agenda online, a lista inteira (até 6.000), em ordem alfabética: o painel mostra numa
  // lista de seleção com filtro local. Com `busca`, filtrada pelo nome no próprio ERP, sem cache.
  app.get<{ Querystring: { busca?: string } }>("/v1/exames", async (req, reply) => {
    const busca = String(req.query.busca ?? "").trim().slice(0, 60);
    const ctx = await tenantComErp(req, reply);
    if (!ctx) return;
    const chave = ctx.tenant.id;
    const guardado = busca ? undefined : cache.get(chave);
    if (guardado && Date.now() - guardado.em < CACHE_MS) return { exames: guardado.exames, completa: true };

    const porId = new Map<string, Exame>();
    let completa = false;
    paginas: for (let inicio = 1; inicio <= MAX_PAGINAS; inicio += LOTE) {
      const nums = Array.from({ length: Math.min(LOTE, MAX_PAGINAS - inicio + 1) }, (_, i) => inicio + i);
      const rs = await Promise.all(nums.map((page) => ctx.erp.examesPagina(page, busca || undefined)));
      for (const [i, r] of rs.entries()) {
        if (naoEncontrado(r)) { completa = true; break paginas; }
        if (!r.ok) {
          if (nums[i] === 1) return falha(reply, r);
          req.log.warn({ erro: r.erro, page: nums[i] }, "exames: página do ERP falhou; lista parcial");
          break paginas;
        }
        for (const e of r.dados.exames) porId.set(e.id, e);
        if (r.dados.ultima) { completa = true; break paginas; }
      }
    }
    const exames = [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    if (completa && !busca) guardar(chave, exames);
    req.log.info({ tenant: ctx.tenant.id, itens: exames.length, completa }, "exames: lista carregada do ERP");
    return { exames, completa };
  });

  // Grupos de procedimentos (Clínico, Cardiologia…), para o painel navegar a lista por grupo. Se o ERP não
  // tiver grupos, volta lista vazia e o painel esconde o filtro.
  app.get("/v1/exames/grupos", async (req, reply) => {
    const ctx = await tenantComErp(req, reply);
    if (!ctx) return;
    const chave = ctx.tenant.id + "|grupos";
    const guardado = grupos.get(chave);
    if (guardado && Date.now() - guardado.em < CACHE_MS) return { grupos: guardado.dados };
    const r = await ctx.erp.gruposExames();
    if (naoEncontrado(r)) return { grupos: [] };
    if (!r.ok) return falha(reply, r);
    guardarGrupo(chave, r.dados);
    return { grupos: r.dados };
  });

  // Procedimentos de um grupo, no mesmo formato de /v1/exames.
  app.get<{ Params: { id: string } }>("/v1/exames/grupos/:id", async (req, reply) => {
    if (!idValido(req.params.id)) return reply.code(400).send({ erro: "GRUPO_INVALIDO" });
    const ctx = await tenantComErp(req, reply);
    if (!ctx) return;
    const chave = ctx.tenant.id + "|grupo|" + req.params.id;
    const guardado = grupos.get(chave);
    if (guardado && Date.now() - guardado.em < CACHE_MS) return { exames: guardado.dados };
    const r = await ctx.erp.examesDoGrupo(req.params.id);
    if (naoEncontrado(r)) return { exames: [] };
    if (!r.ok) return falha(reply, r);
    const dados = r.dados.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    guardarGrupo(chave, dados);
    return { exames: dados };
  });

  // Convênios que cobrem o procedimento, com o valor.
  app.get<{ Params: { id: string } }>("/v1/exames/:id/convenios", async (req, reply) => {
    if (!idValido(req.params.id)) return reply.code(400).send({ erro: "EXAME_INVALIDO" });
    const erp = await erpDaRequisicao(req, reply);
    if (!erp) return;
    const r = await erp.conveniosDoExame(req.params.id);
    if (naoEncontrado(r)) return { convenios: [] };
    if (!r.ok) return falha(reply, r);
    return { convenios: r.dados };
  });

  // Prestadores que fazem o procedimento (pelo convênio, se vier), com o valor naquele convênio.
  app.get<{ Params: { id: string }; Querystring: { convenio_id?: string } }>("/v1/exames/:id/prestadores", async (req, reply) => {
    const conv = req.query.convenio_id;
    if (!idValido(req.params.id) || (conv && !idValido(conv))) return reply.code(400).send({ erro: "EXAME_INVALIDO" });
    const erp = await erpDaRequisicao(req, reply);
    if (!erp) return;
    const r = await erp.prestadoresDoExame(req.params.id, conv || undefined);
    if (naoEncontrado(r)) return { prestadores: [] };
    if (!r.ok) return falha(reply, r);
    return { prestadores: r.dados };
  });
}
