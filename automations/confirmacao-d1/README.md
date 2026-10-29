# Confirmação de véspera (D-1): modelos dos fluxos da Kentro

Desenho: `docs/superpowers/specs/2026-10-29-confirmacao-d1-design.md`.

Cada clínica recebe **dois fluxos**, criados a partir destes modelos, e **uma agenda**:

| Canal da clínica | Automação de disparo | URA de resposta |
|---|---|---|
| WhatsApp não oficial (WAMD) | `disparo-wamd.dsl` | `resposta-wamd.dsl` |
| WhatsApp oficial (Cloud API) | `disparo-cloud.dsl` | `resposta-cloud.dsl` |

Os quatro foram validados na Kentro (`automations_validate_elements`) em 29/10/2026.

## Marcadores

| Marcador | O que entra |
|---|---|
| `%%CONECTOR_URL%%` | `https://asa-integracao-samuels.kentro.com.br` |
| `%%CHAVE_AUTOMACAO%%` | Saída de `POST /admin/tenants/<id>/chave-automacao`. Gerar de novo invalida a anterior |
| `%%FILA_ID%%` | Fila por onde os lembretes saem. Precisa ser do mesmo tipo do modelo |
| `%%URA_RESPOSTA_ID%%` | Id da URA de resposta, criada **antes** da automação |
| `%%TEMPLATE_ID%%` | Só no oficial: id do template aprovado (não aceita variável) |
| `%%DESTINO_REMARCAR%%` | Campos do `transfer`. Exemplos: `destinationType=0` (fila, distribuição normal), `destinationType=0 filter=["<grupo>"]` ou `destinationType=1 destinationId="<usuário>"` |

## Template do WhatsApp oficial

A clínica cria um template de **utilidade** com 5 variáveis, nesta ordem:
`{{1}}` nome · `{{2}}` data ("amanhã (30/10)") · `{{3}}` hora · `{{4}}` profissional · `{{5}}` clínica.
Ele tem três botões de resposta rápida: **Confirmar**, **Remarcar** e **Cancelar**. O Conector entende o texto
do botão, e também "1/2/3", "sim" e "confirmo".

## Roteiro de implantação

1. No Conector: clínica criada (`POST /admin/tenants`), token da Asa cadastrado e chave da automação gerada.
2. Criar a URA de resposta (`automations_create` type=1) com os marcadores preenchidos e anotar o id.
3. Criar a automação de disparo (type=2) e anotar o id.
4. Criar a agenda (`automation_schedules_create`): `fk_ivr` = disparo, `fk_queue` = `%%FILA_ID%%`,
   `kind=4`, a cada 15 min, janela das 09:00 às 18:00, de segunda a sexta (ou o que a clínica pedir),
   fuso `America/Sao_Paulo`. Criar **pausada** (`enabled=0`) e ligar só depois do teste.
5. Em "Configurar Asa Saúde": ligar a confirmação **em modo teste**, só com o telefone de quem testa.
6. Marcar uma consulta de teste para amanhã nesse telefone e rodar a agenda (`automation_schedules_run_now`).
   Conferir a mensagem, as três respostas, o selo na aba Consultas e `GET /admin/tenants/<id>/confirmacoes`.
7. Desligar o modo teste.

## Limites que o modelo respeita

- Uma execução de automação manda no máximo 100 mensagens e faz no máximo 100 requisições: o lote tem até 40 (padrão 15).
- No WAMD há uma pausa de 20 s entre envios, para proteger o número. 15 × 20 s ≈ 5 min, dentro dos 10 min de execução ativa.
- Se o paciente já tem atendimento aberto, a Kentro não aplica o destino (`CHAT_OPEN`): o Conector marca `falhou` e não insiste.
