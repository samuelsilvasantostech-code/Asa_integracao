import assert from "node:assert/strict";
import { test } from "node:test";
import { disparoUrlValida, idTenantValido, instituicaoConfere, lerDadosTenant, normalizarInstancia, precisaMarcarUso } from "../src/implantacao.js";

const token = (s: string) => Buffer.from(s, "utf8").toString("base64");

test("instância: tira esquema, caminho, porta e espaços e põe em minúsculas", () => {
  assert.equal(normalizarInstancia("https://ClinicaDaGente.atenderbem.com/base/"), "clinicadagente.atenderbem.com");
  assert.equal(normalizarInstancia("  clinicadagente.atenderbem.com  "), "clinicadagente.atenderbem.com");
  assert.equal(normalizarInstancia("http://apresentacao.kentro.com.br:8443/base/config?x=1#y"), "apresentacao.kentro.com.br");
  assert.equal(normalizarInstancia("apresentacao.atenderbem.com."), "apresentacao.atenderbem.com");
});

test("instância: recusa o que não é nome de host", () => {
  for (const v of ["", "   ", "localhost", "10.0.0.1", "https://10.0.0.1/base", "clinica_x.atenderbem.com", "-x.atenderbem.com",
    "a..b.com", "user@clinica.atenderbem.com", "clínica.atenderbem.com", "x".repeat(64) + ".com", null, undefined, 42, {}]) {
    assert.equal(normalizarInstancia(v), null, String(v));
  }
});

test("instituição: sem esperada, qualquer token confere", () => {
  assert.equal(instituicaoConfere(null, token("123:abc")), true);
  assert.equal(instituicaoConfere(null, "lixo"), true);
});

test("instituição: com esperada, só o token da mesma instituição", () => {
  assert.equal(instituicaoConfere("123", token("123:abc")), true);
  assert.equal(instituicaoConfere("123", token("124:abc")), false);
  assert.equal(instituicaoConfere("123", token("sem-instituicao")), false);
  assert.equal(instituicaoConfere("123", "%%%"), false);
  assert.equal(instituicaoConfere("0123", token("123:abc")), true);
});

test("último uso: marca sem registro ou depois de 1 hora", () => {
  const agora = new Date("2026-11-03T12:00:00Z");
  assert.equal(precisaMarcarUso(null, agora), true);
  assert.equal(precisaMarcarUso(new Date("2026-11-03T10:59:59Z"), agora), true);
  assert.equal(precisaMarcarUso(new Date("2026-11-03T11:30:00Z"), agora), false);
  assert.equal(precisaMarcarUso(new Date("2026-11-03T11:00:00Z"), agora), false);
});

test("id do tenant: só UUID", () => {
  assert.equal(idTenantValido("0b6c7a3e-1d2f-4a5b-9c8d-7e6f5a4b3c2d"), true);
  assert.equal(idTenantValido("0B6C7A3E-1D2F-4A5B-9C8D-7E6F5A4B3C2D"), true);
  for (const v of ["", "x", "1", "0b6c7a3e1d2f4a5b9c8d7e6f5a4b3c2d", "0b6c7a3e-1d2f-4a5b-9c8d-7e6f5a4b3c2", undefined, 5]) {
    assert.equal(idTenantValido(v), false, String(v));
  }
});

test("dados do tenant: normaliza e valida cada campo", () => {
  const r = lerDadosTenant(
    { nome: "  Clínica X ", kentro_instancia: "https://X.atenderbem.com/base", kentro_instalacao_id: "29", asa_instituicao_id: " 123 ", observacao: " ok ", ativo: false, outro: 1 },
    ["nome", "kentro_instancia", "kentro_instalacao_id", "asa_instituicao_id", "observacao", "ativo"],
  );
  assert.deepEqual(r, {
    ok: true,
    campos: { nome: "Clínica X", kentro_instancia: "x.atenderbem.com", kentro_instalacao_id: 29, asa_instituicao_id: "123", observacao: "ok", ativo: false },
  });
});

test("dados do tenant: vazio ou null limpa os campos opcionais", () => {
  const r = lerDadosTenant({ kentro_instancia: "", kentro_instalacao_id: null, asa_instituicao_id: "", observacao: "  " },
    ["kentro_instancia", "kentro_instalacao_id", "asa_instituicao_id", "observacao"]);
  assert.deepEqual(r, { ok: true, campos: { kentro_instancia: null, kentro_instalacao_id: null, asa_instituicao_id: null, observacao: null } });
});

test("dados do tenant: recusa valor fora do formato", () => {
  const todos = ["nome", "kentro_instancia", "kentro_instalacao_id", "asa_instituicao_id", "observacao", "ativo", "implantado_por"];
  const casos: [Record<string, unknown>, string][] = [
    [{ nome: "  " }, "NOME_OBRIGATORIO"],
    [{ nome: 5 }, "NOME_OBRIGATORIO"],
    [{ kentro_instancia: "10.0.0.1" }, "INSTANCIA_INVALIDA"],
    [{ kentro_instalacao_id: 0 }, "INSTALACAO_INVALIDA"],
    [{ kentro_instalacao_id: -3 }, "INSTALACAO_INVALIDA"],
    [{ kentro_instalacao_id: 1.5 }, "INSTALACAO_INVALIDA"],
    [{ kentro_instalacao_id: "29a" }, "INSTALACAO_INVALIDA"],
    [{ kentro_instalacao_id: 2 ** 31 }, "INSTALACAO_INVALIDA"],
    [{ asa_instituicao_id: "12a" }, "INSTITUICAO_INVALIDA"],
    [{ asa_instituicao_id: 123 }, "INSTITUICAO_INVALIDA"],
    [{ observacao: "x".repeat(1001) }, "OBSERVACAO_INVALIDA"],
    [{ ativo: "sim" }, "ATIVO_INVALIDO"],
    [{ implantado_por: "x".repeat(121) }, "IMPLANTADO_POR_INVALIDO"],
  ];
  for (const [corpo, erro] of casos) assert.deepEqual(lerDadosTenant(corpo, todos), { ok: false, erro }, JSON.stringify(corpo));
});

test("dados do tenant: só os campos permitidos, e nada para alterar é erro", () => {
  assert.deepEqual(lerDadosTenant({ ativo: true }, ["nome"]), { ok: false, erro: "NADA_PARA_ALTERAR" });
  assert.deepEqual(lerDadosTenant(null, ["nome"]), { ok: false, erro: "NADA_PARA_ALTERAR" });
});

test("URL de disparo: só captura de webhook em domínio da Kentro", () => {
  assert.equal(disparoUrlValida("https://clinica.atenderbem.com/webhookcapture/capture/abcDEF123_-x"), true);
  assert.equal(disparoUrlValida("https://apresentacao.kentro.com.br/webhookcapture/capture/abcdefgh"), true);
  for (const u of [
    "http://clinica.atenderbem.com/webhookcapture/capture/abcdefgh",
    "https://evil.com/webhookcapture/capture/abcdefgh",
    "https://atenderbem.com.evil.com/webhookcapture/capture/abcdefgh",
    "https://evilatenderbem.com/webhookcapture/capture/abcdefgh",
    "https://10.0.0.1/webhookcapture/capture/abcdefgh",
    "https://clinica.atenderbem.com:8080/webhookcapture/capture/abcdefgh",
    "https://user@clinica.atenderbem.com/webhookcapture/capture/abcdefgh",
    "https://clinica.atenderbem.com/webhookcapture/capture/abc",
    "https://clinica.atenderbem.com/outra/coisa/abcdefgh",
    "",
  ]) {
    assert.equal(disparoUrlValida(u), false, u);
  }
});
