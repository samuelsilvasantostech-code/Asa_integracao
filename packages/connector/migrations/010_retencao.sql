-- Retenção de 90 dias (retencao.ts): depois disso, os dados pessoais das trilhas são apagados e a linha
-- fica, para os números do painel. O paciente da cobrança passa a poder ficar vazio.
ALTER TABLE cobrancas ALTER COLUMN paciente_id DROP NOT NULL;
