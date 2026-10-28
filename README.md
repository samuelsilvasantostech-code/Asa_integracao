# Asa Saúde × Kentro

Integração da Asa Saúde com a plataforma Kentro.

| Pasta | O que é |
|---|---|
| `packages/connector` | Conector (API) — único ponto que fala com a Asa. Deploy no Doca. |

## Conector

```bash
cd packages/connector
npm ci
cp .env.example .env   # ajuste DATABASE_URL
npm run dev
```

No Doca: tipo **API**, pasta `packages/connector`, build **Fastify**, porta `3000`, verificação `/health`.
Na subida o Conector aplica as migrações de `migrations/` em ordem.
