// Motor dos conectores: traduz uma chamada da especificação Kentro (GET /pacientes?cpf=…) para a rota do
// ERP descrita no conector, e a resposta do ERP de volta ao formato da especificação. Funções puras: quem
// faz a chamada HTTP é o adaptador Padrão Kentro (erp/padrao/adaptador.ts).
//
// Modelos: "{{fonte | filtro:arg | filtro}}". Na requisição, a fonte é path.id, query.cpf, corpo.data,
// corpo.paciente.nome ou cred.token. Na resposta, é $.caminho ($ = o item atual) ou $raiz.caminho. Uma
// string que é só um modelo mantém o tipo do valor (número, lista, objeto); com texto em volta, vira texto.

/* ---------- rotas da especificação ---------- */

export const ROTAS_ESPECIFICACAO = [
  "GET /status",
  "GET /pacientes",
  "POST /pacientes",
  "GET /pacientes/{id}",
  "GET /pacientes/{id}/agendamentos",
  "GET /especialidades",
  "GET /profissionais",
  "GET /procedimentos",
  "GET /grupos-procedimento",
  "GET /convenios",
  "GET /precos",
  "GET /profissionais/{id}/dias-disponiveis",
  "GET /profissionais/{id}/horarios-disponiveis",
  "GET /agenda",
  "POST /agendamentos",
  "POST /agendamentos/{id}/remarcar",
  "POST /agendamentos/{id}/cancelar",
  "POST /agendamentos/{id}/status",
  "GET /confirmacoes/pendentes",
  "POST /confirmacoes/enviadas",
  "GET /contas",
  "POST /contas",
] as const;
export type RotaEspecificacao = (typeof ROTAS_ESPECIFICACAO)[number];

const PADROES_ROTA = ROTAS_ESPECIFICACAO.map((chave) => {
  const [metodo, caminho] = chave.split(" ");
  const rx = new RegExp("^" + caminho.replace(/\{id\}/g, "([^/]+)") + "$");
  return { chave, metodo, rx };
});

// "GET", "/pacientes/8812/agendamentos" → { chave: "GET /pacientes/{id}/agendamentos", path: { id: "8812" } }
export function rotaDaEspecificacao(metodo: string, caminho: string): { chave: RotaEspecificacao; path: Record<string, string> } | null {
  for (const p of PADROES_ROTA) {
    if (p.metodo !== metodo) continue;
    const m = p.rx.exec(caminho);
    if (m) return { chave: p.chave, path: m[1] !== undefined ? { id: decodeURIComponent(m[1]) } : {} };
  }
  return null;
}

/* ---------- configuração ---------- */

export type TipoAutenticacao = "nenhuma" | "bearer" | "header" | "basic" | "query";

export interface CampoConector {
  chave: string; // nome do campo na credencial ({{cred.chave}})
  rotulo: string; // o que a clínica vê
  tipo: "texto" | "segredo" | "url";
  obrigatorio?: boolean;
  ajuda?: string;
}

export interface Regra {
  status?: number | number[];
  caminho?: string; // modelo de resposta, ex.: "{{$.message}}"
  contem?: string; // texto (sem diferença de maiúsculas) que o valor do caminho contém
  igual?: string | number | boolean;
}

export interface RotaConfig {
  metodo?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; // obrigatório, menos em rota `fixo`
  caminho?: string; // modelo, ex.: "/patient/{{path.id}}"; obrigatório, menos em rota `fixo`
  // Resposta fixa, sem chamar o ERP: para o que o ERP não tem e o ClinFy precisa de um valor certo
  // (ex.: só "Particular" nos convênios, ou "lembrete registrado" quando o ERP não guarda isso).
  fixo?: unknown;
  // Condição para a rota valer (mesmas regras de $se): falsa = a rota não existe para este pedido.
  // Ex.: ["{{corpo.status}}", "confirmado"] quando o ERP só confirma e não marca ausência.
  se?: unknown;
  query?: Record<string, string>;
  corpo?: unknown; // modelo JSON
  formato_corpo?: "json" | "form" | "query";
  resposta?: unknown; // mapa para o formato da especificação; ausente = a resposta passa como veio
}

export interface ConectorConfig {
  versao: 1;
  base_url: string; // fixo, ou "{{cred.base_url}}" quando cada clínica tem o seu endereço
  autenticacao: { tipo: TipoAutenticacao; campo?: string; header?: string; param?: string; usuario?: string; senha?: string };
  cabecalhos?: Record<string, string>; // modelos com {{cred.*}}
  idempotencia_header?: string | null; // padrão "Idempotency-Key"; null = o ERP não aceita
  campos: CampoConector[];
  // true = rota que o conector não descreve vai como está na especificação (o próprio padrão Kentro).
  // false = rota não descrita é rota que o ERP não tem.
  especificacao?: boolean;
  rotas: Partial<Record<RotaEspecificacao, RotaConfig>>;
  erros?: {
    credencial?: Regra[];
    nao_encontrado?: Regra[];
    recusa?: Regra[];
    mensagem?: string; // modelo da mensagem de erro, ex.: "{{$.error.message}}"
  };
}

/* ---------- caminhos e filtros ---------- */

function caminhoEm(obj: unknown, caminho: string): unknown {
  if (!caminho) return obj;
  const partes = caminho.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let atual: any = obj;
  for (const p of partes) {
    if (atual === null || atual === undefined) return undefined;
    atual = atual[p];
  }
  return atual;
}

const vazio = (v: unknown) => v === undefined || v === null || v === "";
const dois = (n: number | string) => String(n).padStart(2, "0");
// Hoje no fuso das clínicas (YYYY-MM-DD). Fonte `hoje` nos modelos.
export const hojeSp = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

// "2026-11-20" (ou ISO com hora) → formato com YYYY, MM, DD.
function formatarData(v: unknown, fmt: string): unknown {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  if (!m) return v;
  return fmt.replace("YYYY", m[1]).replace("MM", m[2]).replace("DD", m[3]);
}

// Texto no formato `fmt` (YYYY, MM, DD) → "YYYY-MM-DD".
function lerData(v: unknown, fmt: string): unknown {
  const s = String(v ?? "");
  const ordem: string[] = [];
  const rx = new RegExp(
    "^" + fmt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/YYYY|MM|DD/g, (t) => { ordem.push(t); return t === "YYYY" ? "(\\d{4})" : "(\\d{1,2})"; }),
  );
  const m = rx.exec(s);
  if (!m) return vazio(v) ? null : v;
  const val: Record<string, string> = {};
  ordem.forEach((t, i) => { val[t] = m[i + 1]; });
  return `${val.YYYY}-${dois(val.MM)}-${dois(val.DD)}`;
}

function aplicarFiltro(v: unknown, filtro: string): unknown {
  const i = filtro.indexOf(":");
  const nome = (i < 0 ? filtro : filtro.slice(0, i)).trim();
  const arg = i < 0 ? "" : filtro.slice(i + 1).trim();
  switch (nome) {
    case "data": return vazio(v) ? v : formatarData(v, arg || "YYYY-MM-DD");
    case "data_iso": return vazio(v) ? null : lerData(v, arg || "YYYY-MM-DD");
    case "hora": {
      const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v ?? ""));
      return m ? (arg || "HH:MM").replace("HH", dois(m[1])).replace("MM", m[2]).replace("SS", m[3] ?? "00") : v;
    }
    case "hora_curta": { const m = /(\d{1,2}):(\d{2})/.exec(String(v ?? "")); return m ? `${dois(m[1])}:${m[2]}` : null; }
    // "2026-11-20 | mais_dias:30" → "2026-12-20" (também aceita número negativo).
    case "mais_dias": {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ""));
      return m ? new Date(Date.parse(m[1] + "T12:00:00Z") + Number(arg || 0) * 864e5).toISOString().slice(0, 10) : v;
    }
    case "centavos": return vazio(v) ? v : Math.round(Number(String(v).replace(",", ".")) * 100);
    case "reais": return vazio(v) ? null : Number(v) / 100;
    case "digitos": return vazio(v) ? v : String(v).replace(/\D/g, "");
    case "sem_ddi": { const d = String(v ?? "").replace(/\D/g, ""); return (d.length === 12 || d.length === 13) && d.startsWith("55") ? d.slice(2) : d; }
    case "texto": return vazio(v) ? v : String(v);
    case "numero": return vazio(v) ? v : Number(v);
    case "minusculas": return vazio(v) ? v : String(v).toLowerCase();
    case "padrao": return vazio(v) ? arg : v;
    case "igual": return String(v ?? "") === arg;
    // "mapa:1=agendado,2=confirmado" (valor sem par fica como está)
    case "mapa": {
      for (const par of arg.split(",")) {
        const j = par.indexOf("=");
        if (j > 0 && par.slice(0, j).trim() === String(v ?? "")) return par.slice(j + 1).trim();
      }
      return v;
    }
    default: throw new Error(`filtro desconhecido: ${nome}`);
  }
}

const FILTROS = ["mais_dias", "data", "data_iso", "hora", "hora_curta", "centavos", "reais", "digitos", "sem_ddi", "texto", "numero", "minusculas", "padrao", "igual", "mapa"];

/* ---------- modelos ---------- */

const MODELO_INTEIRO = /^\{\{([^{}]+)\}\}$/;
const MODELO = /\{\{([^{}]+)\}\}/g;

type Resolver = (fonte: string) => unknown;

function avaliar(expr: string, resolver: Resolver): unknown {
  const [fonte, ...filtros] = expr.split("|").map((s) => s.trim());
  return filtros.reduce((v, f) => aplicarFiltro(v, f), resolver(fonte));
}

// Renderiza um modelo (string, lista ou objeto). Chave cujo valor fica vazio some do objeto.
function renderizarCom(modelo: unknown, resolver: Resolver): unknown {
  if (typeof modelo === "string") {
    const inteiro = MODELO_INTEIRO.exec(modelo);
    if (inteiro) return avaliar(inteiro[1], resolver);
    if (!modelo.includes("{{")) return modelo;
    return modelo.replace(MODELO, (_, e) => { const v = avaliar(e, resolver); return vazio(v) ? "" : String(v); });
  }
  if (Array.isArray(modelo)) return modelo.map((m) => renderizarCom(m, resolver));
  if (modelo && typeof modelo === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, m] of Object.entries(modelo)) {
      const v = renderizarCom(m, resolver);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return modelo;
}

export interface EntradaRota {
  path: Record<string, string>;
  query: Record<string, unknown>;
  corpo: unknown;
  cred: Record<string, unknown>;
}

const resolverRequisicao = (e: EntradaRota): Resolver => (fonte) => {
  if (fonte === "hoje") return hojeSp();
  const [raiz, ...resto] = fonte.split(".");
  const base = raiz === "path" ? e.path : raiz === "query" ? e.query : raiz === "corpo" ? e.corpo : raiz === "cred" ? e.cred : undefined;
  if (base === undefined) throw new Error(`fonte desconhecida no modelo: ${fonte}`);
  return caminhoEm(base, resto.join("."));
};

export function renderizarRequisicao(modelo: unknown, e: EntradaRota): unknown {
  return renderizarCom(modelo, resolverRequisicao(e));
}

// Condição de $se/$exceto/se: um modelo (vale se não for vazio, false, "false", "0" ou lista vazia), um par
// [a, b] (vale se a == b, como texto), ou uma lista de condições (todas precisam valer).
function condicao(c: unknown, resolver: Resolver): boolean {
  if (Array.isArray(c) && c.length === 2 && c.every((x) => typeof x === "string")) {
    return String(renderizarCom(c[0], resolver) ?? "") === String(renderizarCom(c[1], resolver) ?? "");
  }
  if (Array.isArray(c)) return c.every((x) => condicao(x, resolver));
  const v = renderizarCom(c, resolver);
  return !(vazio(v) || v === false || v === "false" || v === "0" || v === 0 || (Array.isArray(v) && !v.length));
}

export function condicaoDaRequisicao(c: unknown, e: EntradaRota): boolean {
  return condicao(c, resolverRequisicao(e));
}

// Mapa de resposta. {"$lista": "{{$.content}}", "$item": {...}} vira uma lista, com $ = cada item.
// "$se" e "$exceto" filtram os itens (ver condicao). `req` dá acesso ao pedido: {{$req.query.data}}, {{$req.path.id}}.
export function mapearResposta(mapa: unknown, corpo: unknown, req?: Partial<EntradaRota>): unknown {
  const andar = (m: unknown, atual: unknown): unknown => {
    const resolver: Resolver = (fonte) => {
      if (fonte === "$") return atual;
      if (fonte === "hoje") return hojeSp();
      if (fonte.startsWith("$raiz")) return caminhoEm(corpo, fonte.slice(5).replace(/^\./, ""));
      if (fonte.startsWith("$req.")) {
        const [raiz, ...resto] = fonte.slice(5).split(".");
        if (raiz !== "path" && raiz !== "query" && raiz !== "corpo") throw new Error(`fonte desconhecida na resposta: ${fonte}`);
        return caminhoEm(req?.[raiz], resto.join("."));
      }
      if (fonte.startsWith("$.")) return caminhoEm(atual, fonte.slice(2));
      throw new Error(`fonte desconhecida na resposta: ${fonte}`);
    };
    if (m && typeof m === "object" && !Array.isArray(m) && "$lista" in (m as object)) {
      const lista = renderizarCom((m as any).$lista, resolver);
      const itens = Array.isArray(lista) ? lista : lista && typeof lista === "object" ? Object.values(lista) : [];
      const se = (m as any).$se, exceto = (m as any).$exceto;
      const resolverDo = (item: unknown): Resolver => (fonte) => (fonte === "$" ? item : fonte.startsWith("$.") ? caminhoEm(item, fonte.slice(2)) : resolver(fonte));
      return itens
        .filter((item) => (se === undefined || condicao(se, resolverDo(item))) && (exceto === undefined || !exceto.some?.((x: unknown) => condicao(x, resolverDo(item)))))
        .map((item) => andar((m as any).$item ?? "{{$}}", item));
    }
    if (m && typeof m === "object" && !Array.isArray(m)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(m)) out[k] = andar(v, atual);
      return out;
    }
    if (Array.isArray(m)) return m.map((x) => andar(x, atual));
    return renderizarCom(m, resolver);
  };
  return andar(mapa, corpo);
}

/* ---------- requisição ---------- */

export interface Requisicao {
  metodo: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

// Monta a requisição ao ERP. `rota` ausente com `especificacao` ligada = a chamada vai como veio.
export function montarRequisicao(
  c: ConectorConfig,
  rota: RotaConfig | null,
  original: { metodo: string; caminho: string },
  e: EntradaRota,
  idempotencia?: string,
): Requisicao {
  const base = String(renderizarRequisicao(c.base_url, e) ?? "").replace(/\/+$/, "");
  const headers: Record<string, string> = { Accept: "application/json" };
  const qs = new URLSearchParams();

  const a = c.autenticacao;
  const campo = (k: string | undefined, padrao: string) => String(e.cred[k ?? padrao] ?? "");
  if (a.tipo === "bearer") headers.Authorization = `Bearer ${campo(a.campo, "token")}`;
  else if (a.tipo === "header") headers[a.header ?? "Authorization"] = campo(a.campo, "token");
  else if (a.tipo === "basic") headers.Authorization = "Basic " + Buffer.from(`${campo(a.usuario, "usuario")}:${campo(a.senha, "senha")}`, "utf8").toString("base64");
  else if (a.tipo === "query") qs.append(a.param ?? "token", campo(a.campo, "token"));
  for (const [k, m] of Object.entries(c.cabecalhos ?? {})) {
    const v = renderizarRequisicao(m, e);
    if (!vazio(v)) headers[k] = String(v);
  }
  const chaveIdem = c.idempotencia_header === undefined ? "Idempotency-Key" : c.idempotencia_header;
  if (idempotencia && chaveIdem) headers[chaveIdem] = idempotencia;

  const acrescentar = (obj: unknown) => {
    for (const [k, v] of Object.entries((obj as Record<string, unknown>) ?? {})) {
      if (vazio(v)) continue;
      if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
      else qs.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
  };

  let metodo = original.metodo;
  let caminho = original.caminho;
  let body: string | undefined;
  if (rota) {
    metodo = rota.metodo ?? metodo;
    caminho = String(renderizarRequisicao(rota.caminho ?? caminho, e) ?? "");
    acrescentar(renderizarRequisicao(rota.query ?? {}, e));
    if (rota.corpo !== undefined) {
      const corpo = renderizarRequisicao(rota.corpo, e);
      const formato = rota.formato_corpo ?? "json";
      if (formato === "query") acrescentar(corpo);
      else if (formato === "form") {
        const f = new URLSearchParams();
        for (const [k, v] of Object.entries((corpo as Record<string, unknown>) ?? {})) if (!vazio(v)) f.append(k, String(v));
        body = f.toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      } else {
        body = JSON.stringify(corpo);
        headers["Content-Type"] = "application/json";
      }
    }
  } else {
    acrescentar(e.query);
    if (e.corpo !== undefined) {
      body = JSON.stringify(e.corpo);
      headers["Content-Type"] = "application/json";
    }
  }
  return { metodo, url: `${base}${caminho}${qs.size ? "?" + qs.toString() : ""}`, headers, ...(body !== undefined ? { body } : {}) };
}

/* ---------- erros ---------- */

export type TipoErro = "credencial" | "nao_encontrado" | "recusa";

function bate(r: Regra, status: number, corpo: unknown): boolean {
  if (r.status !== undefined && !(Array.isArray(r.status) ? r.status : [r.status]).includes(status)) return false;
  if (r.caminho) {
    const v = mapearResposta(r.caminho, corpo);
    if (r.igual !== undefined && v !== r.igual && String(v) !== String(r.igual)) return false;
    if (r.contem !== undefined && !String(v ?? "").toLowerCase().includes(r.contem.toLowerCase())) return false;
    if (r.igual === undefined && r.contem === undefined && vazio(v)) return false;
  }
  return true;
}

// Regras do conector, na ordem credencial → não encontrado → recusa. null = nenhuma bateu (vale o código HTTP).
export function classificarErro(c: ConectorConfig, status: number, corpo: unknown): TipoErro | null {
  const e = c.erros ?? {};
  if ((e.credencial ?? []).some((r) => bate(r, status, corpo))) return "credencial";
  if ((e.nao_encontrado ?? []).some((r) => bate(r, status, corpo))) return "nao_encontrado";
  if ((e.recusa ?? []).some((r) => bate(r, status, corpo))) return "recusa";
  return null;
}

export function mensagemDeErro(c: ConectorConfig, corpo: unknown): string | undefined {
  if (!c.erros?.mensagem) return undefined;
  const v = mapearResposta(c.erros.mensagem, corpo);
  return vazio(v) ? undefined : String(v).slice(0, 400);
}

/* ---------- validação ---------- */

const TIPOS_AUT: TipoAutenticacao[] = ["nenhuma", "bearer", "header", "basic", "query"];
const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

// Confere a forma da configuração e os filtros usados. Devolve a lista de problemas (vazia = ok).
export function validarConector(bruto: unknown): { ok: true; conector: ConectorConfig } | { ok: false; erros: string[] } {
  const erros: string[] = [];
  const c = bruto as ConectorConfig;
  if (!c || typeof c !== "object") return { ok: false, erros: ["a configuração precisa ser um objeto JSON"] };
  if (c.versao !== 1) erros.push("versao precisa ser 1");
  if (typeof c.base_url !== "string" || !c.base_url) erros.push("base_url é obrigatório");
  if (!c.autenticacao || !TIPOS_AUT.includes(c.autenticacao.tipo)) erros.push(`autenticacao.tipo: use ${TIPOS_AUT.join(", ")}`);
  if (!Array.isArray(c.campos)) erros.push("campos precisa ser uma lista");
  else c.campos.forEach((f, i) => {
    if (!f || !/^[a-z][a-z0-9_]{0,39}$/.test(String(f.chave))) erros.push(`campos[${i}].chave: letras minúsculas, dígitos e _`);
    if (!f?.rotulo) erros.push(`campos[${i}].rotulo é obrigatório`);
    if (!["texto", "segredo", "url"].includes(String(f?.tipo))) erros.push(`campos[${i}].tipo: texto, segredo ou url`);
  });
  if (!c.rotas || typeof c.rotas !== "object") erros.push("rotas precisa ser um objeto");
  else for (const [chave, r] of Object.entries(c.rotas)) {
    if (!(ROTAS_ESPECIFICACAO as readonly string[]).includes(chave)) { erros.push(`rota desconhecida: ${chave}`); continue; }
    if (r && r.fixo !== undefined) continue;
    if (!r || !METODOS.includes(String(r.metodo))) erros.push(`${chave}: metodo inválido`);
    if (typeof r?.caminho !== "string" || !r.caminho.startsWith("/")) erros.push(`${chave}: caminho precisa começar com /`);
    if (r?.formato_corpo && !["json", "form", "query"].includes(r.formato_corpo)) erros.push(`${chave}: formato_corpo inválido`);
  }
  // Filtros usados em qualquer modelo precisam existir.
  const texto = JSON.stringify(c);
  for (const m of texto.matchAll(/\{\{([^{}]+)\}\}/g)) {
    for (const f of m[1].split("|").slice(1)) {
      const nome = f.split(":")[0].trim();
      if (!FILTROS.includes(nome)) erros.push(`filtro desconhecido: ${nome}`);
    }
  }
  return erros.length ? { ok: false, erros: [...new Set(erros)] } : { ok: true, conector: c };
}

// O conector do próprio padrão Kentro: nada a traduzir, token Bearer, endereço de cada clínica.
export const CONECTOR_PADRAO: ConectorConfig = {
  versao: 1,
  base_url: "{{cred.base_url}}",
  autenticacao: { tipo: "bearer", campo: "token" },
  campos: [
    { chave: "base_url", rotulo: "Endereço da API", tipo: "url", obrigatorio: true, ajuda: "Ex.: https://erp.exemplo.com/api/v1" },
    { chave: "token", rotulo: "Token", tipo: "segredo", obrigatorio: true },
  ],
  especificacao: true,
  rotas: {},
};
