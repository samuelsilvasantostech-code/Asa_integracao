import type { FastifyInstance, FastifyReply } from "fastify";
import { pool } from "../db.js";
import { hojeEm } from "../confirmacao.js";
import type { FalhaErp, Resultado } from "../erp/index.js";
import { telefoneNacional, type Consulta } from "../erp/modelo.js";
import { Limite } from "../limite.js";
import { erpDaRequisicao, tenantComErp } from "../tenant-auth.js";

// Rotas de LEITURA do ERP da clínica para o painel. Nada aqui grava no ERP.

export const dataValida = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
// Id de registro do ERP: a Asa usa números; a especificação Kentro, texto. Letras, dígitos e - _ . : até 64.
export const idValido = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(s);

export function falha(reply: FastifyReply, r: FalhaErp) {
  const status = r.credencialInvalida ? 422 : 502;
  // A mensagem do ERP numa recusa é texto de erro de negócio, sem dados do paciente: ajuda o atendente.
  return reply.code(status).send({ erro: r.erro, msg: r.recusa ? r.msg : undefined });
}

// O ERP respondeu "não achei" (cada adaptador sabe reconhecer o dele).
export function naoEncontrado(r: Resultado<unknown> | null): boolean {
  return !!r && !r.ok && r.naoEncontrado;
}

// Busca de paciente por clínica: o painel busca ao abrir cada conversa, então 300 por minuto cobre uma
// equipe grande no pico; mais que isso é varredura de CPF/telefone com uma chave vazada.
const buscasPorClinica = new Limite(300, 60 * 1000);

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
    const telefone = req.query.telefone ? telefoneNacional(String(req.query.telefone)) : null;
    if (cpf && cpf.length !== 11) return reply.code(400).send({ erro: "CPF_INVALIDO" });
    if (!cpf && !telefone) return reply.code(400).send({ erro: "TELEFONE_INVALIDO" });

    const ctx = await tenantComErp(req, reply);
    if (!ctx) return;
    const { tenant, erp } = ctx;
    if (!buscasPorClinica.registrar(tenant.id)) {
      req.log.warn({ tenant: tenant.id }, "busca de paciente: limite por minuto atingido");
      return reply.code(429).send({ erro: "MUITAS_BUSCAS" });
    }

    const busca = cpf ? { cpf } : { telefone: telefone! };
    const [rp, rc] = await Promise.all([erp.buscarPaciente(busca), erp.consultasFuturas(busca)]);

    if (naoEncontrado(rp)) return { encontrado: false, busca: cpf ? "cpf" : "telefone" };
    if (!rp.ok) return falha(reply, rp);

    const paciente = rp.dados;
    if (!paciente) return { encontrado: false, busca: cpf ? "cpf" : "telefone" };
    // Alguns ERPs (a Asa) só trazem o CPF na lista de consultas.
    if (!paciente.cpf && rc.ok) paciente.cpf = rc.dados.cpf;

    // null = o ERP não respondeu a lista agora; [] = paciente sem consultas marcadas.
    let consultas: Consulta[] | null = null;
    if (naoEncontrado(rc)) consultas = [];
    else if (rc.ok) consultas = rc.dados.consultas;
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
    const ctx = await tenantComErp(req, reply);
    if (!ctx) return;
    const guardado = cacheAgenda.get(ctx.tenant.id);
    if (guardado && Date.now() - guardado.em < AGENDA_CACHE_MS) return guardado.corpo;
    const r = await ctx.erp.especialidadesEPrestadores();
    if (!r.ok) return falha(reply, r);
    cacheAgenda.set(ctx.tenant.id, { em: Date.now(), corpo: r.dados });
    return r.dados;
  });

  // Dias com atendimento do prestador (até 60 dias à frente).
  app.get<{ Querystring: { prestador_id?: string } }>("/v1/agenda/dias", async (req, reply) => {
    if (!idValido(req.query.prestador_id)) return reply.code(400).send({ erro: "PRESTADOR_INVALIDO" });
    const erp = await erpDaRequisicao(req, reply);
    if (!erp) return;
    const r = await erp.diasDisponiveis(req.query.prestador_id);
    if (naoEncontrado(r)) return { dias: [] };
    if (!r.ok) return falha(reply, r);
    return { dias: r.dados };
  });

  // Dia de um prestador para a agenda em tela cheia: consultas marcadas e horários livres.
  // Horários livres de dia passado não são pedidos (a Asa recusa): só de hoje em diante.
  app.get<{ Querystring: { prestador_id?: string; data?: string } }>("/v1/agenda/dia", async (req, reply) => {
    const { prestador_id, data } = req.query;
    if (!idValido(prestador_id)) return reply.code(400).send({ erro: "PRESTADOR_INVALIDO" });
    if (!data || !dataValida(data)) return reply.code(400).send({ erro: "DATA_INVALIDA" });
    const ctx = await tenantComErp(req, reply);
    if (!ctx) return;
    const { erp } = ctx;
    const futuro = data >= hojeEm(new Date());
    const [ra, rl] = await Promise.all([erp.agendaDoDia(prestador_id, data), futuro ? erp.horariosLivres(prestador_id, data) : null]);
    if (!ra.ok && !naoEncontrado(ra)) return falha(reply, ra);
    const agendados = ra.ok ? ra.dados : [];
    // Horários livres indisponíveis não derrubam a agenda: as consultas marcadas ainda servem.
    const livres = rl && rl.ok ? rl.dados : [];
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
    const erp = await erpDaRequisicao(req, reply);
    if (!erp) return;
    const r = await erp.horariosLivres(prestador_id, data);
    if (naoEncontrado(r)) return { horarios: [] };
    if (!r.ok) return falha(reply, r);
    return { horarios: r.dados };
  });
}
