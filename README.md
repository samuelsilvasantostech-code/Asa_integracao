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

Sem build: os arquivos são servidos como estão e o host injeta o SDK `omni`.

O host da Kentro busca cada arquivo em `<pasta do manifest>/v/<version>/<caminho>`, e o Doca não reescreve
caminhos. Por isso só o `manifest.json` fica na raiz e os arquivos ficam em `v/<versão>/`.

Para publicar uma versão nova:
1. copie `v/<atual>/` para `v/<nova>/` e faça as mudanças lá;
2. suba `version` no `manifest.json` e o `?v=` dos arquivos nos `.html`;
3. deploy no Doca e `extension_installs_refresh_manifest` nas instalações.

As pastas antigas ficam: uma instalação que ainda aponta para a versão anterior continua funcionando.
