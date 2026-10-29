# Asa Saúde × Kentro — Visão geral do projeto

> Situação em 29/10/2026 · extensão `kentro.asa-saude` **0.8.0** · instância de teste: `apresentacao`

## 1. O que é

É uma integração que leva a agenda da **Asa Saúde** para dentro do atendimento da **Kentro**. O atendente abre a
conversa com o paciente e, num painel ao lado, faz o seguinte:

- localiza o paciente na Asa pelo telefone da conversa ou pelo CPF;
- vê as consultas do paciente;
- consulta os dias e horários livres de cada profissional;
- **marca, remarca e cancela** consultas sem sair da Kentro.

## 2. Arquitetura

```
 Atendente (Kentro)                      VM do Doca                              Asa Saúde
┌────────────────────┐   HTTPS + chave   ┌──────────────────────────────┐  HTTPS  ┌──────────────────────┐
│ Extensão           │ ────────────────▶ │ Conector (Fastify + TS)      │ ──────▶ │ sistema.asasaude     │
│ kentro.asa-saude   │                   │  · /v1/*  rotas do painel    │  token  │ .app.br/api          │
│ (painel da conversa│ ◀──────────────── │  · /admin/* gestão clínicas  │ ◀────── │                      │
│  + tela Configurar)│                   │  · /extensao/* estáticos     │         └──────────────────────┘
└────────────────────┘                   │  PostgreSQL samuels_asa_saude│
                                         └──────────────────────────────┘
```

| Peça | Onde fica | Papel |
|---|---|---|
| **Extensão** | `packages/extension` (JS puro, sem build) | Painel na conversa (`chat.html`) e diálogo "Configurar Asa Saúde" (`config.html`, só para administradores). |
| **Conector** | `packages/connector` (Fastify + TypeScript) | É o **único** ponto que fala com a Asa. Guarda as credenciais cifradas, valida os pedidos e mantém a trilha dos agendamentos. |
| **Banco** | PostgreSQL `samuels_asa_saude` (Doca) | Tabelas `tenants` (clínicas) e `agendamentos` (idempotência e trilha). As migrações rodam na subida. |
| **Hospedagem** | Doca — projeto `Asa_integracao`, pasta `.`, Dockerfile da raiz, porta 3000, verificação `/health` | O deploy sai do Git (`github.com/samuelsilvasantostech-code/Asa_integracao`). |

**Endereços**

- Conector: https://asa-integracao-samuels.kentro.com.br
- Manifest da extensão: https://asa-integracao-samuels.kentro.com.br/extensao/manifest.json

A extensão é servida **pelo Conector**, e não pelo tipo "Extensão" do Doca. O Doca responde com
`X-Frame-Options: DENY`, e a Kentro carrega o painel num iframe: servido pelo Doca, o painel ficava em branco.

## 3. Modelo multi-clínica (tenants)

- Cada clínica é um **tenant** no Conector. A rota `POST /admin/tenants`, protegida pela `x-admin-key`, gera a
  **chave da instalação**. Ela aparece uma única vez, e o banco guarda só o hash.
- A chave entra na config `apiKey` (secret) da instalação da extensão na Kentro, em
  `/base/config/extensioninstalls`. Essa tela exige superusuário.
- O **token da Asa** (um campo só, enviado como está no `Authorization`) é cadastrado pela tela "Configurar Asa
  Saúde". O Conector testa o token na Asa e grava cifrado com AES-GCM (`ASA_CRED_KEY`).
- Só a chave de administrador troca um token já cadastrado (`PUT /admin/tenants/:id/credencial`). A tela
  Configurar cadastra apenas o primeiro.

## 4. Funcionalidades por fase

| Fase | Versão | Entrega | Situação |
|---|---|---|---|
| 0 — Hospedagem | 0.1.0 – 0.2.x | Conector no Doca, banco, extensão servida pelo Conector | ✅ concluída |
| 1 — Credencial | 0.3.0 – 0.6.0 | Tela Configurar, token único da Asa, chave pela config da instalação | ✅ validada de ponta a ponta |
| 2 — Leitura | 0.5.0 | Abas **Paciente**, **Consultas** e **Agenda** | ✅ validada |
| 3 — Marcar | 0.7.0 – 0.7.1 | Marcar consulta (paciente novo vai junto), convênios e procedimentos | ✅ validada: agendamento real nº 42655586 |
| 4 — Remarcar e cancelar | 0.8.0 | Botões Remarcar e Cancelar na aba Consultas, trava da troca de token, acesso só pelo domínio | 🟡 publicada, falta testar na instalação |
| — Visual | 0.9.0 | Cartão de consulta | ✅ publicada |
| 5 — Confirmação D-1 | 0.10.0 | Conector, configuração e selo; fluxos em `automations/confirmacao-d1/` | 🟡 falta montar os fluxos e testar |
| 6 — Tela cheia | 0.11.0 | Ícone **Agenda Asa** na navegação: agenda do dia por profissional, busca de paciente, marcar, remarcar, confirmar presença, marcar falta e cancelar | 🟡 publicada, falta testar com dados reais |

## 5. Rotas do Conector

**Painel** (autenticadas pela chave da instalação)

| Método | Rota | Função |
|---|---|---|
| GET | `/v1/tenant/conexao/teste` | Testa Conector + Asa |
| PUT | `/v1/tenant/credencial` | Cadastra o primeiro token da Asa |
| GET | `/v1/paciente?telefone=&cpf=` | Busca o paciente e as consultas dele |
| GET | `/v1/agenda` · `/v1/agenda/dias` · `/v1/agenda/horarios` | Profissionais, dias e horários livres |
| GET | `/v1/agenda/convenios` · `/v1/agenda/procedimentos` | Opções para o agendamento |
| POST | `/v1/agendamentos` | Marca a consulta; com `remarcar`, remarca |
| POST | `/v1/agendamentos/:id/cancelar` | Cancela a consulta (prova: a consulta está na lista do paciente) |
| GET | `/v1/agenda/dia?prestador_id=&data=` | Tela cheia: consultas marcadas (`horarios-agendados`) e horários livres do dia |
| POST | `/v1/agendamentos/:id/status` | Tela cheia: `confirmado`, `ausente` ou `cancelado` (prova: a consulta está na agenda do prestador naquele dia) |

**Administração** (header `x-admin-key`): `GET/POST /admin/tenants`, `PATCH /admin/tenants/:id`,
`PUT /admin/tenants/:id/credencial` e `POST /admin/tenants/:id/rotacionar-chave`.

**Infraestrutura**: `GET /health` (status e banco) e `GET /extensao/*` (estáticos sem cache).

## 6. Segurança e proteções

- **Gravações restritas**: só as rotas POST de `agendamento.ts` gravam na Asa. Tudo o mais é leitura.
- **Idempotência**: cada confirmação gera uma chave. A mesma chave nunca chama a Asa duas vezes, então um clique
  duplo não cria duas consultas.
- **Estado `incerto`**: se a Asa não responde, o pedido fica marcado como "pode ter gravado", e o painel não tenta
  de novo às cegas.
- **Horário revalidado** logo antes de gravar.
- **Remarcar e cancelar** só aceitam consultas que estejam na lista do paciente da conversa. Um id solto é recusado.
- **Somente pelo domínio**: um pedido por IP:porta recebe 421, menos o `/health`. Assim nenhuma chave trafega
  em HTTP puro.
- **Sem dados pessoais na trilha**: a tabela `agendamentos` não guarda nome, CPF nem telefone.
- Credenciais da Asa ficam cifradas (AES-GCM), e a chave da instalação fica só como hash.

## 7. Ambiente de teste (`apresentacao`)

| Item | Valor |
|---|---|
| Instalação | **29**: "Asa Saúde (teste — Samuel)" |
| Filas | `18,19` (a 19, WhatsApp oficial, foi ligada pelo usuário em 29/10 para a D-1) |
| Usuários | 508 (samuel.silva.adm, administrador) e 509 (agente.samuel, que atende e testa o painel) |
| Tenant | `7ad29fa2-0ccf-4e52-842c-8eab3cc71012`, instituição Asa 7 |
| Versão instalada | **0.11.1** em 29/10. A 0.11.2 já está no GitHub, mas falta o deploy no Doca |

## 8. Comportamentos da Asa que já pegaram a gente

- O Cloudflare da Asa bloqueia o User-Agent de biblioteca (`403 / 1010`). O Conector se identifica como
  `Kentro-Asa-Connector/x.y`.
- "Paciente não localizado" volta como **HTTP 403**, o mesmo código da credencial recusada. Só é credencial
  quando a mensagem fala em "autoriza".
- O retorno de procedimentos não segue a documentação: traz `convenio_procedimento_id`, `valor`,
  `valor_convenio` e `procedimento_instituicao`. Valor 0 é comum, e o painel o esconde.
- O mapa completo da API está em [`asa-api.md`](asa-api.md).

## 9. Próximos passos

Ponto de parada em 29/10/2026: [`retomada.md`](retomada.md).

1. **Deploy da 0.11.2** no Doca (ícone branco do Configurar), depois `extension_installs_refresh_manifest` na 29.
2. **Testar a tela cheia** com o login 509, só com consultas do próprio usuário: marcar, confirmar presença,
   remarcar, marcar falta e cancelar. Testar também a busca de paciente.
3. Testar **Remarcar** e **Cancelar** do painel lateral (0.8.0).
4. **Fluxos da D-1** na fila 19 (oficial): o usuário pediu para fazer depois das funcionalidades da Asa.
5. Definir o roteiro de implantação para a primeira clínica real: tenant, instalação, chave e token.
6. Corrigir o `/health`, que sempre informa `versao: 0.1.0`.

## 10. Publicar uma versão nova

1. Subir `version` no `packages/extension/manifest.json` e o `?v=` dos arquivos nos `.html`.
2. Fazer commit e push. **O push não dispara deploy**: alguém clica em "Fazer deploy" no projeto
   `Asa_integracao` do Doca. O Conector serve a extensão.
3. Rodar `extension_installs_refresh_manifest` nas instalações.
