// Adaptador da Asa Saúde: traduz a API da Asa (rotas POST com query string, formatos misturados) para o
// contrato de erp/adaptador.ts. Tudo o que é particular da Asa fica aqui e em cliente.ts / normalizar.ts.
import type { BuscaPaciente, ErpAdapter, FalhaErp, PedidoConta, PedidoMarcacao, Resultado, StatusConsulta, Vaga } from "../adaptador.js";
import { chamarAsa, type CredencialAsa, type RespostaAsa } from "./cliente.js";
import * as N from "./normalizar.js";

// O mínimo de log que o adaptador usa (o logger da requisição do Fastify serve).
export interface LogErp {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

const POR_PAGINA = 100; // a Asa pagina o catálogo de procedimentos de 100 em 100

// "Não achei" chega como recusa (403/status "error") com mensagem de não encontrado, ou 404.
export function asaNaoEncontrado(r: Extract<RespostaAsa<unknown>, { ok: false }>): boolean {
  if (r.erro === "ASA_ROTA_INEXISTENTE") return true;
  return r.erro === "ASA_RECUSOU" && /encontrad|localizad|n[ãa]o possui|nenhum/i.test(r.msg ?? "");
}

export function falhaDaAsa(r: Extract<RespostaAsa<unknown>, { ok: false }>): FalhaErp {
  return {
    ok: false,
    erro: r.erro,
    status: r.status,
    msg: r.msg,
    naoEncontrado: asaNaoEncontrado(r),
    credencialInvalida: r.erro === "ASA_CREDENCIAL_INVALIDA",
    semResposta: r.erro === "ASA_FORA_DO_AR" && r.status === 0,
    recusa: r.erro === "ASA_RECUSOU",
  };
}

const chavesDe = (o: unknown) => (o && typeof o === "object" ? Object.keys(o) : typeof o);

// Parâmetros de vaga como a Asa pede (data em DD/MM/AAAA).
const paramsVaga = (v: Vaga) => ({ prestador_id: v.prestador_id, data: N.dataBr(v.data), horario: v.horario, agenda_id: v.agenda_id });

export class AsaAdapter implements ErpAdapter {
  readonly erp = "asa";

  constructor(
    private readonly credencial: CredencialAsa,
    private readonly log: LogErp,
  ) {}

  // Chama a Asa e converte a resposta: sucesso passa por `ler`; falha vira FalhaErp.
  private async pedir<T>(
    rota: string,
    params: Record<string, string | number | Array<string | number>>,
    ler: (dados: any) => T,
    timeoutMs?: number,
  ): Promise<Resultado<T>> {
    const r = await chamarAsa<any>(this.credencial, rota, params, timeoutMs);
    return r.ok ? { ok: true, dados: ler(r.dados) } : falhaDaAsa(r);
  }

  testarConexao() {
    return this.pedir("api-agendamento", {}, (d) => ({ prestadores: N.lista(d?.prestadores).length }));
  }

  buscarPaciente(busca: BuscaPaciente) {
    return this.pedir("api-agendamento-paciente-instituicao", { ...busca }, (d) => {
      const p = N.paciente(d);
      if (!p) this.log.warn({ chaves: chavesDe(d) }, "resposta de paciente sem nome");
      return p;
    });
  }

  // O CPF não vem em paciente-instituicao, mas vem em agendamentos-futuros.
  consultasFuturas(busca: BuscaPaciente) {
    return this.pedir("api-agendamentos-futuros", { ...busca }, (d) => ({
      consultas: N.consultasFuturas(d),
      cpf: N.paciente(d)?.cpf ?? null,
    }));
  }

  especialidadesEPrestadores() {
    return this.pedir("api-agendamento", {}, (d) => ({
      especialidades: N.lista(d?.especialidades).map((e: any) => ({ id: String(e.id), nome: String(e.descricao ?? "") })),
      prestadores: N.lista(d?.prestadores).map((p: any) => ({
        id: String(p.id),
        nome: String(p.nome ?? ""),
        especialidade_id: p.especialidade_id == null ? null : String(p.especialidade_id),
        especialidade: p.especialidade ?? null,
        ordem_chegada: !!Number(p.ordem_chegada),
      })),
    }));
  }

  diasDisponiveis(prestadorId: string) {
    return this.pedir("api-agendamento-dias-atendimento", { prestador_id: prestadorId }, N.dias);
  }

  // A Asa pede a data com hora zerada e recusa dias passados.
  horariosLivres(prestadorId: string, data: string) {
    return this.pedir("api-agendamento-horarios-atendimento", { prestador_id: prestadorId, data: `${data} 00:00:00` }, N.horarios);
  }

  agendaDoDia(prestadorId: string, data: string) {
    return this.pedir("api-agendamento-horarios-agendados", { prestador_id: prestadorId, data }, (d) => {
      const agendados = N.agendados(d);
      if (!agendados.length && d && typeof d === "object") {
        const primeiro = N.lista(d.agendamentos ?? d)[0];
        this.log.info({ chaves: Object.keys(d), item: primeiro && typeof primeiro === "object" ? Object.keys(primeiro) : typeof primeiro }, "agenda do dia sem consultas reconhecidas");
      }
      return agendados;
    });
  }

  conveniosDaVaga(vaga: Vaga) {
    return this.pedir("api-agendamento-get-convenio-instituicao", paramsVaga(vaga), N.convenios);
  }

  async procedimentosDaVaga(vaga: Vaga, convenioId: string) {
    const r = await this.pedir("api-agendamento-get-procedimentos-instituicao", { ...paramsVaga(vaga), convenio_id: convenioId }, (d) => {
      const procedimentos = N.procedimentos(d);
      if (!procedimentos.length) {
        // Estrutura (só nomes de campos) para ajustar o normalizador quando a Asa muda o formato.
        const primeiro: any = N.lista(d?.procedimentos ?? d)[0];
        this.log.warn(
          { chaves: chavesDe(d), item: chavesDe(primeiro), procedimento_instituicao: chavesDe(primeiro?.procedimento_instituicao) },
          "procedimentos: resposta sem itens reconhecidos",
        );
      }
      return procedimentos;
    });
    if (!r.ok && r.naoEncontrado) this.log.info({ msg_asa: r.msg }, "procedimentos: Asa respondeu não encontrado");
    return r;
  }

  examesPagina(pagina: number, busca?: string) {
    return this.pedir("api-agendamento-procedimentos", { page: pagina, ...(busca ? { descricao: busca } : {}) }, (d) => ({
      exames: N.exames(d),
      ultima: N.lista(d?.procedimentos ?? d).length < POR_PAGINA,
    }));
  }

  gruposExames() {
    return this.pedir("api-agendamento-grupos-procedimentos", {}, N.gruposExames);
  }

  examesDoGrupo(grupoId: string) {
    return this.pedir("api-agendamento-procedimentos-grupo", { grupo_id: grupoId }, N.exames);
  }

  conveniosDoExame(exameId: string) {
    return this.pedir("api-agendamento-get-convenios-procedimento", { procedimento_id: exameId }, N.conveniosDoExame);
  }

  prestadoresDoExame(exameId: string, convenioId?: string) {
    return this.pedir(
      "api-agendamento-get-prestadores-procedimento",
      { procedimento_id: exameId, ...(convenioId ? { convenio_id: convenioId } : {}) },
      (d) => N.prestadoresDoExame(d, convenioId),
    );
  }

  // Remarcar é o MESMO endpoint de agendar, com `agendamento` = a consulta original.
  marcar(p: PedidoMarcacao, timeoutMs: number) {
    return this.pedir(
      "api-agendamento-agendar-instituicao",
      {
        ...paramsVaga(p.vaga),
        convenio_id: p.convenio_id,
        convenio_procedimento_id: p.procedimento_id,
        ...p.paciente,
        ...(p.remarcar ? { agendamento: p.remarcar } : {}),
        ...(p.obs ? { obs: p.obs } : {}),
      },
      (d) => ({
        feito: N.agendamentoFeito(d),
        diagnostico: {
          chaves: chavesDe(d),
          status: d?.status,
          msg: String(d?.msg ?? d?.message ?? d?.mensagem ?? "").slice(0, 160),
          agendamento_tipo: typeof d?.agendamento,
        },
      }),
      timeoutMs,
    );
  }

  // Sempre pelo id explícito: o modo "por telefone" da Asa escolhe a consulta sozinho.
  mudarStatus(agendamentoId: string, status: StatusConsulta) {
    return this.pedir("api-agendamento-status", { status, agendamento: agendamentoId }, (d) => d);
  }

  consultasParaConfirmar(inicio: string, fim: string) {
    return this.pedir("api-proximos-agendamento", { data_inicio: inicio, data_fim: fim, envio_final_semana: 0 }, N.proximos);
  }

  marcarLembretesEnviados(agendamentoIds: string[]) {
    return this.pedir("api-agendamento-disparados", { "agendamentos[]": agendamentoIds }, (d) => d);
  }

  // id_externo = a chave: na Asa, a conta fica rastreável até este lançamento (inclusive se ficar incerta).
  // `status` (0/1) não é enviado: a Asa não documenta o que cada valor significa.
  lancarConta(p: PedidoConta) {
    return this.pedir(
      "api-gerar-conta-paciente",
      {
        paciente_id: p.paciente_id,
        valor_parcela: p.valor,
        forma_pagamento: p.forma,
        id_externo: p.id_externo,
        ...(p.agendamento_id ? { agendamento_id: p.agendamento_id } : {}),
        ...(p.vencimento ? { data_vencimento: p.vencimento } : {}),
      },
      (d) => ({ msg: String(d?.msg ?? "").slice(0, 300) || null }),
    );
  }
}
