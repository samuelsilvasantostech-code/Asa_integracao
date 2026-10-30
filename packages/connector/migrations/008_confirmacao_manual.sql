-- Confirmação enviada pelo atendente (botão "Enviar confirmação"), fora da rodada de véspera.
-- Guarda só o primeiro nome e o procedimento, que o lembrete usa; nada de CPF.
ALTER TABLE confirmacoes
  ADD COLUMN origem text NOT NULL DEFAULT 'automatica' CHECK (origem IN ('automatica', 'manual')),
  ADD COLUMN nome text,
  ADD COLUMN procedimento text,
  ADD COLUMN solicitado_por text;

-- Captura de webhook da Kentro que roda a automação de disparo na hora. Cadastrada pela implantação.
ALTER TABLE tenants ADD COLUMN disparo_url text;
