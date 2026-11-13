-- Feegow: adaptador em código (src/erp/feegow). Entra em homologação: a implantação liga uma clínica para
-- testar; publicar (para todas as clínicas verem) é pela Central, depois do teste com credencial real.
INSERT INTO conectores (slug, nome, artigo, tipo, situacao, observacao) VALUES
  ('feegow', 'Feegow', 'o', 'codigo', 'homologacao', 'Feegow Clinic: adaptador próprio (src/erp/feegow). Token x-access-token; unidade opcional.')
ON CONFLICT (slug) DO NOTHING;
