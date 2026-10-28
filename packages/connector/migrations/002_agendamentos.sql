-- Agendamentos pedidos pelo painel: idempotência (um clique duplo não marca duas vezes) e
-- trilha de quem pediu o quê. Não guarda nome, CPF nem telefone do paciente.
CREATE TABLE agendamentos (
  tenant_id     uuid        NOT NULL REFERENCES tenants (id),
  chave         text        NOT NULL,
  -- pendente: chamada à Asa em curso; ok: gravado; incerto: a Asa não respondeu e pode ter gravado
  situacao      text        NOT NULL CHECK (situacao IN ('pendente', 'ok', 'incerto')),
  usuario       text,
  prestador_id  text        NOT NULL,
  data          date        NOT NULL,
  horario       text        NOT NULL,
  paciente_id   text,
  resposta      jsonb,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, chave)
);
