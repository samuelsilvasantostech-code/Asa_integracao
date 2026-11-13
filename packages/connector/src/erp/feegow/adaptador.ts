// Adaptador da Feegow (API REST v1, https://docs.feegow.com). Em código, e não por configuração, porque:
// - os horários livres vêm por especialidade (ou procedimento), num objeto aninhado
//   profissional → local → data → horários;
// - a marcação pede especialidade, local, procedimento e valor em centavos, que a vaga carrega no agenda_id.
// Autenticação: header x-access-token (gerado pelo usuário master da licença). Respostas {success, content};
// erros 401/403 (chave), 409 (conflito: "não encontrado", "horário ocupado"), 422 (validação).
import { config } from "../../config.js";
import { telefoneKentro } from "../../confirmacao.js";
import type { BuscaPaciente, ErpAdapter, FalhaErp, PedidoConta, PedidoMarcacao, Resultado, StatusConsulta, Vaga } from "../adaptador.js";
import type { LogErp } from "../asa/adaptador.js";
import type { Capacidades } from "../capacidades.js";
import type { Agendado, Consulta, ConsultaD1, Convenio, ConvenioValor, Exame, Horario, Paciente, Prestador, PrestadorDoExame, Procedimento } from "../modelo.js";

export interface CredencialFeegow {
  token: string;
  unidade_id?: string; // vazio = todas as unidades; "0" = matriz
}

const BASE = "https://api.feegow.com/v1/api";
const USER_AGENT = `Kentro-ClinFy-Connector/${config.version}`;
const TEMPO_LEITURA_MS = 15000;
const DIAS_A_FRENTE = 30;
const DIAS_CONSULTAS_FUTURAS = 180;
const MAX_BUSCAS_PACIENTE = 40;
// Vaga: "fg:<local_id>:<especialidade_id>". Vai e volta pelo painel sem que ele precise entender.
const PREFIXO_VAGA = "fg:";

// Status da Feegow (GET /appoints/status). Os que tiram a consulta da lista de futuras e da confirmação.
const STATUS: Record<number, string> = {
  1: "marcado - não confirmado", 2: "em atendimento", 3: "atendido", 4: "aguardando", 5: "chamando", 6: "não compareceu",
  7: "marcado - confirmado", 11: "desmarcado pelo paciente", 15: "remarcado", 16: "desmarcado pelo profissional",
  101: "aguardando triagem", 103: "em triagem", 105: "chamando triagem",
};
const STATUS_FORA = new Set([3, 6, 11, 15, 16]);
const STATUS_CONFIRMADO = 7;
const STATUS_AUSENTE = 6;
const MOTIVO_PACIENTE = 1; // "Solicitado pelo paciente" (GET /appoints/motives)
const TIPO_CONSULTA = 2;
const TIPO_EXAME = 3;
const PARTICULAR = "0";

type Params = Record<string, string | number | boolean | undefined | null>;

const texto = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const hojeSp = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const somarDias = (data: string, n: number) => new Date(Date.parse(data + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
// "2026-11-20" → "20-11-2026" (o formato que a Feegow pede nas datas de agenda).
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
// "20-11-2026", "2026-11-20" ou "2026-11-20 10:00:00" → "2026-11-20".
function iso(v: unknown): string | null {
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})[-/](\d{2})[-/](\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
const hhmm = (v: unknown) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? "").trim()); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null; };
const lista = (v: unknown): any[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
// Primeiro telefone com DDD (10 ou 11 dígitos) de uma ou mais listas.
function telefoneDe(...fontes: unknown[]): string | null {
  for (const f of fontes) for (const t of Array.isArray(f) ? f : [f]) {
    const d = digitos(t);
    if (d.length === 10 || d.length === 11) return d;
    if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d.slice(2);
  }
  return null;
}

export function vagaFeegow(local: string, especialidade: string) {
  return `${PREFIXO_VAGA}${local}:${especialidade}`;
}
export function lerVaga(agendaId: string): { local: string; especialidade: string } | null {
  const m = /^fg:(\d+):(\d+)$/.exec(agendaId);
  return m ? { local: m[1], especialidade: m[2] } : null;
}

// content.profissional_id[id].local_id → [{local, data, horarios}]. local_id vem como objeto {local: {data: [...]}}
// ou, quando só há o local 0, como lista [{data: [...]}] (o índice é o id do local).
export function horariosDaResposta(content: any, profissionalId: string): Array<{ local: string; data: string; horarios: string[] }> {
  const prof = content?.profissional_id?.[profissionalId];
  const out: Array<{ local: string; data: string; horarios: string[] }> = [];
  if (!prof || typeof prof !== "object") return out;
  for (const [local, porData] of Object.entries(prof.local_id ?? {})) {
    if (!porData || typeof porData !== "object") continue;
    for (const [data, hs] of Object.entries(porData as Record<string, unknown>)) {
      const d = iso(data);
      const horarios = (Array.isArray(hs) ? hs : []).map(hhmm).filter((h): h is string => !!h);
      if (d && horarios.length) out.push({ local, data: d, horarios });
    }
  }
  return out;
}

function falha(erro: string, status: number, extra: Partial<FalhaErp> = {}): FalhaErp {
  return { ok: false, erro, status, naoEncontrado: false, credencialInvalida: false, semResposta: false, recusa: false, ...extra };
}

export class FeegowAdapter implements ErpAdapter {
  readonly erp = "feegow";
  private profissionais: Promise<Resultado<any[]>> | null = null;
  private especialidades: Promise<Resultado<any[]>> | null = null;
  private pacientes = new Map<string, Promise<any | null>>();
  private procedimentos = new Map<string, Promise<any | null>>();

  constructor(private readonly cred: CredencialFeegow, private readonly log: LogErp) {}

  private get unidade(): string | undefined {
    const u = texto(this.cred.unidade_id);
    return u && /^\d+$/.test(u) ? u : undefined;
  }

  /* ---------- HTTP ---------- */
  private async chamar<T = any>(metodo: "GET" | "POST", caminho: string, opcoes: { params?: Params; corpo?: unknown; timeoutMs?: number } = {}): Promise<Resultado<T>> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opcoes.params ?? {})) if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
    const url = `${BASE}${caminho}${qs.size ? "?" + qs.toString() : ""}`;
    const headers: Record<string, string> = { Accept: "application/json", "x-access-token": this.cred.token, "User-Agent": USER_AGENT };
    if (opcoes.corpo !== undefined) headers["Content-Type"] = "application/json";
    const inicio = Date.now();
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: metodo,
        headers,
        body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
        signal: AbortSignal.timeout(opcoes.timeoutMs ?? TEMPO_LEITURA_MS),
        redirect: "error",
      });
    } catch (err: any) {
      const causa = err?.cause?.code ?? err?.cause?.name ?? "";
      return falha("ERP_FORA_DO_AR", 0, { semResposta: true, msg: `${err?.name ?? "erro"}${causa ? " " + causa : ""} em ${Date.now() - inicio} ms` });
    }
    const bruto = await resp.text();
    let corpo: any = null;
    try { corpo = bruto ? JSON.parse(bruto) : null; } catch { /* não é JSON */ }

    // Mensagem da Feegow: content em texto (409) ou os campos da validação (422).
    const msg = typeof corpo?.content === "string"
      ? corpo.content.slice(0, 400)
      : resp.status === 422 && corpo && typeof corpo === "object"
        ? Object.entries(corpo).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("; ").slice(0, 400)
        : undefined;

    if (resp.status === 401 || resp.status === 403) return falha("ERP_CREDENCIAL_INVALIDA", resp.status, { credencialInvalida: true, msg });
    if (resp.status >= 500 || resp.status === 429) return falha("ERP_FORA_DO_AR", resp.status, { msg });
    const naoAchou = /n[ãa]o (encontrad|exist)/i.test(msg ?? "");
    if (resp.status === 404 || (resp.status === 409 && naoAchou)) return falha("ERP_NAO_ENCONTRADO", resp.status, { naoEncontrado: true, msg });
    if (!resp.ok) return falha("ERP_RECUSOU", resp.status, { recusa: true, msg, codigoErp: /ocupad/i.test(msg ?? "") ? "HORARIO_OCUPADO" : undefined });
    if (corpo === null) return falha("ERP_RESPOSTA_INVALIDA", resp.status);
    if (corpo.success === false) return naoAchou ? falha("ERP_NAO_ENCONTRADO", resp.status, { naoEncontrado: true, msg }) : falha("ERP_RECUSOU", resp.status, { recusa: true, msg });
    return { ok: true, dados: (corpo.content ?? corpo) as T };
  }

  private async ler<T, R>(r: Promise<Resultado<T>>, f: (d: T) => R): Promise<Resultado<R>> {
    const x = await r;
    return x.ok ? { ok: true, dados: f(x.dados) } : x;
  }

  /* ---------- catálogos com cache (o adaptador vive uma requisição) ---------- */
  private listaProfissionais() {
    this.profissionais ??= this.ler(this.chamar("GET", "/professional/list", { params: { ativo: 1, unidade_id: this.unidade } }), lista);
    return this.profissionais;
  }
  private listaEspecialidades() {
    this.especialidades ??= this.ler(this.chamar("GET", "/specialties/list", { params: { unidade_id: this.unidade } }), lista);
    return this.especialidades;
  }
  private async profissional(id: string): Promise<any | null> {
    const r = await this.listaProfissionais();
    return r.ok ? r.dados.find((p) => String(p?.profissional_id) === String(id)) ?? null : null;
  }
  private nomeProfissional(p: any): string | null {
    return texto(p?.nome) ?? texto(p?.tratamento);
  }
  private async especialidadeDe(profissionalId: string): Promise<string | null> {
    const p = await this.profissional(profissionalId);
    const e = lista(p?.especialidades)[0];
    return e?.especialidade_id == null ? null : String(e.especialidade_id);
  }
  private async nomeEspecialidade(id: unknown): Promise<string | null> {
    if (id == null) return null;
    const r = await this.listaEspecialidades();
    return r.ok ? texto(r.dados.find((e) => String(e?.especialidade_id) === String(id))?.nome) : null;
  }
  // Paciente por id (para nome e telefone na agenda e na confirmação). null se não achar.
  private pacientePorId(id: string): Promise<any | null> {
    if (!this.pacientes.has(id)) {
      this.pacientes.set(id, this.chamar("GET", "/patient/search", { params: { paciente_id: id } }).then((r) => (r.ok ? r.dados : null)));
    }
    return this.pacientes.get(id)!;
  }
  // Procedimento por id (nome, valor em centavos, especialidades). null se não achar.
  private procedimento(id: string, extra: Params = {}): Promise<any | null> {
    const chave = id + JSON.stringify(extra);
    if (!this.procedimentos.has(chave)) {
      this.procedimentos.set(chave, this.chamar("GET", "/procedures/list", { params: { procedimento_id: id, unidade_id: this.unidade, ...extra } })
        .then((r) => (r.ok ? lista(r.dados)[0] ?? null : null)));
    }
    return this.procedimentos.get(chave)!;
  }

  private pacienteDo(p: any): Paciente | null {
    const nome = texto(p?.nome);
    if (!nome) return null;
    const id = p.id ?? p.patient_id ?? p.paciente_id;
    return {
      id: id == null ? null : String(id),
      nome,
      nascimento: iso(p.nascimento),
      telefone: telefoneDe(p.celulares, p.celular, p.telefones, p.telefone),
      cpf: texto(digitos(p.documentos?.cpf ?? p.cpf)) ?? null,
    };
  }

  /* ---------- ErpAdapter ---------- */
  testarConexao() {
    return this.ler(this.listaProfissionais(), (l) => ({ prestadores: l.length }));
  }

  async detectarCapacidades(): Promise<Capacidades> {
    // Confirmação: lista consultas por data e status, e grava confirmado/cancelado. Financeiro e grupos ficam
    // para depois (a API tem, mas o mapeamento ainda não foi feito).
    return { financeiro: false, confirmacao: true, grupos_exames: false };
  }

  async buscarPaciente(busca: BuscaPaciente): Promise<Resultado<Paciente | null>> {
    if ("cpf" in busca) {
      const r = await this.chamar("GET", "/patient/search", { params: { paciente_cpf: digitos(busca.cpf) } });
      if (!r.ok) return r.naoEncontrado ? { ok: true, dados: null } : r;
      return { ok: true, dados: this.pacienteDo(r.dados) };
    }
    const r = await this.chamar("GET", "/patient/list", { params: { telefone: digitos(busca.telefone), limit: 5 } });
    if (!r.ok) return r.naoEncontrado ? { ok: true, dados: null } : r;
    const achados = lista(r.dados);
    if (achados.length > 1) this.log.info({ achados: achados.length }, "feegow: busca por telefone com mais de um paciente; usado o primeiro");
    return { ok: true, dados: achados.length ? this.pacienteDo(achados[0]) : null };
  }

  async consultasFuturas(busca: BuscaPaciente): Promise<Resultado<{ consultas: Consulta[]; cpf: string | null }>> {
    const rp = await this.buscarPaciente(busca);
    if (!rp.ok) return rp;
    if (!rp.dados?.id) return { ok: true, dados: { consultas: [], cpf: null } };
    const hoje = hojeSp();
    const r = await this.chamar("GET", "/appoints/search", { params: { paciente_id: rp.dados.id, data_start: dmy(hoje), data_end: dmy(somarDias(hoje, DIAS_CONSULTAS_FUTURAS)) } });
    if (!r.ok) return r.naoEncontrado ? { ok: true, dados: { consultas: [], cpf: rp.dados.cpf } } : r;
    const itens = lista(r.dados).filter((a) => a?.agendamento_id != null && !STATUS_FORA.has(Number(a.status_id)));
    const consultas = await Promise.all(itens.map(async (a): Promise<Consulta> => {
      const [prof, proc] = await Promise.all([this.profissional(String(a.profissional_id)), a.procedimento_id ? this.procedimento(String(a.procedimento_id)) : null]);
      return { id: String(a.agendamento_id), data: iso(a.data), hora: hhmm(a.horario), prestador: this.nomeProfissional(prof), procedimentos: proc?.nome ? [String(proc.nome)] : [] };
    }));
    consultas.sort((x, y) => `${x.data}${x.hora}`.localeCompare(`${y.data}${y.hora}`));
    return { ok: true, dados: { consultas, cpf: rp.dados.cpf } };
  }

  async especialidadesEPrestadores() {
    const [re, rp] = await Promise.all([this.listaEspecialidades(), this.listaProfissionais()]);
    if (!re.ok) return re;
    if (!rp.ok) return rp;
    const nomes = new Map(re.dados.map((e) => [String(e.especialidade_id), texto(e.nome)]));
    return {
      ok: true as const,
      dados: {
        especialidades: re.dados.filter((e) => e?.especialidade_id != null && texto(e.nome)).map((e) => ({ id: String(e.especialidade_id), nome: String(e.nome) })),
        prestadores: rp.dados.filter((p) => p?.profissional_id != null).map((p): Prestador => {
          const esp = lista(p.especialidades)[0];
          const espId = esp?.especialidade_id == null ? null : String(esp.especialidade_id);
          return {
            id: String(p.profissional_id),
            nome: this.nomeProfissional(p) ?? `Profissional ${p.profissional_id}`,
            especialidade_id: espId,
            especialidade: texto(esp?.nome_especialidade) ?? (espId ? nomes.get(espId) ?? null : null),
            ordem_chegada: false,
          };
        }),
      },
    };
  }

  // Horários livres do profissional num período, pela especialidade dele (a Feegow não busca por profissional só).
  private async agendaLivre(prestadorId: string, de: string, ate: string) {
    const esp = await this.especialidadeDe(prestadorId);
    if (!esp) return { ok: true as const, dados: { esp: null as string | null, itens: [] as ReturnType<typeof horariosDaResposta> } };
    const r = await this.chamar("GET", "/appoints/available-schedule", {
      params: { tipo: "E", especialidade_id: esp, profissional_id: prestadorId, unidade_id: this.unidade, data_start: dmy(de), data_end: dmy(ate) },
    });
    if (!r.ok) return r.naoEncontrado ? { ok: true as const, dados: { esp, itens: [] } } : r;
    return { ok: true as const, dados: { esp, itens: horariosDaResposta(r.dados, prestadorId) } };
  }

  async diasDisponiveis(prestadorId: string): Promise<Resultado<string[]>> {
    const de = hojeSp();
    const r = await this.agendaLivre(prestadorId, de, somarDias(de, DIAS_A_FRENTE));
    if (!r.ok) return r;
    return { ok: true, dados: [...new Set(r.dados.itens.map((i) => i.data))].sort() };
  }

  async horariosLivres(prestadorId: string, data: string): Promise<Resultado<Horario[]>> {
    const r = await this.agendaLivre(prestadorId, data, data);
    if (!r.ok) return r;
    const porHora = new Map<string, Horario>();
    for (const i of r.dados.itens) {
      if (i.data !== data) continue;
      for (const h of i.horarios) if (!porHora.has(h)) porHora.set(h, { horario: h, agenda_id: vagaFeegow(i.local, r.dados.esp!) });
    }
    return { ok: true, dados: [...porHora.values()].sort((a, b) => a.horario.localeCompare(b.horario)) };
  }

  async agendaDoDia(prestadorId: string, data: string): Promise<Resultado<Agendado[]>> {
    const r = await this.chamar("GET", "/appoints/search", { params: { profissional_id: prestadorId, data_start: dmy(data), data_end: dmy(data), unidade_id: this.unidade } });
    if (!r.ok) return r.naoEncontrado ? { ok: true, dados: [] } : r;
    const itens = lista(r.dados).filter((a) => a?.agendamento_id != null);
    const comPaciente = itens.slice(0, MAX_BUSCAS_PACIENTE);
    const pacientes = await Promise.all(comPaciente.map((a) => (a.paciente_id ? this.pacientePorId(String(a.paciente_id)) : null)));
    const procs = await Promise.all(itens.map((a) => (a.procedimento_id ? this.procedimento(String(a.procedimento_id)) : null)));
    return {
      ok: true,
      dados: itens.map((a, i): Agendado => {
        const p = pacientes[i] ?? null;
        return {
          id: String(a.agendamento_id),
          hora: hhmm(a.horario),
          status: STATUS[Number(a.status_id)] ?? (a.status_id == null ? null : String(a.status_id)),
          paciente: { id: a.paciente_id == null ? null : String(a.paciente_id), nome: texto(p?.nome), telefone: p ? telefoneDe(p.celulares, p.telefones) : null, idade: null, etiqueta: null },
          procedimentos: procs[i]?.nome ? [String(procs[i].nome)] : [],
          obs: texto(a.notas),
        };
      }).sort((x, y) => (x.hora ?? "").localeCompare(y.hora ?? "")),
    };
  }

  // Convênios que o profissional aceita, com "Particular" (id 0) primeiro.
  async conveniosDaVaga(vaga: Vaga): Promise<Resultado<Convenio[]>> {
    const r = await this.chamar("GET", "/professional/insurance", { params: { profissional_id: vaga.prestador_id } });
    const aceitos = r.ok ? lista(r.dados) : [];
    if (!r.ok && !r.naoEncontrado) return r;
    const vistos = new Set<string>();
    const convenios = aceitos
      .filter((c) => c?.convenio_id != null && texto(c.nome))
      .map((c) => ({ id: String(c.convenio_id), nome: String(c.nome) }))
      .filter((c) => (vistos.has(c.id) ? false : (vistos.add(c.id), true)));
    return { ok: true, dados: [{ id: PARTICULAR, nome: "Particular" }, ...convenios] };
  }

  // Consultas do profissional na especialidade da vaga. Valor só no particular (no convênio, a Feegow pede 0).
  async procedimentosDaVaga(vaga: Vaga, convenioId: string): Promise<Resultado<Procedimento[]>> {
    const esp = lerVaga(vaga.agenda_id)?.especialidade ?? (await this.especialidadeDe(vaga.prestador_id));
    const r = await this.chamar("GET", "/procedures/list", {
      params: { tipo_procedimento: TIPO_CONSULTA, especialidade_id: esp ?? undefined, profissional_id: vaga.prestador_id, unidade_id: this.unidade },
    });
    if (!r.ok) return r.naoEncontrado ? { ok: true, dados: [] } : r;
    return {
      ok: true,
      dados: lista(r.dados).filter((p) => p?.procedimento_id != null && texto(p.nome)).map((p) => ({
        id: String(p.procedimento_id),
        nome: String(p.nome),
        valor: convenioId === PARTICULAR && typeof p.valor === "number" ? p.valor / 100 : null,
        procedimento_id: String(p.procedimento_id),
      })),
    };
  }

  // A Feegow não pagina a lista de procedimentos: tudo vem na página 1.
  async examesPagina(pagina: number, busca?: string): Promise<Resultado<{ exames: Exame[]; ultima: boolean }>> {
    if (pagina > 1) return { ok: true, dados: { exames: [], ultima: true } };
    const r = await this.chamar("GET", "/procedures/list", { params: { tipo_procedimento: TIPO_EXAME, unidade_id: this.unidade, nome_procedimento: texto(busca) ?? undefined } });
    if (!r.ok) return r.naoEncontrado ? { ok: true, dados: { exames: [], ultima: true } } : r;
    return {
      ok: true,
      dados: {
        exames: lista(r.dados).filter((p) => p?.procedimento_id != null && texto(p.nome)).map((p) => ({ id: String(p.procedimento_id), nome: String(p.nome), tipo: "exame" })),
        ultima: true,
      },
    };
  }

  async gruposExames() {
    return { ok: true as const, dados: [] };
  }
  async examesDoGrupo() {
    return { ok: true as const, dados: [] as Exame[] };
  }

  async conveniosDoExame(exameId: string): Promise<Resultado<ConvenioValor[]>> {
    const [r, proc] = await Promise.all([this.chamar("GET", "/insurance/list", { params: { unidade_id: this.unidade } }), this.procedimento(exameId)]);
    if (!r.ok && !r.naoEncontrado) return r;
    const vistos = new Set<string>();
    const convenios = (r.ok ? lista(r.dados) : [])
      .filter((c) => c?.convenio_id != null && texto(c.nome))
      .map((c) => ({ id: String(c.convenio_id), nome: String(c.nome), valor: null }))
      .filter((c) => (vistos.has(c.id) ? false : (vistos.add(c.id), true)));
    const particular = { id: PARTICULAR, nome: "Particular", valor: typeof proc?.valor === "number" ? proc.valor / 100 : null };
    return { ok: true, dados: [particular, ...convenios] };
  }

  // Profissionais de alguma especialidade do exame (a Feegow liga procedimento a especialidades).
  async prestadoresDoExame(exameId: string, convenioId?: string): Promise<Resultado<PrestadorDoExame[]>> {
    const [proc, rp] = await Promise.all([this.procedimento(exameId), this.listaProfissionais()]);
    if (!rp.ok) return rp;
    const esps = new Set(lista(proc?.especialidade_id).map(String));
    const valor = (!convenioId || convenioId === PARTICULAR) && typeof proc?.valor === "number" ? proc.valor / 100 : null;
    return {
      ok: true,
      dados: rp.dados
        .filter((p) => p?.profissional_id != null && (!esps.size || lista(p.especialidades).some((e) => esps.has(String(e?.especialidade_id)))))
        .map((p) => ({
          id: String(p.profissional_id),
          nome: this.nomeProfissional(p) ?? `Profissional ${p.profissional_id}`,
          especialidade: texto(lista(p.especialidades)[0]?.nome_especialidade),
          ordem_chegada: false,
          valor,
        })),
    };
  }

  // Marcar: paciente novo é cadastrado antes (a Feegow devolve o id existente se o CPF e o nascimento já
  // estiverem cadastrados). Remarcar no mesmo profissional usa /appoints/reschedule; com outro profissional,
  // marca a nova e desmarca a antiga.
  async marcar(p: PedidoMarcacao, timeoutMs: number) {
    const vaga = lerVaga(p.vaga.agenda_id);
    const especialidade = vaga?.especialidade ?? (await this.especialidadeDe(p.vaga.prestador_id));
    if (!especialidade) return falha("ERP_RECUSOU", 422, { recusa: true, msg: "o profissional não tem especialidade cadastrada na Feegow" });
    const horario = `${p.vaga.horario}:00`;

    let pacienteId: string;
    let telefone: string;
    let planoConvenio = 0;
    if ("paciente_id" in p.paciente) {
      pacienteId = p.paciente.paciente_id;
      telefone = p.paciente.telefone;
      if (p.convenio_id !== PARTICULAR) {
        const cad = await this.pacientePorId(pacienteId);
        const conv = lista(cad?.convenios).find((c) => String(c?.convenio_id) === p.convenio_id);
        planoConvenio = Number(conv?.plano_id) || 0;
      }
    } else {
      const novo = p.paciente;
      const r = await this.chamar("POST", "/patient/create", {
        corpo: { nome_completo: novo.nome, cpf: digitos(novo.cpf), data_nascimento: novo.nascimento, celular: novo.telefone, celular1: novo.telefone },
        timeoutMs,
      });
      if (!r.ok) return r;
      pacienteId = String((r.dados as any)?.paciente_id ?? "");
      telefone = novo.telefone;
      if (!pacienteId) return falha("ERP_RESPOSTA_INVALIDA", 200, { msg: "cadastro de paciente sem id" });
    }

    if (p.remarcar) {
      const orig = await this.chamar("GET", "/appoints/search", { params: { agendamento_id: p.remarcar } });
      if (!orig.ok) return orig;
      const original = lista(orig.dados)[0];
      if (original && String(original.profissional_id) === String(p.vaga.prestador_id)) {
        const r = await this.chamar("POST", "/appoints/reschedule", {
          corpo: { agendamento_id: Number(p.remarcar), motivo_id: MOTIVO_PACIENTE, data: dmy(p.vaga.data), horario, obs: p.obs ?? "Remarcado pela Kentro (ClinFy)" },
          timeoutMs,
        });
        if (!r.ok) return r;
        return this.feito(p.remarcar, pacienteId, especialidade, original, r.dados);
      }
    }

    const particular = p.convenio_id === PARTICULAR;
    let valor = 0;
    if (particular) {
      const proc = await this.procedimento(p.procedimento_id, { profissional_id: p.vaga.prestador_id, especialidade_id: especialidade });
      valor = typeof proc?.valor === "number" ? proc.valor : 0;
    }
    const r = await this.chamar("POST", "/appoints/new-appoint", {
      corpo: {
        local_id: Number(vaga?.local ?? 0),
        paciente_id: Number(pacienteId),
        profissional_id: Number(p.vaga.prestador_id),
        especialidade_id: Number(especialidade),
        procedimento_id: Number(p.procedimento_id),
        data: dmy(p.vaga.data),
        horario,
        valor,
        plano: particular ? 0 : 1,
        ...(particular ? {} : { convenio_id: Number(p.convenio_id), convenio_plano_id: planoConvenio }),
        notas: p.obs ?? undefined,
        celular: telefone,
      },
      timeoutMs,
    });
    if (!r.ok) return r;
    const novoId = (r.dados as any)?.agendamento_id;
    if (p.remarcar && novoId != null) {
      // Remarcação com outro profissional: a nova foi marcada; a antiga sai.
      const c = await this.chamar("POST", "/appoints/cancel-appoint", { corpo: { agendamento_id: Number(p.remarcar), motivo_id: MOTIVO_PACIENTE, obs: `Remarcado para ${novoId} pela Kentro (ClinFy)` } });
      if (!c.ok) this.log.warn({ original: p.remarcar, novo: novoId, erro: c.erro }, "feegow: remarcação marcou a nova, mas não desmarcou a antiga");
    }
    return this.feito(novoId == null ? null : String(novoId), pacienteId, especialidade, null, r.dados);
  }

  private async feito(id: string | null, pacienteId: string, especialidade: string, original: any, dados: unknown) {
    return {
      ok: true as const,
      dados: {
        feito: { agendamento_id: id, paciente_id: pacienteId, setor: await this.nomeEspecialidade(especialidade), clinica: texto(original?.nome_fantasia), endereco: null },
        diagnostico: { chaves: dados && typeof dados === "object" ? Object.keys(dados as object) : typeof dados, msg: typeof dados === "string" ? dados : "" },
      },
    };
  }

  async mudarStatus(agendamentoId: string, status: StatusConsulta): Promise<Resultado<unknown>> {
    if (status === "remarcar") return { ok: true, dados: null }; // a conversa vai para um atendente
    if (status === "cancelado") {
      return this.chamar("POST", "/appoints/cancel-appoint", { corpo: { agendamento_id: Number(agendamentoId), motivo_id: MOTIVO_PACIENTE, obs: "Cancelado pelo paciente (confirmação ClinFy)" } });
    }
    return this.chamar("POST", "/appoints/statusUpdate", {
      corpo: { AgendamentoID: Number(agendamentoId), StatusID: status === "confirmado" ? STATUS_CONFIRMADO : STATUS_AUSENTE, Obs: status === "confirmado" ? "Confirmado pelo paciente (ClinFy)" : "Ausência registrada pela ClinFy" },
    });
  }

  // Consultas ainda não confirmadas (status 1) no período, com nome e celular do paciente.
  async consultasParaConfirmar(inicio: string, fim: string): Promise<Resultado<ConsultaD1[]>> {
    const r = await this.chamar("GET", "/appoints/search", { params: { data_start: dmy(inicio), data_end: dmy(fim), status_id: 1, unidade_id: this.unidade } });
    if (!r.ok) return r.naoEncontrado ? { ok: true, dados: [] } : r;
    const itens = lista(r.dados).filter((a) => a?.agendamento_id != null && iso(a.data));
    const out: ConsultaD1[] = [];
    for (const a of itens) {
      const [p, prof, proc, esp] = await Promise.all([
        a.paciente_id ? this.pacientePorId(String(a.paciente_id)) : null,
        this.profissional(String(a.profissional_id)),
        a.procedimento_id ? this.procedimento(String(a.procedimento_id)) : null,
        this.nomeEspecialidade(a.especialidade_id),
      ]);
      const cel = p ? telefoneDe(p.celulares, p.telefones) : null;
      out.push({
        agendamento_id: String(a.agendamento_id),
        data: iso(a.data)!,
        hora: hhmm(a.horario),
        prestador: this.nomeProfissional(prof),
        paciente: texto(p?.nome),
        telefone: cel ? telefoneKentro(cel) : null,
        clinica: texto(a.nome_fantasia),
        especialidade: esp,
        procedimento: texto(proc?.nome),
        endereco: null,
      });
    }
    return { ok: true, dados: out };
  }

  // A Feegow não tem onde registrar "lembrete enviado": o Conector guarda isso na própria trilha.
  async marcarLembretesEnviados() {
    return { ok: true as const, dados: null };
  }

  async lancarConta(_p: PedidoConta): Promise<Resultado<{ msg: string | null }>> {
    return falha("ERP_SEM_FINANCEIRO", 404, { naoEncontrado: true, msg: "lançamento de conta na Feegow ainda não feito no ClinFy" });
  }
}
