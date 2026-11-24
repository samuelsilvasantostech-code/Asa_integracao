// Contagem diária do uso (aba "Uso" da implantação): quantas vezes cada clínica buscou paciente, abriu
// a agenda, cadastrou, e quantas chamadas ao ERP falharam. Só contadores por (clínica, dia, evento):
// nenhuma URL, parâmetro ou dado de paciente. Soma em memória e grava a cada minuto (uma linha por
// evento e dia, não uma por chamada). Se o processo cair, perde no máximo o último minuto.
import type pg from "pg";
import type { FastifyRequest } from "fastify";
import { hojeEm } from "./confirmacao.js";

// Rotas contadas, pelo molde do Fastify (nunca a URL real). Lista fechada: rota nova só entra aqui de propósito.
export const EVENTOS: Readonly<Record<string, string>> = {
  "GET /v1/tenant/conexao/teste": "abertura",
  "GET /v1/paciente": "busca_paciente",
  "POST /v1/pacientes": "cadastro_paciente",
  "GET /v1/agenda/dia": "agenda_dia",
  "GET /v1/agenda/horarios": "horarios",
  "GET /v1/exames": "exames",
  "GET /v1/painel/resumo": "painel",
  "POST /v1/agendamentos": "agendamento",
  "POST /v1/cobrancas": "cobranca",
  "POST /v1/confirmacao/enviar": "confirmacao_manual",
  "GET /v1/confirmacao/lote": "confirmacao_lote",
};

export const DIAS_USO_DIARIO = 400; // um ano e pouco, para comparar com o mesmo mês do ano anterior
const MAX_PENDENTES = 20000; // banco fora do ar por muito tempo: para de acumular em vez de crescer sem fim

// Clínica e falha do ERP de cada requisição, para o onResponse contar. WeakMap: some com a requisição.
const marcas = new WeakMap<FastifyRequest, { tenant?: string; erroErp?: string }>();
const marca = (req: FastifyRequest) => marcas.get(req) ?? marcas.set(req, {}).get(req)!;

export function marcarTenant(req: FastifyRequest, tenantId: string) { marca(req).tenant = tenantId; }
export function marcarErroErp(req: FastifyRequest, erro: string) {
  marca(req).erroErp = /^[A-Z0-9_]{1,40}$/.test(erro) ? erro : "OUTRO";
}

// Evento da resposta: "busca_paciente", "busca_paciente:erro" (5xx, ERP recusando a credencial etc.)
// ou null (rota fora da lista, recusa por dado inválido do pedido).
export function eventoDa(metodo: string, molde: string | undefined, status: number): string | null {
  const ev = molde ? EVENTOS[`${metodo} ${molde}`] : undefined;
  if (!ev) return null;
  if (status < 400) return ev;
  if (status >= 500 || status === 422) return ev + ":erro";
  return null;
}

const pendentes = new Map<string, number>(); // "tenant|dia|evento" → n

export function contar(tenantId: string, evento: string, agora = new Date()) {
  const k = `${tenantId}|${hojeEm(agora)}|${evento}`;
  if (!pendentes.has(k) && pendentes.size >= MAX_PENDENTES) return;
  pendentes.set(k, (pendentes.get(k) ?? 0) + 1);
}

// Chamado no onResponse de toda requisição.
export function contarResposta(req: FastifyRequest, status: number) {
  const m = marcas.get(req);
  if (!m?.tenant) return;
  const molde = req.routeOptions?.url;
  // Toda chamada de clínica conta em "chamada": é a base da taxa de falhas do ERP.
  if (molde?.startsWith("/v1/")) contar(m.tenant, "chamada");
  const ev = eventoDa(req.method, molde, status);
  if (ev) contar(m.tenant, ev);
  if (m.erroErp) contar(m.tenant, "erp:" + m.erroErp);
}

export function pendentesUso() { return pendentes.size; }

export const SQL_GRAVAR_USO = `INSERT INTO uso_diario (tenant_id, dia, evento, n)
  SELECT * FROM unnest($1::uuid[], $2::date[], $3::text[], $4::int[])
  ON CONFLICT (tenant_id, dia, evento) DO UPDATE SET n = uso_diario.n + EXCLUDED.n`;

// Grava o que acumulou. Numa falha, devolve as contagens para a próxima tentativa.
export async function gravarUso(db: Pick<pg.Pool, "query">): Promise<number> {
  if (!pendentes.size) return 0;
  const lote = [...pendentes];
  pendentes.clear();
  const cols: [string[], string[], string[], number[]] = [[], [], [], []];
  for (const [k, n] of lote) {
    const [t, d, e] = k.split("|");
    cols[0].push(t); cols[1].push(d); cols[2].push(e); cols[3].push(n);
  }
  try {
    await db.query(SQL_GRAVAR_USO, cols);
  } catch (err) {
    for (const [k, n] of lote) pendentes.set(k, (pendentes.get(k) ?? 0) + n);
    throw err;
  }
  return lote.length;
}

export const SQL_LIMPAR_USO = "DELETE FROM uso_diario WHERE dia < $1::date";

// Grava a cada minuto e limpa o que passou de 400 dias uma vez por dia. Os timers não seguram o processo.
// Devolve a gravação final, para o desligamento chamar antes de fechar o banco.
export function iniciarGravacaoUso(
  db: Pick<pg.Pool, "query"> | null,
  log: { warn: (o: object, msg: string) => void },
): () => Promise<void> {
  if (!db) return async () => {};
  const gravar = () => gravarUso(db).then(() => undefined, (err) => log.warn({ err }, "uso: falha ao gravar as contagens; tenta de novo em 1 min"));
  const limpar = () => {
    const corte = new Date(Date.now() - DIAS_USO_DIARIO * 86400000).toISOString().slice(0, 10);
    db.query(SQL_LIMPAR_USO, [corte]).catch((err) => log.warn({ err }, "uso: falha ao limpar contagens antigas"));
  };
  setInterval(gravar, 60_000).unref();
  limpar();
  setInterval(limpar, 86400000).unref();
  return gravar;
}
