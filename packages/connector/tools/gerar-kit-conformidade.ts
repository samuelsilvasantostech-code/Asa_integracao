// Gera o kit de conformidade (coleção do Postman, formato v2.1) que o time de um ERP roda contra a própria
// API para saber se ela segue a especificação da Kentro. Saída: kit-conformidade/clinfy-conformidade.postman_collection.json
//
//   npx tsx tools/gerar-kit-conformidade.ts
//
// A coleção cria um paciente de teste e trabalha só com ele: roda em HOMOLOGAÇÃO, nunca em produção.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Metodo = "GET" | "POST";
interface Passo {
  nome: string;
  metodo: Metodo;
  caminho: string; // depois de {{baseUrl}}, com {{variaveis}}
  query?: Record<string, string>;
  corpo?: unknown;
  cabecalhos?: Record<string, string>;
  semToken?: boolean;
  antes?: string[]; // pre-request script
  testes: string[];
}

// Conferências que valem para toda resposta.
const COMUNS = [
  `pm.test("responde em até 10 s", () => pm.expect(pm.response.responseTime).to.be.below(10000));`,
  `if (pm.response.code >= 400) {`,
  `  pm.test("erro no envelope {erro: {codigo, mensagem}}", () => {`,
  `    const e = pm.response.json().erro;`,
  `    pm.expect(e, "objeto erro").to.be.an("object");`,
  `    pm.expect(e.codigo, "erro.codigo em MAIÚSCULAS").to.match(/^[A-Z][A-Z0-9_]+$/);`,
  `    pm.expect(e.mensagem, "erro.mensagem").to.be.a("string");`,
  `  });`,
  `} else if (pm.response.code !== 204) {`,
  `  pm.test("corpo em JSON", () => pm.response.to.be.json);`,
  `}`,
];

const status = (codigo: number) => `pm.test("HTTP ${codigo}", () => pm.response.to.have.status(${codigo}));`;
const codigoErro = (codigo: string) => `pm.test("erro.codigo = ${codigo}", () => pm.expect(pm.response.json().erro.codigo).to.eql("${codigo}"));`;
const lista = (campo = "dados") => `pm.test("${campo} é uma lista", () => pm.expect(pm.response.json().${campo}).to.be.an("array"));`;
const paginacao = `pm.test("paginacao {pagina, por_pagina, total}", () => { const p = pm.response.json().paginacao; pm.expect(p).to.be.an("object"); pm.expect(p.total).to.be.a("number"); });`;
const idTexto = (expr: string, nome: string) => `pm.test("${nome}.id é texto", () => pm.expect(${expr}.id).to.be.a("string").and.not.empty);`;

// Um CPF válido novo a cada execução, e um celular de teste, para o paciente do kit.
const gerarPaciente = [
  `const n = Array.from({length: 9}, () => Math.floor(Math.random() * 10));`,
  `const dv = (arr) => { const s = arr.reduce((t, d, i) => t + d * (arr.length + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s; };`,
  `n.push(dv(n)); n.push(dv(n));`,
  `pm.collectionVariables.set("cpfTeste", n.join(""));`,
  `pm.collectionVariables.set("telefoneTeste", "55279" + String(Math.floor(10000000 + Math.random() * 89999999)));`,
  `pm.collectionVariables.set("execucao", String(Date.now()));`,
];

const datas = [
  `const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);`,
  `const ate = new Date(Date.now() - 3 * 3600e3 + 30 * 864e5).toISOString().slice(0, 10);`,
  `pm.collectionVariables.set("hoje", hoje); pm.collectionVariables.set("ate", ate);`,
];

const OBRIGATORIAS: Passo[] = [
  {
    nome: "01 GET /status", metodo: "GET", caminho: "/status",
    testes: [status(200), `pm.test("ok = true e clinica.id", () => { const b = pm.response.json(); pm.expect(b.ok).to.eql(true); pm.expect(b.clinica.id).to.be.a("string"); });`],
  },
  {
    nome: "02 sem token → 401", metodo: "GET", caminho: "/status", semToken: true,
    testes: [status(401), codigoErro("NAO_AUTENTICADO")],
  },
  {
    nome: "03 POST /pacientes (paciente do kit)", metodo: "POST", caminho: "/pacientes", antes: gerarPaciente,
    cabecalhos: { "Idempotency-Key": "kit-paciente-{{execucao}}" },
    corpo: { nome: "Paciente Kit Conformidade", cpf: "{{cpfTeste}}", nascimento: "1990-01-15", telefones: [{ numero: "{{telefoneTeste}}", tipo: "celular", whatsapp: true, principal: true }] },
    testes: [status(201), idTexto("pm.response.json()", "paciente"), `pm.collectionVariables.set("pacienteId", pm.response.json().id);`],
  },
  {
    nome: "04 POST /pacientes com o mesmo CPF → 409", metodo: "POST", caminho: "/pacientes",
    cabecalhos: { "Idempotency-Key": "kit-paciente-dup-{{execucao}}" },
    corpo: { nome: "Outro Nome", cpf: "{{cpfTeste}}", nascimento: "1980-01-01", telefones: [{ numero: "5527911112222", tipo: "celular", whatsapp: true, principal: true }] },
    testes: [status(409), codigoErro("PACIENTE_JA_EXISTE")],
  },
  {
    nome: "05 GET /pacientes?cpf", metodo: "GET", caminho: "/pacientes", query: { cpf: "{{cpfTeste}}" },
    testes: [status(200), lista(), paginacao, `pm.test("acha o paciente do kit, sem ter alterado o nome", () => { const p = pm.response.json().dados.find(x => x.id === pm.collectionVariables.get("pacienteId")); pm.expect(p, "paciente").to.be.an("object"); pm.expect(p.nome).to.eql("Paciente Kit Conformidade"); pm.expect(p.telefones).to.be.an("array"); });`],
  },
  {
    nome: "06 GET /pacientes?telefone (sem DDI)", metodo: "GET", caminho: "/pacientes",
    antes: [`pm.collectionVariables.set("telefoneSemDdi", pm.collectionVariables.get("telefoneTeste").slice(2));`],
    query: { telefone: "{{telefoneSemDdi}}" },
    testes: [status(200), lista(), `pm.test("acha pelo telefone sem o 55", () => pm.expect(pm.response.json().dados.map(x => x.id)).to.include(pm.collectionVariables.get("pacienteId")));`],
  },
  {
    nome: "07 busca sem resultado → 200 com lista vazia", metodo: "GET", caminho: "/pacientes", query: { cpf: "00000000191" },
    testes: [status(200), `pm.test("dados = []", () => pm.expect(pm.response.json().dados).to.eql([]));`],
  },
  {
    nome: "08 GET /pacientes/{id}", metodo: "GET", caminho: "/pacientes/{{pacienteId}}",
    testes: [status(200), `pm.test("mesmo id, nascimento YYYY-MM-DD", () => { const b = pm.response.json(); pm.expect(b.id).to.eql(pm.collectionVariables.get("pacienteId")); pm.expect(b.nascimento).to.match(/^\\d{4}-\\d{2}-\\d{2}$/); });`],
  },
  {
    nome: "09 GET /pacientes/{id} inexistente → 404", metodo: "GET", caminho: "/pacientes/kit-inexistente-0000",
    testes: [status(404), codigoErro("NAO_ENCONTRADO")],
  },
  {
    nome: "10 GET /especialidades", metodo: "GET", caminho: "/especialidades",
    testes: [status(200), lista(), `pm.test("ao menos uma, com id texto e nome", () => { const e = pm.response.json().dados[0]; pm.expect(e.id).to.be.a("string"); pm.expect(e.nome).to.be.a("string"); });`],
  },
  {
    nome: "11 GET /profissionais", metodo: "GET", caminho: "/profissionais",
    testes: [
      status(200), lista(),
      `const p = pm.response.json().dados.find(x => x.tipo_agenda === "horario_marcado");`,
      `pm.test("há profissional com tipo_agenda horario_marcado", () => pm.expect(p).to.be.an("object"));`,
      `pm.test("tipo_agenda válido em todos", () => pm.response.json().dados.forEach(x => pm.expect(["horario_marcado", "ordem_chegada"]).to.include(x.tipo_agenda)));`,
      `if (p) pm.collectionVariables.set("profissionalId", p.id);`,
    ],
  },
  {
    nome: "12 GET /procedimentos do profissional", metodo: "GET", caminho: "/procedimentos", query: { profissional_id: "{{profissionalId}}" },
    testes: [
      status(200), lista(), paginacao,
      `pm.test("tipo válido em todos", () => pm.response.json().dados.forEach(x => pm.expect(["consulta", "exame", "retorno", "procedimento"]).to.include(x.tipo)));`,
      `const p = pm.response.json().dados[0]; pm.test("ao menos um procedimento", () => pm.expect(p).to.be.an("object"));`,
      `if (p) pm.collectionVariables.set("procedimentoId", p.id);`,
    ],
  },
  {
    nome: "13 GET /convenios do profissional", metodo: "GET", caminho: "/convenios", query: { profissional_id: "{{profissionalId}}" },
    testes: [
      status(200), lista(),
      `const c = pm.response.json().dados.find(x => x.particular) || pm.response.json().dados[0];`,
      `pm.test("ao menos um convênio", () => pm.expect(c).to.be.an("object"));`,
      `if (c) pm.collectionVariables.set("convenioId", c.id);`,
    ],
  },
  {
    nome: "14 GET dias disponíveis", metodo: "GET", caminho: "/profissionais/{{profissionalId}}/dias-disponiveis", antes: datas,
    query: { de: "{{hoje}}", ate: "{{ate}}" },
    testes: [
      status(200), lista("dias"),
      `const d = pm.response.json().dias.find(x => x.data > pm.collectionVariables.get("hoje"));`,
      `pm.test("há dia livre nos próximos 30 dias (data YYYY-MM-DD)", () => { pm.expect(d).to.be.an("object"); pm.expect(d.data).to.match(/^\\d{4}-\\d{2}-\\d{2}$/); });`,
      `if (d) pm.collectionVariables.set("dataLivre", d.data);`,
    ],
  },
  {
    nome: "15 GET horários disponíveis", metodo: "GET", caminho: "/profissionais/{{profissionalId}}/horarios-disponiveis", query: { data: "{{dataLivre}}" },
    testes: [
      status(200), lista("horarios"),
      `const hs = pm.response.json().horarios.filter(h => /^\\d{2}:\\d{2}$/.test(h.inicio));`,
      `pm.test("ao menos dois horários HH:MM", () => pm.expect(hs.length).to.be.at.least(2));`,
      `if (hs[0]) { pm.collectionVariables.set("horario", hs[0].inicio); pm.collectionVariables.set("slotId", hs[0].slot_id || ""); }`,
      `if (hs[1]) { pm.collectionVariables.set("horario2", hs[1].inicio); pm.collectionVariables.set("slotId2", hs[1].slot_id || ""); }`,
    ],
  },
  {
    nome: "16 GET /agenda do dia", metodo: "GET", caminho: "/agenda", query: { data: "{{dataLivre}}", profissional_id: "{{profissionalId}}" },
    testes: [status(200), lista("itens"), `pm.test("tipo de cada item", () => pm.response.json().itens.forEach(i => pm.expect(["agendamento", "livre", "bloqueio"]).to.include(i.tipo)));`],
  },
  {
    nome: "17 POST /agendamentos (marcar)", metodo: "POST", caminho: "/agendamentos",
    cabecalhos: { "Idempotency-Key": "kit-marcar-{{execucao}}" },
    corpo: { paciente_id: "{{pacienteId}}", profissional_id: "{{profissionalId}}", data: "{{dataLivre}}", horario: "{{horario}}", slot_id: "{{slotId}}", procedimento_ids: ["{{procedimentoId}}"], convenio_id: "{{convenioId}}", observacao: "Kit de conformidade Kentro", usuario: "kit.conformidade" },
    testes: [
      status(201), idTexto("pm.response.json()", "agendamento"),
      `pm.test("status agendado, inicio na data e hora pedidas, com fuso", () => { const a = pm.response.json(); pm.expect(a.status).to.eql("agendado"); pm.expect(a.inicio).to.match(new RegExp("^" + pm.collectionVariables.get("dataLivre") + "T" + pm.collectionVariables.get("horario") + ".*[+-]\\\\d{2}:\\\\d{2}$")); });`,
      `pm.collectionVariables.set("agendamentoId", pm.response.json().id);`,
    ],
  },
  {
    nome: "18 mesma Idempotency-Key → mesma consulta", metodo: "POST", caminho: "/agendamentos",
    cabecalhos: { "Idempotency-Key": "kit-marcar-{{execucao}}" },
    corpo: { paciente_id: "{{pacienteId}}", profissional_id: "{{profissionalId}}", data: "{{dataLivre}}", horario: "{{horario}}", slot_id: "{{slotId}}", procedimento_ids: ["{{procedimentoId}}"], convenio_id: "{{convenioId}}" },
    testes: [`pm.test("2xx com o mesmo id (sem consulta duplicada)", () => { pm.expect(pm.response.code).to.be.within(200, 201); pm.expect(pm.response.json().id).to.eql(pm.collectionVariables.get("agendamentoId")); });`],
  },
  {
    nome: "19 mesmo horário, outra chave → 409", metodo: "POST", caminho: "/agendamentos",
    cabecalhos: { "Idempotency-Key": "kit-marcar-dup-{{execucao}}" },
    corpo: { paciente_id: "{{pacienteId}}", profissional_id: "{{profissionalId}}", data: "{{dataLivre}}", horario: "{{horario}}", slot_id: "{{slotId}}", procedimento_ids: ["{{procedimentoId}}"], convenio_id: "{{convenioId}}" },
    testes: [status(409), `pm.test("HORARIO_OCUPADO ou PACIENTE_JA_AGENDADO", () => pm.expect(["HORARIO_OCUPADO", "PACIENTE_JA_AGENDADO"]).to.include(pm.response.json().erro.codigo));`],
  },
  {
    nome: "20 marcar com dados inválidos → 4xx (nunca 200)", metodo: "POST", caminho: "/agendamentos",
    cabecalhos: { "Idempotency-Key": "kit-invalido-{{execucao}}" },
    corpo: { paciente_id: "{{pacienteId}}" },
    testes: [`pm.test("recusa com 400 ou 422", () => pm.expect([400, 422]).to.include(pm.response.code));`],
  },
  {
    nome: "21 GET /agendamentos/{id}", metodo: "GET", caminho: "/agendamentos/{{agendamentoId}}",
    testes: [status(200), `pm.test("mesmo id e paciente", () => { const a = pm.response.json(); pm.expect(a.id).to.eql(pm.collectionVariables.get("agendamentoId")); pm.expect(a.paciente.id).to.eql(pm.collectionVariables.get("pacienteId")); });`],
  },
  {
    nome: "22 GET /pacientes/{id}/agendamentos", metodo: "GET", caminho: "/pacientes/{{pacienteId}}/agendamentos", query: { periodo: "futuro" },
    testes: [status(200), lista(), `pm.test("contém a consulta marcada", () => pm.expect(pm.response.json().dados.map(x => x.id)).to.include(pm.collectionVariables.get("agendamentoId")));`],
  },
  {
    nome: "23 POST status confirmado", metodo: "POST", caminho: "/agendamentos/{{agendamentoId}}/status",
    corpo: { status: "confirmado", origem: "whatsapp", usuario: "kit.conformidade" },
    testes: [status(200), `pm.test("status = confirmado", () => pm.expect(pm.response.json().status).to.eql("confirmado"));`],
  },
  {
    nome: "24 POST remarcar", metodo: "POST", caminho: "/agendamentos/{{agendamentoId}}/remarcar",
    cabecalhos: { "Idempotency-Key": "kit-remarcar-{{execucao}}" },
    corpo: { data: "{{dataLivre}}", horario: "{{horario2}}", slot_id: "{{slotId2}}", motivo: "Kit de conformidade", usuario: "kit.conformidade" },
    testes: [
      status(201),
      `pm.test("consulta nova ligada à antiga", () => { const a = pm.response.json(); pm.expect(a.id).to.not.eql(pm.collectionVariables.get("agendamentoId")); pm.expect(a.remarcado_de_id).to.eql(pm.collectionVariables.get("agendamentoId")); });`,
      `pm.collectionVariables.set("agendamentoId2", pm.response.json().id);`,
    ],
  },
  {
    nome: "25 a antiga ficou remarcado", metodo: "GET", caminho: "/agendamentos/{{agendamentoId}}",
    testes: [status(200), `pm.test("status = remarcado", () => pm.expect(pm.response.json().status).to.eql("remarcado"));`],
  },
  {
    nome: "26 POST cancelar", metodo: "POST", caminho: "/agendamentos/{{agendamentoId2}}/cancelar",
    corpo: { motivo: "Kit de conformidade", por: "clinica", usuario: "kit.conformidade" },
    testes: [status(200), `pm.test("status = cancelado", () => pm.expect(pm.response.json().status).to.eql("cancelado"));`],
  },
  {
    nome: "27 cancelar de novo → 200 (repetível)", metodo: "POST", caminho: "/agendamentos/{{agendamentoId2}}/cancelar",
    corpo: { motivo: "Kit de conformidade", por: "clinica" },
    testes: [status(200)],
  },
  {
    nome: "28 status em consulta cancelada → 409", metodo: "POST", caminho: "/agendamentos/{{agendamentoId2}}/status",
    corpo: { status: "atendido" },
    testes: [status(409), codigoErro("STATUS_NAO_PERMITE")],
  },
];

const DESEJAVEIS: Passo[] = [
  { nome: "D1 GET /unidades", metodo: "GET", caminho: "/unidades", testes: [status(200), lista()] },
  { nome: "D2 GET /grupos-procedimento", metodo: "GET", caminho: "/grupos-procedimento", testes: [status(200), lista()] },
  { nome: "D3 GET /precos", metodo: "GET", caminho: "/precos", query: { procedimento_id: "{{procedimentoId}}", convenio_id: "{{convenioId}}" }, testes: [status(200), `pm.test("valor em centavos (inteiro) ou null", () => { const v = pm.response.json().valor_centavos; pm.expect(v === null || Number.isInteger(v)).to.eql(true); });`] },
  { nome: "D4 GET /agendamentos?alterados_desde", metodo: "GET", caminho: "/agendamentos", query: { alterados_desde: "{{hoje}}T00:00:00-03:00" }, testes: [status(200), lista()] },
  { nome: "D5 GET /confirmacoes/pendentes", metodo: "GET", caminho: "/confirmacoes/pendentes", query: { data_consulta: "{{dataLivre}}" }, testes: [status(200), lista()] },
  {
    nome: "D6 POST /contas", metodo: "POST", caminho: "/contas", cabecalhos: { "Idempotency-Key": "kit-conta-{{execucao}}" },
    corpo: { paciente_id: "{{pacienteId}}", descricao: "Kit de conformidade", valor_centavos: 1000, vencimento: "{{dataLivre}}", forma_pagamento: "pix", parcelas: 1 },
    testes: [status(201), idTexto("pm.response.json()", "conta"), `pm.collectionVariables.set("contaId", pm.response.json().id);`],
  },
  { nome: "D7 POST /contas/{id}/cancelar", metodo: "POST", caminho: "/contas/{{contaId}}/cancelar", corpo: { motivo: "Kit de conformidade" }, testes: [status(200)] },
];

function item(p: Passo) {
  const [semQuery] = p.caminho.split("?");
  const header = [
    ...(p.semToken ? [] : [{ key: "Authorization", value: "Bearer {{token}}" }]),
    { key: "Accept", value: "application/json" },
    ...(p.corpo !== undefined ? [{ key: "Content-Type", value: "application/json" }] : []),
    ...Object.entries(p.cabecalhos ?? {}).map(([key, value]) => ({ key, value })),
  ];
  const query = Object.entries(p.query ?? {}).map(([key, value]) => ({ key, value }));
  const raw = "{{baseUrl}}" + semQuery + (query.length ? "?" + query.map((q) => `${q.key}=${q.value}`).join("&") : "");
  return {
    name: p.nome,
    event: [
      ...(p.antes ? [{ listen: "prerequest", script: { type: "text/javascript", exec: p.antes } }] : []),
      { listen: "test", script: { type: "text/javascript", exec: [...COMUNS, ...p.testes] } },
    ],
    request: {
      method: p.metodo,
      auth: { type: "noauth" },
      header,
      url: { raw, host: ["{{baseUrl}}"], path: semQuery.split("/").filter(Boolean), ...(query.length ? { query } : {}) },
      ...(p.corpo !== undefined ? { body: { mode: "raw", raw: JSON.stringify(p.corpo, null, 2), options: { raw: { language: "json" } } } } : {}),
    },
  };
}

const colecao = {
  info: {
    name: "ClinFy · Conformidade da API do ERP",
    description:
      "Kit de conformidade da especificação da API do ERP para a extensão ClinFy (Kentro). " +
      "Rode em HOMOLOGAÇÃO: o kit cria um paciente, consultas e uma conta de teste. " +
      "Variáveis: baseUrl (ex.: https://erp.exemplo.com/api/v1) e token. A pasta Obrigatórias precisa passar inteira.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "baseUrl", value: "https://erp.exemplo.com/api/v1" },
    { key: "token", value: "" },
  ],
  item: [
    { name: "Obrigatórias", item: OBRIGATORIAS.map(item) },
    { name: "Desejáveis", item: DESEJAVEIS.map(item) },
  ],
};

const saida = resolve(dirname(fileURLToPath(import.meta.url)), "../../../kit-conformidade/clinfy-conformidade.postman_collection.json");
mkdirSync(dirname(saida), { recursive: true });
writeFileSync(saida, JSON.stringify(colecao, null, 2) + "\n", "utf8");
console.log(`kit gerado: ${saida} (${OBRIGATORIAS.length} obrigatórias, ${DESEJAVEIS.length} desejáveis)`);
