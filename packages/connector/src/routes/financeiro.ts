import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import type { ErpAdapter, FalhaErp } from "../erp/index.js";
import { FORMAS, formaValida, lerFinanceiro, valorAsa } from "../financeiro.js";
import { tenantComErp, tenantDaRequisicao } from "../tenant-auth.js";
import { buscaDe } from "./agendamento.js";
import { dataValida, falha, idValido, naoEncontrado } from "./consulta.js";

// Financeiro: lançar conta a receber do paciente no ERP. Na Asa é gravação SEM VOLTA: ela não deixa ler,
// editar nem apagar a conta pela API. Por isso a chave de idempotência, a conferência do paciente e do
// vínculo, e a trilha na tabela cobrancas.

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
  vencimento?: string; // YYYY-MM-DD; vazio = o ERP decide (a Asa usa o dia seguinte)
  // Vínculo opcional com uma consulta. Com prestador_id e data, vem da agenda do dia (que pode já ter
  // passado); sem eles, tem de estar nas próximas consultas do paciente.
  agendamento?: { id?: string; prestador_id?: string; data?: string };
  usuario?: string;
}

const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");

// Confere que o paciente_id é o do paciente achado pela busca, e que a consulta vinculada é dele.
async function conferir(
  erp: ErpAdapter,
  pacienteId: string,
  busca: Busca,
  ag: PedidoCobranca["agendamento"],
): Promise<{ ok: true } | { ok: false; status: number; erro: string; r?: FalhaErp }> {
  const b = buscaDe(busca);
  if (!b) return { ok: false, status: 400, erro: "PACIENTE_INVALIDO" };

  const rp = await erp.buscarPaciente(b);
  if (!rp.ok) return naoEncontrado(rp) ? { ok: false, status: 409, erro: "PACIENTE_NAO_CONFERE" } : { ok: false, status: 502, erro: rp.erro, r: rp };
  if (rp.dados?.id !== pacienteId) return { ok: false, status: 409, erro: "PACIENTE_NAO_CONFERE" };

  if (!ag?.id) return { ok: true };
  if (ag.prestador_id) {
    // Agenda do dia: a Asa não traz o id do paciente nela, então confere pelo telefone.
    const ra = await erp.agendaDoDia(ag.prestador_id, ag.data!);
    if (!ra.ok && !naoEncontrado(ra)) return { ok: false, status: 502, erro: ra.erro, r: ra };
    const a = ra.ok ? ra.dados.find((x) => x.id === ag.id) : undefined;
    const telPaciente = digitos(rp.dados?.telefone);
    if (!a || !telPaciente || digitos(a.paciente.telefone) !== telPaciente) return { ok: false, status: 409, erro: "CONSULTA_NAO_ENCONTRADA" };
    return { ok: true };
  }
  const rc = await erp.consultasFuturas(b);
  if (!rc.ok && !naoEncontrado(rc)) return { ok: false, status: 502, erro: rc.erro, r: rc };
  if (!rc.ok || !rc.dados.consultas.some((c) => c.id === ag.id)) return { ok: false, status: 409, erro: "CONSULTA_NAO_ENCONTRADA" };
  return { ok: true };
}

export async function financeiroRoutes(app: FastifyInstance) {
  // Configuração do financeiro da clínica: a tela "Configurar" e o painel só leem. Quem grava é a
  // implantação (PUT /admin/tenants/:id/financeiro), com a chave de administrador.
  app.get("/v1/tenant/financeiro", async (req, reply) => {
    const tenant = await tenantDaRequisicao(req, reply);
    if (!tenant) return;
    const { rows } = await pool!.query<{ financeiro: unknown }>("SELECT financeiro FROM tenants WHERE id = $1", [tenant.id]);
    return { config: lerFinanceiro(rows[0]?.financeiro), formas: FORMAS };
  });

  // Ligar o financeiro é só da implantação (0.19.0): a chave da instalação está no navegador de todo
  // atendente. A rota fica só para a extensão antiga receber um erro claro.
  app.put("/v1/tenant/financeiro", async (_req, reply) => reply.code(403).send({ erro: "SO_IMPLANTACAO" }));

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

  // Lançar conta a receber no ERP.
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

    const ctx = await tenantComErp(req, reply);
    if (!ctx) return;
    const { tenant, erp } = ctx;
    const { rows: cfgRows } = await pool!.query<{ financeiro: unknown }>("SELECT financeiro FROM tenants WHERE id = $1", [tenant.id]);
    // `quem` (só administradores ou todos) NÃO é conferido aqui: o Conector não sabe quem é o usuário da
    // Kentro (`usuario` vem da extensão, só para a trilha). Essa regra é só da tela. O controle de verdade é
    // que só a implantação liga o financeiro.
    if (!lerFinanceiro(cfgRows[0]?.financeiro).ativo) return reply.code(403).send({ erro: "FINANCEIRO_DESLIGADO" });

    // A mesma chave nunca chama o ERP duas vezes.
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

    const c = await conferir(erp, b.paciente_id, b.busca, ag);
    if (!c.ok) {
      await liberar();
      return c.r ? falha(reply, c.r) : reply.code(c.status).send({ erro: c.erro });
    }

    const r = await erp.lancarConta({
      paciente_id: b.paciente_id,
      valor,
      forma: b.forma,
      id_externo: b.chave,
      ...(ag ? { agendamento_id: ag.id! } : {}),
      ...(b.vencimento ? { vencimento: b.vencimento } : {}),
    });
    if (!r.ok) {
      if (r.semResposta) {
        await pool!.query("UPDATE cobrancas SET situacao = 'incerto', atualizado_em = now() WHERE tenant_id = $1 AND chave = $2", [tenant.id, b.chave]);
        req.log.error({ tenant: tenant.id, chave: b.chave }, "cobrança sem resposta do ERP");
        return reply.code(504).send({ erro: "COBRANCA_INCERTA" });
      }
      await liberar();
      req.log.warn({ erro: r.erro, status: r.status, msg: r.msg }, "o ERP recusou a cobrança");
      return falha(reply, r);
    }

    const msg = r.dados.msg;
    await pool!.query("UPDATE cobrancas SET situacao = 'ok', msg = $3, atualizado_em = now() WHERE tenant_id = $1 AND chave = $2", [tenant.id, b.chave, msg]);
    req.log.info(
      { tenant: tenant.id, paciente: b.paciente_id, agendamento: ag?.id, valor, forma: b.forma, usuario: b.usuario, chave: b.chave, erp: erp.erp },
      "conta a receber lançada no ERP",
    );
    return { ok: true, msg, valor, forma: b.forma, vencimento: b.vencimento || null, agendamento_id: ag?.id ?? null };
  });
}
