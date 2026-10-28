import type { FastifyInstance } from "fastify";
import { chamarAsa } from "../asa.js";
import { pool } from "../db.js";
import * as N from "../normalizar.js";
import { credencialDaRequisicao, tenantComCredencial } from "../tenant-auth.js";
import { dataValida, falha, idValido, naoEncontrado } from "./consulta.js";

// Marcar consulta pelo painel. Convênios e procedimentos são leitura; POST /v1/agendamentos é a
// ÚNICA rota do Conector que grava na Asa (api-agendamento-agendar-instituicao, só criação).

const horaValida = (s: unknown): s is string => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);

interface Vaga {
  prestador_id?: string;
  data?: string; // YYYY-MM-DD
  horario?: string; // HH:MM
  agenda_id?: string;
}

function vagaValida<T extends Vaga>(q: T): q is T & Required<Vaga> {
  return idValido(q.prestador_id) && !!q.data && dataValida(q.data) && horaValida(q.horario) && idValido(q.agenda_id);
}

function paramsVaga(v: Required<Vaga>) {
  return { prestador_id: v.prestador_id, data: N.dataBr(v.data), horario: v.horario, agenda_id: v.agenda_id };
}

interface PedidoAgendamento extends Vaga {
  chave?: string; // idempotência: gerada pelo painel a cada confirmação
  convenio_id?: string;
  convenio_procedimento_id?: string;
  paciente_id?: string;
  paciente?: { nome?: string; cpf?: string; nascimento?: string; telefone?: string };
  obs?: string;
  usuario?: string; // quem pediu no Kentro, só para a trilha
}

export async function agendamentoRoutes(app: FastifyInstance) {
  app.get<{ Querystring: Vaga }>("/v1/agenda/convenios", async (req, reply) => {
    if (!vagaValida(req.query)) return reply.code(400).send({ erro: "VAGA_INVALIDA" });
    const credencial = await credencialDaRequisicao(req, reply);
    if (!credencial) return;
    const r = await chamarAsa<any>(credencial, "api-agendamento-get-convenio-instituicao", paramsVaga(req.query));
    if (naoEncontrado(r)) return { convenios: [] };
    if (!r.ok) return falha(reply, r);
    return { convenios: N.convenios(r.dados) };
  });

  app.get<{ Querystring: Vaga & { convenio_id?: string } }>("/v1/agenda/procedimentos", async (req, reply) => {
    if (!vagaValida(req.query) || !idValido(req.query.convenio_id)) return reply.code(400).send({ erro: "VAGA_INVALIDA" });
    const credencial = await credencialDaRequisicao(req, reply);
    if (!credencial) return;
    const r = await chamarAsa<any>(credencial, "api-agendamento-get-procedimentos-instituicao", {
      ...paramsVaga(req.query),
      convenio_id: req.query.convenio_id,
    });
    if (naoEncontrado(r)) {
      req.log.info({ msg_asa: !r.ok ? r.msg : undefined }, "procedimentos: Asa respondeu não encontrado");
      return { procedimentos: [] };
    }
    if (!r.ok) return falha(reply, r);
    const procedimentos = N.procedimentos(r.dados);
    if (!procedimentos.length) {
      // Estrutura (só nomes de campos) para ajustar o normalizador quando a Asa muda o formato.
      const lista = r.dados?.procedimentos ?? r.dados;
      const primeiro = N.lista(lista)[0];
      req.log.warn({ chaves: Object.keys(r.dados ?? {}), item: primeiro && typeof primeiro === "object" ? Object.keys(primeiro) : typeof primeiro }, "procedimentos: resposta sem itens reconhecidos");
    }
    return { procedimentos };
  });

  app.post<{ Body: PedidoAgendamento }>("/v1/agendamentos", async (req, reply) => {
    const b = req.body ?? {};
    const chave = String(b.chave ?? "");
    if (!/^[A-Za-z0-9-]{16,64}$/.test(chave)) return reply.code(400).send({ erro: "CHAVE_IDEMPOTENCIA_INVALIDA" });
    if (!vagaValida(b) || !idValido(b.convenio_id) || !idValido(b.convenio_procedimento_id)) {
      return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    }

    // Paciente: o já cadastrado (id) ou os dados mínimos que a Asa pede para cadastrar junto.
    let paciente: Record<string, string>;
    if (idValido(b.paciente_id)) {
      paciente = { paciente_id: b.paciente_id };
    } else {
      const p = b.paciente ?? {};
      const nome = String(p.nome ?? "").trim();
      const cpf = String(p.cpf ?? "").replace(/\D/g, "");
      const nascimento = String(p.nascimento ?? "");
      const telefone = N.telefoneAsa(String(p.telefone ?? ""));
      if (nome.length < 3 || cpf.length !== 11 || !dataValida(nascimento) || !telefone) {
        return reply.code(400).send({ erro: "PACIENTE_INVALIDO" });
      }
      paciente = { nome, cpf, nascimento, telefone };
    }
    const obs = String(b.obs ?? "").trim().slice(0, 500);

    const ctx = await tenantComCredencial(req, reply);
    if (!ctx) return;
    const { tenant, credencial } = ctx;

    // Idempotência: a mesma chave nunca chama a Asa duas vezes.
    const ins = await pool!.query(
      `INSERT INTO agendamentos (tenant_id, chave, situacao, usuario, prestador_id, data, horario, paciente_id)
       VALUES ($1, $2, 'pendente', $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [tenant.id, chave, String(b.usuario ?? "").slice(0, 120) || null, b.prestador_id, b.data, b.horario, b.paciente_id ?? null],
    );
    if (ins.rowCount === 0) {
      const { rows } = await pool!.query<{ situacao: string; resposta: any }>(
        "SELECT situacao, resposta FROM agendamentos WHERE tenant_id = $1 AND chave = $2",
        [tenant.id, chave],
      );
      const anterior = rows[0];
      if (anterior?.situacao === "ok") return { ok: true, repetido: true, ...anterior.resposta };
      return reply.code(409).send({ erro: anterior?.situacao === "incerto" ? "AGENDAMENTO_INCERTO" : "AGENDAMENTO_EM_ANDAMENTO" });
    }
    const liberar = () => pool!.query("DELETE FROM agendamentos WHERE tenant_id = $1 AND chave = $2", [tenant.id, chave]);

    // Revalida o horário imediatamente antes: outra pessoa pode ter ocupado a vaga.
    const rh = await chamarAsa<any>(credencial, "api-agendamento-horarios-atendimento", {
      prestador_id: b.prestador_id,
      data: `${b.data} 00:00:00`,
    });
    if (!rh.ok) {
      await liberar();
      return falha(reply, rh);
    }
    if (!N.horarios(rh.dados).some((h) => h.horario === b.horario && h.agenda_id === b.agenda_id)) {
      await liberar();
      return reply.code(409).send({ erro: "HORARIO_INDISPONIVEL" });
    }

    const r = await chamarAsa<any>(credencial, "api-agendamento-agendar-instituicao", {
      ...paramsVaga(b),
      convenio_id: b.convenio_id,
      convenio_procedimento_id: b.convenio_procedimento_id,
      ...paciente,
      ...(obs ? { obs } : {}),
    });

    if (!r.ok) {
      // Sem resposta, a Asa pode ter gravado: não libera a chave para não duplicar numa nova tentativa.
      if (r.erro === "ASA_FORA_DO_AR" && r.status === 0) {
        await pool!.query("UPDATE agendamentos SET situacao = 'incerto', atualizado_em = now() WHERE tenant_id = $1 AND chave = $2", [tenant.id, chave]);
        req.log.error({ tenant: tenant.id, prestador: b.prestador_id, data: b.data, horario: b.horario }, "agendamento sem resposta da Asa");
        return reply.code(504).send({ erro: "AGENDAMENTO_INCERTO" });
      }
      await liberar();
      req.log.warn({ erro: r.erro, status: r.status, msg: r.msg }, "Asa recusou o agendamento");
      return falha(reply, r);
    }

    const feito = {
      ...N.agendamentoFeito(r.dados),
      data: b.data,
      horario: b.horario,
    };
    await pool!.query(
      "UPDATE agendamentos SET situacao = 'ok', resposta = $3, paciente_id = COALESCE(paciente_id, $4), atualizado_em = now() WHERE tenant_id = $1 AND chave = $2",
      [tenant.id, chave, feito, feito.paciente_id],
    );
    req.log.info({ tenant: tenant.id, agendamento: feito.agendamento_id, prestador: b.prestador_id, data: b.data, horario: b.horario, usuario: b.usuario }, "agendamento gravado na Asa");
    return { ok: true, ...feito };
  });
}
