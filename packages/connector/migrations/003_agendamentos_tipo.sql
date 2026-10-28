-- Remarcar e cancelar pelo painel usam a mesma trilha e a mesma idempotência do agendamento.
ALTER TABLE agendamentos
  ADD COLUMN tipo text NOT NULL DEFAULT 'criar' CHECK (tipo IN ('criar', 'remarcar', 'cancelar')),
  ADD COLUMN agendamento_id text;
-- Cancelar não tem horário novo.
ALTER TABLE agendamentos ALTER COLUMN prestador_id DROP NOT NULL;
ALTER TABLE agendamentos ALTER COLUMN data DROP NOT NULL;
ALTER TABLE agendamentos ALTER COLUMN horario DROP NOT NULL;
