# Multi-ERP: uma extensão para qualquer ERP de clínica

Decisão de 09/11/2026: a extensão deixa de ser só da Asa Saúde e passa a se chamar **ClinFy** (clínica + simplify). Cada clínica informa o ERP que usa, e o Conector fala com ele por um **adaptador**. A extensão nunca sabe qual ERP está do outro lado.

```
Extensão (igual para todos) ──► Conector ──► adaptador do ERP da clínica ──► ERP
                                rotas /v1/*     erp/<nome>/
                                modelo neutro   traduz para a API do ERP
```

O formato canônico é a "Especificação da API do ERP para a extensão Kentro" (41 rotas, 17 obrigatórias), escrita em 09/11 para um cliente com ERP próprio: https://claude.ai/artifact/152n5TuKBG5NF9jhs7EW2j

## Fases

| Fase | Entrega | Situação |
|---|---|---|
| 1 | Separar a Asa do Conector atrás de `ErpAdapter`, sem mudar o comportamento | **No ar desde 09/11 (0.20.0)**, validada pelo usuário com a Asa |
| 2 | Adaptador "Padrão Kentro" (fala a especificação), kit de conformidade no Postman e servidor simulado | **Feita em 09/11 (0.21.0)**, sem deploy |
| 3 | Extensão genérica: `/v1/capacidades`, textos sem "Asa", implantação com escolha do ERP e "Testar conexão" | A fazer. O nome ClinFy já entrou na 0.20.0 (menus e títulos) |
| 4 | Próximos ERPs, por demanda dos clientes | A fazer |

## Fase 2: Padrão Kentro (0.21.0)

Um ERP que implementa a especificação conecta com **endereço da API + token**, sem código novo.

| Peça | Onde | Para quê |
|---|---|---|
| Adaptador | `src/erp/padrao/adaptador.ts` (`erp = "padrao"`) | Fala a especificação: Bearer, JSON, `Idempotency-Key` em toda gravação, erros pelo envelope `{erro: {codigo, mensagem, campos}}` |
| ERP simulado | `tools/erp-simulado.ts` | A especificação rodando com dados fictícios. Testes, desenvolvimento e referência para o time do ERP (`npx tsx tools/erp-simulado.ts`, porta 4010, token `token-de-teste`) |
| Kit de conformidade | `kit-conformidade/` (coleção do Postman + README), gerado por `tools/gerar-kit-conformidade.ts` | O time do ERP roda contra a homologação dele. 28 passos obrigatórios e 7 desejáveis |
| Ligar a clínica | `PUT /admin/tenants/:id/erp` `{erp: "padrao", base_url, token}` | Testa a conexão e só depois grava (credencial cifrada). `{erp: "asa"}` volta para a Asa sem credencial |

Como o adaptador traduz a especificação para o que as rotas já usam:

- **Erros:**
    - 401 → `ERP_CREDENCIAL_INVALIDA`;
    - 404 → não encontrado;
    - 400, 403, 409 e 422 → `ERP_RECUSOU`, com a mensagem e o código do ERP (`codigoErp`, por exemplo `HORARIO_OCUPADO`);
    - 429 e 5xx → `ERP_FORA_DO_AR`;
    - sem resposta → incerto.
- **Horário sem `slot_id`:** vira `agenda_id = "h-HHMM"`, e esse id não é enviado ao ERP.
- **Paciente novo:** é cadastrado antes da marcação. Se o CPF já existe (409), usa o cadastro que está lá, sem alterá-lo.
- **Status "remarcar" da confirmação:** a especificação não tem esse status. Nada é gravado, e a conversa vai para um atendente.
- **Preços:** vêm de `GET /precos`, quando o ERP tem a rota, e são convertidos de centavos para reais.
- **Telefone com mais de um paciente:** vale o primeiro, e o caso fica registrado no log.

Outras mudanças desta versão:

- Os ids de registro aceitam texto (letras, dígitos e `- _ . :`, até 64), além de números. As colunas do banco já eram texto.
- A extensão entende os códigos `ERP_*` e, para clínica fora da Asa, diz "o ERP" ou "o sistema da clínica".
- O endereço do ERP só aceita HTTPS. Bloqueia `localhost`, IPs internos e de metadados (169.254.x), usuário e senha na URL, query e fragmento. As chamadas não seguem redirecionamento.

**Limites conhecidos** (ficam para a fase 3):

- Profissional por ordem de chegada (turnos sem hora) não aparece na marcação pelo padrão.
- Cada clínica escolhe um ERP só.
- O cadastro do ERP é feito por `curl`; a página `/implantacao` ainda não tem esse campo.

Testes: 9 do adaptador contra o ERP simulado, cobrindo o ciclo completo. Também rodei o kit contra o simulador: 35 requisições e 151 verificações, todas aprovadas; com o token errado, ele reprova (73 falhas). O Conector tem 72 testes.

## Como está organizado (fase 1)

| Arquivo | Papel |
|---|---|
| `src/erp/modelo.ts` | Tipos neutros (Paciente, Consulta, Horario, Agendado…) e utilitários sem ERP (`telefoneNacional`, `consultaNoHorario`) |
| `src/erp/adaptador.ts` | A interface `ErpAdapter`: uma operação para cada coisa que as rotas pedem. `Resultado<T>` e `FalhaErp` |
| `src/erp/index.ts` | Registro: `criarAdaptador(erp, credencial, log)`. Um ERP novo = um adaptador + uma linha aqui |
| `src/erp/asa/cliente.ts` | Chamada HTTP à Asa (antes `src/asa.ts`) |
| `src/erp/asa/normalizar.ts` | Leitura das respostas da Asa (antes `src/normalizar.ts`), mais `proximos` (antes em `confirmacao.ts`) |
| `src/erp/asa/adaptador.ts` | `AsaAdapter`: rotas, formatos de data, `00:00:00`, diagnósticos de formato no log |
| `migrations/011_erp.sql` | Coluna `tenants.erp` (padrão `asa`) |

**`FalhaErp`** traz o código que vai para a extensão (`erro`) e quatro sinais que as rotas usam no lugar das mensagens da Asa:

- `naoEncontrado`: tratar como lista vazia ou registro ausente;
- `credencialInvalida`: responder 422;
- `semResposta`: numa gravação, o resultado é incerto;
- `recusa`: mostrar a mensagem ao atendente.

**O que não mudou de propósito** (fica para a fase 3, junto com a extensão genérica):

- Os códigos `ASA_*` continuam indo para a extensão, porque o `core.js` lê `ASA_CREDENCIAL_INVALIDA` e `ASA_RECUSOU`.
- A chave `asa` na resposta de `/v1/tenant/conexao/teste`.
- A coluna `asa_credencial_cifrada`, que guarda a credencial de qualquer ERP.
- O cadastro do token (`gravarCredencial`) e o vínculo com a instituição, que são da Asa. Para outro ERP, o cadastro responde `ERP_SEM_CADASTRO_DE_TOKEN`.
- A validação de ids só com dígitos (`idValido`), feita para os ids numéricos da Asa. A especificação usa ids em texto.

## Como acrescentar um ERP

1. Criar `src/erp/<nome>/adaptador.ts` implementando `ErpAdapter`. Uma operação que o ERP não tem devolve `FalhaErp` com `naoEncontrado: true` (vira lista vazia) até existirem as capacidades da fase 3.
2. Registrar em `src/erp/index.ts` (`ERPS` e o `switch`).
3. Testes como `test/erp-asa.test.ts`, com a rede simulada.
4. Gravar `tenants.erp = '<nome>'` na clínica.

## Testes

`test/erp-asa.test.ts` simula a rede e confere o que vai para a Asa e como cada resposta é classificada:

- o 403 "Paciente não localizado" vira não encontrado, e não credencial;
- a recusa do Laravel que volta com HTTP 200 vira recusa;
- a queda de rede vira sem resposta;
- a marcação manda a data em DD/MM/AAAA e o id original na remarcação;
- a resposta sem número da consulta chega às rotas com o formato para o log.

Com eles, o Conector tem 62 testes.
