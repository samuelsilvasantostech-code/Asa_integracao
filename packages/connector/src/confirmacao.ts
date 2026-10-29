// Confirmação de véspera (D-1): configuração por clínica, datas e textos. Funções puras.
import { dataIso, horaCurta, lista } from "./normalizar.js";

export type Acao = "confirmar" | "remarcar" | "cancelar";
export const ACOES: Acao[] = ["confirmar", "remarcar", "cancelar"];
// Status da Asa (api-agendamento-status) para cada botão.
export const STATUS_ASA: Record<Acao, string> = { confirmar: "confirmado", remarcar: "remarcar", cancelar: "cancelado" };

export interface Textos {
  mensagem: string; // vai ao paciente no canal não oficial; no oficial quem fala é o template
  confirmado: string;
  cancelado: string;
  remarcar: string;
  ja_respondido: string;
  indisponivel: string; // a Asa não respondeu na hora da resposta
}

export interface ConfigConfirmacao {
  ativo: boolean;
  dias_antes: number;
  sexta_pega_segunda: boolean;
  lote: number;
  textos: Textos;
  teste: { ativo: boolean; telefones: string[] };
}

export const TEXTOS_PADRAO: Textos = {
  mensagem:
    "Olá, {nome}! Passando para lembrar da sua consulta com {profissional} em {data} às {hora}, na {clinica}. Você confirma?",
  confirmado: "Obrigado, {nome}! Sua consulta de {data} às {hora} está confirmada.",
  cancelado: "Tudo certo, {nome}. Sua consulta de {data} às {hora} foi cancelada. Quando quiser, é só chamar para marcar de novo.",
  remarcar: "Combinado, {nome}! Vou te passar para a nossa equipe escolher um novo horário com você.",
  ja_respondido: "Já registramos a sua resposta para a consulta de {data} às {hora}. Se precisar de algo mais, nossa equipe te ajuda.",
  indisponivel: "Recebemos a sua resposta, {nome}. Nossa equipe confirma com você em instantes.",
};

export const PADRAO: ConfigConfirmacao = {
  ativo: false,
  dias_antes: 1,
  sexta_pega_segunda: true,
  lote: 15,
  textos: TEXTOS_PADRAO,
  // Nasce em modo teste: nada sai para paciente de verdade até alguém desligar.
  teste: { ativo: true, telefones: [] },
};

const LIMITE_TEXTO = 1000;

// Mescla o que está gravado com o padrão e descarta valores fora do formato. Serve para ler e
// para validar o que a tela Configurar manda.
export function lerConfig(gravado: unknown): ConfigConfirmacao {
  const g = gravado && typeof gravado === "object" ? (gravado as any) : {};
  const textos = { ...TEXTOS_PADRAO };
  for (const k of Object.keys(TEXTOS_PADRAO) as (keyof Textos)[]) {
    const v = g.textos?.[k];
    if (typeof v === "string" && v.trim()) textos[k] = v.trim().slice(0, LIMITE_TEXTO);
  }
  const inteiro = (v: unknown, min: number, max: number, padrao: number) =>
    Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : padrao;
  const telefones = Array.isArray(g.teste?.telefones)
    ? [...new Set(g.teste.telefones.map((t: unknown) => telefoneKentro(String(t))).filter(Boolean) as string[])].slice(0, 20)
    : [];
  return {
    ativo: typeof g.ativo === "boolean" ? g.ativo : PADRAO.ativo,
    dias_antes: inteiro(g.dias_antes, 1, 7, PADRAO.dias_antes),
    sexta_pega_segunda: typeof g.sexta_pega_segunda === "boolean" ? g.sexta_pega_segunda : PADRAO.sexta_pega_segunda,
    // A Kentro limita uma execução de automação a 100 mensagens e 100 requisições.
    lote: inteiro(g.lote, 1, 40, PADRAO.lote),
    textos,
    teste: { ativo: typeof g.teste?.ativo === "boolean" ? g.teste.ativo : PADRAO.teste.ativo, telefones },
  };
}

// Telefone em qualquer formato → 55 + DDD + número, como a Kentro abre o atendimento. null se não for BR.
export function telefoneKentro(raw: string): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return "55" + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return null;
}

// Data de hoje (YYYY-MM-DD) no fuso da clínica.
export function hojeEm(agora: Date, fuso = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

function somarDias(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

const diaDaSemana = (iso: string) => new Date(iso + "T12:00:00Z").getUTCDay(); // 0 = domingo

// Intervalo de datas das consultas a lembrar hoje. Com sexta_pega_segunda e dias_antes = 1, a sexta
// cobre sábado, domingo e segunda (a clínica não dispara no fim de semana).
export function datasAlvo(hoje: string, cfg: Pick<ConfigConfirmacao, "dias_antes" | "sexta_pega_segunda">) {
  const inicio = somarDias(hoje, cfg.dias_antes);
  let fim = inicio;
  if (cfg.sexta_pega_segunda && cfg.dias_antes === 1 && diaDaSemana(hoje) === 5) fim = somarDias(hoje, 3);
  return { inicio, fim };
}

export interface ConsultaD1 {
  agendamento_id: string;
  data: string; // YYYY-MM-DD
  hora: string | null;
  prestador: string | null;
  paciente: string | null;
  telefone: string | null; // já no formato da Kentro
  clinica: string | null;
}

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

// api-proximos-agendamento → consultas com id e data. Descarta o que vier sem id ou sem data.
export function proximos(corpo: any): ConsultaD1[] {
  return lista(corpo?.agendamentos ?? corpo?.msg ?? corpo)
    .filter((a: any) => a && typeof a === "object")
    .map((a: any) => ({
      agendamento_id: texto(a.id ?? a.agendamento_id) ?? "",
      data: dataIso(a.data ?? a.data_hora) ?? "",
      hora: horaCurta(a.hora ?? a.horario ?? a.data_hora ?? a.data),
      prestador: texto(a.profissional ?? a.nome_prestador ?? a.prestador),
      paciente: texto(a.paciente ?? a.nome),
      telefone: telefoneKentro(String(a.telefone1 ?? a.telefone ?? "")),
      clinica: texto(a.clinica ?? a["clínica"]),
    }))
    .filter((c) => c.agendamento_id && c.data);
}

export function primeiroNome(nome: string | null): string {
  const p = String(nome ?? "").trim().split(/\s+/)[0] ?? "";
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : "";
}

const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// "amanhã (30/10)" quando é amanhã, senão "segunda (02/11)".
export function dataFalada(iso: string, hoje: string): string {
  const [, m, d] = iso.split("-");
  const dia = `${d}/${m}`;
  if (iso === somarDias(hoje, 1)) return `amanhã (${dia})`;
  return `${SEMANA[diaDaSemana(iso)]} (${dia})`;
}

export interface Vars {
  nome: string;
  data: string;
  hora: string;
  profissional: string;
  clinica: string;
}

export function varsDa(c: Pick<ConsultaD1, "paciente" | "data" | "hora" | "prestador" | "clinica">, hoje: string, clinicaPadrao: string): Vars {
  return {
    nome: primeiroNome(c.paciente) || "tudo bem",
    data: dataFalada(c.data, hoje),
    hora: c.hora ?? "horário marcado",
    profissional: c.prestador ?? "o profissional",
    clinica: c.clinica ?? clinicaPadrao,
  };
}

// Troca {nome}, {data}… pelos valores. Marcador desconhecido fica como está.
export function preencher(modelo: string, v: Vars): string {
  return modelo.replace(/\{(\w+)\}/g, (inteiro, k: string) => (k in v ? (v as any)[k] : inteiro));
}

// Ordem fixa das variáveis do template oficial (documentada para a clínica criar o template).
export function variaveisTemplate(v: Vars): string[] {
  return [v.nome, v.data, v.hora, v.profissional, v.clinica];
}

// Botão recebido (id ou texto) → ação. Aceita o texto do botão do template e variações comuns.
export function acaoDoBotao(recebido: unknown): Acao | null {
  const s = String(recebido ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if ((ACOES as string[]).includes(s)) return s as Acao;
  if (/^(confirm|sim\b|1$)/.test(s)) return "confirmar";
  if (/^(remarc|reagend|2$)/.test(s)) return "remarcar";
  if (/^(cancel|desmarc|3$)/.test(s)) return "cancelar";
  return null;
}
