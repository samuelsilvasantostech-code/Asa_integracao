-- Implantação multi-cliente: vínculo do tenant com a instância e a instalação da Kentro e com a
-- instituição da Asa, e o estado que a página de implantação mostra (credencial, último uso, desligamento).
ALTER TABLE tenants
  ADD COLUMN kentro_instancia      text,        -- ex.: clinicadagente.atenderbem.com
  ADD COLUMN kentro_instalacao_id  integer,     -- id da instalação da extensão nessa instância
  -- Instituição da Asa esperada: com ela preenchida, token de outra instituição é recusado.
  ADD COLUMN asa_instituicao_id    text,
  ADD COLUMN implantado_por        text,
  ADD COLUMN credencial_gravada_em timestamptz,
  ADD COLUMN credencial_origem     text CHECK (credencial_origem IN ('clinica', 'implantacao')),
  ADD COLUMN ultimo_uso_em         timestamptz, -- última chamada com a chave da instalação (marcada no máximo 1x/hora)
  ADD COLUMN desligado_em          timestamptz,
  ADD COLUMN observacao            text;

-- Uma instalação da Kentro aponta para um tenant só.
CREATE UNIQUE INDEX tenants_instalacao ON tenants (kentro_instancia, kentro_instalacao_id)
  WHERE kentro_instancia IS NOT NULL AND kentro_instalacao_id IS NOT NULL;
