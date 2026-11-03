// Limite de chamadas em memória, por janela fixa. Vale por processo (o Conector roda uma réplica só);
// reiniciar zera as contas.
export class Limite {
  private contas = new Map<string, { inicio: number; n: number }>();

  constructor(
    private readonly max: number,
    private readonly janelaMs: number,
    // Teto de chaves guardadas: sem ele, IPs variados fariam a memória crescer sem parar.
    private readonly maxChaves = 10_000,
  ) {}

  private atual(chave: string, agora: number) {
    const c = this.contas.get(chave);
    return c && agora - c.inicio < this.janelaMs ? c : null;
  }

  // Já passou do limite nesta janela? Só consulta, não conta.
  excedido(chave: string, agora = Date.now()): boolean {
    return (this.atual(chave, agora)?.n ?? 0) >= this.max;
  }

  // Conta uma chamada. false = passou do limite (a chamada não deve seguir).
  registrar(chave: string, agora = Date.now()): boolean {
    const c = this.atual(chave, agora);
    if (c) {
      c.n++;
      return c.n <= this.max;
    }
    if (this.contas.size >= this.maxChaves) this.abrirEspaco(agora);
    this.contas.delete(chave);
    this.contas.set(chave, { inicio: agora, n: 1 });
    return 1 <= this.max;
  }

  tamanho(): number {
    return this.contas.size;
  }

  // Tira as contas vencidas; se ainda estiver cheio, as mais antigas (o Map guarda a ordem de entrada).
  private abrirEspaco(agora: number) {
    for (const [k, c] of this.contas) if (agora - c.inicio >= this.janelaMs) this.contas.delete(k);
    while (this.contas.size >= this.maxChaves) this.contas.delete(this.contas.keys().next().value!);
  }
}
