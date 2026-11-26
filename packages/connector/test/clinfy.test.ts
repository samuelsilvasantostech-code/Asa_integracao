import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { DIR_EXTENSAO, montarClinfy } from "../tools/montar-clinfy.js";

// A tela única do administrador é montada das telas de sempre: precisa estar em dia com elas.
test("clinfy.html está em dia com inicio, agenda, painel, config e confirmacao (rode tools/montar-clinfy.ts)", () => {
  const gravado = readFileSync(resolve(DIR_EXTENSAO, "clinfy.html"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(gravado, montarClinfy());
});

test("clinfy.html: ids únicos, as quatro abas e os prefixos que o hub.js usa", () => {
  const html = montarClinfy();
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(repetidos, []);
  for (const id of ["tab-inicio", "sec-inicio", "in-pill", "tab-agenda", "tab-painel", "tab-configurar", "sec-agenda", "sec-painel", "sec-configurar", "ag-pill", "pn-pill", "cf-conn-text", "cc-conn-text"]) {
    assert.ok(ids.includes(id), id);
  }
  const hub = readFileSync(resolve(DIR_EXTENSAO, "hub.js"), "utf8");
  for (const p of ["'in-'", "'ag-'", "'pn-'", "'cf-'", "'cc-'"]) assert.ok(hub.includes(p), `hub.js usa o prefixo ${p}`);
  // hub.js antes das telas: o mapa de ids precisa existir quando elas carregam.
  assert.ok(html.indexOf("hub.js") < html.indexOf("inicio.js"));
  assert.ok(html.indexOf("hub.js") < html.indexOf("agenda.js"));
  // Início é a primeira aba.
  assert.ok(html.indexOf('id="tab-inicio"') < html.indexOf('id="tab-agenda"'));
  assert.doesNotMatch(html, /<script>|onclick=|style=/i, "sem script ou estilo embutido");
});
