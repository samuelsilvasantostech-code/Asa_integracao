-- Tempo de espera na clínica: a recepção marca na Agenda a chegada do paciente, a chamada para a consulta e
-- o fim. Fica só no ClinFy (o sistema da clínica não tem esses estados) e vale para qualquer ERP.
-- Não guarda dados do paciente: só o número da consulta no ERP, o profissional e o horário marcado.
CREATE TABLE atendimentos (
  tenant_id      uuid        NOT NULL REFERENCES tenants (id),
  agendamento_id text        NOT NULL,
  prestador_id   text        NOT NULL,
  data           date        NOT NULL,       -- dia da consulta (fuso da clínica)
  hora_marcada   text,                       -- HH:MM marcado no ERP; base do atraso no relatório
  chegada        timestamptz,
  chamada        timestamptz,
  fim            timestamptz,
  -- Quem marcou cada etapa (id e nome do atendente na Kentro). Apagado pela retenção depois de 90 dias.
  chegada_por    text,
  chamada_por    text,
  fim_por        text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agendamento_id),
  CHECK (chamada IS NULL OR (chegada IS NOT NULL AND chamada >= chegada)),
  CHECK (fim IS NULL OR (chamada IS NOT NULL AND fim >= chamada))
);
-- Agenda do dia e relatório por período.
CREATE INDEX atendimentos_dia ON atendimentos (tenant_id, data);
