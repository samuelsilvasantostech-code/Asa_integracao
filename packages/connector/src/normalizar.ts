// Respostas da Asa → formato estável para a extensão. Funções puras: a Asa mistura formatos de
// data, devolve listas como objeto indexado e muda o nome da lista de rota para rota.

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
}

export interface Horario {
  horario: string; // HH:MM
  agenda_id: string;
}

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

// Aceita YYYY-MM-DD, YYYY-MM-DD HH:MM:SS e DD/MM/YYYY. Devolve YYYY-MM-DD.
export function dataIso(v: unknown): string | null {
  const s = texto(v);
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

export function horaCurta(v: unknown): string | null {
  const m = /(\d{1,2}):(\d{2})/.exec(texto(v) ?? "");
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

// Lista que pode vir como array ou como objeto indexado ({"1": {...}}).
export function lista<T = any>(v: unknown): T[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v as Record<string, T>);
  return [];
}

function nomeDeItem(p: any): string | null {
  if (typeof p === "string") return texto(p);
  return texto(p?.descricao ?? p?.nome ?? p?.procedimento ?? null);
}

// api-agendamento-paciente-instituicao. Pode vir solto ou dentro de "paciente".
export function paciente(corpo: any): Paciente | null {
  const p = corpo?.paciente && typeof corpo.paciente === "object" ? corpo.paciente : corpo;
  const nome = texto(p?.nome);
  if (!nome) return null;
  return {
    id: texto(p.paciente_id ?? p.id),
    nome,
    nascimento: dataIso(p.nascimento ?? p.data_nascimento),
    telefone: texto(p.telefone ?? p.telefone1),
    cpf: texto(p.cpf),
  };
}

// api-agendamentos-futuros: a lista vem em "msg".
export function consultasFuturas(corpo: any): Consulta[] {
  const itens = lista(corpo?.msg ?? corpo?.agendamentos);
  return itens
    .filter((a: any) => a && typeof a === "object")
    .map((a: any) => ({
      id: String(a.id ?? ""),
      data: dataIso(a.data ?? a.data_hora),
      hora: horaCurta(a.hora ?? a.horario ?? a.data_hora),
      prestador: texto(a.nome_prestador ?? a.prestador ?? a.profissional),
      procedimentos: lista(a.procedimentos).map(nomeDeItem).filter((n): n is string => !!n),
    }))
    .sort((x, y) => `${x.data} ${x.hora}`.localeCompare(`${y.data} ${y.hora}`));
}

// api-agendamento-dias-atendimento: datas com hora zerada, podendo repetir o dia.
export function dias(corpo: any): string[] {
  const itens = lista(Array.isArray(corpo) ? corpo : corpo?.dias ?? corpo?.datas ?? corpo);
  const unicos = new Set(itens.map(dataIso).filter((d): d is string => !!d));
  return [...unicos].sort();
}

// api-agendamento-horarios-atendimento: objeto indexado {"1": {horario, agenda_id}}.
export function horarios(corpo: any): Horario[] {
  return lista(corpo?.horarios ?? corpo)
    .map((h: any) => ({ horario: horaCurta(h?.horario), agenda_id: texto(h?.agenda_id) }))
    .filter((h): h is Horario => !!h.horario && !!h.agenda_id)
    .sort((a, b) => a.horario.localeCompare(b.horario));
}

// Telefone do contato Kentro (com DDI, só dígitos ou formatado) → DDD + número, como a Asa espera.
// Número estrangeiro (parâmetro `ddi` da Asa) fica de fora até termos um caso real para testar.
export function telefoneAsa(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}
