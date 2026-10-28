# Asa Saúde × Kentro

Integração da Asa Saúde com a plataforma Kentro.

| Pasta | O que é |
|---|---|
| `packages/connector` | Conector (API) — único ponto que fala com a Asa. Deploy no Doca. |
| `packages/extension` | Extensão `kentro.asa-saude` (manifest + estáticos, JS puro). Servida pelo Conector em `/extensao/`. |

## Conector

```bash
cd packages/connector
npm ci
cp .env.example .env   # ajuste DATABASE_URL
npm run dev
```

No Doca: tipo **API**, pasta `.`, build **Dockerfile do próprio repositório**, porta `3000`, verificação `/health`.
Na subida o Conector aplica as migrações de `migrations/` em ordem.

### Cadastrar uma clínica

```bash
curl -X POST https://asa-integracao-samuels.kentro.com.br/admin/tenants   -H "x-admin-key: $ADMIN_KEY" -H "content-type: application/json"   -d '{"nome":"Clínica X"}'
```

A resposta traz `chave_instalacao` uma única vez: é o valor do campo "Chave da instalação" da extensão.

## Extensão

Sem build: os arquivos de `packages/extension` são servidos como estão e o host injeta o SDK `omni`.

**Quem serve é o Conector**, em `https://asa-integracao-samuels.kentro.com.br/extensao/manifest.json`. O tipo
"Extensão" do Doca manda `X-Frame-Options: DENY`, e o host da Kentro carrega as telas num iframe, então ali o
painel fica em branco. O `Dockerfile` da raiz põe Conector e extensão na mesma imagem; no Doca o projeto usa
pasta `.` e build "Dockerfile do próprio repositório".

Para publicar uma versão nova: suba `version` no `manifest.json` e o `?v=` dos arquivos nos `.html`, faça o
deploy do Conector e rode `extension_installs_refresh_manifest` nas instalações.
