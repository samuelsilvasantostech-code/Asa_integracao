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
| 1 | Separar a Asa do Conector atrás de `ErpAdapter`, sem mudar o comportamento | **Feita em 09/11 (0.20.0), aguardando deploy** |
| 2 | Adaptador "Padrão Kentro" (fala a especificação), kit de conformidade no Postman e servidor simulado | A fazer |
| 3 | Extensão genérica: `/v1/capacidades`, textos sem "Asa", implantação com escolha do ERP e "Testar conexão" | A fazer. O nome ClinFy já entrou na 0.20.0 (menus e títulos) |
| 4 | Próximos ERPs, por demanda dos clientes | A fazer |

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
