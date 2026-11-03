// Retenção: depois de 90 dias, os dados pessoais das trilhas (confirmacoes, agendamentos, cobrancas) são
// apagados. A linha fica, com estado, tipo, valor e datas, para os números do painel (que vai até 90 dias).
import type pg from "pg";
import { hojeEm } from "./confirmacao.js";

export const RETENCAO_DIAS = 90;
const FUSO = "America/Sao_Paulo";
const UM_DIA = 24 * 60 * 60 * 1000;

// Primeiro dia mantido: o que for de antes dele é anonimizado. hoje e o retorno em YYYY-MM-DD.
export function corteRetencao(hoje: string, dias = RETENCAO_DIAS): string {
  const d = new Date(hoje + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

// $1 = corte. `atualizado_em` não é tocado: o painel conta confirmações pela data de envio ou da última
// mudança, e a limpeza não pode trazer uma linha antiga para o período atual.
export const SQL_RETENCAO = {
  // Consulta antiga: telefone, primeiro nome, procedimento, profissional, quem pediu e o atendimento da Kentro.
  confirmacoes: `UPDATE confirmacoes SET telefone = NULL, nome = NULL, procedimento = NULL, prestador = NULL, solicitado_por = NULL, chat_id = NULL
    WHERE data < $1::date
      AND (telefone IS NOT NULL OR nome IS NOT NULL OR procedimento IS NOT NULL OR prestador IS NOT NULL OR solicitado_por IS NOT NULL OR chat_id IS NOT NULL)`,
  // Pedido antigo: atendente, paciente e a resposta guardada para a idempotência (que já não serve).
  agendamentos: `UPDATE agendamentos SET usuario = NULL, paciente_id = NULL, resposta = NULL
    WHERE (criado_em AT TIME ZONE '${FUSO}')::date < $1::date
      AND (usuario IS NOT NULL OR paciente_id IS NOT NULL OR resposta IS NOT NULL)`,
  // Cobrança antiga: atendente, paciente e a mensagem da Asa. Valor, forma e situação ficam.
  cobrancas: `UPDATE cobrancas SET usuario = NULL, paciente_id = NULL, msg = NULL
    WHERE (criado_em AT TIME ZONE '${FUSO}')::date < $1::date
      AND (usuario IS NOT NULL OR paciente_id IS NOT NULL OR msg IS NOT NULL)`,
} as const;

export async function aplicarRetencao(db: Pick<pg.Pool, "query">, agora = new Date()) {
  const corte = corteRetencao(hojeEm(agora));
  const feito: Record<keyof typeof SQL_RETENCAO, number> = { confirmacoes: 0, agendamentos: 0, cobrancas: 0 };
  for (const [tabela, sql] of Object.entries(SQL_RETENCAO) as [keyof typeof SQL_RETENCAO, string][]) {
    feito[tabela] = (await db.query(sql, [corte])).rowCount ?? 0;
  }
  return { corte, ...feito };
}

// Roda uma vez ao subir (depois das migrações) e a cada 24 h. O timer não segura o processo.
export function iniciarRetencao(
  db: Pick<pg.Pool, "query"> | null,
  log: { info: (o: object, msg: string) => void; error: (o: object, msg: string) => void },
) {
  if (!db) return;
  const rodar = () =>
    aplicarRetencao(db).then(
      (r) => log.info(r, "retenção: dados pessoais antigos apagados"),
      (err) => log.error({ err }, "retenção: falhou; tenta de novo em 24 h"),
    );
  void rodar();
  setInterval(rodar, UM_DIA).unref();
}
