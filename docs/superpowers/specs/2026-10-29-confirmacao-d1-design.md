# Confirmação de véspera (D-1) — desenho

> 29/10/2026 · fase seguinte ao painel 0.8.0/0.9.0 · item C1, C2, C3, B2 do escopo ("MVP confirmação")

## 1. Intenção

Na véspera da consulta, a Kentro manda ao paciente uma mensagem com três botões: **Confirmar**,
**Remarcar** e **Cancelar**. A resposta grava o status na Asa. "Remarcar" leva a conversa a um atendente,
que remarca pelo painel (que já está pronto).

A extensão é **um produto para várias clínicas**, e nada que varia entre elas fica fixo no código:
canal, fila, template, textos, horários e destino do "Remarcar" são configuração (decisão do usuário em 29/10).

## 2. Objetivos, não objetivos e antiobjetivos

**Objetivos**
- Disparo D-1 em WhatsApp oficial (template) **e** não oficial (WAMD). Cada clínica escolhe o seu.
- Confirmar e cancelar gravam na Asa (`agendamento-status` com o **id explícito**). Remarcar grava
  `remarcar` e transfere a conversa.
- Sexta pega segunda (`envio_final_semana`), configurável.
- Implantar numa clínica nova sem mexer em código: só configuração e um fluxo gerado a partir do modelo.

**Não objetivos (fica para depois)**
- O robô remarcar sozinho (é a fase do robô).
- Faltosos, lista de espera e cobrança (fase 5 do escopo).
- Criar ou aprovar template na Meta: isso é com a clínica, e a implantação só informa o id.

**Antiobjetivos (seria falha mesmo funcionando)**
- Mandar mensagem a paciente de verdade durante os testes.
- Mandar a mesma consulta duas vezes, ou marcar `disparados` na Asa para uma mensagem que não saiu
  (`disparados` é irreversível).
- Gravar status na Asa escolhendo a consulta pelo telefone (risco 4 do `asa-api.md`).
- Exigir que a clínica mexa na URA de entrada que ela já usa.

## 3. Como funciona

```
 Agenda da Kentro (a cada N min, na janela configurada)
   └─ Automação "Asa — Disparo D-1" (tipo 2, gerada por clínica)
        1. request GET  Conector /v1/confirmacao/lote       → até L consultas pendentes, já com o texto pronto
        2. loop forEach consulta:
             newVar asa_agendamento_id, asa_texto…           (as variáveis são copiadas para o atendimento aberto)
             openChat (WAMD) | openChatCloud (template)      queueId = fila de disparo; destino = URA "Asa — Resposta"
             guarda {agendamento_id, chat_id, erro}
             sleep S segundos (só WAMD, protege o número)
        3. request POST Conector /v1/confirmacao/enviados    → o Conector marca enviados e chama `disparados` na Asa

 URA "Asa — Resposta" (recebe só os atendimentos abertos acima)
   WAMD:  message com {{asa_texto}} e 3 botões (id = confirmar|remarcar|cancelar), depois espera a resposta
   Cloud: o template já saiu e o 1º elemento só espera a resposta (botão do template)
   → request POST Conector /v1/confirmacao/resposta {agendamento_id, acao}
   → message com o texto devolvido pelo Conector
   → confirmar/cancelar: encerra · remarcar: transfere para o destino configurado
   → resposta que não é botão (texto livre): transfere para o destino configurado
```

Por que abrir o atendimento direto na URA "Asa — Resposta": a resposta do paciente cai num fluxo nosso, que
já sabe qual consulta está em jogo (`asa_agendamento_id` foi copiado para o atendimento), nos dois canais.
A URA de entrada da clínica não é tocada.

## 4. O que é configuração, e onde fica

| O quê | Onde | Por quê |
|---|---|---|
| Fila de disparo, canal (WAMD/Cloud), `templateId`, URA de resposta, destino do Remarcar (fila/grupo/atendente) | No **fluxo gerado** para a clínica, na implantação | São ids da Kentro; o `templateId` não aceita variável |
| Horário e intervalo do disparo | Na **agenda** da automação (`automation_schedules`) | É da Kentro e cada clínica tem o seu |
| Ligado/desligado, dias de antecedência (1), sexta pega segunda, tamanho do lote, textos da mensagem e das respostas, **modo teste com lista de telefones permitidos** | No **Conector**, por tenant, editável na tela "Configurar Asa Saúde" (só admin) | Muda sem refazer o fluxo |
| Ordem das variáveis do template Cloud | Fixa e documentada: `[nome, data, hora, profissional, clínica]` | A clínica cria o template seguindo esse modelo |

O modelo do fluxo fica versionado em `automations/confirmacao-d1/` (DSL com marcadores `{{IMPLANTACAO.*}}`),
junto com o roteiro de implantação. Quem implanta (hoje, eu pelo MCP) preenche e cria os dois fluxos e a agenda.

## 5. Conector

**Migração 004**
- `tenants.confirmacao jsonb`: `{ativo, dias_antes, sexta_pega_segunda, lote, textos{…}, teste{ativo, telefones[]}}`.
- `confirmacoes`: `tenant_id, agendamento_id, telefone, data, hora, prestador, estado` (`pendente | reservado |
  enviado | falhou | respondido | ignorado`), `tentativas, chat_id, resposta, erro, reservado_ate`, datas.
  Única por `(tenant_id, agendamento_id)`.
- `tenants.chave_automacao_hash`: uma **chave só da automação**, que só vale nas rotas `/v1/confirmacao/*`.
  Ela fica gravada no fluxo, que os administradores da Kentro conseguem ler, então não pode ser a chave da instalação.

**Rotas** (com a chave da automação)
- `GET /v1/confirmacao/lote`: calcula a data-alvo (fuso America/Sao_Paulo, sexta → segunda se ligado), chama
  `proximos-agendamento` e faz upsert em `confirmacoes`. Depois **reserva** até `lote` pendentes por 15 min,
  para que duas execuções seguidas não peguem as mesmas, e devolve cada uma com telefone normalizado
  (`55…`), as variáveis do template e o texto WAMD montado.
  Com `teste.ativo`, só devolve telefones da lista permitida e marca os outros como `ignorado`, sem chamar `disparados`.
- `POST /v1/confirmacao/enviados {itens:[{agendamento_id, chat_id?, erro?}]}`: as enviadas viram `enviado` e são
  marcadas em `disparados` na Asa (em blocos de até 50). Com erro, voltam a `pendente` até 3 tentativas; depois
  ficam em `falhou`. `CHAT_OPEN` (paciente com atendimento aberto) vira `falhou` com motivo, e o atendente
  vê isso na trilha. Não se insiste.
- `POST /v1/confirmacao/resposta {agendamento_id, acao}`: só aceita uma linha `enviado` daquele tenant.
  É idempotente: a mesma resposta não chama a Asa de novo. Chama `agendamento-status` com o id explícito e
  devolve `{texto, transferir}`. A consulta já passou, ou já tem resposta: devolve o texto informando e não grava.

**Fora do ar:** se a Asa não responder no lote, o disparo dessa rodada não sai. Se não responder na resposta,
o paciente recebe "recebemos, a clínica confirma em instantes" e a conversa vai para o destino configurado.

## 6. Painel

- Na tela "Configurar Asa Saúde", uma seção **Confirmação de véspera** com liga/desliga, textos, modo teste
  e telefones permitidos. Só administradores veem.
- Na aba Consultas, um selo no cartão ("Confirmada pelo paciente", "Pediu para remarcar", "Mensagem enviada")
  quando houver linha em `confirmacoes`. É barato e ajuda o atendente que recebe o "Remarcar".

## 7. Teste

Na instância `apresentacao`, com o modo teste ligado e só o número do usuário na lista. É preciso uma consulta de
teste amanhã na Asa para esse número, marcada pelo próprio painel. Testar os dois canais, se a `apresentacao`
tiver uma fila de cada tipo; se não tiver, testar o que houver e documentar o outro como não testado.

## 8. Decidido por mim (confira)

- URA própria de resposta, aberta como destino do `openChat`/`openChatCloud`, em vez de mexer na URA de entrada da clínica.
- Chave separada para a automação, com escopo só de confirmação.
- Lote padrão de 15, `sleep` de 20 s no WAMD, até 3 tentativas, reserva de 15 min.
- Texto livre (não botão) na URA de resposta vai para o destino do Remarcar, e não gera resposta automática.
- Ordem fixa das variáveis do template Cloud.
