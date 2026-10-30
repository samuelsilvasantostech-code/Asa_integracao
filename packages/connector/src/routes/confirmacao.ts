import type { FastifyInstance } from "fastify";
import { chamarAsa } from "../asa.js";
import * as C from "../confirmacao.js";
import { pool } from "../db.js";
import { tenantComCredencial, tenantDaAutomacao } from "../tenant-auth.js";
import * as N from "../normalizar.js";
import { consultaDoPaciente, type Busca } from "./agendamento.js";
import { falha, naoEncontrado } from "./consulta.js";

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

    // Rodada de véspera só com o envio automático ligado. Os pedidos manuais (botão do atendente)
    // saem sempre: já foram conferidos (paciente, telefone, modo teste) quando foram pedidos.
    let daAsa: C.ConsultaD1[] = [];
    if (cfg.ativo) {
      const r = await chamarAsa<any>(t.credencial, "api-proximos-agendamento", { data_inicio: inicio, data_fim: fim, envio_final_semana: 0 });
      if (!r.ok) {
        req.log.warn({ tenant: t.id, erro: r.erro, status: r.status }, "confirmação: a Asa não devolveu os próximos agendamentos");
        return reply.code(502).send({ erro: r.erro });
      }
      daAsa = C.proximos(r.dados).filter((c) => c.data >= inicio && c.data <= fim);
    }
    const porId = new Map(daAsa.map((c) => [c.agendamento_id, c]));
    // Modo teste: só entram os telefones permitidos. Os demais nem são gravados, para saírem
    // normalmente quando o teste for desligado.
    const permitidos = new Set(cfg.teste.telefones);
    const entram = cfg.teste.ativo ? daAsa.filter((c) => c.telefone && permitidos.has(c.telefone)) : daAsa;

    type Reservada = {
      agendamento_id: string; origem: string; telefone: string; data: string; hora: string | null;
      prestador: string | null; nome: string | null; procedimento: string | null;
    };
    const db = await pool!.connect();
    let reservadas: Reservada[];
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
      // Consulta da véspera que saiu da lista da Asa (cancelada ou já disparada por outro meio) não é enviada.
      const ids = [...porId.keys()];
      if (cfg.ativo) {
        await db.query(
          `UPDATE confirmacoes SET estado = 'ignorado', erro = 'SAIU_DA_AGENDA', atualizado_em = now()
           WHERE tenant_id = $1 AND origem = 'automatica' AND estado = 'pendente' AND data BETWEEN $2 AND $3
             AND NOT (agendamento_id = ANY($4::text[]))`,
          [t.id, inicio, fim, ids],
        );
      }
      // Manuais primeiro: alguém está esperando por elas.
      const res = await db.query<Reservada>(
        `UPDATE confirmacoes SET estado = 'reservado', reservado_ate = now() + interval '${RESERVA_MIN} minutes',
                tentativas = tentativas + 1, atualizado_em = now()
         WHERE (tenant_id, agendamento_id) IN (
           SELECT tenant_id, agendamento_id FROM confirmacoes
           WHERE tenant_id = $1 AND estado = 'pendente' AND (
             (origem = 'manual' AND data >= $6::date)
             OR ($7 AND origem = 'automatica' AND data BETWEEN $2 AND $3 AND agendamento_id = ANY($4::text[])))
           ORDER BY (origem = 'manual') DESC, data, hora LIMIT $5 FOR UPDATE SKIP LOCKED)
         RETURNING agendamento_id, origem, telefone, to_char(data, 'YYYY-MM-DD') AS data, hora, prestador, nome, procedimento`,
        [t.id, inicio, fim, ids, cfg.lote, hoje, cfg.ativo],
      );
      reservadas = res.rows;
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    } finally {
      db.release();
    }

    const itens = reservadas.map((row) => {
      const c: C.ConsultaD1 = porId.get(row.agendamento_id) ?? {
        agendamento_id: row.agendamento_id, data: row.data, hora: row.hora, prestador: row.prestador, paciente: row.nome,
        telefone: row.telefone, clinica: null, especialidade: null, procedimento: row.procedimento, endereco: null,
      };
      const v = C.varsDa(c, hoje, t.nome);
      return {
        agendamento_id: row.agendamento_id,
        telefone: c.telefone,
        pais: "BR",
        nome: v.nome,
        data: c.data,
        hora: c.hora,
        origem: row.origem,
        texto: C.preencher(cfg.textos.mensagem, v),
        template: C.variaveisTemplate(v, cfg.template.parametros),
      };
    });
    const manuais = itens.filter((i) => i.origem === "manual").length;
    req.log.info({ tenant: t.id, inicio, fim, na_asa: daAsa.length, lote: itens.length, manuais, teste: cfg.teste.ativo }, "confirmação: lote entregue");
    return { ...base, total: itens.length, itens };
  });

  // Botão "Enviar confirmação" do atendente: põe a consulta na fila e aciona a automação de disparo
  // na hora (captura de webhook da Kentro). A consulta precisa ser futura e do paciente buscado.
  app.post<{ Body: { agendamento_id?: unknown; busca?: Busca; usuario?: unknown } }>("/v1/confirmacao/enviar", async (req, reply) => {
    const id = String(req.body?.agendamento_id ?? "");
    if (!idValido(id)) return reply.code(400).send({ erro: "DADOS_INVALIDOS" });
    const ctx = await tenantComCredencial(req, reply);
    if (!ctx) return;
    const { tenant, credencial } = ctx;
    const busca = req.body?.busca;

    const cons = await consultaDoPaciente(credencial, busca, id);
    if (!cons.ok) return reply.code(cons.status).send({ erro: cons.erro });
    const hoje = C.hojeEm(new Date());
    if (!cons.consulta.data || cons.consulta.data < hoje) return reply.code(409).send({ erro: "CONSULTA_PASSADA" });

    // Telefone e nome do cadastro da Asa, não da tela.
    const cpf = String(busca?.cpf ?? "").replace(/\D/g, "");
    const tel = N.telefoneAsa(String(busca?.telefone ?? ""));
    const rp = await chamarAsa<any>(credencial, "api-agendamento-paciente-instituicao", cpf.length === 11 ? { cpf } : { telefone: tel ?? "" });
    if (!rp.ok && !naoEncontrado(rp)) return falha(reply, rp);
    const pac = rp.ok ? N.paciente(rp.dados) : null;
    const telefone = C.telefoneKentro(String(pac?.telefone ?? ""));
    if (!telefone) return reply.code(422).send({ erro: "SEM_TELEFONE" });

    const { rows: cfgRows } = await pool!.query<{ confirmacao: unknown; disparo_url: string | null }>(
      "SELECT confirmacao, disparo_url FROM tenants WHERE id = $1",
      [tenant.id],
    );
    const cfg = C.lerConfig(cfgRows[0]?.confirmacao);
    if (cfg.teste.ativo && !cfg.teste.telefones.includes(telefone)) return reply.code(409).send({ erro: "MODO_TESTE" });

    const { rows: atual } = await pool!.query<{ estado: string; resposta: string | null }>(
      "SELECT estado, resposta FROM confirmacoes WHERE tenant_id = $1 AND agendamento_id = $2",
      [tenant.id, id],
    );
    if (atual[0]?.estado === "respondido") return reply.code(409).send({ erro: "JA_RESPONDIDA", resposta: atual[0].resposta });
    if (atual[0]?.estado === "reservado") return reply.code(409).send({ erro: "EM_ENVIO" });

    const usuario = String(req.body?.usuario ?? "").slice(0, 120) || null;
    await pool!.query(
      `INSERT INTO confirmacoes (tenant_id, agendamento_id, telefone, data, hora, prestador, estado, origem, nome, procedimento, solicitado_por)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendente', 'manual', $7, $8, $9)
       ON CONFLICT (tenant_id, agendamento_id) DO UPDATE SET
         telefone = EXCLUDED.telefone, data = EXCLUDED.data, hora = EXCLUDED.hora, prestador = EXCLUDED.prestador,
         estado = 'pendente', origem = 'manual', nome = EXCLUDED.nome, procedimento = EXCLUDED.procedimento,
         solicitado_por = EXCLUDED.solicitado_por, tentativas = 0, erro = NULL, reservado_ate = NULL, atualizado_em = now()`,
      [
        tenant.id, id, telefone, cons.consulta.data, cons.consulta.hora, cons.consulta.prestador,
        C.primeiroNome(pac?.nome ?? null) || null, cons.consulta.procedimentos.join(", ") || null, usuario,
      ],
    );

    const url = cfgRows[0]?.disparo_url;
    let disparo: "imediato" | "proxima_rodada" | "falhou" = "proxima_rodada";
    if (url) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ origem: "manual" }),
          signal: AbortSignal.timeout(10000),
        });
        disparo = r.ok ? "imediato" : "falhou";
      } catch {
        disparo = "falhou";
      }
    }
    req.log.info({ tenant: tenant.id, agendamento: id, usuario, disparo }, "confirmação manual pedida");
    return { ok: true, disparo };
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
    const v = C.varsResposta(linha, nome, hoje, t.nome);
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
