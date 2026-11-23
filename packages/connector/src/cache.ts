import { createHash } from "node:crypto";

// Cache em memória com validade, para leituras do ERP que mudam pouco (convênios, procedimentos, preços).
// - Pedidos iguais em andamento viram um só: dez atendentes abrindo a mesma tela fazem uma chamada ao ERP.
// - Só guarda o que `guardar` aprovar (em geral, resposta ok): falha é pedida de novo na próxima vez.
// - Tamanho limitado: passando de `max`, sai o mais antigo.
// A chave deve começar pela clínica (ou pela credencial), para um cliente nunca ver o dado de outro.
export class Cache<T> {
  private itens = new Map<string, { em: number; valor: Promise<T>; pronto: boolean }>();

  constructor(private readonly validadeMs: number, private readonly max = 2000) {}

  obter(chave: string, buscar: () => Promise<T>, guardar: (v: T) => boolean = () => true): Promise<T> {
    const agora = Date.now();
    const item = this.itens.get(chave);
    if (item && (!item.pronto || agora - item.em < this.validadeMs)) return item.valor;
    if (item) this.itens.delete(chave);

    const novo = { em: agora, pronto: false, valor: null as unknown as Promise<T> };
    novo.valor = buscar().then(
      (v) => {
        novo.pronto = true;
        novo.em = Date.now();
        if (!guardar(v) && this.itens.get(chave) === novo) this.itens.delete(chave);
        return v;
      },
      (err) => {
        if (this.itens.get(chave) === novo) this.itens.delete(chave);
        throw err;
      },
    );
    this.itens.set(chave, novo);
    while (this.itens.size > this.max) this.itens.delete(this.itens.keys().next().value as string);
    return novo.valor;
  }

  // Esquece tudo o que começa com o prefixo (ex.: a clínica trocou de credencial).
  esquecer(prefixo: string) {
    for (const k of this.itens.keys()) if (k.startsWith(prefixo)) this.itens.delete(k);
  }
}

// Prefixo de chave por clínica E credencial: trocar a credencial (ou o ERP) já começa com cache vazio.
export function chaveDaClinica(t: { id: string; erp: string; credencial: Buffer | null }): string {
  const cred = t.credencial ? createHash("sha256").update(t.credencial).digest("hex").slice(0, 16) : "-";
  return `${t.id}|${t.erp}|${cred}|`;
}

// Resultado do ERP que vale guardar: sucesso ou "não encontrado". Falha (fora do ar, recusa) não.
export const guardavel = (r: { ok: boolean; naoEncontrado?: boolean }) => r.ok || !!r.naoEncontrado;
