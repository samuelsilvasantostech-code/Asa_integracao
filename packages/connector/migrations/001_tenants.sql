-- Clientes Kentro que usam a integração. A chave da instalação da extensão
-- identifica o cliente; guardamos só o hash dela.
CREATE TABLE tenants (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                 text        NOT NULL,
  chave_instalacao_hash text       NOT NULL UNIQUE,
  asa_credencial_cifrada bytea,
  ativo                boolean     NOT NULL DEFAULT true,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);
