import type { FastifyInstance, FastifyReply } from "fastify";
import { pool } from "../db.js";
import { hojeEm } from "../confirmacao.js";
import type { FalhaErp, Resultado } from "../erp/index.js";
import { telefoneNacional, type Agendado, type Consulta, type Horario } from "../erp/modelo.js";
import { Limite } from "../limite.js";
import { Cache, chaveDaClinica, guardavel } from "../cache.js";
import { marcarErroErp } from "../contagem.js";
import { atendimentosDe } from "./atendimento.js";
import { lembrarAgendados } from "../atendimento.js";
import { tenantComErp } from "../tenant-auth.js";
import type { ErpAdapter } from "../erp/index.js";
import type { FastifyRequest } from "fastify";

// Rotas de LEITURA do ERP da clínica para o painel. Nada aqui grava no ERP.

export const dataValida = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
// Id de registro do ERP: a Asa usa números; a especificação Kentro, texto. Letras, dígitos e - _ . : até 64.
export const idValido = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(s);

export function falha(reply: FastifyReply, r: FalhaErp) {
  const status = r.credencialInvalida ? 422 : 502;
  // Falha do sistema (fora do ar, credencial, resposta estranha) entra na contagem de uso; recusa de negócio não.
  if (!r.recusa) marcarErroErp(reply.request, r.erro);
  // A mensagem do ERP numa recusa é texto de erro de negócio, sem dados do paciente: ajuda o atendente.
  return reply.code(status).send({ erro: r.erro, msg: r.recusa ? r.msg : undefined });
}

// O ERP respondeu "não achei" (cada adaptador sabe reconhecer o dele).
export function naoEncontrado(r: Resultado<unknown> | null): boolean {
  return !!r && !r.ok && r.naoEncontrado;
}

// Hora atual (HH:MM) no fuso da clínica.
export function horaEm(agora: Date, fuso = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(agora);
}

// Consulta que ainda ocupa o horário: cancelada e desistência liberam (o mesmo critério da marcação).
export const ocupaHorario = (a: Agendado) => !!a.hora && !/cancel|desist/.test(a.status ?? "");

// Horários livres que dá para oferecer de verdade. O ERP (a Asa, por exemplo) pode devolver como livre:
// - horário de hoje que já passou;
// - horário que já tem consulta ativa (agenda com vários agenda_id, ou leitura fora de sincronia);
// - o mesmo horário repetido (um por agenda_id).
// Em agenda de ordem de chegada vários pacientes dividem o turno, que segue aberto depois de começar:
// ali só sai o repetido. Sem saber o tipo da agenda, sai o passado e o repetido.
// Só a leitura passa por aqui; a marcação continua conferindo no ERP antes de gravar.
export function filtrarLivres(
  livres: Horario[],
  agendados: Agendado[] | null,
  data: string,
  agora: Date,
  opcoes: { passados?: boolean; ocupados?: boolean } = {},
): Horario[] {
  const limite = opcoes.passados !== false && data === hojeEm(agora) ? horaEm(agora) : null;
  const ocupadas = new Set(opcoes.ocupados !== false && agendados ? agendados.filter(ocupaHorario).map((a) => a.hora!) : []);
  const vistos = new Set<string>();
  return livres.filter((h) => {
    if (vistos.has(h.horario)) return false;
    vistos.add(h.horario);
    if (limite && h.horario <= limite) return false;
    return !ocupadas.has(h.horario);
  });
}

// Itens do pedido em lote: "prestador:data" separados por vírgula, sem repetir, até MAX_COLUNAS.
export const MAX_COLUNAS = 8;
export function lerColunas(bruto: unknown): { prestador_id: string; data: string }[] | null {
  if (typeof bruto !== "string" || !bruto) return null;
  const vistos = new Set<string>();
  const itens: { prestador_id: string; data: string }[] = [];
  for (const parte of bruto.split(",")) {
    const i = parte.lastIndexOf(":");
    const prestador_id = parte.slice(0, i), data = parte.slice(i + 1);
    if (i < 1 || !idValido(prestador_id) || !dataValida(data)) return null;
    if (vistos.has(parte)) continue;
    vistos.add(parte);
    itens.push({ prestador_id, data });
  }
  return itens.length && itens.length <= MAX_COLUNAS ? itens : null;
}

// Busca de paciente por clínica: o painel busca ao abrir cada conversa, então 300 por minuto cobre uma
// equipe grande no pico; mais que isso é varredura de CPF/telefone com uma chave vazada.
const buscasPorClinica = new Limite(300, 60 * 1000);

// Especialidades e profissionais: 5 min. Dias com atendimento: 1 min (um dia pode lotar).
const cacheAgenda = new Cache<any>(5 * 60 * 1000, 500);
const cacheDias = new Cache<any>(60 * 1000);

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

type Ctx = { tenant: { id: string; erp: string; credencial: Buffer | null }; erp: ErpAdapter };

// Profissional de ordem de chegada? Vem da lista de profissionais (a mesma da rota /v1/agenda, em cache).
// Sem resposta, null: quem chama não esconde horário ocupado, só o passado e o repetido.
async function ordemDeChegada(ctx: Ctx, prestadorId: string): Promise<boolean | null> {
  const r = await cacheAgenda.obter(chaveDaClinica(ctx.tenant) + "agenda", () => ctx.erp.especialidadesEPrestadores(), (x) => x.ok)
    .catch(() => null) as Awaited<ReturnType<ErpAdapter["especialidadesEPrestadores"]>> | null;
  if (!r || !r.ok) return null;
  const p = r.dados.prestadores.find((x) => x.id === prestadorId);
  return p ? p.ordem_chegada : null;
}

// Falha do ERP como resposta (status + corpo), para a rota de um dia e para cada coluna do lote.
function respostaDeFalha(req: FastifyRequest, r: FalhaErp) {
  if (!r.recusa) marcarErroErp(req, r.erro);
  return { status: r.credencialInvalida ? 422 : 502, corpo: { erro: r.erro, msg: r.recusa ? r.msg : undefined } as Record<string, unknown> };
}

// Um dia de um prestador para a agenda: consultas marcadas e horários livres que dá para oferecer.
// Horários livres de dia passado não são pedidos (a Asa recusa): só de hoje em diante.
async function montarDia(req: FastifyRequest, ctx: Ctx, prestador_id: string, data: string): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const { erp } = ctx;
  const agora = new Date();
  const hoje = hojeEm(agora);
  const futuro = data >= hoje;
  const [ra, rl, oc] = await Promise.all([
    erp.agendaDoDia(prestador_id, data),
    futuro ? erp.horariosLivres(prestador_id, data) : null,
    futuro ? ordemDeChegada(ctx, prestador_id) : null,
  ]);
  if (!ra.ok && !naoEncontrado(ra)) return respostaDeFalha(req, ra);
  const agendados = ra.ok ? ra.dados : [];
  // Horários livres indisponíveis não derrubam a agenda: as consultas marcadas ainda servem.
  const livres = rl && rl.ok ? filtrarLivres(rl.dados, ra.ok ? agendados : null, data, agora, { passados: oc !== true, ocupados: oc === false }) : [];
  const ids = agendados.map((x) => x.id);
  if (ra.ok && data === hoje) lembrarAgendados(ctx.tenant.id, prestador_id, data, ids);
  // Tempo de espera (chegada, chamada, fim) só existe para hoje.
  const [conf, atend] = await Promise.all([confirmacoesDe(ctx.tenant.id, ids), data === hoje ? atendimentosDe(ctx.tenant.id, ids) : null]);
  return {
    status: 200,
    corpo: {
      data,
      // Hora do Conector: os cronômetros das telas contam a partir dela (o relógio do computador pode errar).
      agora: agora.toISOString(),
      agendados: agendados.map((x) => {
        const extra: Record<string, unknown> = {};
        if (conf.has(x.id)) extra.confirmacao = conf.get(x.id);
        if (atend?.has(x.id)) extra.atendimento = atend.get(x.id);
        return Object.keys(extra).length ? { ...x, ...extra } : x;
      }),
      livres,
      livres_ok: !rl || rl.ok || naoEncontrado(rl),
      // O profissional não atende neste dia: a tela diz isso em vez de "nenhuma consulta".
      ...(!ra.ok && ra.semExpediente && !agendados.length ? { sem_atendimento: true } : {}),
    },
  };
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
    const r = await cacheAgenda.obter(chaveDaClinica(ctx.tenant) + "agenda", () => ctx.erp.especialidadesEPrestadores(), (x) => x.ok) as Awaited<ReturnType<typeof ctx.erp.especialidadesEPrestadores>>;
    if (!r.ok) return falha(reply, r);
    return r.dados;
  });

  // Dias com atendimento do prestador (até 60 dias à frente).
  app.get<{ Querystring: { prestador_id?: string } }>("/v1/agenda/dias", async (req, reply) => {
    const prest = req.query.prestador_id;
    if (!idValido(prest)) return reply.code(400).send({ erro: "PRESTADOR_INVALIDO" });
    const ctx = await tenantComErp(req, reply);
    if (!ctx) return;
    const r = await cacheDias.obter(chaveDaClinica(ctx.tenant) + "dias|" + prest, () => ctx.erp.diasDisponiveis(prest), guardavel) as Awaited<ReturnType<typeof ctx.erp.diasDisponiveis>>;
    if (naoEncontrado(r)) return { dias: [] };
    if (!r.ok) return falha(reply, r);
    return { dias: r.dados };
  });

  // Dia de um prestador para a agenda em tela cheia: consultas marcadas e horários livres.
  app.get<{ Querystring: { prestador_id?: string; data?: string } }>("/v1/agenda/dia", async (req, reply) => {
    const { prestador_id, data } = req.query;
    if (!idValido(prestador_id)) return reply.code(400).send({ erro: "PRESTADOR_INVALIDO" });
    if (!data || !dataValida(data)) return reply.code(400).send({ erro: "DATA_INVALIDA" });
    const ctx = await tenantComErp(req, reply);
    if (!ctx) return;
    const r = await montarDia(req, ctx, prestador_id, data);
    return reply.code(r.status).send(r.corpo);
  });

  // Várias colunas (semana, lado a lado, ocupação do painel) numa requisição só: o proxy da Kentro conta
  // cada chamada da extensão (30 por minuto por instalação). Cada coluna responde sozinha, com o mesmo
  // corpo de /v1/agenda/dia ou {erro}; no máximo 2 colunas por vez no ERP.
  app.get<{ Querystring: { itens?: string } }>("/v1/agenda/colunas", async (req, reply) => {
    const itens = lerColunas(req.query.itens);
    if (!itens) return reply.code(400).send({ erro: "PARAMETROS_INVALIDOS", max: MAX_COLUNAS });
    const ctx = await tenantComErp(req, reply);
    if (!ctx) return;
    const colunas: Record<string, unknown>[] = new Array(itens.length);
    let i = 0;
    const trabalhador = async () => {
      while (i < itens.length) {
        const k = i++, it = itens[k];
        const r = await montarDia(req, ctx, it.prestador_id, it.data).catch(() => ({ status: 500, corpo: { erro: "ERRO_INTERNO" } as Record<string, unknown> }));
        colunas[k] = { prestador_id: it.prestador_id, ...r.corpo, data: it.data, status: r.status };
      }
    };
    await Promise.all([trabalhador(), trabalhador()]);
    return { agora: new Date().toISOString(), colunas };
  });

  // Horários livres do prestador num dia (marcação pelo painel). Passa pelo mesmo filtro da agenda.
  app.get<{ Querystring: { prestador_id?: string; data?: string } }>("/v1/agenda/horarios", async (req, reply) => {
    const { prestador_id, data } = req.query;
    if (!idValido(prestador_id)) return reply.code(400).send({ erro: "PRESTADOR_INVALIDO" });
    if (!data || !dataValida(data)) return reply.code(400).send({ erro: "DATA_INVALIDA" });
    const ctx = await tenantComErp(req, reply);
    if (!ctx) return;
    const [r, ra, oc] = await Promise.all([
      ctx.erp.horariosLivres(prestador_id, data),
      ctx.erp.agendaDoDia(prestador_id, data).catch(() => null),
      ordemDeChegada(ctx, prestador_id),
    ]);
    if (naoEncontrado(r)) return { horarios: [] };
    if (!r.ok) return falha(reply, r);
    return { horarios: filtrarLivres(r.dados, ra && ra.ok ? ra.dados : null, data, new Date(), { passados: oc !== true, ocupados: oc === false }) };
  });
}
