import assert from "node:assert/strict";
import { test } from "node:test";
import { conveniosDoExame, exames, prestadoresDoExame, procedimentos } from "../src/normalizar.js";

// Exemplos da coleção pública da Asa (Postman).
test("exames: lista de procedimentos com tipo", () => {
  const r = exames({ procedimentos: [{ id: 11650, descricao: "Retorno", tipo: "consulta" }, { id: 41982, descricao: "Ressonância Magnética (RM)", tipo: "exame" }, { id: 1 }] });
  assert.deepEqual(r, [
    { id: "11650", nome: "Retorno", tipo: "consulta" },
    { id: "41982", nome: "Ressonância Magnética (RM)", tipo: "exame" },
  ]);
});

test("convênios do exame: valor em texto vira número", () => {
  assert.deepEqual(conveniosDoExame({ status: "success", convenios: [{ id: 142, nome: "Particular", valor: "150.00" }] }), [
    { id: "142", nome: "Particular", valor: 150 },
  ]);
});

test("prestadores do exame: valor do convênio pedido e ordem de chegada", () => {
  const corpo = {
    prestadores: [
      { id: 91, nome: "Sala 02", especialidade: "Clínico Geral", ordem_chegada: false, convenios: [{ convenio_id: 142, convenio_nome: "Particular", valor_procedimento: "1000.00" }, { convenio_id: 143, valor_procedimento: "65.32" }] },
      { id: 92, nome: "Dr. Fabiano Rocha", especialidade: "Clínico Geral", ordem_chegada: 1 },
    ],
  };
  assert.deepEqual(prestadoresDoExame(corpo, "143"), [
    { id: "91", nome: "Sala 02", especialidade: "Clínico Geral", ordem_chegada: false, valor: 65.32 },
    { id: "92", nome: "Dr. Fabiano Rocha", especialidade: "Clínico Geral", ordem_chegada: true, valor: null },
  ]);
});

test("procedimentos do horário: guarda o id do procedimento para casar com o exame escolhido", () => {
  const [p] = procedimentos({ procedimentos: [{ convenio_procedimento_id: 9, valor: "0", procedimento_instituicao: { id: 77, procedimento_id: 41982, descricao: "RM" } }] });
  assert.equal(p.id, "9");
  assert.equal(p.procedimento_id, "41982");
});
