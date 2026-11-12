-- Catálogo de conectores (docs/conectores.md): um por sistema (ERP). tenants.erp aponta para o slug.
-- 'codigo' = adaptador escrito em TypeScript (a Asa); 'configuracao' = tradução por JSON (erp/conector/motor.ts).
-- O padrão Kentro fica com config NULL: o Conector usa CONECTOR_PADRAO do código.
CREATE TABLE IF NOT EXISTS conectores (
  slug          text        PRIMARY KEY CHECK (slug ~ '^[a-z][a-z0-9-]{1,39}$'),
  nome          text        NOT NULL,                     -- como as telas escrevem: "Asa", "Feegow"
  artigo        text        NOT NULL DEFAULT 'o' CHECK (artigo IN ('a', 'o')),
  tipo          text        NOT NULL DEFAULT 'configuracao' CHECK (tipo IN ('codigo', 'configuracao')),
  situacao      text        NOT NULL DEFAULT 'rascunho' CHECK (situacao IN ('rascunho', 'homologacao', 'publicado', 'arquivado')),
  versao        integer     NOT NULL DEFAULT 1,
  config        jsonb,
  observacao    text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  publicado_em  timestamptz
);

INSERT INTO conectores (slug, nome, artigo, tipo, situacao, observacao, publicado_em) VALUES
  ('asa', 'Asa', 'a', 'codigo', 'publicado', 'Asa Saúde: adaptador próprio (src/erp/asa).', now()),
  ('padrao', 'sistema da clínica', 'o', 'configuracao', 'publicado', 'ERP que implementa a especificação da Kentro: endereço da API + token.', now())
ON CONFLICT (slug) DO NOTHING;

-- Pedido de um sistema que não está no catálogo, aberto pela clínica na tela de conexão (ou pela implantação).
CREATE TABLE IF NOT EXISTS conector_pedidos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        REFERENCES tenants (id) ON DELETE SET NULL,
  sistema       text        NOT NULL,
  contato       text,
  observacao    text,
  situacao      text        NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'em_andamento', 'atendido', 'recusado')),
  conector_slug text        REFERENCES conectores (slug) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Documentação da API de um sistema: link ou arquivo. Só a chave de administrador lê.
CREATE TABLE IF NOT EXISTS conector_documentos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conector_slug text        NOT NULL REFERENCES conectores (slug) ON DELETE CASCADE,
  tipo          text        NOT NULL CHECK (tipo IN ('link', 'arquivo')),
  url           text,
  nome_arquivo  text,
  mime          text,
  tamanho       integer,
  conteudo      bytea,
  limpezas      integer     NOT NULL DEFAULT 0,          -- credenciais removidas do arquivo ao receber
  origem        text,                                     -- de quem veio (clínica, fornecedor)
  enviado_por   text,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conector_documentos_slug ON conector_documentos (conector_slug);
