import type { FastifyInstance } from "fastify";
import { chamarAsa, type CredencialAsa } from "../asa.js";
import { pool } from "../db.js";
import { FORMAS, formaValida, lerFinanceiro, valorAsa } from "../financeiro.js";
import * as N from "../normalizar.js";
import { tenantComCredencial, tenantDaRequisicao } from "../tenant-auth.js";
import { dataValida, falha, idValido, naoEncontrado } from "./consulta.js";

// Financeiro: lançar conta a receber do paciente na Asa (api-gerar-conta-paciente). É gravação SEM
// VOLTA: a Asa não deixa ler, editar nem apagar a conta pela API. Por isso a chave de idempotência,
// a conferência do paciente e do vínculo, e a trilha na tabela cobrancas.

const chaveValida = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9-]{16,64}$/.test(s);

interface Busca {
  telefone?: string;
  cpf?: string;
}

interface PedidoCobranca {
  chave?: string;
  paciente_id?: string;
  busca?: Busca; // como o painel achou o paciente: prova que o id é o dele
  valor?: string | number;
  forma?: string;
  vencimento?: string; // YYYY-MM-DD; vazio = a Asa usa o dia seguinte
  // Vínculo opcional com uma consulta. Com prestador_id e data, vem da agenda do dia (que pode já ter
  // passado); sem eles, tem de estar nas próximas consultas do paciente.
  agendamento?: { id?: string; prestador_id?: string; data?: string };
  usuario?: string;
}

const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");

// Confere que o paciente_id é o do paciente achado pela busca, e que a consulta vinculada é dele.
async function conferir(
  credencial: CredencialAsa,
  pacienteId: string,
  busca: Busca,
  ag: PedidoCobranca["agendamento"],
): Promise<{ ok: true } | { ok: false; status: number; erro: string; r?: any }> {
  const cpf = digitos(busca.cpf);
  const telefone = busca.telefone ? N.telefoneAsa(String(busca.telefone)) : null;
  if (cpf.length !== 11 && !telefone) return { ok: false, status: 400, erro: "PACIENTE_INVALIDO" };
  const params: Record<string, string> = cpf.length === 11 ? { cpf } : { telefone: telefone! };

  const rp = await chamarAsa<any>(credencial, "api-agendamento-paciente-instituicao", params);
  if (!rp.ok) return naoEncontrado(rp) ? { ok: false, status: 409, erro: "PACIENTE_NAO_CONFERE" } : { ok: false, status: 502, erro: rp.erro, r: rp };
  if (N.paciente(rp.dados)?.id !== pacienteId) return { ok: false, status: 409, erro: "PACIENTE_NAO_CONFERE" };

  if (!ag?.id) return { ok: true };
  if (ag.prestador_id) {
    // Agenda do dia: horarios-agendados não traz o id do paciente, então confere pelo telefone.
    const ra = await chamarAsa<any>(credencial, "api-agendamento-horarios-agendados", { prestador_id: ag.prestador_id, data: ag.data! });
    if (!ra.ok && !naoEncontrado(ra)) return { ok: false, status: 502, erro: ra.erro, r: ra };
    const a = ra.ok ? N.agendados(ra.dados).find((x) => x.id === ag.id) : undefined;
    const telPaciente = digitos(N.paciente(rp.dados)?.telefone);
    if (!a || !telPaciente || digitos(a.paciente.telefone) !== telPaciente) return { ok: false, status: 409, erro: "CONSULTA_NAO_ENCONTRADA" };
    return { ok: true };
  }
  const rc = await chamarAsa<any>(credencial, "api-agendamentos-futuros", params);
  if (!rc.ok && !naoEncontrado(rc)) return { ok: false, status: 502, erro: rc.erro, r: rc };
  if (!rc.ok || !N.consultasFuturas(rc.dados).some((c) => c.id === ag.id)) return { ok: false, status: 409, erro: "CONSULTA_NAO_ENCONTRADA" };
  return { ok: true };
}

export async function financeiroRoutes(app: FastifyInstance) {
  // Configuração do financeiro da clínica, pela tela "Configurar Asa Saúde" e pelo painel.
  app.get("/v1/tenant/financeiro", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    const { rows } = await pool!.query<{ financeiro: unknown }>("SELECT financeiro FROM tenants WHERE id = $1", [tenant.id]);
    return { config: lerFinanceiro(rows[0]?.financeiro), formas: FORMAS };
  });

  app.put<{ Body: { config?: unknown; usuario?: string } }>("/v1/tenant/financeiro", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    if (!req.body?.config || typeof req.body.config !== "object") return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    const cfg = lerFinanceiro(req.body.config);
    await pool!.query("UPDATE tenants SET financeiro = $1, atualizado_em = now() WHERE id = $2", [cfg, tenant.id]);
    req.log.info({ tenant: tenant.id, usuario: req.body.usuario, ...cfg }, "financeiro: configuração gravada");
    return { ok: true, config: cfg };
  });

  // Contas lançadas pelo painel para o paciente. A Asa não devolve as contas: esta é a trilha local.
  app.get<{ Querystring: { paciente_id?: string } }>("/v1/cobrancas", async (req, reply) => {
    if (!idValido(req.query.paciente_id)) return reply.code(400).send({ erro: "PACIENTE_INVALIDO" });
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    const { rows } = await pool!.query(
      `SELECT situacao, valor::text AS valor, forma, to_char(vencimento, 'YYYY-MM-DD') AS vencimento, agendamento_id, usuario, criado_em
         FROM cobrancas WHERE tenant_id = $1 AND paciente_id = $2 AND situacao <> 'pendente'
        ORDER BY criado_em DESC LIMIT 20`,
      [tenant.id, req.query.paciente_id],
    );
    return { cobrancas: rows };
  });

  // Lançar conta a receber na Asa.
  app.post<{ Body: PedidoCobranca }>("/v1/cobrancas", async (req, reply) => {
    const b = req.body ?? {};
    if (!chaveValida(b.chave)) return reply.code(400).send({ erro: "CHAVE_IDEMPOTENCIA_INVALIDA" });
    const valor = valorAsa(b.valor);
    const ag = b.agendamento?.id ? b.agendamento : undefined;
    if (
      !idValido(b.paciente_id) || !valor || !formaValida(b.forma) || !b.busca ||
      (b.vencimento && !dataValida(b.vencimento)) ||
      (ag && (!idValido(ag.id) || (ag.prestador_id && (!idValido(ag.prestador_id) || !ag.data || !dataValida(ag.data)))))
    ) {
      return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    }

    const ctx = await tenantComCredencial(req, reply);
    if (!ctx) return;
    const { tenant, credencial } = ctx;
    const { rows: cfgRows } = await pool!.query<{ financeiro: unknown }>("SELECT financeiro FROM tenants WHERE id = $1", [tenant.id]);
    if (!lerFinanceiro(cfgRows[0]?.financeiro).ativo) return reply.code(403).send({ erro: "FINANCEIRO_DESLIGADO" });

    // A mesma chave nunca chama a Asa duas vezes.
    const ins = await pool!.query(
      `INSERT INTO cobrancas (tenant_id, chave, situacao, usuario, paciente_id, agendamento_id, valor, forma, vencimento)
       VALUES ($1, $2, 'pendente', $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
      [tenant.id, b.chave, String(b.usuario ?? "").slice(0, 120) || null, b.paciente_id, ag?.id ?? null, valor, b.forma, b.vencimento || null],
    );
    if (!ins.rowCount) {
      const { rows } = await pool!.query<{ situacao: string; msg: string | null }>(
        "SELECT situacao, msg FROM cobrancas WHERE tenant_id = $1 AND chave = $2",
        [tenant.id, b.chave],
      );
      const s = rows[0]?.situacao;
      if (s === "ok") return { ok: true, repetido: true, msg: rows[0].msg };
      return reply.code(409).send({ erro: s === "incerto" ? "COBRANCA_INCERTA" : "COBRANCA_EM_ANDAMENTO" });
    }
    const liberar = () => pool!.query("DELETE FROM cobrancas WHERE tenant_id = $1 AND chave = $2", [tenant.id, b.chave]);

    const c = await conferir(credencial, b.paciente_id, b.busca, ag);
    if (!c.ok) {
      await liberar();
      return c.r ? falha(reply, c.r) : reply.code(c.status).send({ erro: c.erro });
    }

    // id_externo = a chave: na Asa, a conta fica rastreável até este lançamento (inclusive se ficar incerta).
    // `status` (0/1) não é enviado: a Asa não documenta o que cada valor significa.
    const r = await chamarAsa<any>(credencial, "api-gerar-conta-paciente", {
      paciente_id: b.paciente_id,
      valor_parcela: valor,
      forma_pagamento: b.forma,
      id_externo: b.chave,
      ...(ag ? { agendamento_id: ag.id! } : {}),
      ...(b.vencimento ? { data_vencimento: b.vencimento } : {}),
    });
    if (!r.ok) {
      if (r.erro === "ASA_FORA_DO_AR" && r.status === 0) {
        await pool!.query("UPDATE cobrancas SET situacao = 'incerto', atualizado_em = now() WHERE tenant_id = $1 AND chave = $2", [tenant.id, b.chave]);
        req.log.error({ tenant: tenant.id, chave: b.chave }, "cobrança sem resposta da Asa");
        return reply.code(504).send({ erro: "COBRANCA_INCERTA" });
      }
      await liberar();
      req.log.warn({ erro: r.erro, status: r.status, msg: r.msg }, "Asa recusou a cobrança");
      return falha(reply, r);
    }

    const msg = String(r.dados?.msg ?? "").slice(0, 300) || null;
    await pool!.query("UPDATE cobrancas SET situacao = 'ok', msg = $3, atualizado_em = now() WHERE tenant_id = $1 AND chave = $2", [tenant.id, b.chave, msg]);
    req.log.info(
      { tenant: tenant.id, paciente: b.paciente_id, agendamento: ag?.id, valor, forma: b.forma, usuario: b.usuario, chave: b.chave },
      "conta a receber lançada na Asa",
    );
    return { ok: true, msg, valor, forma: b.forma, vencimento: b.vencimento || null, agendamento_id: ag?.id ?? null };
  });
}
