-- Aba "Uso" (etapa B): contagem diária do que cada clínica faz pelo ClinFy, inclusive o que não grava
-- trilha (buscas, abertura da agenda, falhas do ERP). Só contadores: nenhum dado de paciente.
CREATE TABLE IF NOT EXISTS uso_diario (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dia date NOT NULL,
  evento text NOT NULL,
  n integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, dia, evento)
);
CREATE INDEX IF NOT EXISTS uso_diario_dia ON uso_diario (dia);

-- Versão da extensão que a clínica está usando (header x-clinfy-versao).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS extensao_versao text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS extensao_versao_em timestamptz;
