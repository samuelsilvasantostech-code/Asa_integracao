// Documentação de API recebida na Central: coleções do Postman e OpenAPI em JSON costumam trazer tokens de
// exemplo ou reais (a da Asa trazia). Antes de guardar, os valores de credencial são apagados. O que não é
// JSON é guardado como veio: a Central avisa que pode conter segredo.

const NOME_SENSIVEL = /^(token|access[_-]?token|refresh[_-]?token|bearer|api[_-]?key|apikey|x-api-key|x-access-token|secret|client[_-]?secret|password|passwd|senha|authorization|cookie|hash)$/i;

function limpar(v: unknown, contar: () => void): unknown {
  if (Array.isArray(v)) return v.map((x) => limpar(x, contar));
  if (!v || typeof v !== "object") {
    // "Bearer abc…" ou "Basic abc…" soltos num texto.
    if (typeof v === "string" && /^(Bearer|Basic)\s+\S{8,}/i.test(v)) { contar(); return v.split(/\s+/)[0] + " "; }
    return v;
  }
  const o = v as Record<string, unknown>;
  // Pares {key, value} do Postman (headers, variáveis, query, auth): apaga o valor de chave sensível.
  if (typeof o.key === "string" && "value" in o && NOME_SENSIVEL.test(o.key) && o.value !== "" && o.value != null) {
    contar();
    return { ...o, value: "" };
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    // Bloco "auth" do Postman: todos os valores saem.
    if (k === "auth" && x && typeof x === "object") {
      out[k] = limparAuth(x as Record<string, unknown>, contar);
      continue;
    }
    if (NOME_SENSIVEL.test(k) && typeof x === "string" && x) { contar(); out[k] = ""; continue; }
    out[k] = limpar(x, contar);
  }
  return out;
}

function limparAuth(auth: Record<string, unknown>, contar: () => void): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(auth)) {
    if (Array.isArray(x)) out[k] = x.map((p) => (p && typeof p === "object" && "value" in p && (p as any).value ? (contar(), { ...(p as object), value: "" }) : p));
    else out[k] = x;
  }
  return out;
}

export function limparDocumento(nome: string, conteudo: Buffer): { conteudo: Buffer; limpezas: number } {
  if (!/\.(json|postman_collection|postman_environment)$/i.test(nome) && !/^\s*[{[]/.test(conteudo.subarray(0, 64).toString("utf8"))) {
    return { conteudo, limpezas: 0 };
  }
  let json: unknown;
  try {
    json = JSON.parse(conteudo.toString("utf8"));
  } catch {
    return { conteudo, limpezas: 0 };
  }
  let n = 0;
  const limpo = limpar(json, () => { n++; });
  return n ? { conteudo: Buffer.from(JSON.stringify(limpo, null, 2), "utf8"), limpezas: n } : { conteudo, limpezas: 0 };
}
