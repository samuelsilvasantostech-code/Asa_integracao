-- Confirmação de véspera (D-1). A configuração é por clínica; os ids da Kentro (fila, template,
-- URA) ficam no fluxo gerado na implantação, não aqui.
ALTER TABLE tenants
  ADD COLUMN confirmacao jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Chave só da automação: vale apenas em /v1/confirmacao/*. Fica gravada no fluxo da Kentro,
  -- que administradores leem, por isso não é a chave da instalação.
  ADD COLUMN chave_automacao_hash text UNIQUE;

-- Uma linha por consulta que entrou no disparo. Guarda o telefone porque é para ele que a
-- mensagem sai e é ele que confere a resposta; nome e CPF não são guardados.
CREATE TABLE confirmacoes (
  tenant_id      uuid        NOT NULL REFERENCES tenants (id),
  agendamento_id text        NOT NULL,
  telefone       text,                 -- 55 + DDD + número, como a Kentro espera
  data           date        NOT NULL,
  hora           text,
  prestador      text,
  -- pendente: a enviar · reservado: entregue a uma rodada da automação · enviado: saiu e foi marcado
  -- em `disparados` · falhou: desistimos · respondido: o paciente respondeu · ignorado: fora do modo teste
  -- ou sem telefone
  estado         text        NOT NULL CHECK (estado IN ('pendente', 'reservado', 'enviado', 'falhou', 'respondido', 'ignorado')),
  tentativas     integer     NOT NULL DEFAULT 0,
  reservado_ate  timestamptz,
  chat_id        text,
  resposta       text CHECK (resposta IN ('confirmar', 'remarcar', 'cancelar')),
  erro           text,
  -- a Asa já foi avisada (`disparados`); separado de `estado` para refazer só essa parte se ela falhar
  disparado_asa  boolean     NOT NULL DEFAULT false,
  enviado_em     timestamptz,
  respondido_em  timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agendamento_id)
);
CREATE INDEX confirmacoes_fila ON confirmacoes (tenant_id, estado, data);
