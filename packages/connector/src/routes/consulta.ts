import type { FastifyInstance, FastifyReply } from "fastify";
import { chamarAsa, type RespostaAsa } from "../asa.js";
import * as N from "../normalizar.js";
import { pool } from "../db.js";
import { hojeEm } from "../confirmacao.js";
import { credencialDaRequisicao, tenantComCredencial } from "../tenant-auth.js";

// Rotas de LEITURA da Asa para o painel. Nada aqui grava na Asa.

export const dataValida = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const idValido = (s: unknown): s is string => typeof s === "string" && /^\d{1,10}$/.test(s);

export function falha(reply: FastifyReply, r: Extract<RespostaAsa<unknown>, { ok: false }>) {
  const status = r.erro === "ASA_CREDENCIAL_INVALIDA" ? 422 : 502;
  // A mensagem da Asa é texto de erro de negócio, sem dados do paciente: ajuda o atendente.
  return reply.code(status).send({ erro: r.erro, msg: r.erro === "ASA_RECUSOU" ? r.msg : undefined });
}

// "Não achei" chega como recusa (403/status "error") com mensagem de não encontrado, ou 404.
export function naoEncontrado(r: RespostaAsa<any>): boolean {
  if (r.ok) return false;
  if (r.erro === "ASA_ROTA_INEXISTENTE") return true;
  return r.erro === "ASA_RECUSOU" && /encontrad|localizad|n[ãa]o possui|nenhum/i.test(r.msg ?? "");
}

const AGENDA_CACHE_MS = 5 * 60 * 1000;
const cacheAgenda = new Map<string, { em: number; corpo: unknown }>();

// Estado da confirmação (véspera ou botão do atendente) de cada consulta, para o selo. "fila" = pedido
// manual que ainda não saiu.
async function confirmacoesDe(tenantId: string, ids: string[]) {
  const mapa = new Map<string, { estado: string; resposta: string | null }>();
  if (!ids.length) return mapa;
  const { rows } = await pool!.query<{ agendamento_id: string; estado: string; resposta: string | null; origem: string }>(
    "SELECT agendamento_id, estado, resposta, origem FROM confirmacoes WHERE tenant_id = $1 AND agendamento_id = ANY($2::text[])",
    [tenantId, ids],
  );
  for (const r of rows) {
    if (r.estado === "enviado" || r.estado === "respondido") mapa.set(r.agendamento_id, { estado: r.estado, resposta: r.resposta });
    else if (r.origem === "manual" && (r.estado === "pendente" || r.estado === "reservado")) mapa.set(r.agendamento_id, { estado: "fila", resposta: null });
    else if (r.origem === "manual" && r.estado === "falhou") mapa.set(r.agendamento_id, { estado: "falhou", resposta: null });
  }
  return mapa;
}

export async function consultaRoutes(app: FastifyInstance) {
  // Paciente da conversa (por telefone ou CPF) e os próximos agendamentos dele.
  app.get<{ Querystring: { telefone?: string; cpf?: string } }>("/v1/paciente", async (req, reply) => {
    const cpf = String(req.query.cpf ?? "").replace(/\D/g, "");
    const telefone = req.query.telefone ? N.telefoneAsa(String(req.query.telefone)) : null;
    if (cpf && cpf.length !== 11) return reply.code(400).send({ erro: "CPF_INVALIDO" });
    if (!cpf && !telefone) return reply.code(400).send({ erro: "TELEFONE_INVALIDO" });

    const ctx = await tenantComCredencial(req, reply);
    if (!ctx) return;
    const { tenant, credencial } = ctx;

    const busca: Record<string, string> = cpf ? { cpf } : { telefone: telefone! };
    const [rp, rc] = await Promise.all([
      chamarAsa<any>(credencial, "api-agendamento-paciente-instituicao", busca),
      chamarAsa<any>(credencial, "api-agendamentos-futuros", busca),
    ]);

    if (naoEncontrado(rp)) return { encontrado: false, busca: cpf ? "cpf" : "telefone" };
    if (!rp.ok) return falha(reply, rp);

    const paciente = N.paciente(rp.dados);
    if (!paciente) {
      req.log.warn({ chaves: Object.keys(rp.dados ?? {}) }, "resposta de paciente sem nome");
      return { encontrado: false, busca: cpf ? "cpf" : "telefone" };
    }
    // O CPF não vem em paciente-instituicao, mas vem em agendamentos-futuros.
    if (!paciente.cpf && rc.ok) paciente.cpf = N.paciente(rc.dados)?.cpf ?? null;

    // null = a Asa não respondeu a lista agora; [] = paciente sem consultas marcadas.
    let consultas: N.Consulta[] | null = null;
    if (naoEncontrado(rc)) consultas = [];
    else if (rc.ok) consultas = N.consultasFuturas(rc.dados);
    else req.log.warn({ erro: rc.erro, status: rc.status }, "agendamentos futuros indisponíveis");

    // Estado da confirmação de véspera, para o selo no cartão da consulta.
    if (consultas?.length) {
      const porId = await confirmacoesDe(tenant.id, consultas.map((c) => c.id));
      consultas = consultas.map((c) => (porId.has(c.id) ? { ...c, confirmacao: porId.get(c.id) } : c));
    }

    return { encontrado: true, paciente, consultas };
  });

  // Especialidades e prestadores com agenda online.
  // Muda pouco e é pedida a cada abertura do painel e da Agenda: fica 5 min por clínica.
  app.get("/v1/agenda", async (req, reply) => {
    const ctx = await tenantComCredencial(req, reply);
    if (!ctx) return;
    const guardado = cacheAgenda.get(ctx.tenant.id);
    if (guardado && Date.now() - guardado.em < AGENDA_CACHE_MS) return guardado.corpo;
    const r = await chamarAsa<any>(ctx.credencial, "api-agendamento");
    if (!r.ok) return falha(reply, r);
    const corpo = {
      especialidades: N.lista(r.dados.especialidades).map((e: any) => ({ id: String(e.id), nome: String(e.descricao ?? "") })),
      prestadores: N.lista(r.dados.prestadores).map((p: any) => ({
        id: String(p.id),
        nome: String(p.nome ?? ""),
        especialidade_id: p.especialidade_id == null ? null : String(p.especialidade_id),
        especialidade: p.especialidade ?? null,
        ordem_chegada: !!Number(p.ordem_chegada),
      })),
    };
    cacheAgenda.set(ctx.tenant.id, { em: Date.now(), corpo });
    return corpo;
  });

  // Dias com atendimento do prestador (até 60 dias à frente).
  app.get<{ Querystring: { prestador_id?: string } }>("/v1/agenda/dias", async (req, reply) => {
    if (!idValido(req.query.prestador_id)) return reply.code(400).send({ erro: "PRESTADOR_INVALIDO" });
    const credencial = await credencialDaRequisicao(req, reply);
    if (!credencial) return;
    const r = await chamarAsa<any>(credencial, "api-agendamento-dias-atendimento", { prestador_id: req.query.prestador_id });
    if (naoEncontrado(r)) return { dias: [] };
    if (!r.ok) return falha(reply, r);
    return { dias: N.dias(r.dados) };
  });

  // Dia de um prestador para a agenda em tela cheia: consultas marcadas e horários livres.
  // A Asa recusa horários livres de dia passado, então eles só são pedidos de hoje em diante.
  app.get<{ Querystring: { prestador_id?: string; data?: string } }>("/v1/agenda/dia", async (req, reply) => {
    const { prestador_id, data } = req.query;
    if (!idValido(prestador_id)) return reply.code(400).send({ erro: "PRESTADOR_INVALIDO" });
    if (!data || !dataValida(data)) return reply.code(400).send({ erro: "DATA_INVALIDA" });
    const ctx = await tenantComCredencial(req, reply);
    if (!ctx) return;
    const { credencial } = ctx;
    const futuro = data >= hojeEm(new Date());
    const [ra, rl] = await Promise.all([
      chamarAsa<any>(credencial, "api-agendamento-horarios-agendados", { prestador_id, data }),
      futuro ? chamarAsa<any>(credencial, "api-agendamento-horarios-atendimento", { prestador_id, data: `${data} 00:00:00` }) : null,
    ]);
    if (!ra.ok && !naoEncontrado(ra)) return falha(reply, ra);
    const agendados = ra.ok ? N.agendados(ra.dados) : [];
    if (ra.ok && !agendados.length && ra.dados && typeof ra.dados === "object") {
      const primeiro = N.lista(ra.dados.agendamentos ?? ra.dados)[0];
      req.log.info({ chaves: Object.keys(ra.dados), item: primeiro && typeof primeiro === "object" ? Object.keys(primeiro) : typeof primeiro }, "agenda do dia sem consultas reconhecidas");
    }
    // Horários livres indisponíveis não derrubam a agenda: as consultas marcadas ainda servem.
    const livres = rl && rl.ok ? N.horarios(rl.dados) : [];
    const conf = await confirmacoesDe(ctx.tenant.id, agendados.map((x) => x.id));
    return {
      data,
      agendados: agendados.map((x) => (conf.has(x.id) ? { ...x, confirmacao: conf.get(x.id) } : x)),
      livres,
      livres_ok: !rl || rl.ok || naoEncontrado(rl),
    };
  });

  // Horários livres do prestador num dia.
  app.get<{ Querystring: { prestador_id?: string; data?: string } }>("/v1/agenda/horarios", async (req, reply) => {
    const { prestador_id, data } = req.query;
    if (!idValido(prestador_id)) return reply.code(400).send({ erro: "PRESTADOR_INVALIDO" });
    if (!data || !dataValida(data)) return reply.code(400).send({ erro: "DATA_INVALIDA" });
    const credencial = await credencialDaRequisicao(req, reply);
    if (!credencial) return;
    const r = await chamarAsa<any>(credencial, "api-agendamento-horarios-atendimento", { prestador_id, data: `${data} 00:00:00` });
    if (naoEncontrado(r)) return { horarios: [] };
    if (!r.ok) return falha(reply, r);
    return { horarios: N.horarios(r.dados) };
  });
}
