# Roteiro de teste com dados reais

O que está no ar e ainda não foi testado numa clínica de verdade (itens P32 a P36, P41 e P42 de [`pendencias.md`](pendencias.md)).
Use um paciente de teste com o seu próprio telefone. Marque cada passo como **ok** ou anote o que apareceu na tela (texto exato e horário).

Antes de começar: confira que o Conector está na versão certa em `/health` e que a instalação da Kentro foi atualizada.

## 1. Tempo de espera (P41): Agenda, consulta de hoje

| # | Faça | Esperado |
|---|---|---|
| 1.1 | Agenda → Dia → Hoje. Abra uma consulta ativa | O primeiro botão é **Confirmar chegada** |
| 1.2 | Abra uma consulta de amanhã | Sem o botão, com o aviso "A chegada é marcada no dia da consulta." |
| 1.3 | Hoje: clique em **Confirmar chegada** | Linha com "Aguardando · 0 min". O paciente entra na **Sala de espera** (feche a consulta para ver). Confirmar presença, Marcar falta, Remarcar e Cancelar somem. **Se der erro aqui, a migração 019 não rodou.** |
| 1.4 | Espere uns minutos ou use **Ajustar hora** para pôr a chegada 20 min antes | Cronômetro âmbar (vermelho se for mais de 30 min) |
| 1.5 | **Chamar para consulta** | "Em consulta · X"; a lateral mostra quanto ele esperou |
| 1.6 | **Desfazer chamada**, depois chame de novo | Volta para "Aguardando" e depois para "Em consulta" |
| 1.7 | **Finalizar consulta** | "Atendido · esperou X"; a lateral mostra a duração |
| 1.8 | Dois computadores na mesma consulta: um chama, e em seguida o outro (sem atualizar) também clica em chamar | O segundo vê "Outra pessoa…" e a tela se acerta sozinha |
| 1.9 | Painel → período Hoje | A seção **Tempo de espera** mostra o atendimento, com espera e consulta |

## 2. Painel lateral da conversa (P32)

| # | Faça | Esperado |
|---|---|---|
| 2.1 | Na conversa do paciente de teste, marque uma consulta | Aparece em "Próximas" e na Agenda do ERP |
| 2.2 | **Remarcar** essa consulta para outro horário | No ERP: horário novo, e o antigo livre |
| 2.3 | **Cancelar**: o foco vai para "Não"; depois confirme | Some das próximas e aparece cancelada no ERP |

## 3. Agenda em tela cheia (P33)

| # | Faça | Esperado |
|---|---|---|
| 3.1 | Dia e Semana, troca de profissional e Lado a lado | Mesmas consultas do ERP |
| 3.2 | Clique num horário livre e marque | Aparece na coluna e no ERP |
| 3.3 | **Confirmar presença** e **Marcar falta** (cada um em uma consulta) | O estado muda na Agenda e no ERP |
| 3.4 | Buscar paciente por CPF e por telefone | Mostra o paciente e as consultas dele |

## 4. Cadastro de paciente (P42): só em Luna ou Feegow

| # | Faça | Esperado |
|---|---|---|
| 4.1 | Busque um CPF que não existe → **Cadastrar paciente** | O CPF já vem preenchido; depois de salvar, o paciente aparece |
| 4.2 | Cadastre de novo o mesmo CPF | Aviso de que já existia, sem duplicar no ERP |

## 5. Por exame (P36)

| # | Faça | Esperado |
|---|---|---|
| 5.1 | Agendar → Por exame, busque um exame e escolha um horário | O procedimento já vem escolhido no formulário |

## 6. Financeiro (P34): só se estiver ligado na implantação

| # | Faça | Esperado |
|---|---|---|
| 6.1 | Lance uma cobrança de valor baixo no paciente de teste | Aparece no histórico da aba Financeiro |
| 6.2 | Confira a conta a receber no ERP | Anote como ficou a situação (paga ou em aberto): isso fecha o P3 |
| 6.3 | Entre com um atendente sem perfil de administrador | O botão de cobrança some, se "Quem pode lançar" for só administradores (fecha o P22) |

## 7. Confirmação D-1 (P35)

| # | Faça | Esperado |
|---|---|---|
| 7.1 | Consulta de amanhã para o seu número → **Enviar confirmação** | Chega a mensagem pela fila 19 |
| 7.2 | Responda pela opção de confirmar do fluxo | A consulta passa a confirmada na Agenda e no ERP (depende do fluxo criado na fila 19) |
