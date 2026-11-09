import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db.js";
import type { PedidoMarcacao, Vaga as VagaErp } from "../erp/adaptador.js";
import type { BuscaPaciente, ErpAdapter, FalhaErp } from "../erp/index.js";
import { consultaNoHorario, telefoneNacional, type Consulta } from "../erp/modelo.js";
import { erpDaRequisicao, tenantComErp } from "../tenant-auth.js";
import { dataValida, falha, idValido, naoEncontrado } from "./consulta.js";

// Marcar, remarcar, cancelar, confirmar e marcar falta. Convênios e procedimentos são leitura; as rotas
// POST deste arquivo são as ÚNICAS do Conector que gravam consultas no ERP.

const horaValida = (s: unknown): s is string => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
const chaveValida = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9-]{16,64}$/.test(s);

interface Vaga {
  prestador_id?: string;
  data?: string; // YYYY-MM-DD
  horario?: string; // HH:MM
  agenda_id?: string;
}

// Como o painel achou o paciente: serve para conferir que a consulta é dele.
export interface Busca {
  telefone?: string;
  cpf?: string;
}

function vagaValida<T extends Vaga>(q: T): q is T & Required<Vaga> {
  return idValido(q.prestador_id) && !!q.data && dataValida(q.data) && horaValida(q.horario) && idValido(q.agenda_id);
}

const vagaDe = (v: Required<Vaga>): VagaErp => ({ prestador_id: v.prestador_id, data: v.data, horario: v.horario, agenda_id: v.agenda_id });

// Busca do painel → busca do ERP. null se não houver CPF de 11 dígitos nem telefone válido.
export function buscaDe(b: Busca | undefined): BuscaPaciente | null {
  const cpf = String(b?.cpf ?? "").replace(/\D/g, "");
  if (cpf.length === 11) return { cpf };
  const telefone = b?.telefone ? telefoneNacional(String(b.telefone)) : null;
  return telefone ? { telefone } : null;
}

interface PedidoAgendamento extends Vaga {
  chave?: string; // idempotência: gerada pelo painel a cada confirmação
  convenio_id?: string;
  convenio_procedimento_id?: string;
  paciente_id?: string;
  paciente?: { nome?: string; cpf?: string; nascimento?: string; telefone?: string };
  busca?: Busca; // como o paciente cadastrado foi achado (CPF ou telefone): o Conector relê o cadastro no ERP
  obs?: string;
  usuario?: string; // quem pediu no Kentro, só para a trilha
  remarcar?: { agendamento_id?: string; busca?: Busca }; // presente = remarcar esta consulta
}

/* ---------- idempotência e trilha (tabela agendamentos) ---------- */

type Reserva = { novo: true } | { novo: false; situacao: string; resposta: any };

// A mesma chave nunca chama o ERP duas vezes.
async function reservar(
  tenantId: string,
  chave: string,
  c: { tipo: string; usuario?: string; prestador_id?: string; data?: string; horario?: string; paciente_id?: string; agendamento_id?: string },
): Promise<Reserva> {
  const ins = await pool!.query(
    `INSERT INTO agendamentos (tenant_id, chave, situacao, tipo, usuario, prestador_id, data, horario, paciente_id, agendamento_id)
     VALUES ($1, $2, 'pendente', $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
    [
      tenantId, chave, c.tipo, String(c.usuario ?? "").slice(0, 120) || null,
      c.prestador_id ?? null, c.data ?? null, c.horario ?? null, c.paciente_id ?? null, c.agendamento_id ?? null,
    ],
  );
  if (ins.rowCount) return { novo: true };
  const { rows } = await pool!.query<{ situacao: string; resposta: any }>(
    "SELECT situacao, resposta FROM agendamentos WHERE tenant_id = $1 AND chave = $2",
    [tenantId, chave],
  );
  return { novo: false, situacao: rows[0]?.situacao ?? "pendente", resposta: rows[0]?.resposta };
}

function repetido(reply: FastifyReply, r: Extract<Reserva, { novo: false }>) {
  if (r.situacao === "ok") return { ok: true, repetido: true, ...r.resposta };
  return reply.code(409).send({ erro: r.situacao === "incerto" ? "AGENDAMENTO_INCERTO" : "AGENDAMENTO_EM_ANDAMENTO" });
}

const liberar = (tenantId: string, chave: string) =>
  pool!.query("DELETE FROM agendamentos WHERE tenant_id = $1 AND chave = $2", [tenantId, chave]);

const concluir = (tenantId: string, chave: string, resposta: object, pacienteId: string | null = null) =>
  pool!.query(
    "UPDATE agendamentos SET situacao = 'ok', resposta = $3, paciente_id = COALESCE(paciente_id, $4), atualizado_em = now() WHERE tenant_id = $1 AND chave = $2",
    [tenantId, chave, resposta, pacienteId],
  );

// A gravação de consulta no ERP pode demorar: espera mais que as leituras.
// Abaixo do corte do proxy (a resposta precisa chegar à tela); o que passar disso a conferência resolve.
const TEMPO_GRAVAR_MS = 25000;

// Depois de uma gravação sem resposta (ou sem número), lê a agenda do prestador naquele dia. O horário
// estava livre segundos antes, então uma consulta ativa nele agora é a que acabamos de pedir.
// null = não deu para ler; achou=false = a leitura funcionou e não há consulta ali (ainda).
async function conferirNaAgenda(
  erp: ErpAdapter,
  b: PedidoAgendamento,
): Promise<{ achou: true; agendamento_id: string; paciente_id: string | null } | { achou: false } | null> {
  const r = await erp.agendaDoDia(b.prestador_id!, b.data!);
  if (!r.ok) return naoEncontrado(r) ? { achou: false } : null;
  const nossa = consultaNoHorario(r.dados, {
    horario: b.horario!, paciente_id: b.paciente_id, nome: b.paciente?.nome, original: b.remarcar?.agendamento_id,
  });
  return nossa ? { achou: true, agendamento_id: nossa.id, paciente_id: nossa.paciente.id ?? b.paciente_id ?? null } : { achou: false };
}

// Resultado incerto: confere na agenda antes de responder. Achou: é sucesso. Não achou: continua
// incerto (o ERP pode gravar depois de não responder) e o painel pode pedir para conferir de novo.
async function resolverIncerto(
  req: FastifyRequest,
  reply: FastifyReply,
  tenantId: string,
  chave: string,
  erp: ErpAdapter,
  b: PedidoAgendamento,
  detalhe?: string,
) {
  const c = await conferirNaAgenda(erp, b);
  if (c?.achou) {
    const feito = { agendamento_id: c.agendamento_id, paciente_id: c.paciente_id, setor: null, clinica: null, endereco: null, data: b.data, horario: b.horario, remarcado: !!b.remarcar, conferido: true };
    await concluir(tenantId, chave, feito, feito.paciente_id);
    req.log.info({ tenant: tenantId, agendamento: c.agendamento_id, detalhe, erp: erp.erp }, "agendamento incerto confirmado na agenda do ERP");
    return { ok: true, ...feito };
  }
  await pool!.query(
    "UPDATE agendamentos SET situacao = 'incerto', diagnostico = COALESCE($3, diagnostico), atualizado_em = now() WHERE tenant_id = $1 AND chave = $2",
    [tenantId, chave, detalhe ?? null],
  );
  req.log.error({ tenant: tenantId, chave, detalhe, leu_agenda: c !== null, erp: erp.erp }, "gravação sem confirmação do ERP");
  return reply.code(504).send({ erro: "AGENDAMENTO_INCERTO", detalhe, conferido: c !== null });
}

// Falha do ERP ao gravar. Sem resposta, o ERP pode ter gravado: a chave fica "incerto" e não é liberada.
async function falhaAoGravar(req: FastifyRequest, reply: FastifyReply, tenantId: string, chave: string, r: FalhaErp) {
  if (r.semResposta) {
    await pool!.query("UPDATE agendamentos SET situacao = 'incerto', atualizado_em = now() WHERE tenant_id = $1 AND chave = $2", [tenantId, chave]);
    req.log.error({ tenant: tenantId, chave, detalhe: r.msg }, "gravação sem resposta do ERP");
    return reply.code(504).send({ erro: "AGENDAMENTO_INCERTO", detalhe: r.msg });
  }
  await liberar(tenantId, chave);
  req.log.warn({ erro: r.erro, status: r.status, msg: r.msg }, "o ERP recusou a gravação");
  return falha(reply, r);
}

// Remarcar e cancelar só valem para uma consulta futura DO paciente da conversa. Um id solto não
// basta: evita mexer na consulta de outra pessoa por engano ou com um id adulterado.
export async function consultaDoPaciente(
  erp: ErpAdapter,
  busca: Busca | undefined,
  agendamentoId: string,
): Promise<{ ok: true; consulta: Consulta } | { ok: false; erro: string; status: number }> {
  const b = buscaDe(busca);
  if (!b) return { ok: false, erro: "PACIENTE_INVALIDO", status: 400 };
  const r = await erp.consultasFuturas(b);
  const consulta = r.ok ? r.dados.consultas.find((c) => c.id === agendamentoId) : undefined;
  if (consulta) return { ok: true, consulta };
  if (!r.ok && !naoEncontrado(r)) return { ok: false, erro: r.erro, status: 502 };
  return { ok: false, erro: "CONSULTA_NAO_ENCONTRADA", status: 409 };
}

// O ERP (a Asa) exige nome, nascimento e telefone na marcação mesmo com paciente_id ("preencha os campos
// indicados com *"). Os dados vêm do próprio cadastro no ERP, relido pela busca, e não da tela: assim a
// marcação não altera o cadastro do paciente.
async function dadosDoCadastro(
  erp: ErpAdapter,
  busca: Busca | undefined,
  pacienteId: string,
): Promise<
  | { ok: true; campos: { paciente_id: string; nome: string; nascimento: string; telefone: string; cpf?: string } }
  | { ok: false; erro: string; status: number; faltam?: string[]; r?: FalhaErp }
> {
  const b = buscaDe(busca);
  if (!b) return { ok: false, erro: "BUSCA_AUSENTE", status: 400 };
  const r = await erp.buscarPaciente(b);
  if (!r.ok && !naoEncontrado(r)) return { ok: false, erro: r.erro, status: 502, r };
  const p = r.ok ? r.dados : null;
  if (!p || p.id !== pacienteId) return { ok: false, erro: "PACIENTE_NAO_CONFERE", status: 409 };
  const telefone = p.telefone ? telefoneNacional(p.telefone) : null;
  const cpf = String(p.cpf ?? "").replace(/\D/g, "");
  const faltam = [!p.nascimento && "nascimento", !telefone && "telefone"].filter(Boolean) as string[];
  if (faltam.length) return { ok: false, erro: "PACIENTE_INCOMPLETO", status: 422, faltam };
  return { ok: true, campos: { paciente_id: pacienteId, nome: p.nome, nascimento: p.nascimento!, telefone: telefone!, ...(cpf.length === 11 ? { cpf } : {}) } };
}

export async function agendamentoRoutes(app: FastifyInstance) {
  app.get<{ Querystring: Vaga }>("/v1/agenda/convenios", async (req, reply) => {
    if (!vagaValida(req.query)) return reply.code(400).send({ erro: "VAGA_INVALIDA" });
    const erp = await erpDaRequisicao(req, reply);
    if (!erp) return;
    const r = await erp.conveniosDaVaga(vagaDe(req.query));
    if (naoEncontrado(r)) return { convenios: [] };
    if (!r.ok) return falha(reply, r);
    return { convenios: r.dados };
  });

  app.get<{ Querystring: Vaga & { convenio_id?: string } }>("/v1/agenda/procedimentos", async (req, reply) => {
    if (!vagaValida(req.query) || !idValido(req.query.convenio_id)) return reply.code(400).send({ erro: "VAGA_INVALIDA" });
    const erp = await erpDaRequisicao(req, reply);
    if (!erp) return;
    const r = await erp.procedimentosDaVaga(vagaDe(req.query), req.query.convenio_id);
    if (naoEncontrado(r)) return { procedimentos: [] };
    if (!r.ok) return falha(reply, r);
    return { procedimentos: r.dados };
  });

  // Marcar consulta; com `remarcar`, remarca a consulta indicada.
  app.post<{ Body: PedidoAgendamento }>("/v1/agendamentos", async (req, reply) => {
    const b = req.body ?? {};
    const chave = b.chave;
    if (!chaveValida(chave)) return reply.code(400).send({ erro: "CHAVE_IDEMPOTENCIA_INVALIDA" });
    if (!vagaValida(b) || !idValido(b.convenio_id) || !idValido(b.convenio_procedimento_id)) {
      return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    }
    const remarcar = b.remarcar;
    const original = remarcar?.agendamento_id;
    if (remarcar && (!idValido(original) || !idValido(b.paciente_id))) {
      return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    }

    // Paciente: o já cadastrado (id) ou os dados mínimos para cadastrar junto com a marcação.
    let paciente: PedidoMarcacao["paciente"] | null = null;
    if (!idValido(b.paciente_id)) {
      const p = b.paciente ?? {};
      const nome = String(p.nome ?? "").trim();
      const cpf = String(p.cpf ?? "").replace(/\D/g, "");
      const nascimento = String(p.nascimento ?? "");
      const telefone = telefoneNacional(String(p.telefone ?? ""));
      if (nome.length < 3 || cpf.length !== 11 || !dataValida(nascimento) || !telefone) {
        return reply.code(400).send({ erro: "PACIENTE_INVALIDO" });
      }
      paciente = { nome, cpf, nascimento, telefone };
    }
    const obs = String(b.obs ?? "").trim().slice(0, 500);

    const ctx = await tenantComErp(req, reply);
    if (!ctx) return;
    const { tenant, erp } = ctx;

    // Paciente cadastrado: o ERP exige também nome, nascimento e telefone, relidos do cadastro dele.
    if (!paciente) {
      const d = await dadosDoCadastro(erp, b.busca ?? remarcar?.busca, b.paciente_id!);
      if (!d.ok) return d.r ? falha(reply, d.r) : reply.code(d.status).send({ erro: d.erro, faltam: d.faltam });
      paciente = d.campos;
    }

    const reserva = await reservar(tenant.id, chave, {
      tipo: remarcar ? "remarcar" : "criar",
      usuario: b.usuario, prestador_id: b.prestador_id, data: b.data, horario: b.horario,
      paciente_id: b.paciente_id, agendamento_id: original,
    });
    // Mesmo pedido de novo depois de um resultado incerto: só confere na agenda, nunca grava outra vez.
    if (!reserva.novo && reserva.situacao === "incerto") {
      const { rows } = await pool!.query<{ diagnostico: string | null }>("SELECT diagnostico FROM agendamentos WHERE tenant_id = $1 AND chave = $2", [tenant.id, chave]);
      return resolverIncerto(req, reply, tenant.id, chave, erp, b, rows[0]?.diagnostico ?? undefined);
    }
    if (!reserva.novo) return repetido(reply, reserva);

    if (remarcar) {
      const c = await consultaDoPaciente(erp, remarcar.busca, original!);
      if (!c.ok) {
        await liberar(tenant.id, chave);
        return reply.code(c.status).send({ erro: c.erro });
      }
    }

    // Revalida o horário imediatamente antes: outra pessoa pode ter ocupado a vaga.
    const t0 = Date.now();
    const rh = await erp.horariosLivres(b.prestador_id, b.data);
    if (!rh.ok) {
      await liberar(tenant.id, chave);
      return falha(reply, rh);
    }
    if (!rh.dados.some((h) => h.horario === b.horario && h.agenda_id === b.agenda_id)) {
      await liberar(tenant.id, chave);
      return reply.code(409).send({ erro: "HORARIO_INDISPONIVEL" });
    }

    const t1 = Date.now();
    const r = await erp.marcar(
      {
        vaga: vagaDe(b),
        convenio_id: b.convenio_id,
        procedimento_id: b.convenio_procedimento_id,
        paciente,
        ...(remarcar ? { remarcar: original! } : {}),
        ...(obs ? { obs } : {}),
      },
      TEMPO_GRAVAR_MS,
    );
    // Sem dados pessoais: tempos, erro de rede e os ids do pedido, para comparar com a marcação que funciona.
    const diag = [
      r.ok ? "respondeu" : r.msg ?? r.erro,
      `revalidação ${t1 - t0} ms`,
      `gravação ${Date.now() - t1} ms`,
      `paciente ${"paciente_id" in paciente ? "existente" : "novo"}`,
      `convênio ${b.convenio_id}`,
      `procedimento ${b.convenio_procedimento_id}`,
      `agenda ${b.agenda_id}`,
    ].join("; ");
    if (!r.ok && r.semResposta) return resolverIncerto(req, reply, tenant.id, chave, erp, b, diag);
    if (!r.ok) return falhaAoGravar(req, reply, tenant.id, chave, r);

    const feito = { ...r.dados.feito, data: b.data, horario: b.horario, remarcado: !!remarcar };
    // Sem o número da consulta não há prova de que o ERP gravou: a Asa já respondeu 200 com uma recusa
    // fora do formato de erro. Não se diz "marcada"; a tentativa fica como incerta, e o formato da
    // resposta vai para o log (sem dados do paciente) para entender o que veio.
    if (!feito.agendamento_id) {
      const { msg, ...formato } = r.dados.diagnostico;
      req.log.error(
        { tenant: tenant.id, tipo: remarcar ? "remarcar" : "criar", prestador: b.prestador_id, data: b.data, horario: b.horario, erp: erp.erp, ...formato, msg },
        "o ERP respondeu ao agendamento sem o número da consulta",
      );
      return resolverIncerto(req, reply, tenant.id, chave, erp, b, "sem número" + (msg ? ": " + msg : "") + "; " + diag);
    }
    await concluir(tenant.id, chave, feito, feito.paciente_id);
    req.log.info(
      {
        tenant: tenant.id, tipo: remarcar ? "remarcar" : "criar", agendamento: feito.agendamento_id, original,
        prestador: b.prestador_id, data: b.data, horario: b.horario, usuario: b.usuario, erp: erp.erp,
      },
      "agendamento gravado no ERP",
    );
    return { ok: true, ...feito };
  });

  // Cancelar consulta, sempre pelo id explícito.
  app.post<{ Params: { id: string }; Body: { chave?: string; busca?: Busca; usuario?: string } }>(
    "/v1/agendamentos/:id/cancelar",
    async (req, reply) => {
      const id = req.params.id;
      const b = req.body ?? {};
      if (!idValido(id)) return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
      if (!chaveValida(b.chave)) return reply.code(400).send({ erro: "CHAVE_IDEMPOTENCIA_INVALIDA" });

      const ctx = await tenantComErp(req, reply);
      if (!ctx) return;
      const { tenant, erp } = ctx;

      const reserva = await reservar(tenant.id, b.chave, { tipo: "cancelar", usuario: b.usuario, agendamento_id: id });
      if (!reserva.novo) return repetido(reply, reserva);

      const c = await consultaDoPaciente(erp, b.busca, id);
      if (!c.ok) {
        await liberar(tenant.id, b.chave);
        return reply.code(c.status).send({ erro: c.erro });
      }

      const r = await erp.mudarStatus(id, "cancelado");
      if (!r.ok) return falhaAoGravar(req, reply, tenant.id, b.chave, r);

      const feito = { agendamento_id: id, cancelado: true, data: c.consulta.data, horario: c.consulta.hora };
      await concluir(tenant.id, b.chave, feito);
      req.log.info({ tenant: tenant.id, tipo: "cancelar", agendamento: id, usuario: b.usuario, erp: erp.erp }, "consulta cancelada no ERP");
      return { ok: true, ...feito };
    },
  );

  // Agenda em tela cheia: confirmar presença, marcar falta ou cancelar uma consulta do dia. A prova de
  // que o id é legítimo é ele estar na agenda daquele prestador naquele dia.
  const STATUS: Record<string, { status: "confirmado" | "ausente" | "cancelado"; tipo: string }> = {
    confirmado: { status: "confirmado", tipo: "confirmar" },
    ausente: { status: "ausente", tipo: "ausente" },
    cancelado: { status: "cancelado", tipo: "cancelar" },
  };
  app.post<{ Params: { id: string }; Body: { chave?: string; status?: string; prestador_id?: string; data?: string; usuario?: string } }>(
    "/v1/agendamentos/:id/status",
    async (req, reply) => {
      const id = req.params.id;
      const b = req.body ?? {};
      const alvo = STATUS[String(b.status ?? "")];
      if (!idValido(id) || !alvo || !idValido(b.prestador_id) || !b.data || !dataValida(b.data)) {
        return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
      }
      if (!chaveValida(b.chave)) return reply.code(400).send({ erro: "CHAVE_IDEMPOTENCIA_INVALIDA" });

      const ctx = await tenantComErp(req, reply);
      if (!ctx) return;
      const { tenant, erp } = ctx;

      const reserva = await reservar(tenant.id, b.chave, {
        tipo: alvo.tipo, usuario: b.usuario, prestador_id: b.prestador_id, data: b.data, agendamento_id: id,
      });
      if (!reserva.novo) return repetido(reply, reserva);

      const ra = await erp.agendaDoDia(b.prestador_id, b.data);
      const consulta = ra.ok ? ra.dados.find((a) => a.id === id) : undefined;
      if (!consulta) {
        await liberar(tenant.id, b.chave);
        if (!ra.ok && !naoEncontrado(ra)) return falha(reply, ra);
        return reply.code(409).send({ erro: "CONSULTA_NAO_ENCONTRADA" });
      }

      const r = await erp.mudarStatus(id, alvo.status);
      if (!r.ok) return falhaAoGravar(req, reply, tenant.id, b.chave, r);

      const feito = { agendamento_id: id, status: alvo.status, data: b.data, horario: consulta.hora };
      await concluir(tenant.id, b.chave, feito, consulta.paciente.id);
      req.log.info({ tenant: tenant.id, tipo: alvo.tipo, agendamento: id, usuario: b.usuario, erp: erp.erp }, "status da consulta gravado no ERP");
      return { ok: true, ...feito };
    },
  );
}
