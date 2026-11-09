// Modelo neutro: o formato de dados que as rotas e a extensão usam, seja qual for o ERP da clínica.
// Cada adaptador (erp/<nome>/) traduz o ERP para estes tipos. Nada aqui conhece um ERP específico.

export interface Paciente {
  id: string | null;
  nome: string;
  nascimento: string | null; // YYYY-MM-DD
  telefone: string | null;
  cpf: string | null;
}

export interface Consulta {
  id: string;
  data: string | null; // YYYY-MM-DD
  hora: string | null; // HH:MM
  prestador: string | null;
  procedimentos: string[];
  confirmacao?: { estado: string; resposta: string | null }; // da confirmação de véspera, quando houve
}

// Horário livre. `agenda_id` identifica a vaga na grade do ERP e volta na marcação.
export interface Horario {
  horario: string; // HH:MM
  agenda_id: string;
}

export interface Especialidade {
  id: string;
  nome: string;
}

export interface Prestador {
  id: string;
  nome: string;
  especialidade_id: string | null;
  especialidade: string | null;
  ordem_chegada: boolean;
}

export interface Convenio {
  id: string;
  nome: string;
}

export interface ConvenioValor extends Convenio {
  valor: number | null;
}

// Procedimento oferecido numa vaga, já no convênio escolhido.
export interface Procedimento {
  id: string; // o identificador que vai para a marcação (na Asa, convenio_procedimento_id)
  nome: string;
  valor: number | null;
  procedimento_id: string | null; // id do procedimento no catálogo (o de Exame.id), quando vier
}

// Consulta já marcada, na agenda do dia de um prestador.
export interface Agendado {
  id: string;
  hora: string | null; // HH:MM
  status: string | null; // como o ERP escreveu, em minúsculas
  paciente: { id: string | null; nome: string | null; telefone: string | null; idade: number | null; etiqueta: string | null };
  procedimentos: string[];
  obs: string | null;
}

// Item do catálogo de procedimentos (consulta ou exame), para agendar por exame.
export interface Exame {
  id: string;
  nome: string;
  tipo: string | null; // "consulta" | "exame"
}

export interface GrupoExame {
  id: string;
  nome: string;
}

export interface PrestadorDoExame {
  id: string;
  nome: string;
  especialidade: string | null;
  ordem_chegada: boolean;
  valor: number | null; // do convênio pedido, quando houver
}

// O que a marcação devolve para o painel.
export interface AgendamentoFeito {
  agendamento_id: string | null;
  paciente_id: string | null;
  setor: string | null;
  clinica: string | null;
  endereco: string | null;
}

// Consulta a confirmar na véspera, com o que a mensagem ao paciente usa.
export interface ConsultaD1 {
  agendamento_id: string;
  data: string; // YYYY-MM-DD
  hora: string | null;
  prestador: string | null;
  paciente: string | null;
  telefone: string | null; // com DDI, como a Kentro envia
  clinica: string | null;
  especialidade: string | null;
  procedimento: string | null;
  endereco: string | null;
}

// Telefone do contato Kentro (com DDI, só dígitos ou formatado) → DDD + número. null se não for um
// número brasileiro. Número estrangeiro fica de fora até termos um caso real para testar.
export function telefoneNacional(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}

// Nome para comparação: sem acento, minúsculo, espaços colapsados. null se vazio.
export function normalizarNome(v: unknown): string | null {
  const s = String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return s || null;
}

// A consulta que acabamos de pedir, na agenda do dia: mesma hora, ativa, e do mesmo paciente (ou a
// consulta remarcada). Sem como identificar o paciente, vale a única consulta ativa no horário, que
// estava livre segundos antes.
export function consultaNoHorario(
  lista: Agendado[],
  alvo: { horario: string; paciente_id?: string; nome?: string; original?: string },
): Agendado | undefined {
  const nome = normalizarNome(alvo.nome);
  const noHorario = lista.filter((a) => a.hora === alvo.horario && !/cancel|desist/.test(a.status ?? ""));
  return (
    noHorario.find((a) => alvo.original && a.id === alvo.original) ??
    noHorario.find((a) => alvo.paciente_id && a.paciente.id === alvo.paciente_id) ??
    noHorario.find((a) => nome && normalizarNome(a.paciente.nome) === nome) ??
    (noHorario.length === 1 ? noHorario[0] : undefined)
  );
}
