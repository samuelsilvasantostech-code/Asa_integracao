-- Multi-ERP (fase 1): cada clínica diz qual ERP usa. Todas as clínicas de hoje são da Asa.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS erp text NOT NULL DEFAULT 'asa';
