// Contrato entre as rotas do Conector e o ERP da clínica. Cada ERP tem um adaptador (erp/<nome>/) que
// fala a API dele e devolve o modelo neutro (erp/modelo.ts). As rotas só conhecem esta interface.
import type {
  AgendamentoFeito, Agendado, Consulta, ConsultaD1, Convenio, ConvenioValor, Especialidade, Exame, GrupoExame, Horario,
  Paciente, Prestador, PrestadorDoExame, Procedimento,
} from "./modelo.js";

// Falha de uma chamada ao ERP. `erro` é o código que vai para a extensão (o adaptador escolhe); os três
// sinais dizem às rotas o que fazer, sem que elas precisem conhecer as mensagens do ERP.
export interface FalhaErp {
  ok: false;
  erro: string;
  status: number; // HTTP do ERP; 0 = sem resposta
  msg?: string; // mensagem do ERP, sem dados do paciente: mostrada ao atendente quando é recusa de negócio
  naoEncontrado: boolean; // "não achei": as rotas tratam como lista vazia ou registro ausente
  credencialInvalida: boolean; // o ERP recusou a credencial da clínica
  semResposta: boolean; // tempo esgotado ou conexão caída: numa gravação, o ERP PODE ter gravado
  recusa: boolean; // recusa de negócio (validação, regra): a mensagem ajuda o atendente
  codigoErp?: string; // o código de erro do próprio ERP (ex.: HORARIO_OCUPADO), quando ele manda um
}

export type Resultado<T> = { ok: true; dados: T } | FalhaErp;

// Como o painel achou o paciente. Exatamente um dos dois: CPF com 11 dígitos ou telefone DDD + número.
export type BuscaPaciente = { cpf: string } | { telefone: string };

// Vaga escolhida pelo painel, como veio dos horários livres.
export interface Vaga {
  prestador_id: string;
  data: string; // YYYY-MM-DD
  horario: string; // HH:MM
  agenda_id: string;
}

export interface PedidoMarcacao {
  vaga: Vaga;
  convenio_id: string;
  procedimento_id: string; // o `id` de Procedimento (na Asa, convenio_procedimento_id)
  // Paciente cadastrado (com os dados que o ERP exige junto) ou paciente novo, cadastrado na marcação.
  paciente: { paciente_id: string; nome: string; nascimento: string; telefone: string; cpf?: string } | { nome: string; cpf: string; nascimento: string; telefone: string };
  remarcar?: string; // id da consulta original: presente = remarcação
  obs?: string;
  idempotencia?: string; // a chave do painel: ERPs que aceitam Idempotency-Key não gravam duas vezes
  usuario?: string; // quem pediu na Kentro, para a auditoria do ERP
}

export interface Marcacao {
  feito: AgendamentoFeito;
  // Só nomes de campos e mensagem, para o log quando a resposta não traz o número da consulta.
  diagnostico: { msg: string } & Record<string, unknown>;
}

export type StatusConsulta = "confirmado" | "ausente" | "cancelado" | "remarcar";

export interface PedidoConta {
  paciente_id: string;
  valor: string; // reais com ponto decimal, como o painel valida ("150.00")
  forma: string;
  id_externo: string; // a chave de idempotência do lançamento
  agendamento_id?: string;
  vencimento?: string; // YYYY-MM-DD
}

export interface ErpAdapter {
  readonly erp: string; // "asa", …

  // Teste de conexão (e validação da credencial ao gravar). `prestadores` = quantos o ERP listou.
  testarConexao(): Promise<Resultado<{ prestadores: number }>>;

  // Paciente da busca. null = o ERP respondeu, mas sem um paciente reconhecível.
  buscarPaciente(busca: BuscaPaciente): Promise<Resultado<Paciente | null>>;
  // Próximas consultas do paciente. `cpf`: o CPF, quando esta lista o traz e a busca de paciente não.
  consultasFuturas(busca: BuscaPaciente): Promise<Resultado<{ consultas: Consulta[]; cpf: string | null }>>;

  especialidadesEPrestadores(): Promise<Resultado<{ especialidades: Especialidade[]; prestadores: Prestador[] }>>;
  diasDisponiveis(prestadorId: string): Promise<Resultado<string[]>>;
  horariosLivres(prestadorId: string, data: string): Promise<Resultado<Horario[]>>;
  agendaDoDia(prestadorId: string, data: string): Promise<Resultado<Agendado[]>>;
  conveniosDaVaga(vaga: Vaga): Promise<Resultado<Convenio[]>>;
  procedimentosDaVaga(vaga: Vaga, convenioId: string): Promise<Resultado<Procedimento[]>>;

  // Catálogo para agendar por exame. `ultima` = não há página seguinte.
  examesPagina(pagina: number, busca?: string): Promise<Resultado<{ exames: Exame[]; ultima: boolean }>>;
  gruposExames(): Promise<Resultado<GrupoExame[]>>;
  examesDoGrupo(grupoId: string): Promise<Resultado<Exame[]>>;
  conveniosDoExame(exameId: string): Promise<Resultado<ConvenioValor[]>>;
  prestadoresDoExame(exameId: string, convenioId?: string): Promise<Resultado<PrestadorDoExame[]>>;

  // Gravações. Marcar (ou remarcar) espera mais que as leituras.
  marcar(pedido: PedidoMarcacao, timeoutMs: number): Promise<Resultado<Marcacao>>;
  mudarStatus(agendamentoId: string, status: StatusConsulta): Promise<Resultado<unknown>>;

  // Confirmação de véspera.
  consultasParaConfirmar(inicio: string, fim: string): Promise<Resultado<ConsultaD1[]>>;
  marcarLembretesEnviados(agendamentoIds: string[]): Promise<Resultado<unknown>>;

  // Financeiro: lança a conta a receber. `msg` = o que o ERP respondeu, para a trilha.
  lancarConta(pedido: PedidoConta): Promise<Resultado<{ msg: string | null }>>;
}
