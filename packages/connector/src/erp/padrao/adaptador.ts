// Adaptador "Padrão Kentro": fala a "Especificação da API do ERP para a extensão Kentro" (REST + JSON,
// Bearer token, erros no envelope {erro: {codigo, mensagem, campos}}). Qualquer ERP que implemente a
// especificação conecta com URL e token, sem código novo no Conector.
import { config } from "../../config.js";
import { telefoneKentro } from "../../confirmacao.js";
import type { BuscaPaciente, ErpAdapter, FalhaErp, PedidoConta, PedidoMarcacao, Resultado, StatusConsulta, Vaga } from "../adaptador.js";
import type { LogErp } from "../asa/adaptador.js";
import type { Agendado, Consulta, ConsultaD1, Exame, Horario, Paciente } from "../modelo.js";
import {
  classificarErro, CONECTOR_PADRAO, mapearResposta, mensagemDeErro, montarRequisicao, rotaDaEspecificacao,
  type ConectorConfig, type TipoErro,
} from "../conector/motor.js";

export interface CredencialPadrao {
  base_url: string; // ex.: https://erp.exemplo.com/api/v1 (sem barra no fim)
  token: string;
}

const USER_AGENT = `Kentro-ClinFy-Connector/${config.version}`;
const TEMPO_LEITURA_MS = 15000;
const POR_PAGINA = 100;
const DIAS_A_FRENTE = 60;
// Horário livre sem slot_id: o Conector cria um id a partir da hora. O prefixo diz que não vai ao ERP.
const SEM_SLOT = "h-";

type Params = Record<string, string | number | boolean | undefined | null>;

const texto = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const reais = (centavos: unknown): number | null => (typeof centavos === "number" && Number.isFinite(centavos) ? centavos / 100 : null);
const dataDe = (iso: unknown) => texto(iso)?.slice(0, 10) ?? null;
const horaDe = (iso: unknown) => { const m = /T(\d{2}:\d{2})/.exec(String(iso ?? "")); return m ? m[1] : null; };
const listaDe = (corpo: any): any[] => (Array.isArray(corpo?.dados) ? corpo.dados : Array.isArray(corpo) ? corpo : []);
const hojeSp = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const somarDias = (data: string, n: number) => new Date(Date.parse(data + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

function falha(erro: string, status: number, extra: Partial<FalhaErp> = {}): FalhaErp {
  return { ok: false, erro, status, naoEncontrado: false, credencialInvalida: false, semResposta: false, recusa: false, ...extra };
}

// Paciente da especificação → modelo. Telefone = o principal (ou o primeiro).
function paciente(p: any): Paciente | null {
  const nome = texto(p?.nome);
  if (!nome) return null;
  const tels: any[] = Array.isArray(p.telefones) ? p.telefones : [];
  const tel = tels.find((t) => t?.principal) ?? tels[0];
  return { id: texto(p.id), nome, nascimento: dataDe(p.nascimento), telefone: texto(tel?.numero ?? p.telefone), cpf: texto(p.cpf) };
}

function consulta(a: any): Consulta {
  return {
    id: String(a.id),
    data: dataDe(a.inicio),
    hora: horaDe(a.inicio),
    prestador: texto(a.profissional?.nome),
    procedimentos: (Array.isArray(a.procedimentos) ? a.procedimentos : []).map((p: any) => texto(p?.nome)).filter((n: string | null): n is string => !!n),
  };
}

export class PadraoAdapter implements ErpAdapter {
  readonly erp: string;

  // `conector` traduz as rotas da especificação para as do ERP (erp/conector/motor.ts). Sem ele, o ERP fala
  // a própria especificação. `credencial` = os campos que o conector pede (base_url e token, no padrão).
  constructor(
    private readonly credencial: Record<string, unknown>,
    private readonly log: LogErp,
    private readonly conector: ConectorConfig = CONECTOR_PADRAO,
    nome = "padrao",
  ) {
    this.erp = nome;
  }

  // Uma chamada a uma rota da especificação, traduzida pelo conector. Erros viram FalhaErp: primeiro pelas
  // regras do conector, depois pelos códigos HTTP da especificação.
  private async chamar<T>(
    metodo: "GET" | "POST",
    caminho: string,
    opcoes: { params?: Params; corpo?: unknown; idempotencia?: string; timeoutMs?: number } = {},
  ): Promise<Resultado<T>> {
    const c = this.conector;
    const achada = rotaDaEspecificacao(metodo, caminho);
    const rota = achada ? c.rotas[achada.chave] ?? null : null;
    if (!rota && !c.especificacao) {
      // O conector não descreve esta rota: o ERP não tem o recurso.
      return falha("ERP_NAO_ENCONTRADO", 404, { naoEncontrado: true, msg: `o conector não tem ${achada?.chave ?? metodo + " " + caminho}` });
    }
    const entrada = { path: achada?.path ?? {}, query: opcoes.params ?? {}, corpo: opcoes.corpo, cred: this.credencial };
    let req;
    try {
      req = montarRequisicao(c, rota, { metodo, caminho }, entrada, opcoes.idempotencia);
    } catch (err: any) {
      return falha("ERP_CONECTOR_INVALIDO", 0, { msg: String(err?.message ?? err) });
    }
    req.headers["User-Agent"] = USER_AGENT;

    let resp: Response;
    const inicio = Date.now();
    try {
      resp = await fetch(req.url, {
        method: req.metodo,
        headers: req.headers,
        body: req.body,
        signal: AbortSignal.timeout(opcoes.timeoutMs ?? TEMPO_LEITURA_MS),
        redirect: "error", // o token nunca segue um redirecionamento
      });
    } catch (err: any) {
      const causa = err?.cause?.code ?? err?.cause?.name ?? "";
      return falha("ERP_FORA_DO_AR", 0, { semResposta: true, msg: `${err?.name ?? "erro"}${causa ? " " + causa : ""} em ${Date.now() - inicio} ms` });
    }

    const bruto = await resp.text();
    let corpo: any = null;
    try {
      corpo = bruto ? JSON.parse(bruto) : null;
    } catch {
      // corpo não é JSON
    }

    // Mensagem: a do conector, ou o envelope de erro da especificação.
    const codigo = texto(corpo?.erro?.codigo);
    const camposErro = corpo?.erro?.campos && typeof corpo.erro.campos === "object"
      ? Object.entries(corpo.erro.campos).map(([k, v]) => `${k}: ${v}`).join("; ")
      : "";
    const msg = mensagemDeErro(c, corpo) ?? ([texto(corpo?.erro?.mensagem), camposErro].filter(Boolean).join(" — ").slice(0, 400) || undefined);
    const extra = codigo ? { codigoErp: codigo } : {};

    let tipo: TipoErro | null;
    try {
      tipo = classificarErro(c, resp.status, corpo);
    } catch (err: any) {
      return falha("ERP_CONECTOR_INVALIDO", resp.status, { msg: String(err?.message ?? err) });
    }
    if (tipo === "credencial") return falha("ERP_CREDENCIAL_INVALIDA", resp.status, { credencialInvalida: true, msg, ...extra });
    if (tipo === "nao_encontrado") return falha("ERP_NAO_ENCONTRADO", resp.status, { naoEncontrado: true, msg, ...extra });
    if (tipo === "recusa") return falha("ERP_RECUSOU", resp.status, { recusa: true, msg: msg ?? codigo ?? undefined, ...extra });

    if (resp.ok) {
      if (resp.status !== 204 && corpo === null) return falha("ERP_RESPOSTA_INVALIDA", resp.status);
      if (rota?.resposta === undefined) return { ok: true, dados: corpo as T };
      try {
        return { ok: true, dados: mapearResposta(rota.resposta, corpo) as T };
      } catch (err: any) {
        return falha("ERP_RESPOSTA_INVALIDA", resp.status, { msg: String(err?.message ?? err) });
      }
    }
    if (resp.status === 401) return falha("ERP_CREDENCIAL_INVALIDA", 401, { credencialInvalida: true, msg, ...extra });
    if (resp.status === 404) return falha("ERP_NAO_ENCONTRADO", 404, { naoEncontrado: true, msg, ...extra });
    if (resp.status >= 500 || resp.status === 429) return falha("ERP_FORA_DO_AR", resp.status, { msg, ...extra });
    // 400, 403, 409, 422: recusa de negócio. O código do ERP vai junto, para o log e a tela.
    return falha("ERP_RECUSOU", resp.status, { recusa: true, msg: msg ?? codigo ?? undefined, ...extra });
  }

  // Transforma o sucesso; a falha passa adiante.
  private async ler<T, R>(r: Promise<Resultado<T>>, f: (d: T) => R): Promise<Resultado<R>> {
    const x = await r;
    return x.ok ? { ok: true, dados: f(x.dados) } : x;
  }

  // Lista inteira de uma rota paginada (até `max` páginas).
  private async todas(caminho: string, params: Params = {}, max = 20): Promise<Resultado<any[]>> {
    const itens: any[] = [];
    for (let pagina = 1; pagina <= max; pagina++) {
      const r = await this.chamar<any>("GET", caminho, { params: { ...params, pagina, por_pagina: POR_PAGINA } });
      if (!r.ok) return pagina === 1 ? r : { ok: true, dados: itens };
      const lote = listaDe(r.dados);
      itens.push(...lote);
      const total = Number(r.dados?.paginacao?.total);
      if (!r.dados?.paginacao || lote.length < POR_PAGINA || (Number.isFinite(total) && itens.length >= total)) break;
    }
    return { ok: true, dados: itens };
  }

  // Preço em reais de um procedimento (null se o ERP não tiver a rota ou o preço).
  private async preco(procedimentoId: string, convenioId?: string, profissionalId?: string): Promise<number | null> {
    const r = await this.chamar<any>("GET", "/precos", { params: { procedimento_id: procedimentoId, convenio_id: convenioId, profissional_id: profissionalId } });
    return r.ok ? reais(r.dados?.valor_centavos) : null;
  }

  // Busca de paciente. Um telefone pode ser de mais de um paciente (mãe e filho): vale o primeiro.
  private pacienteDa(busca: BuscaPaciente) {
    return this.ler(this.chamar<any>("GET", "/pacientes", { params: { ...busca } }), (d) => {
      const lista = listaDe(d);
      if (lista.length > 1) this.log.info({ achados: lista.length }, "padrão: busca de paciente com mais de um resultado; usado o primeiro");
      return lista.length ? paciente(lista[0]) : null;
    });
  }

  testarConexao() {
    return (async (): Promise<Resultado<{ prestadores: number }>> => {
      const s = await this.chamar<any>("GET", "/status");
      if (!s.ok) return s;
      return this.ler(this.chamar<any>("GET", "/profissionais"), (d) => ({ prestadores: listaDe(d).length }));
    })();
  }

  // As rotas desejáveis da especificação: existe se responde 2xx. 404 (rota inexistente) ou qualquer erro =
  // não oferecer o recurso.
  async detectarCapacidades() {
    const hoje = hojeSp();
    const [contas, pendentes, grupos] = await Promise.all([
      this.chamar("GET", "/contas", { params: { pagina: 1, por_pagina: 1 } }),
      this.chamar("GET", "/confirmacoes/pendentes", { params: { data_consulta: hoje, pagina: 1, por_pagina: 1 } }),
      this.chamar<any>("GET", "/grupos-procedimento"),
    ]);
    return {
      financeiro: contas.ok,
      confirmacao: pendentes.ok,
      grupos_exames: grupos.ok && listaDe(grupos.dados).length > 0,
    };
  }

  buscarPaciente(busca: BuscaPaciente) {
    return this.pacienteDa(busca);
  }

  async consultasFuturas(busca: BuscaPaciente): Promise<Resultado<{ consultas: Consulta[]; cpf: string | null }>> {
    const rp = await this.pacienteDa(busca);
    if (!rp.ok) return rp;
    if (!rp.dados?.id) return { ok: true, dados: { consultas: [], cpf: null } };
    const r = await this.todas(`/pacientes/${encodeURIComponent(rp.dados.id)}/agendamentos`, { periodo: "futuro" }, 2);
    if (!r.ok) return r;
    const consultas = r.dados.filter((a) => a?.id != null && !["cancelado", "remarcado"].includes(String(a.status))).map(consulta);
    return { ok: true, dados: { consultas, cpf: rp.dados.cpf } };
  }

  async especialidadesEPrestadores() {
    const [re, rp] = await Promise.all([this.chamar<any>("GET", "/especialidades"), this.chamar<any>("GET", "/profissionais")]);
    if (!re.ok) return re;
    if (!rp.ok) return rp;
    return {
      ok: true as const,
      dados: {
        especialidades: listaDe(re.dados).map((e) => ({ id: String(e.id), nome: String(e.nome ?? "") })),
        prestadores: listaDe(rp.dados).map((p) => {
          const esp = Array.isArray(p.especialidades) ? p.especialidades[0] : null;
          return {
            id: String(p.id),
            nome: String(p.nome ?? ""),
            especialidade_id: esp?.id == null ? null : String(esp.id),
            especialidade: texto(esp?.nome),
            ordem_chegada: p.tipo_agenda === "ordem_chegada",
          };
        }),
      },
    };
  }

  diasDisponiveis(prestadorId: string) {
    const de = hojeSp();
    return this.ler(
      this.chamar<any>("GET", `/profissionais/${encodeURIComponent(prestadorId)}/dias-disponiveis`, { params: { de, ate: somarDias(de, DIAS_A_FRENTE) } }),
      (d) => [...new Set((Array.isArray(d?.dias) ? d.dias : []).map((x: any) => dataDe(x?.data ?? x)).filter(Boolean) as string[])].sort(),
    );
  }

  horariosLivres(prestadorId: string, data: string) {
    return this.ler(
      this.chamar<any>("GET", `/profissionais/${encodeURIComponent(prestadorId)}/horarios-disponiveis`, { params: { data } }),
      (d) =>
        (Array.isArray(d?.horarios) ? d.horarios : [])
          .map((h: any): Horario | null => {
            const horario = texto(h?.inicio);
            if (!horario || !/^\d{2}:\d{2}$/.test(horario)) return null; // turnos de ordem de chegada ficam para a fase 3
            return { horario, agenda_id: texto(h.slot_id) ?? SEM_SLOT + horario.replace(":", "") };
          })
          .filter((h: Horario | null): h is Horario => !!h)
          .sort((a: Horario, b: Horario) => a.horario.localeCompare(b.horario)),
    );
  }

  agendaDoDia(prestadorId: string, data: string) {
    return this.ler(
      this.chamar<any>("GET", "/agenda", { params: { data, profissional_id: prestadorId, incluir_livres: false } }),
      (d) =>
        (Array.isArray(d?.itens) ? d.itens : [])
          .filter((i: any) => i?.tipo === "agendamento" && i.agendamento?.id != null)
          .map((i: any): Agendado => {
            const a = i.agendamento;
            return {
              id: String(a.id),
              hora: texto(i.inicio)?.slice(0, 5) ?? horaDe(a.inicio),
              status: texto(a.status)?.toLowerCase() ?? null,
              paciente: { id: texto(a.paciente?.id), nome: texto(a.paciente?.nome), telefone: texto(a.paciente?.telefone), idade: null, etiqueta: null },
              procedimentos: (Array.isArray(a.procedimentos) ? a.procedimentos : []).map((p: any) => texto(p?.nome)).filter(Boolean) as string[],
              obs: texto(a.observacao),
            };
          })
          .sort((x: Agendado, y: Agendado) => (x.hora ?? "").localeCompare(y.hora ?? "")),
    );
  }

  conveniosDaVaga(vaga: Vaga) {
    return this.ler(this.chamar<any>("GET", "/convenios", { params: { profissional_id: vaga.prestador_id } }), (d) =>
      listaDe(d).filter((c) => c?.id != null && texto(c.nome)).map((c) => ({ id: String(c.id), nome: String(c.nome) })),
    );
  }

  // Procedimentos que o profissional faz no convênio, com o preço quando o ERP tem a rota de preços.
  async procedimentosDaVaga(vaga: Vaga, convenioId: string) {
    const r = await this.todas("/procedimentos", { profissional_id: vaga.prestador_id, convenio_id: convenioId }, 3);
    if (!r.ok) return r;
    const itens = r.dados.filter((p) => p?.id != null && texto(p.nome));
    const precos = itens.length <= 20 ? await Promise.all(itens.map((p) => this.preco(String(p.id), convenioId, vaga.prestador_id))) : [];
    return {
      ok: true as const,
      dados: itens.map((p, i) => ({ id: String(p.id), nome: String(p.nome), valor: precos[i] ?? null, procedimento_id: String(p.id) })),
    };
  }

  examesPagina(pagina: number, busca?: string) {
    return this.ler(this.chamar<any>("GET", "/procedimentos", { params: { pagina, por_pagina: POR_PAGINA, busca } }), (d) => {
      const lista = listaDe(d);
      const total = Number(d?.paginacao?.total);
      return {
        exames: lista.filter((p) => p?.id != null && texto(p.nome)).map((p): Exame => ({ id: String(p.id), nome: String(p.nome), tipo: texto(p.tipo)?.toLowerCase() ?? null })),
        ultima: lista.length < POR_PAGINA || (Number.isFinite(total) && pagina * POR_PAGINA >= total),
      };
    });
  }

  gruposExames() {
    return this.ler(this.chamar<any>("GET", "/grupos-procedimento"), (d) =>
      listaDe(d)
        .filter((g) => g?.id != null && texto(g.nome))
        .map((g) => ({ id: String(g.id), nome: String(g.nome) }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    );
  }

  async examesDoGrupo(grupoId: string) {
    return this.ler(this.todas("/procedimentos", { grupo_id: grupoId }, 5), (lista) =>
      lista.filter((p) => p?.id != null && texto(p.nome)).map((p): Exame => ({ id: String(p.id), nome: String(p.nome), tipo: texto(p.tipo)?.toLowerCase() ?? null })),
    );
  }

  async conveniosDoExame(exameId: string) {
    const r = await this.chamar<any>("GET", "/convenios", { params: { procedimento_id: exameId } });
    if (!r.ok) return r;
    const lista = listaDe(r.dados).filter((c) => c?.id != null && texto(c.nome));
    const precos = await Promise.all(lista.map((c) => this.preco(exameId, String(c.id))));
    return { ok: true as const, dados: lista.map((c, i) => ({ id: String(c.id), nome: String(c.nome), valor: precos[i] })) };
  }

  async prestadoresDoExame(exameId: string, convenioId?: string) {
    const r = await this.chamar<any>("GET", "/profissionais", { params: { procedimento_id: exameId, convenio_id: convenioId } });
    if (!r.ok) return r;
    const lista = listaDe(r.dados).filter((p) => p?.id != null && texto(p.nome));
    const precos = convenioId ? await Promise.all(lista.map((p) => this.preco(exameId, convenioId, String(p.id)))) : [];
    return {
      ok: true as const,
      dados: lista.map((p, i) => ({
        id: String(p.id),
        nome: String(p.nome),
        especialidade: texto(Array.isArray(p.especialidades) ? p.especialidades[0]?.nome : null),
        ordem_chegada: p.tipo_agenda === "ordem_chegada",
        valor: precos[i] ?? null,
      })),
    };
  }

  // Marcar: paciente novo é cadastrado antes (CPF já existente usa o cadastro que está lá, sem alterá-lo).
  async marcar(p: PedidoMarcacao, timeoutMs: number) {
    const slot = p.vaga.agenda_id.startsWith(SEM_SLOT) ? undefined : p.vaga.agenda_id;
    let pacienteId: string;
    if ("paciente_id" in p.paciente) {
      pacienteId = p.paciente.paciente_id;
    } else {
      const novo = p.paciente;
      const r = await this.chamar<any>("POST", "/pacientes", {
        corpo: { nome: novo.nome, cpf: novo.cpf, nascimento: novo.nascimento, telefones: [{ numero: "55" + novo.telefone, tipo: "celular", whatsapp: true, principal: true }] },
        idempotencia: p.idempotencia ? p.idempotencia + "-paciente" : undefined,
        timeoutMs,
      });
      if (r.ok) pacienteId = String(r.dados?.id ?? "");
      else if (r.status === 409) {
        const existente = await this.pacienteDa({ cpf: novo.cpf });
        if (!existente.ok) return existente;
        if (!existente.dados?.id) return r;
        pacienteId = existente.dados.id;
      } else return r;
      if (!pacienteId) return falha("ERP_RESPOSTA_INVALIDA", 201, { msg: "cadastro de paciente sem id" });
    }

    const r = p.remarcar
      ? await this.chamar<any>("POST", `/agendamentos/${encodeURIComponent(p.remarcar)}/remarcar`, {
          corpo: { data: p.vaga.data, horario: p.vaga.horario, slot_id: slot, profissional_id: p.vaga.prestador_id, motivo: p.obs ?? null, usuario: p.usuario ?? null },
          idempotencia: p.idempotencia,
          timeoutMs,
        })
      : await this.chamar<any>("POST", "/agendamentos", {
          corpo: {
            paciente_id: pacienteId, profissional_id: p.vaga.prestador_id, data: p.vaga.data, horario: p.vaga.horario, slot_id: slot,
            procedimento_ids: [p.procedimento_id], convenio_id: p.convenio_id, observacao: p.obs ?? null, usuario: p.usuario ?? null,
          },
          idempotencia: p.idempotencia,
          timeoutMs,
        });
    if (!r.ok) return r;
    const a = r.dados ?? {};
    return {
      ok: true as const,
      dados: {
        feito: {
          agendamento_id: texto(a.id),
          paciente_id: texto(a.paciente?.id) ?? pacienteId,
          setor: texto(a.especialidade?.nome),
          clinica: texto(a.unidade?.nome),
          endereco: null,
        },
        diagnostico: { chaves: a && typeof a === "object" ? Object.keys(a) : typeof a, status: a?.status, msg: "" },
      },
    };
  }

  async mudarStatus(agendamentoId: string, status: StatusConsulta): Promise<Resultado<unknown>> {
    const id = encodeURIComponent(agendamentoId);
    if (status === "cancelado") return this.chamar("POST", `/agendamentos/${id}/cancelar`, { corpo: { motivo: null, por: "paciente" } });
    // A especificação não tem o status "pedido de remarcação": a conversa vai para um atendente, que
    // remarca pela rota própria. Nada a gravar no ERP.
    if (status === "remarcar") return { ok: true, dados: null };
    return this.chamar("POST", `/agendamentos/${id}/status`, { corpo: { status, origem: "whatsapp" } });
  }

  async consultasParaConfirmar(inicio: string, fim: string) {
    const consultas: ConsultaD1[] = [];
    for (let data = inicio; data <= fim; data = somarDias(data, 1)) {
      const r = await this.todas("/confirmacoes/pendentes", { data_consulta: data }, 10);
      if (!r.ok) return r;
      for (const c of r.dados) {
        const d = dataDe(c?.inicio);
        if (c?.agendamento_id == null || !d) continue;
        consultas.push({
          agendamento_id: String(c.agendamento_id),
          data: d,
          hora: horaDe(c.inicio),
          prestador: texto(c.profissional?.nome),
          paciente: texto(c.paciente?.nome),
          telefone: telefoneKentro(String(c.paciente?.telefone_whatsapp ?? "")),
          clinica: texto(c.unidade?.nome),
          especialidade: texto(c.especialidade),
          procedimento: texto((Array.isArray(c.procedimentos) ? c.procedimentos : []).map((p: any) => texto(p?.nome)).filter(Boolean).join(", ")),
          endereco: texto(c.unidade?.endereco_texto),
        });
      }
    }
    return { ok: true as const, dados: consultas };
  }

  marcarLembretesEnviados(agendamentoIds: string[]) {
    const agoraIso = new Date().toISOString();
    return this.chamar("POST", "/confirmacoes/enviadas", {
      corpo: { enviados: agendamentoIds.map((id) => ({ agendamento_id: id, enviado_em: agoraIso, canal: "whatsapp" })) },
    });
  }

  lancarConta(p: PedidoConta) {
    return this.ler(
      this.chamar<any>("POST", "/contas", {
        corpo: {
          paciente_id: p.paciente_id,
          agendamento_id: p.agendamento_id ?? null,
          valor_centavos: Math.round(Number(p.valor) * 100),
          vencimento: p.vencimento ?? hojeSp(),
          forma_pagamento: p.forma,
          parcelas: 1,
        },
        idempotencia: p.id_externo,
      }),
      (d) => ({ msg: texto(d?.status) ? `conta ${texto(d.id) ?? ""} ${texto(d.status)}`.trim() : null }),
    );
  }
}
