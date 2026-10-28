import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "./config.js";

// AES-256-GCM. Formato gravado: iv (12) | tag (16) | texto cifrado.
function chave(): Buffer {
  const k = Buffer.from(config.credKey, "base64");
  if (k.length !== 32) throw new Error("ASA_CRED_KEY ausente ou inválida (esperado 32 bytes em base64)");
  return k;
}

export function cifraDisponivel(): boolean {
  try {
    chave();
    return true;
  } catch {
    return false;
  }
}

export function cifrar(texto: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), dados]);
}

export function decifrar(blob: Buffer): string {
  const d = createDecipheriv("aes-256-gcm", chave(), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString("utf8");
}
