import type { FastifyInstance } from "fastify";
import { chamarAsa } from "../asa.js";
import * as C from "../confirmacao.js";
import { pool } from "../db.js";
import { tenantDaAutomacao } from "../tenant-auth.js";

// Confirmação de véspera (D-1). Quem chama é a automação da Kentro, com a chave da automação.
// Gravações na Asa daqui: `disparados` (só depois que a mensagem saiu) e `agendamento-status`
// (sempre com o id explícito, nunca pelo telefone).

const RESERVA_MIN = 15;
const MAX_TENTATIVAS = 3;
const ERROS_DEFINITIVOS = new Set(["CHAT_OPEN", "INVALID_NUMBER", "NOT_ON_WHATSAPP", "CONTACT_LOCKED"]);
const idValido = (s: unknown): s is string => typeof s === "string" && /^\d{1,12}$/.test(s);

export async function confirmacaoRoutes(app: FastifyInstance) {
  // Lote a enviar agora. Cada chamada reserva as consultas que devolve, então duas rodadas seguidas
  // não pegam as mesmas.
  app.get("/v1/confirmacao/lote", async (req, reply) => {
    const t = await tenantDaAutomacao(req, reply);
    if (!t) return;
    const cfg = C.lerConfig(t.confirmacao);
    const hoje = C.hojeEm(new Date());
    const { inicio, fim } = C.datasAlvo(hoje, cfg);
    const base = { ativo: cfg.ativo, teste: cfg.teste.ativo, data_inicio: inicio, data_fim: fim };
    if (!cfg.ativo) return { ...base, total: 0, itens: [] };

    const r = await chamarAsa<any>(t.credencial, "api-proximos-agendamento", { data_inicio: inicio, data_fim: fim, envio_final_semana: 0 });
    if (!r.ok) {
      req.log.warn({ tenant: t.id, erro: r.erro, status: r.status }, "confirmação: a Asa não devolveu os próximos agendamentos");
      return reply.code(502).send({ erro: r.erro });
    }
    const daAsa = C.proximos(r.dados).filter((c) => c.data >= inicio && c.data <= fim);
    const porId = new Map(daAsa.map((c) => [c.agendamento_id, c]));
    // Modo teste: só entram os telefones permitidos. Os demais nem são gravados, para saírem
    // normalmente quando o teste for desligado.
    const permitidos = new Set(cfg.teste.telefones);
    const entram = cfg.teste.ativo ? daAsa.filter((c) => c.telefone && permitidos.has(c.telefone)) : daAsa;

    const db = await pool!.connect();
    let reservadas: { agendamento_id: string }[];
    try {
      await db.query("BEGIN");
      for (const c of entram) {
        await db.query(
          `INSERT INTO confirmacoes (tenant_id, agendamento_id, telefone, data, hora, prestador, estado, erro)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (tenant_id, agendamento_id) DO NOTHING`,
          [t.id, c.agendamento_id, c.telefone, c.data, c.hora, c.prestador, c.telefone ? "pendente" : "ignorado", c.telefone ? null : "SEM_TELEFONE"],
        );
      }
      // Rodada que caiu no meio: a reserva vence e a consulta volta à fila.
      await db.query(
        "UPDATE confirmacoes SET estado = 'pendente', atualizado_em = now() WHERE tenant_id = $1 AND estado = 'reservado' AND reservado_ate < now()",
        [t.id],
      );
      // Consulta que saiu da lista da Asa (cancelada ou já disparada por outro meio) não é enviada.
      const ids = [...porId.keys()];
      await db.query(
        `UPDATE confirmacoes SET estado = 'ignorado', erro = 'SAIU_DA_AGENDA', atualizado_em = now()
         WHERE tenant_id = $1 AND estado = 'pendente' AND data BETWEEN $2 AND $3 AND NOT (agendamento_id = ANY($4::text[]))`,
        [t.id, inicio, fim, ids],
      );
      const res = await db.query<{ agendamento_id: string }>(
        `UPDATE confirmacoes SET estado = 'reservado', reservado_ate = now() + interval '${RESERVA_MIN} minutes',
                tentativas = tentativas + 1, atualizado_em = now()
         WHERE (tenant_id, agendamento_id) IN (
           SELECT tenant_id, agendamento_id FROM confirmacoes
           WHERE tenant_id = $1 AND estado = 'pendente' AND data BETWEEN $2 AND $3 AND agendamento_id = ANY($4::text[])
           ORDER BY data, hora LIMIT $5 FOR UPDATE SKIP LOCKED)
         RETURNING agendamento_id`,
        [t.id, inicio, fim, ids, cfg.lote],
      );
      reservadas = res.rows;
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    } finally {
      db.release();
    }

    const itens = reservadas.map(({ agendamento_id }) => {
      const c = porId.get(agendamento_id)!;
      const v = C.varsDa(c, hoje, t.nome);
      return {
        agendamento_id,
        telefone: c.telefone,
        pais: "BR",
        nome: v.nome,
        data: c.data,
        hora: c.hora,
        texto: C.preencher(cfg.textos.mensagem, v),
        template: C.variaveisTemplate(v, cfg.template.parametros),
      };
    });
    req.log.info({ tenant: t.id, inicio, fim, na_asa: daAsa.length, lote: itens.length, teste: cfg.teste.ativo }, "confirmação: lote entregue");
    return { ...base, total: itens.length, itens };
  });

  // Resultado da rodada. Só o que saiu é marcado em `disparados` na Asa, que não tem volta.
  app.post<{ Body: { itens?: { agendamento_id?: unknown; chat_id?: unknown; erro?: unknown }[] } }>(
    "/v1/confirmacao/enviados",
    async (req, reply) => {
      const t = await tenantDaAutomacao(req, reply);
      if (!t) return;
      const itens = Array.isArray(req.body?.itens) ? req.body.itens.slice(0, 100) : null;
      if (!itens) return reply.code(400).send({ erro: "DADOS_INVALIDOS" });

      let enviados = 0;
      let falhas = 0;
      for (const it of itens) {
        const id = String(it?.agendamento_id ?? "");
        if (!idValido(id)) continue;
        const erro = String(it?.erro ?? "").trim().slice(0, 60);
        const chat = String(it?.chat_id ?? "").trim().slice(0, 40);
        if (!erro && chat) {
          const { rowCount } = await pool!.query(
            `UPDATE confirmacoes SET estado = 'enviado', chat_id = $3, erro = NULL, enviado_em = now(), reservado_ate = NULL, atualizado_em = now()
             WHERE tenant_id = $1 AND agendamento_id = $2 AND estado = 'reservado'`,
            [t.id, id, chat],
          );
          enviados += rowCount ?? 0;
        } else {
          const { rowCount } = await pool!.query(
            `UPDATE confirmacoes SET estado = CASE WHEN $4 OR tentativas >= $5 THEN 'falhou' ELSE 'pendente' END,
                    erro = $3, reservado_ate = NULL, atualizado_em = now()
             WHERE tenant_id = $1 AND agendamento_id = $2 AND estado = 'reservado'`,
            [t.id, id, erro || "SEM_ATENDIMENTO", ERROS_DEFINITIVOS.has(erro), MAX_TENTATIVAS],
          );
          falhas += rowCount ?? 0;
        }
      }

      // Avisa a Asa de tudo que saiu e ainda não foi avisado, inclusive de rodadas anteriores em
      // que ela estava fora do ar.
      const { rows } = await pool!.query<{ agendamento_id: string }>(
        "SELECT agendamento_id FROM confirmacoes WHERE tenant_id = $1 AND estado IN ('enviado', 'respondido') AND NOT disparado_asa LIMIT 200",
        [t.id],
      );
      let asa = 0;
      for (let i = 0; i < rows.length; i += 50) {
        const bloco = rows.slice(i, i + 50).map((r) => r.agendamento_id);
        const r = await chamarAsa<any>(t.credencial, "api-agendamento-disparados", { "agendamentos[]": bloco });
        if (!r.ok) {
          req.log.warn({ tenant: t.id, erro: r.erro, status: r.status }, "confirmação: a Asa não aceitou `disparados`; tenta na próxima rodada");
          break;
        }
        await pool!.query("UPDATE confirmacoes SET disparado_asa = true, atualizado_em = now() WHERE tenant_id = $1 AND agendamento_id = ANY($2::text[])", [t.id, bloco]);
        asa += bloco.length;
      }
      req.log.info({ tenant: t.id, enviados, falhas, asa }, "confirmação: rodada registrada");
      return { ok: true, enviados, falhas, asa_disparados: asa };
    },
  );

  // Resposta do paciente (botão). A URA sempre recebe 200 com o texto a mandar e se deve transferir.
  app.post<{ Body: { agendamento_id?: unknown; acao?: unknown; nome?: unknown } }>("/v1/confirmacao/resposta", async (req, reply) => {
    const t = await tenantDaAutomacao(req, reply);
    if (!t) return;
    const cfg = C.lerConfig(t.confirmacao);
    const id = String(req.body?.agendamento_id ?? "");
    const acao = C.acaoDoBotao(req.body?.acao, cfg.sinonimos);
    const nome = C.primeiroNome(String(req.body?.nome ?? "")) || "tudo bem";
    // Texto livre ou consulta desconhecida: quem resolve é a equipe.
    if (!idValido(id) || !acao) return { acao: null, texto: "", transferir: true };

    const { rows } = await pool!.query<{ estado: string; resposta: string | null; data: string; hora: string | null; prestador: string | null }>(
      "SELECT estado, resposta, to_char(data, 'YYYY-MM-DD') AS data, hora, prestador FROM confirmacoes WHERE tenant_id = $1 AND agendamento_id = $2",
      [t.id, id],
    );
    const linha = rows[0];
    if (!linha || !["enviado", "respondido"].includes(linha.estado)) return { acao, texto: "", transferir: true };
    const hoje = C.hojeEm(new Date());
    const v = C.varsDa({ paciente: nome, data: linha.data, hora: linha.hora, prestador: linha.prestador, clinica: null }, hoje, t.nome);
    v.nome = nome;
    if (linha.estado === "respondido" || linha.data < hoje) {
      return { acao, texto: C.preencher(cfg.textos.ja_respondido, v), transferir: true };
    }

    // Reivindica a resposta antes de chamar a Asa: dois toques não gravam duas vezes.
    const claim = await pool!.query(
      `UPDATE confirmacoes SET estado = 'respondido', resposta = $3, respondido_em = now(), atualizado_em = now()
       WHERE tenant_id = $1 AND agendamento_id = $2 AND estado = 'enviado'`,
      [t.id, id, acao],
    );
    if (!claim.rowCount) return { acao, texto: C.preencher(cfg.textos.ja_respondido, v), transferir: true };

    const r = await chamarAsa<any>(t.credencial, "api-agendamento-status", { status: C.STATUS_ASA[acao], agendamento: id });
    if (!r.ok) {
      await pool!.query("UPDATE confirmacoes SET erro = $3, atualizado_em = now() WHERE tenant_id = $1 AND agendamento_id = $2", [
        t.id,
        id,
        "ASA_STATUS_" + r.erro,
      ]);
      req.log.warn({ tenant: t.id, agendamento: id, acao, erro: r.erro }, "confirmação: a Asa não gravou a resposta");
      return { acao, texto: C.preencher(cfg.textos.indisponivel, v), transferir: true, gravado: false };
    }
    req.log.info({ tenant: t.id, agendamento: id, acao }, "confirmação: resposta gravada na Asa");
    const texto = acao === "confirmar" ? cfg.textos.confirmado : acao === "cancelar" ? cfg.textos.cancelado : cfg.textos.remarcar;
    return { acao, texto: C.preencher(texto, v), transferir: acao === "remarcar", gravado: true };
  });
}
