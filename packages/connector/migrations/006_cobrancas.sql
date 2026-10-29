-- Financeiro: lançamento de conta a receber na Asa (api-gerar-conta-paciente). A Asa só CRIA a conta,
-- não deixa ler, editar nem apagar: esta tabela é a única trilha do que o painel lançou, e a chave
-- impede lançar duas vezes. Não guarda nome, CPF nem telefone do paciente.
ALTER TABLE tenants
  -- {ativo, quem: "admin" | "todos"}; lido por financeiro.ts, que aplica os padrões
  ADD COLUMN financeiro jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE cobrancas (
  tenant_id      uuid          NOT NULL REFERENCES tenants (id),
  chave          text          NOT NULL, -- idempotência; vai também como id_externo para a Asa
  -- pendente: chamada à Asa em curso; ok: gravada; incerto: a Asa não respondeu e pode ter gravado
  situacao       text          NOT NULL CHECK (situacao IN ('pendente', 'ok', 'incerto')),
  usuario        text,
  paciente_id    text          NOT NULL,
  agendamento_id text,
  valor          numeric(10,2) NOT NULL CHECK (valor > 0),
  forma          text          NOT NULL,
  vencimento     date,
  msg            text,                   -- resposta da Asa
  criado_em      timestamptz   NOT NULL DEFAULT now(),
  atualizado_em  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, chave)
);
CREATE INDEX cobrancas_paciente ON cobrancas (tenant_id, paciente_id, criado_em DESC);
