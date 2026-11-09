// ERP simulado: implementa a "Especificação da API do ERP para a extensão Kentro" com dados fictícios em
// memória. Serve para desenvolver e testar o adaptador Padrão Kentro e o kit de conformidade sem o ERP do
// cliente. NÃO é usado em produção (fica fora de src/ e do build).
//
// Rodar sozinho:  npx tsx tools/erp-simulado.ts            (porta 4010, token "token-de-teste")
//                 PORTA=4020 TOKEN=outro npx tsx tools/erp-simulado.ts
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { pathToFileURL } from "node:url";

type Status = "agendado" | "confirmado" | "presente" | "atendido" | "ausente" | "cancelado" | "remarcado";

interface Paciente {
  id: string; nome: string; nome_social: null; cpf: string | null; nascimento: string; sexo: string | null;
  telefones: Array<{ numero: string; tipo: string; whatsapp: boolean; principal: boolean }>;
  email: string | null; endereco: null; convenio: null; observacoes: null; criado_em: string; atualizado_em: string;
}

interface Agendamento {
  id: string; status: Status; inicio: string; fim: string;
  paciente: { id: string; nome: string; telefone: string | null };
  profissional: { id: string; nome: string };
  especialidade: { id: string; nome: string };
  procedimentos: Array<{ id: string; nome: string; preparo: string | null }>;
  convenio: { id: string; nome: string; plano_id: string | null; carteirinha: string | null };
  unidade: { id: string; nome: string };
  valor_centavos: number | null; observacao: string | null; origem: string; id_externo: string | null;
  remarcado_de_id: string | null; remarcado_para_id: string | null;
  confirmacao: { enviada_em: string | null; respondida_em: string | null };
  cancelamento: null | { em: string; motivo: string | null; por: string };
  criado_em: string; atualizado_em: string;
}

const FUSO = "-03:00";
const hoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const agora = () => new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "T") + FUSO;
const somarDias = (data: string, n: number) => new Date(Date.parse(data + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const diaDaSemana = (data: string) => new Date(data + "T12:00:00Z").getUTCDay();
const so = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const ultimos8 = (s: string) => so(s).slice(-8);

const UNIDADE = { id: "1", nome: "Unidade Centro", endereco: { logradouro: "Av. Central", numero: "500", bairro: "Centro", cidade: "Vila Velha", uf: "ES", cep: "29100000" }, telefone: "552733334444", link_mapa: null };
const ESPECIALIDADES = [{ id: "3", nome: "Cardiologia" }, { id: "7", nome: "Clínica Geral" }];
const PROFISSIONAIS = [
  { id: "101", nome: "Dra. Ana Souza", conselho: "CRM-ES 12345", especialidades: [ESPECIALIDADES[0]], unidades: [{ id: "1", nome: UNIDADE.nome }], tipo_agenda: "horario_marcado", agendavel_online: true, procedimentos: ["p-consulta-cardio", "p-ecg"], convenios: ["0", "5"] },
  { id: "102", nome: "Dr. Bruno Lima", conselho: "CRM-ES 54321", especialidades: [ESPECIALIDADES[1]], unidades: [{ id: "1", nome: UNIDADE.nome }], tipo_agenda: "horario_marcado", agendavel_online: true, procedimentos: ["p-consulta-geral", "p-hemograma"], convenios: ["0"] },
];
const GRUPOS = [{ id: "9", nome: "Laboratório" }, { id: "10", nome: "Consultas" }];
const PROCEDIMENTOS = [
  { id: "p-consulta-cardio", nome: "Consulta cardiológica", tipo: "consulta", grupo: GRUPOS[1], duracao_minutos: 30, preparo: null, exige_pedido_medico: false, agendavel_online: true },
  { id: "p-consulta-geral", nome: "Consulta clínica geral", tipo: "consulta", grupo: GRUPOS[1], duracao_minutos: 30, preparo: null, exige_pedido_medico: false, agendavel_online: true },
  { id: "p-ecg", nome: "Eletrocardiograma", tipo: "exame", grupo: null, duracao_minutos: 30, preparo: "Evitar cafeína no dia.", exige_pedido_medico: true, agendavel_online: true },
  { id: "p-hemograma", nome: "Hemograma completo", tipo: "exame", grupo: GRUPOS[0], duracao_minutos: 30, preparo: "Jejum de 8 horas.", exige_pedido_medico: true, agendavel_online: true },
];
const CONVENIOS = [{ id: "0", nome: "Particular", particular: true }, { id: "5", nome: "Unimed", particular: false, planos: [{ id: "51", nome: "Unimed Nacional" }] }];
const PRECOS: Record<string, number> = { "p-consulta-cardio": 25000, "p-consulta-geral": 15000, "p-ecg": 12000, "p-hemograma": 4500 };
// Grade: dias úteis, 08:00 às 12:00, de 30 em 30 minutos, nos próximos 60 dias.
const GRADE = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30"];
const mais30 = (h: string) => { const [a, b] = h.split(":").map(Number); const m = a * 60 + b + 30; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

export interface OpcoesErpSimulado {
  token?: string;
  // Caminhos (depois de /api/v1) que este ERP não tem: respondem 404, como num ERP que só fez as rotas
  // obrigatórias. Ex.: ["/contas", "/confirmacoes", "/grupos-procedimento"].
  semRotas?: string[];
}

export function criarErpSimulado(opcoes: OpcoesErpSimulado = {}): FastifyInstance {
  const token = opcoes.token ?? "token-de-teste";
  const app = Fastify();
  let seq = 1000;
  const novoId = (p: string) => `${p}${++seq}`;

  const pacientes = new Map<string, Paciente>();
  const agendamentos = new Map<string, Agendamento>();
  const contas = new Map<string, Record<string, unknown>>();
  const idempotencia = new Map<string, { status: number; corpo: unknown }>();

  const maria: Paciente = {
    id: "8812", nome: "Maria da Silva", nome_social: null, cpf: "12345678909", nascimento: "1985-04-12", sexo: "F",
    telefones: [{ numero: "5527999998888", tipo: "celular", whatsapp: true, principal: true }],
    email: "maria@exemplo.com", endereco: null, convenio: null, observacoes: null, criado_em: "2024-02-01T09:12:00-03:00", atualizado_em: "2024-02-01T09:12:00-03:00",
  };
  pacientes.set(maria.id, maria);

  const erro = (reply: FastifyReply, http: number, codigo: string, mensagem: string, extra: Record<string, unknown> = {}) =>
    reply.code(http).send({ erro: { codigo, mensagem, ...extra } });

  // Autenticação: Bearer <token>. Rotas que este ERP "não tem": 404.
  app.addHook("onRequest", async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${token}`) return erro(reply, 401, "NAO_AUTENTICADO", "Token ausente ou inválido.");
    const caminho = req.url.split("?")[0].replace(/^\/api\/v1/, "");
    if ((opcoes.semRotas ?? []).some((r) => caminho === r || caminho.startsWith(r + "/"))) return erro(reply, 404, "NAO_ENCONTRADO", "Rota inexistente.");
  });

  // Idempotency-Key: repetida em 24 h, devolve o mesmo resultado. (Aqui, enquanto o processo viver.)
  async function idempotente(req: FastifyRequest, reply: FastifyReply, fazer: () => { status: number; corpo: unknown }) {
    const chave = req.headers["idempotency-key"];
    const k = typeof chave === "string" && chave ? `${req.url}|${chave}` : null;
    if (k && idempotencia.has(k)) {
      const r = idempotencia.get(k)!;
      return reply.code(r.status).send(r.corpo);
    }
    const r = fazer();
    if (k && r.status < 500) idempotencia.set(k, r);
    return reply.code(r.status).send(r.corpo);
  }

  const paginar = <T>(itens: T[], q: Record<string, string | undefined>) => {
    const pagina = Math.max(1, Number(q.pagina) || 1);
    const por = Math.min(200, Math.max(1, Number(q.por_pagina) || 50));
    return { dados: itens.slice((pagina - 1) * por, pagina * por), paginacao: { pagina, por_pagina: por, total: itens.length } };
  };

  const ocupado = (profissionalId: string, data: string, horario: string) =>
    [...agendamentos.values()].some((a) => a.profissional.id === profissionalId && a.inicio.startsWith(`${data}T${horario}`) && !["cancelado", "remarcado"].includes(a.status));

  const livres = (profissionalId: string, data: string) => {
    if (data < hoje() || data > somarDias(hoje(), 60) || [0, 6].includes(diaDaSemana(data))) return [];
    return GRADE.filter((h) => !ocupado(profissionalId, data, h)).map((h) => ({ slot_id: `${profissionalId}-${data.replace(/-/g, "")}-${h.replace(":", "")}`, inicio: h, fim: mais30(h), unidade_id: "1" }));
  };

  const resumoPaciente = (p: Paciente) => ({ id: p.id, nome: p.nome, telefone: p.telefones.find((t) => t.principal)?.numero ?? p.telefones[0]?.numero ?? null });

  /* ---------- status ---------- */
  app.get("/api/v1/status", async () => ({ ok: true, versao_api: "1.0.0", clinica: { id: "12", nome: "Clínica Simulada" }, fuso_horario: "America/Sao_Paulo" }));

  /* ---------- pacientes ---------- */
  app.get<{ Querystring: Record<string, string | undefined> }>("/api/v1/pacientes", async (req, reply) => {
    const { cpf, telefone, nome } = req.query;
    if (!cpf && !telefone && !nome) return erro(reply, 400, "PARAMETRO_INVALIDO", "Informe cpf, telefone ou nome.");
    const n = String(nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const achados = [...pacientes.values()].filter((p) =>
      (cpf ? p.cpf === so(cpf) : true) &&
      (telefone ? p.telefones.some((t) => ultimos8(t.numero) === ultimos8(telefone)) : true) &&
      (nome ? p.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(n) : true),
    );
    return paginar(achados, req.query);
  });

  app.get<{ Params: { id: string } }>("/api/v1/pacientes/:id", async (req, reply) => {
    const p = pacientes.get(req.params.id);
    return p ?? erro(reply, 404, "NAO_ENCONTRADO", "Paciente não encontrado.");
  });

  app.post<{ Body: Partial<Paciente> & { telefone?: string } }>("/api/v1/pacientes", async (req, reply) =>
    idempotente(req, reply, () => {
      const b = req.body ?? {};
      const campos: Record<string, string> = {};
      if (!b.nome || String(b.nome).trim().length < 2) campos.nome = "obrigatório";
      if (!b.nascimento || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.nascimento))) campos.nascimento = "data YYYY-MM-DD";
      const tels = Array.isArray(b.telefones) ? b.telefones : b.telefone ? [{ numero: so(b.telefone), tipo: "celular", whatsapp: true, principal: true }] : [];
      if (!tels.length) campos.telefones = "ao menos um";
      if (Object.keys(campos).length) return { status: 422, corpo: { erro: { codigo: "VALIDACAO", mensagem: "Dados inválidos.", campos } } };
      const cpf = b.cpf ? so(b.cpf) : null;
      const existente = cpf ? [...pacientes.values()].find((p) => p.cpf === cpf) : undefined;
      if (existente) return { status: 409, corpo: { erro: { codigo: "PACIENTE_JA_EXISTE", mensagem: "Já há paciente com este CPF.", paciente_id: existente.id } } };
      const p: Paciente = {
        id: novoId(""), nome: String(b.nome).trim(), nome_social: null, cpf, nascimento: String(b.nascimento), sexo: b.sexo ?? null,
        telefones: tels.map((t: any) => ({ numero: so(t.numero), tipo: t.tipo ?? "celular", whatsapp: t.whatsapp ?? true, principal: t.principal ?? true })),
        email: b.email ?? null, endereco: null, convenio: null, observacoes: null, criado_em: agora(), atualizado_em: agora(),
      };
      pacientes.set(p.id, p);
      return { status: 201, corpo: p };
    }),
  );

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>("/api/v1/pacientes/:id/agendamentos", async (req, reply) => {
    if (!pacientes.has(req.params.id)) return erro(reply, 404, "NAO_ENCONTRADO", "Paciente não encontrado.");
    const periodo = req.query.periodo ?? "futuro";
    const h = hoje();
    let lista = [...agendamentos.values()].filter((a) => a.paciente.id === req.params.id);
    if (periodo === "futuro") lista = lista.filter((a) => a.inicio.slice(0, 10) >= h).sort((x, y) => x.inicio.localeCompare(y.inicio));
    else if (periodo === "passado") lista = lista.filter((a) => a.inicio.slice(0, 10) < h).sort((x, y) => y.inicio.localeCompare(x.inicio));
    if (req.query.status) { const s = req.query.status.split(","); lista = lista.filter((a) => s.includes(a.status)); }
    return paginar(lista, req.query);
  });

  /* ---------- cadastros ---------- */
  app.get("/api/v1/unidades", async () => ({ dados: [UNIDADE] }));
  app.get("/api/v1/especialidades", async () => ({ dados: ESPECIALIDADES }));

  app.get<{ Querystring: Record<string, string | undefined> }>("/api/v1/profissionais", async (req) => {
    const q = req.query;
    const dados = PROFISSIONAIS.filter((p) =>
      (!q.especialidade_id || p.especialidades.some((e) => e.id === q.especialidade_id)) &&
      (!q.procedimento_id || p.procedimentos.includes(q.procedimento_id)) &&
      (!q.convenio_id || p.convenios.includes(q.convenio_id)) &&
      (!q.unidade_id || p.unidades.some((u) => u.id === q.unidade_id)),
    ).map(({ procedimentos: _p, convenios: _c, ...p }) => p);
    return { dados };
  });

  app.get<{ Querystring: Record<string, string | undefined> }>("/api/v1/procedimentos", async (req) => {
    const q = req.query;
    const busca = String(q.busca ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const prof = q.profissional_id ? PROFISSIONAIS.find((p) => p.id === q.profissional_id) : undefined;
    const lista = PROCEDIMENTOS.filter((p) =>
      (!busca || p.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(busca)) &&
      (!q.tipo || p.tipo === q.tipo) &&
      (!q.grupo_id || p.grupo?.id === q.grupo_id) &&
      (!q.profissional_id || (prof?.procedimentos.includes(p.id) ?? false)) &&
      (!q.convenio_id || PROFISSIONAIS.some((pr) => pr.procedimentos.includes(p.id) && pr.convenios.includes(q.convenio_id!))),
    );
    return paginar(lista, q);
  });

  app.get("/api/v1/grupos-procedimento", async () => ({
    dados: GRUPOS.map((g) => ({ ...g, total_procedimentos: PROCEDIMENTOS.filter((p) => p.grupo?.id === g.id).length })),
  }));

  app.get<{ Querystring: Record<string, string | undefined> }>("/api/v1/convenios", async (req) => {
    const q = req.query;
    const aceitos = new Set(
      PROFISSIONAIS.filter((p) => (!q.profissional_id || p.id === q.profissional_id) && (!q.procedimento_id || p.procedimentos.includes(q.procedimento_id)))
        .flatMap((p) => p.convenios),
    );
    return { dados: CONVENIOS.filter((c) => aceitos.has(c.id)) };
  });

  app.get<{ Querystring: Record<string, string | undefined> }>("/api/v1/precos", async (req, reply) => {
    const q = req.query;
    if (!q.procedimento_id) return erro(reply, 400, "PARAMETRO_INVALIDO", "procedimento_id é obrigatório.");
    const base = PRECOS[q.procedimento_id];
    if (base === undefined) return erro(reply, 404, "NAO_ENCONTRADO", "Procedimento não encontrado.");
    const particular = !q.convenio_id || q.convenio_id === "0";
    return { procedimento_id: q.procedimento_id, convenio_id: q.convenio_id ?? "0", valor_centavos: particular ? base : 0, coparticipacao_centavos: particular ? 0 : Math.round(base * 0.1), valor_particular_centavos: base, exige_autorizacao: false };
  });

  /* ---------- agenda ---------- */
  const profissional = (id: string) => PROFISSIONAIS.find((p) => p.id === id);

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>("/api/v1/profissionais/:id/dias-disponiveis", async (req, reply) => {
    if (!profissional(req.params.id)) return erro(reply, 404, "NAO_ENCONTRADO", "Profissional não encontrado.");
    const { de, ate } = req.query;
    if (!de || !ate) return erro(reply, 400, "PARAMETRO_INVALIDO", "de e ate são obrigatórios.");
    const dias = [];
    for (let d = de; d <= ate && dias.length < 90; d = somarDias(d, 1)) {
      const vagas = livres(req.params.id, d).length;
      if (vagas) dias.push({ data: d, vagas, unidade_id: "1" });
    }
    return { profissional_id: req.params.id, dias };
  });

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>("/api/v1/profissionais/:id/horarios-disponiveis", async (req, reply) => {
    if (!profissional(req.params.id)) return erro(reply, 404, "NAO_ENCONTRADO", "Profissional não encontrado.");
    const data = req.query.data;
    if (!data) return erro(reply, 400, "PARAMETRO_INVALIDO", "data é obrigatória.");
    return { profissional_id: req.params.id, data, tipo_agenda: "horario_marcado", horarios: livres(req.params.id, data) };
  });

  app.get<{ Querystring: Record<string, string | undefined> }>("/api/v1/agenda", async (req, reply) => {
    const { data, profissional_id } = req.query;
    if (!data || !profissional_id) return erro(reply, 400, "PARAMETRO_INVALIDO", "data e profissional_id são obrigatórios.");
    const itens: unknown[] = [...agendamentos.values()]
      .filter((a) => a.profissional.id === profissional_id && a.inicio.startsWith(data) && a.status !== "remarcado")
      .map((a) => ({
        tipo: "agendamento", inicio: a.inicio.slice(11, 16), fim: a.fim.slice(11, 16),
        agendamento: { id: a.id, status: a.status, paciente: a.paciente, procedimentos: a.procedimentos.map(({ id, nome }) => ({ id, nome })), convenio: { id: a.convenio.id, nome: a.convenio.nome }, observacao: a.observacao },
      }));
    if (req.query.incluir_livres !== "false") itens.push(...livres(profissional_id, data).map((l) => ({ tipo: "livre", ...l })));
    itens.sort((x: any, y: any) => x.inicio.localeCompare(y.inicio));
    return { data, profissional_id, itens };
  });

  /* ---------- agendamentos ---------- */
  function criarAgendamento(b: any, remarcadoDe: Agendamento | null): { status: number; corpo: unknown } {
    const prof = profissional(String(b.profissional_id ?? ""));
    const pac = pacientes.get(String(b.paciente_id ?? ""));
    if (!prof || !pac) return { status: 422, corpo: { erro: { codigo: "VALIDACAO", mensagem: "Profissional ou paciente inexistente.", campos: { ...(!prof ? { profissional_id: "inexistente" } : {}), ...(!pac ? { paciente_id: "inexistente" } : {}) } } } };
    const data = String(b.data ?? ""), horario = String(b.horario ?? "");
    if (!GRADE.includes(horario) || [0, 6].includes(diaDaSemana(data))) return { status: 422, corpo: { erro: { codigo: "FORA_DA_GRADE", mensagem: "Horário fora da agenda do profissional." } } };
    if (ocupado(prof.id, data, horario)) return { status: 409, corpo: { erro: { codigo: "HORARIO_OCUPADO", mensagem: `O horário ${horario} de ${data} já foi ocupado.` } } };
    const convenio = CONVENIOS.find((c) => c.id === String(b.convenio_id ?? "0"));
    if (!convenio || !prof.convenios.includes(convenio.id)) return { status: 422, corpo: { erro: { codigo: "CONVENIO_NAO_ACEITO", mensagem: "O profissional não atende este convênio." } } };
    const procs = (Array.isArray(b.procedimento_ids) ? b.procedimento_ids : []).map((id: string) => PROCEDIMENTOS.find((p) => p.id === id)).filter(Boolean) as typeof PROCEDIMENTOS;
    if (!procs.length) return { status: 422, corpo: { erro: { codigo: "VALIDACAO", mensagem: "Informe ao menos um procedimento.", campos: { procedimento_ids: "obrigatório" } } } };
    const a: Agendamento = {
      id: novoId(""), status: "agendado", inicio: `${data}T${horario}:00${FUSO}`, fim: `${data}T${mais30(horario)}:00${FUSO}`,
      paciente: resumoPaciente(pac), profissional: { id: prof.id, nome: prof.nome }, especialidade: prof.especialidades[0],
      procedimentos: procs.map((p) => ({ id: p.id, nome: p.nome, preparo: p.preparo })),
      convenio: { id: convenio.id, nome: convenio.nome, plano_id: b.plano_id ?? null, carteirinha: b.carteirinha ?? null },
      unidade: { id: UNIDADE.id, nome: UNIDADE.nome }, valor_centavos: convenio.particular ? PRECOS[procs[0].id] ?? null : 0,
      observacao: b.observacao ?? null, origem: "kentro", id_externo: null,
      remarcado_de_id: remarcadoDe?.id ?? null, remarcado_para_id: null, confirmacao: { enviada_em: null, respondida_em: null },
      cancelamento: null, criado_em: agora(), atualizado_em: agora(),
    };
    agendamentos.set(a.id, a);
    if (remarcadoDe) Object.assign(remarcadoDe, { status: "remarcado", remarcado_para_id: a.id, atualizado_em: agora() });
    return { status: 201, corpo: a };
  }

  app.post<{ Body: any }>("/api/v1/agendamentos", async (req, reply) =>
    idempotente(req, reply, () => {
      const r = criarAgendamento(req.body ?? {}, null);
      if (r.status === 201) (r.corpo as Agendamento).id_externo = String(req.headers["idempotency-key"] ?? "") || null;
      return r;
    }),
  );

  app.get<{ Params: { id: string } }>("/api/v1/agendamentos/:id", async (req, reply) =>
    agendamentos.get(req.params.id) ?? erro(reply, 404, "NAO_ENCONTRADO", "Agendamento não encontrado."),
  );

  app.get<{ Querystring: Record<string, string | undefined> }>("/api/v1/agendamentos", async (req) => {
    const q = req.query;
    const status = q.status?.split(",");
    const lista = [...agendamentos.values()].filter((a) =>
      (!q.de || a.inicio.slice(0, 10) >= q.de) && (!q.ate || a.inicio.slice(0, 10) <= q.ate) &&
      (!q.profissional_id || a.profissional.id === q.profissional_id) && (!q.paciente_id || a.paciente.id === q.paciente_id) &&
      (!status || status.includes(a.status)) && (!q.alterados_desde || a.atualizado_em >= q.alterados_desde),
    ).sort((x, y) => x.inicio.localeCompare(y.inicio));
    return paginar(lista, q);
  });

  app.post<{ Params: { id: string }; Body: any }>("/api/v1/agendamentos/:id/remarcar", async (req, reply) =>
    idempotente(req, reply, () => {
      const original = agendamentos.get(req.params.id);
      if (!original) return { status: 404, corpo: { erro: { codigo: "NAO_ENCONTRADO", mensagem: "Agendamento não encontrado." } } };
      if (["atendido", "cancelado", "remarcado"].includes(original.status)) return { status: 409, corpo: { erro: { codigo: "STATUS_NAO_PERMITE", mensagem: `A consulta está ${original.status}.` } } };
      const b = req.body ?? {};
      return criarAgendamento({
        paciente_id: original.paciente.id, profissional_id: b.profissional_id ?? original.profissional.id, data: b.data, horario: b.horario,
        convenio_id: original.convenio.id, procedimento_ids: original.procedimentos.map((p) => p.id), observacao: original.observacao,
      }, original);
    }),
  );

  app.post<{ Params: { id: string }; Body: any }>("/api/v1/agendamentos/:id/cancelar", async (req, reply) => {
    const a = agendamentos.get(req.params.id);
    if (!a) return erro(reply, 404, "NAO_ENCONTRADO", "Agendamento não encontrado.");
    if (a.status === "cancelado") return a;
    if (["atendido", "remarcado"].includes(a.status)) return erro(reply, 409, "STATUS_NAO_PERMITE", `A consulta está ${a.status}.`);
    Object.assign(a, { status: "cancelado", cancelamento: { em: agora(), motivo: req.body?.motivo ?? null, por: req.body?.por ?? "paciente" }, atualizado_em: agora() });
    return a;
  });

  const TRANSICOES: Record<string, Status[]> = {
    confirmado: ["agendado", "confirmado"], presente: ["agendado", "confirmado", "presente"],
    atendido: ["presente", "confirmado", "agendado", "atendido"], ausente: ["agendado", "confirmado", "ausente"],
  };
  app.post<{ Params: { id: string }; Body: any }>("/api/v1/agendamentos/:id/status", async (req, reply) => {
    const a = agendamentos.get(req.params.id);
    if (!a) return erro(reply, 404, "NAO_ENCONTRADO", "Agendamento não encontrado.");
    const novo = String(req.body?.status ?? "");
    if (!TRANSICOES[novo]) return erro(reply, 400, "PARAMETRO_INVALIDO", "status deve ser confirmado, presente, atendido ou ausente.");
    if (!TRANSICOES[novo].includes(a.status)) return erro(reply, 409, "STATUS_NAO_PERMITE", `Não é possível ir de ${a.status} para ${novo}.`);
    Object.assign(a, { status: novo, atualizado_em: agora() });
    return a;
  });

  /* ---------- confirmação ---------- */
  app.get<{ Querystring: Record<string, string | undefined> }>("/api/v1/confirmacoes/pendentes", async (req, reply) => {
    const data = req.query.data_consulta;
    if (!data) return erro(reply, 400, "PARAMETRO_INVALIDO", "data_consulta é obrigatória.");
    const datas = [data];
    if (req.query.incluir_fim_de_semana === "true") datas.push(somarDias(data, 1), somarDias(data, 2));
    const lista = [...agendamentos.values()]
      .filter((a) => a.status === "agendado" && !a.confirmacao.enviada_em && datas.includes(a.inicio.slice(0, 10)))
      .map((a) => {
        const p = pacientes.get(a.paciente.id)!;
        return {
          agendamento_id: a.id, inicio: a.inicio,
          paciente: { id: p.id, nome: p.nome, telefone_whatsapp: p.telefones.find((t) => t.whatsapp)?.numero ?? null },
          profissional: a.profissional, especialidade: a.especialidade.nome,
          procedimentos: a.procedimentos.map(({ nome, preparo }) => ({ nome, preparo })),
          unidade: { nome: UNIDADE.nome, endereco_texto: "Av. Central, 500, Centro, Vila Velha/ES", link_mapa: null },
        };
      });
    return paginar(lista, req.query);
  });

  app.post<{ Body: any }>("/api/v1/confirmacoes/enviadas", async (req, reply) => {
    const enviados = req.body?.enviados;
    if (!Array.isArray(enviados) || !enviados.length || enviados.length > 50) return erro(reply, 400, "PARAMETRO_INVALIDO", "enviados: de 1 a 50 itens.");
    return {
      resultados: enviados.map((e: any) => {
        const a = agendamentos.get(String(e?.agendamento_id ?? ""));
        if (!a) return { agendamento_id: e?.agendamento_id ?? null, ok: false };
        a.confirmacao.enviada_em = a.confirmacao.enviada_em ?? String(e.enviado_em ?? agora());
        return { agendamento_id: a.id, ok: true };
      }),
    };
  });

  /* ---------- financeiro ---------- */
  app.post<{ Body: any }>("/api/v1/contas", async (req, reply) =>
    idempotente(req, reply, () => {
      const b = req.body ?? {};
      const formas = ["pix", "boleto", "cartao_credito", "cartao_debito", "dinheiro"];
      if (!pacientes.has(String(b.paciente_id ?? ""))) return { status: 422, corpo: { erro: { codigo: "VALIDACAO", mensagem: "Paciente inexistente.", campos: { paciente_id: "inexistente" } } } };
      if (!Number.isInteger(b.valor_centavos) || b.valor_centavos <= 0) return { status: 422, corpo: { erro: { codigo: "VALIDACAO", mensagem: "valor_centavos deve ser inteiro positivo.", campos: { valor_centavos: "inválido" } } } };
      if (!formas.includes(b.forma_pagamento)) return { status: 422, corpo: { erro: { codigo: "VALIDACAO", mensagem: "Forma de pagamento não aceita.", campos: { forma_pagamento: "inválida" } } } };
      const c = {
        id: novoId("c"), paciente_id: String(b.paciente_id), agendamento_id: b.agendamento_id ?? null, descricao: b.descricao ?? null,
        valor_centavos: b.valor_centavos, valor_pago_centavos: 0, vencimento: b.vencimento ?? hoje(), forma_pagamento: b.forma_pagamento,
        parcelas: b.parcelas ?? 1, status: "aberta", link_pagamento: null, pix_copia_cola: null, pago_em: null,
        id_externo: String(req.headers["idempotency-key"] ?? "") || null, criado_em: agora(),
      };
      contas.set(c.id, c);
      return { status: 201, corpo: c };
    }),
  );

  app.get<{ Querystring: Record<string, string | undefined> }>("/api/v1/contas", async (req) => {
    const q = req.query;
    return paginar([...contas.values()].filter((c) => (!q.paciente_id || c.paciente_id === q.paciente_id) && (!q.status || c.status === q.status)), q);
  });

  app.get<{ Params: { id: string } }>("/api/v1/contas/:id", async (req, reply) => contas.get(req.params.id) ?? erro(reply, 404, "NAO_ENCONTRADO", "Conta não encontrada."));

  app.post<{ Params: { id: string } }>("/api/v1/contas/:id/cancelar", async (req, reply) => {
    const c = contas.get(req.params.id);
    if (!c) return erro(reply, 404, "NAO_ENCONTRADO", "Conta não encontrada.");
    if (c.status === "paga") return erro(reply, 409, "STATUS_NAO_PERMITE", "Conta já paga: estorno é feito no ERP.");
    c.status = "cancelada";
    return c;
  });

  app.setNotFoundHandler((_req, reply) => erro(reply, 404, "NAO_ENCONTRADO", "Rota inexistente."));
  return app;
}

// Rodado direto: sobe na porta PORTA (4010).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const app = criarErpSimulado({ token: process.env.TOKEN });
  const porta = Number(process.env.PORTA ?? 4010);
  await app.listen({ port: porta, host: "127.0.0.1" });
  console.log(`ERP simulado em http://127.0.0.1:${porta}/api/v1 (token: ${process.env.TOKEN ?? "token-de-teste"})`);
}
