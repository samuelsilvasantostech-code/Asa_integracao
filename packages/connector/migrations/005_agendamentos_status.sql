-- A agenda em tela cheia confirma presença e marca falta pela mesma trilha e idempotência.
ALTER TABLE agendamentos DROP CONSTRAINT IF EXISTS agendamentos_tipo_check;
ALTER TABLE agendamentos
  ADD CONSTRAINT agendamentos_tipo_check CHECK (tipo IN ('criar', 'remarcar', 'cancelar', 'confirmar', 'ausente'));
