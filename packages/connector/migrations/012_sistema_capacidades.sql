-- Multi-ERP (fase 3): nome do sistema da clínica nas telas ("na Asa", "no Feegow") e o que o ERP dela
-- suporta, detectado pela implantação no teste de conexão.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sistema_nome    text,
  ADD COLUMN IF NOT EXISTS sistema_artigo  text,          -- 'a' ou 'o'
  ADD COLUMN IF NOT EXISTS erp_capacidades jsonb,         -- null = ainda não detectadas (vale o padrão do ERP)
  ADD COLUMN IF NOT EXISTS erp_testado_em  timestamptz;

UPDATE tenants SET sistema_nome = 'Asa', sistema_artigo = 'a' WHERE erp = 'asa' AND sistema_nome IS NULL;
