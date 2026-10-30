// Confirmação de véspera (D-1): configuração por clínica, datas e textos. Funções puras.
import { dataIso, horaCurta, lista, nomeProcedimento } from "./normalizar.js";

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

// Dados da consulta que podem ir no texto ({campo}) ou num parâmetro do template. "texto" = valor fixo.
export const CAMPOS = {
  nome: "Primeiro nome do paciente",
  nome_completo: "Nome completo do paciente",
  data: "Data falada: amanhã (30/10)",
  data_curta: "Data: 30/10",
  dia_semana: "Dia da semana: sexta",
  hora: "Hora: 08:30",
  profissional: "Profissional",
  especialidade: "Especialidade",
  procedimento: "Procedimento",
  clinica: "Nome da clínica",
  endereco: "Endereço da clínica",
  texto: "Texto fixo",
} as const;
export type Campo = keyof typeof CAMPOS;
export interface Parametro { campo: Campo; texto?: string }

export type Canal = "oficial" | "nao_oficial";

export interface ConfigConfirmacao {
  ativo: boolean;
  canal: Canal;
  dias_antes: number;
  sexta_pega_segunda: boolean;
  lote: number;
  textos: Textos;
  // Só no oficial. O template em si é escolhido na automação (a Kentro não aceita variável no id);
  // aqui fica o nome, para referência, e o que vai em cada {{1}}, {{2}}…
  template: { nome: string; parametros: Parametro[] };
  // Palavras a mais que contam como cada botão, além das que já são reconhecidas.
  sinonimos: Record<Acao, string[]>;
  teste: { ativo: boolean; telefones: string[] };
}

export const TEXTOS_PADRAO: Textos = {
  mensagem:
    "Olá, {nome}! Passando para lembrar da sua consulta com {profissional} {data} às {hora}, na {clinica}.\n\nResponda 1 para confirmar, 2 para remarcar ou 3 para cancelar.",
  confirmado: "Obrigado, {nome}! Sua consulta de {data} às {hora} está confirmada.",
  cancelado: "Tudo certo, {nome}. Sua consulta de {data} às {hora} foi cancelada. Quando quiser, é só chamar para marcar de novo.",
  remarcar: "Combinado, {nome}! Vou te passar para a nossa equipe escolher um novo horário com você.",
  ja_respondido: "Já registramos a sua resposta para a consulta de {data} às {hora}. Se precisar de algo mais, nossa equipe te ajuda.",
  indisponivel: "Recebemos a sua resposta, {nome}. Nossa equipe confirma com você em instantes.",
};

export const PARAMETROS_PADRAO: Parametro[] = [{ campo: "nome" }, { campo: "data" }, { campo: "hora" }, { campo: "profissional" }, { campo: "clinica" }];
export const MAX_PARAMETROS = 10;

export const PADRAO: ConfigConfirmacao = {
  ativo: false,
  canal: "oficial",
  dias_antes: 1,
  sexta_pega_segunda: true,
  lote: 15,
  textos: TEXTOS_PADRAO,
  template: { nome: "", parametros: PARAMETROS_PADRAO },
  sinonimos: { confirmar: [], remarcar: [], cancelar: [] },
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
  const parametros = Array.isArray(g.template?.parametros)
    ? g.template.parametros
        .filter((p: any) => p && typeof p === "object" && Object.hasOwn(CAMPOS, p.campo))
        .slice(0, MAX_PARAMETROS)
        .map((p: any): Parametro => (p.campo === "texto" ? { campo: "texto", texto: String(p.texto ?? "").trim().slice(0, 200) } : { campo: p.campo }))
    : PARAMETROS_PADRAO;
  // Cada palavra conta para um botão só: repetida em outro, ou igual ao nome de um botão, é descartada.
  const sinonimos = { ...PADRAO.sinonimos };
  const usados = new Set<string>(ACOES);
  for (const a of ACOES) {
    const v = g.sinonimos?.[a];
    if (!Array.isArray(v)) continue;
    sinonimos[a] = v.map(normalizar).filter((x: string) => x && x.length <= 40 && !usados.has(x) && (usados.add(x), true)).slice(0, 15);
  }
  return {
    ativo: typeof g.ativo === "boolean" ? g.ativo : PADRAO.ativo,
    canal: g.canal === "nao_oficial" ? "nao_oficial" : "oficial",
    dias_antes: inteiro(g.dias_antes, 1, 7, PADRAO.dias_antes),
    sexta_pega_segunda: typeof g.sexta_pega_segunda === "boolean" ? g.sexta_pega_segunda : PADRAO.sexta_pega_segunda,
    // A Kentro limita uma execução de automação a 100 mensagens e 100 requisições.
    lote: inteiro(g.lote, 1, 40, PADRAO.lote),
    textos,
    template: { nome: typeof g.template?.nome === "string" ? g.template.nome.trim().slice(0, 80) : "", parametros: parametros.length ? parametros : PARAMETROS_PADRAO },
    sinonimos,
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

// Intervalo de datas das consultas a lembrar hoje. Com sexta_pega_segunda, a sexta também manda os
// lembretes que sairiam no sábado e no domingo (a clínica não dispara no fim de semana), seja qual for a
// antecedência: com 1 dia cobre sábado a segunda; com 2, domingo a terça.
export function datasAlvo(hoje: string, cfg: Pick<ConfigConfirmacao, "dias_antes" | "sexta_pega_segunda">) {
  const inicio = somarDias(hoje, cfg.dias_antes);
  let fim = inicio;
  if (cfg.sexta_pega_segunda && diaDaSemana(hoje) === 5) fim = somarDias(hoje, cfg.dias_antes + 2);
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
  especialidade: string | null;
  procedimento: string | null;
  endereco: string | null;
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
      especialidade: texto(a.especialidade),
      procedimento: texto(lista(a.procedimentos).map(nomeProcedimento).filter(Boolean).join(", ")) ?? nomeProcedimento(a.procedimento),
      endereco: texto(a.clinica_endereco ?? a.endereco),
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

export type Vars = Record<Exclude<Campo, "texto">, string>;

type DadosVars = Pick<ConsultaD1, "paciente" | "data" | "hora" | "prestador" | "clinica"> & Partial<Pick<ConsultaD1, "especialidade" | "procedimento" | "endereco">>;

export function varsDa(c: DadosVars, hoje: string, clinicaPadrao: string): Vars {
  const [, m, d] = c.data.split("-");
  return {
    nome: primeiroNome(c.paciente) || "tudo bem",
    nome_completo: String(c.paciente ?? "").trim().replace(/\s+/g, " "),
    data: dataFalada(c.data, hoje),
    data_curta: d && m ? `${d}/${m}` : c.data,
    dia_semana: SEMANA[diaDaSemana(c.data)] ?? "",
    hora: c.hora ?? "horário marcado",
    profissional: c.prestador ?? "o profissional",
    especialidade: c.especialidade ?? "",
    procedimento: c.procedimento ?? "",
    clinica: c.clinica ?? clinicaPadrao,
    endereco: c.endereco ?? "",
  };
}

// Na resposta do paciente só há o que o Conector guardou da consulta (data, hora, profissional) e o
// primeiro nome que a automação devolve. O resto fica vazio, e a prévia usa esta mesma função.
export function varsResposta(linha: { data: string; hora: string | null; prestador: string | null }, nome: string, hoje: string, clinica: string): Vars {
  const v = varsDa({ paciente: nome, data: linha.data, hora: linha.hora, prestador: linha.prestador, clinica }, hoje, clinica);
  return { ...v, nome: primeiroNome(nome) || "tudo bem", nome_completo: "", especialidade: "", procedimento: "", endereco: "" };
}

// Troca {nome}, {data}… pelos valores. Marcador desconhecido fica como está.
export function preencher(modelo: string, v: Vars): string {
  return modelo.replace(/\{(\w+)\}/g, (inteiro, k: string) => (k in v ? (v as any)[k] : inteiro));
}

// Valores de {{1}}, {{2}}… na ordem configurada. O WhatsApp recusa parâmetro vazio, com quebra de
// linha ou tabulação: espaços são colapsados e vazio vira "-".
export function variaveisTemplate(v: Vars, parametros: Parametro[] = PARAMETROS_PADRAO): string[] {
  return parametros.map((p) => {
    const bruto = p.campo === "texto" ? p.texto ?? "" : v[p.campo];
    return String(bruto ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "-";
  });
}

// Botão recebido (id ou texto) → ação. Aceita o texto do botão do template e variações comuns.
// Sem acento, minúsculo, espaços colapsados.
export function normalizar(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function acaoDoBotao(recebido: unknown, sinonimos?: Partial<Record<Acao, string[]>>): Acao | null {
  const s = normalizar(recebido);
  if (!s) return null;
  if ((ACOES as string[]).includes(s)) return s as Acao;
  // Os sinônimos da clínica vêm antes: "sim, vou" pode ser configurado como confirmar.
  for (const a of ACOES) if (sinonimos?.[a]?.includes(s)) return a;
  if (/^(confirm|sim\b|1$)/.test(s)) return "confirmar";
  if (/^(remarc|reagend|2$)/.test(s)) return "remarcar";
  if (/^(cancel|desmarc|3$)/.test(s)) return "cancelar";
  return null;
}
