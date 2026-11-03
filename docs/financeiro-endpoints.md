# Financeiro — rotas a pedir à Asa

Situação em **03/11/2026**. Hoje a API da Asa tem uma única rota financeira, `api-gerar-conta-paciente`, que só **cria** a conta (ver `asa-api.md`). Não há como ler, baixar nem cancelar. Por isso a aba Financeiro mostra só o que a Kentro lançou (tabela `cobrancas`), sem saber se foi pago (P1, P2, P3 e P4 em `pendencias.md`).

**Versão enviada à Asa: `pedido-financeiro-asa.pdf`** (03/11). Decisões do usuário:
- o link de Pix/boleto passou a ser pedido, como F7 no PDF;
- baixa de pagamento, formas de pagamento e webhook ficaram de fora;
- o faturamento de convênio entrou, como C1 a C3.

Este documento é o rascunho do pedido à Asa. As rotas seguem as convenções da Asa: `POST`, parâmetros na query string, prefixo `api-` e o mesmo `Authorization`.

**Escopo:** conta a receber **do paciente** (particular, coparticipação, pacote). O faturamento de convênio (lote de guias para a operadora) é outro processo e fica fora daqui.

## Ciclo de vida da conta

```
lançada ──► em aberto ──► paga
               │  ├─────► parcialmente paga ──► paga
               │  └─────► vencida ──► paga / negociada
               └────────► cancelada (com motivo)
```

A Asa precisa devolver essa `situacao` em todas as rotas de leitura. Os nomes valem como sugestão: o importante é a lista ser fechada e documentada.

## Rotas, por prioridade

### Essenciais (sem elas não há processo financeiro)

| # | Rota sugerida | Tipo | Parâmetros | Retorno | Atende |
|---|---|---|---|---|---|
| F1 | `api-financeiro-contas-paciente` | L | `paciente_id` (ou `cpf`/`telefone`); opcionais `situacao` (`aberto`, `vencido`, `pago`, `cancelado`, `todas`), `vencimento_inicio`, `vencimento_fim`, `page` | `contas[]` (campos abaixo) e `totais {em_aberto, vencido, pago_no_periodo}` | Cobranças no nome do cliente, faturas em aberto, próximas cobranças, saldo devedor |
| F2 | `api-financeiro-contas-periodo` | L | `vencimento_inicio`, `vencimento_fim` (`YYYY-MM-DD`); opcionais `situacao`, `page` | `contas[]` com `paciente {id, nome, cpf, telefone}` | Lembrete de vencimento e cobrança de atrasados por WhatsApp; painel da clínica |
| F3 | Ajuste em `api-gerar-conta-paciente` | E | o que já existe | **devolver o `id` da conta criada** e documentar o `status` 0/1 | Ligar o lançamento da Kentro à conta da Asa (hoje volta só `{status, msg}`) |

**Campos de cada conta** (F1, F2 e F4):

| Campo | Exemplo | Observação |
|---|---|---|
| `id` | `"88123"` | id da conta na Asa |
| `id_externo` | `"k-3f9a…"` | o que a Kentro enviou ao lançar; é como achamos o nosso lançamento |
| `agendamento_id` | `"42650120"` | quando a conta vem de uma consulta |
| `descricao` / `procedimentos[]` | `"Consulta clínica"` | o que está sendo cobrado |
| `parcela`, `total_parcelas` | `2`, `3` | quando parcelado |
| `valor`, `valor_pago`, `valor_em_aberto` | `"350.00"` | em reais, com ponto |
| `desconto`, `juros_multa` | `"0.00"` | se a Asa aplicar |
| `emissao`, `vencimento`, `pagamento` | `YYYY-MM-DD` | `pagamento` nulo enquanto aberta |
| `situacao` | `aberto` | lista fechada (ver ciclo acima) |
| `forma_pagamento` | `pix` | mesma lista de `gerar-conta-paciente` |

### Importantes

| # | Rota sugerida | Tipo | Parâmetros | Retorno | Atende |
|---|---|---|---|---|---|
| F4 | `api-financeiro-conta` | L | `id` **ou** `id_externo` | a conta, mais `pagamentos[] {data, valor, forma}` | Detalhe da cobrança; conferir uma cobrança que ficou `incerto` |
| F5 | `api-financeiro-cancelar-conta` | **E** | `id` ou `id_externo`, `motivo` | `{status, msg}` | Corrigir lançamento errado sem entrar na Asa (P2) |
| F6 | `api-financeiro-lembretes-disparados` | **E** | `contas[]` (até 50 ids), `tipo` (`antes_vencimento`, `vencimento`, `atraso`) | `{status}` | Não mandar o mesmo lembrete duas vezes. É o mesmo padrão de `proximos-agendamento` com `agendamento-disparados` |

### Desejáveis

| # | Rota sugerida | Tipo | O que faz |
|---|---|---|---|
| F7 | `api-financeiro-baixar-conta` | **E** | Registra pagamento recebido fora da Asa (`id`, `valor`, `data`, `forma`, `id_externo` do pagamento). Só faz sentido se a Kentro passar a receber (link de Pix, por exemplo). |
| F8 | `api-financeiro-link-pagamento` | L | Devolve Pix copia-e-cola, QR ou boleto da conta, **se a Asa gerar**. O atendente manda no chat. |
| F9 | `api-financeiro-formas-pagamento` | L | Lista das formas aceitas pela clínica (hoje está fixa no Conector). |
| F10 | Webhook de conta | — | A Asa avisa o Conector quando uma conta é paga, vence ou é cancelada (P4). Sem ele, o Conector consulta F2 em horário marcado. |

## O que cada rota liga no sistema

| Tela ou processo | Rotas | Quem vê |
|---|---|---|
| Aba Financeiro do paciente: saldo em aberto, vencidas em destaque, próximas, histórico com situação real | F1, F4 | Atendente |
| Lançar cobrança (já existe), agora com a conta vinculada | F3 | Conforme "Quem pode lançar" |
| Cancelar lançamento errado | F5 | Administrador |
| Régua de cobrança por WhatsApp: D-3, no dia, D+1 e D+7 (automação Kentro, como a confirmação) | F2, F6 | Automático |
| Painel da clínica: a receber, recebido, inadimplência por período | F2 | Administrador e supervisor |
| Enviar Pix ou boleto no chat | F8 | Atendente |

## Perguntas para a Asa junto com o pedido

1. O que significa `status` 0/1 em `gerar-conta-paciente` (pago na hora? em aberto?)?
2. A Asa gera Pix ou boleto da conta, ou a clínica recebe por fora?
3. A conta aceita parcelamento? Cada parcela é uma conta separada ou uma conta com parcelas?
4. Há juros e multa automáticos no atraso? A conta muda sozinha para "vencida"?
5. Cancelamento é exclusão ou fica registrado com motivo?
6. A conta gerada pelo agendamento (consulta particular) já nasce na Asa sem chamarmos `gerar-conta-paciente`? Se sim, F1 já traria essas contas e o painel não precisaria lançar.
