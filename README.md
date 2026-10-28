# Asa Saúde × Kentro

Integração da Asa Saúde com a plataforma Kentro.

| Pasta | O que é |
|---|---|
| `packages/connector` | Conector (API) — único ponto que fala com a Asa. Deploy no Doca. |
| `packages/extension` | Extensão `kentro.asa-saude` (manifest + estáticos, JS puro). Deploy no Doca como Extensão. |

## Conector

```bash
cd packages/connector
npm ci
cp .env.example .env   # ajuste DATABASE_URL
npm run dev
```

No Doca: tipo **API**, pasta `packages/connector`, build **Fastify**, porta `3000`, verificação `/health`.
Na subida o Conector aplica as migrações de `migrations/` em ordem.

### Cadastrar uma clínica

```bash
curl -X POST https://asa-integracao-samuels.kentro.com.br/admin/tenants   -H "x-admin-key: $ADMIN_KEY" -H "content-type: application/json"   -d '{"nome":"Clínica X"}'
```

A resposta traz `chave_instalacao` uma única vez: é o valor do campo "Chave da instalação" da extensão.

## Extensão

Sem build: os arquivos de `packages/extension` são servidos como estão e o host injeta o SDK `omni`.
Ao mudar a extensão, suba `version` no `manifest.json` e o `?v=` dos arquivos em `chat.html`.
