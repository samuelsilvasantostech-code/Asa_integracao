-- Aba "Uso" da implantação: as consultas cruzam todas as clínicas por instante de criação.
-- Sem estes índices, cada abertura da aba varreria as trilhas inteiras.
CREATE INDEX IF NOT EXISTS agendamentos_criado ON agendamentos (criado_em);
CREATE INDEX IF NOT EXISTS cobrancas_criado ON cobrancas (criado_em);
