-- Acesso à implantação por usuário e senha (src/admin-acesso.ts). A ADMIN_KEY continua valendo para criar o
-- primeiro usuário e como acesso de emergência.
CREATE TABLE IF NOT EXISTS admin_usuarios (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario          text        NOT NULL UNIQUE CHECK (usuario ~ '^[a-z0-9][a-z0-9._@-]{2,79}$'),
  nome             text        NOT NULL,
  senha_hash       text        NOT NULL,          -- scrypt$N$r$p$sal$hash (base64url)
  ativo            boolean     NOT NULL DEFAULT true,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  criado_por       text,
  senha_trocada_em timestamptz NOT NULL DEFAULT now(),
  ultimo_acesso_em timestamptz
);

-- Sessão = token aleatório no cookie (HttpOnly); o banco guarda só o hash.
CREATE TABLE IF NOT EXISTS admin_sessoes (
  token_hash  text        PRIMARY KEY,
  usuario_id  uuid        NOT NULL REFERENCES admin_usuarios(id) ON DELETE CASCADE,
  criada_em   timestamptz NOT NULL DEFAULT now(),
  expira_em   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessoes_usuario ON admin_sessoes (usuario_id);
