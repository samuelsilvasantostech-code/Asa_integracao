// Implantação multi-cliente: vínculo do tenant com a Kentro e com a Asa. Funções puras.
import { instituicaoDoToken } from "./asa.js";

const ROTULO = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// Instância da Kentro como digitada ("https://ClinicaDaGente.atenderbem.com/base/") → nome do host
// ("clinicadagente.atenderbem.com"). null se não for um nome de host (IP, sem domínio, caractere estranho).
export function normalizarInstancia(entrada: unknown): string | null {
  if (typeof entrada !== "string") return null;
  let s = entrada.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0].replace(/:\d*$/, "").replace(/\.$/, "");
  if (!s || s.length > 253) return null;
  const rotulos = s.split(".");
  if (rotulos.length < 2 || !rotulos.every((r) => ROTULO.test(r))) return null;
  // O último rótulo só com letras: assim um IP (10.0.0.1) não passa.
  if (!/^[a-z]{2,}$/.test(rotulos[rotulos.length - 1])) return null;
  return s;
}

// O token é da instituição esperada? Sem instituição esperada, aceita qualquer um (como antes da 0.19.0).
export function instituicaoConfere(esperada: string | null, token: string): boolean {
  if (!esperada) return true;
  // Compara como número: "0123" cadastrado e "123" no token são a mesma instituição.
  const doToken = instituicaoDoToken(token);
  if (!doToken || !/^\d+$/.test(doToken) || !/^\d+$/.test(esperada)) return false;
  return BigInt(doToken) === BigInt(esperada);
}

// O último uso é marcado no máximo uma vez por hora: não vale um UPDATE a cada chamada do painel.
const UMA_HORA = 60 * 60 * 1000;
export function precisaMarcarUso(ultimo: Date | null, agora: Date): boolean {
  return !ultimo || agora.getTime() - ultimo.getTime() > UMA_HORA;
}

export function idTenantValido(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export type CampoTenant = "nome" | "ativo" | "kentro_instancia" | "kentro_instalacao_id" | "asa_instituicao_id" | "observacao" | "implantado_por";

// Texto opcional: vazio ou null limpa o campo. undefined = inválido.
function textoOpcional(v: unknown, max: number): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > max ? undefined : s || null;
}

// Lê e valida os campos do cadastro do tenant vindos da página de implantação. Campo fora de `permitidos`
// é ignorado; null ou "" limpa os opcionais. Devolve os campos já normalizados ou o primeiro erro.
export function lerDadosTenant(
  corpo: unknown,
  permitidos: CampoTenant[],
): { ok: true; campos: Partial<Record<CampoTenant, string | number | boolean | null>> } | { ok: false; erro: string } {
  const b = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>) : {};
  const tem = (k: CampoTenant) => permitidos.includes(k) && b[k] !== undefined;
  const campos: Partial<Record<CampoTenant, string | number | boolean | null>> = {};

  if (tem("nome")) {
    const nome = typeof b.nome === "string" ? b.nome.trim() : "";
    if (!nome || nome.length > 120) return { ok: false, erro: "NOME_OBRIGATORIO" };
    campos.nome = nome;
  }
  if (tem("ativo")) {
    if (typeof b.ativo !== "boolean") return { ok: false, erro: "ATIVO_INVALIDO" };
    campos.ativo = b.ativo;
  }
  if (tem("kentro_instancia")) {
    const bruto = textoOpcional(b.kentro_instancia, 300);
    const inst = bruto ? normalizarInstancia(bruto) : bruto;
    if (inst === undefined || (bruto && !inst)) return { ok: false, erro: "INSTANCIA_INVALIDA" };
    campos.kentro_instancia = inst;
  }
  if (tem("kentro_instalacao_id")) {
    const v = b.kentro_instalacao_id;
    if (v === null || v === "") campos.kentro_instalacao_id = null;
    else {
      const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,10}$/.test(v.trim()) ? Number(v.trim()) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > 2147483647) return { ok: false, erro: "INSTALACAO_INVALIDA" };
      campos.kentro_instalacao_id = n;
    }
  }
  if (tem("asa_instituicao_id")) {
    const v = textoOpcional(b.asa_instituicao_id, 12);
    if (v === undefined || (v !== null && !/^\d+$/.test(v))) return { ok: false, erro: "INSTITUICAO_INVALIDA" };
    campos.asa_instituicao_id = v;
  }
  if (tem("observacao")) {
    const v = textoOpcional(b.observacao, 1000);
    if (v === undefined) return { ok: false, erro: "OBSERVACAO_INVALIDA" };
    campos.observacao = v;
  }
  if (tem("implantado_por")) {
    const v = textoOpcional(b.implantado_por, 120);
    if (v === undefined) return { ok: false, erro: "IMPLANTADO_POR_INVALIDO" };
    campos.implantado_por = v;
  }
  if (!Object.keys(campos).length) return { ok: false, erro: "NADA_PARA_ALTERAR" };
  return { ok: true, campos };
}

// Captura de webhook da Kentro (o Conector faz POST nela). Só HTTPS, porta padrão e host da Kentro
// (*.kentro.com.br ou *.atenderbem.com): o Conector não pode virar ponte para outro endereço.
export function disparoUrlValida(url: string): boolean {
  const m = /^https:\/\/([a-z0-9.-]+)\/webhookcapture\/capture\/[A-Za-z0-9._~-]{8,140}$/.exec(url);
  if (!m) return false;
  const host = normalizarInstancia(m[1]);
  return !!host && host === m[1] && (host.endsWith(".kentro.com.br") || host.endsWith(".atenderbem.com"));
}
