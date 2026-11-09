// Registro dos ERPs suportados: dado o ERP da clínica (coluna tenants.erp) e a credencial dela, cria o
// adaptador. Um ERP novo = um adaptador em erp/<nome>/ e uma linha aqui.
import type { ErpAdapter } from "./adaptador.js";
import { AsaAdapter, type LogErp } from "./asa/adaptador.js";

export type { BuscaPaciente, ErpAdapter, FalhaErp, Resultado } from "./adaptador.js";
export type { LogErp } from "./asa/adaptador.js";

export const ERPS = ["asa"] as const;
export type Erp = (typeof ERPS)[number];

export class ErpDesconhecido extends Error {}

// `credencial` = o JSON decifrado de tenants.asa_credencial_cifrada. Apesar do nome, a coluna guarda a
// credencial de qualquer ERP; a troca de nome fica para quando houver um segundo ERP.
export function criarAdaptador(erp: string, credencial: unknown, log: LogErp): ErpAdapter {
  switch (erp) {
    case "asa":
      return new AsaAdapter(credencial as ConstructorParameters<typeof AsaAdapter>[0], log);
    default:
      throw new ErpDesconhecido(erp);
  }
}
