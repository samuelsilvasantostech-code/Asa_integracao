-- Avelar (sistema Luna): conector por configuração (src/erp/conectores/avelar.json; docs/erps/avelar.md). O Luna
-- implementa a especificação Kentro, então as rotas vão como estão na spec. Entra em homologação.
-- test/avelar.test.ts confere que o JSON abaixo é o mesmo do arquivo.
INSERT INTO conectores (slug, nome, artigo, tipo, situacao, observacao, config) VALUES
  ('avelar', 'Avelar', 'a', 'configuracao', 'homologacao',
   'Avelar (sistema Luna): spec Kentro, Bearer por clínica e ambiente. Remarcar mantém o id. Sem confirmações, contas e webhooks.',
   '{"versao":1,"base_url":"{{cred.base_url}}","autenticacao":{"tipo":"bearer","campo":"token"},"campos":[{"chave":"base_url","rotulo":"Endereço da API do Luna","tipo":"url","obrigatorio":true,"ajuda":"Produção: https://www.sistemaluna.com/api/v1/kentro. Homologação: https://homolog.sistemaluna.com/api/v1/kentro."},{"chave":"token","rotulo":"Token da API do Luna","tipo":"segredo","obrigatorio":true,"ajuda":"Um token por clínica e por ambiente, entregue pela Avelar. Use o token do mesmo ambiente do endereço acima."}],"especificacao":true,"rotas":{}}'::jsonb)
ON CONFLICT (slug) DO NOTHING;
