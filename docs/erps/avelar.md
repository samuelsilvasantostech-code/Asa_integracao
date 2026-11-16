# Avelar (sistema Luna)

O Luna é o sistema interno da Avelar. Na ClinFy ele aparece no catálogo como **Avelar** (slug `avelar`).

A fonte é o PDF "API do Luna para a extensão Kentro", entregue pela Avelar em 16/11/2026. Ele **não está no repositório** porque traz os tokens das clínicas. Os tokens nunca entram em código, documento, teste, log ou commit. Quem cola o token é o usuário, na tela de implantação.

## Conexão

| Item | Valor |
|---|---|
| Produção | `https://www.sistemaluna.com/api/v1/kentro` |
| Homologação | `https://homolog.sistemaluna.com/api/v1/kentro` |
| Autenticação | `Authorization: Bearer <token>` |
| Token | Um por clínica e por ambiente. Não há header de clínica: o token já diz qual é |
| Limite | 600 requisições por minuto. Acima disso, 429 com `Retry-After` |
| Erros | Envelope da spec, `{ "erro": { "codigo", "mensagem", "campos" } }`. Erro nunca vem com HTTP 200 |

## Como o conector foi feito

- **Por configuração**, sem código novo: `packages/connector/src/erp/conectores/avelar.json`. A migração 017 o cadastra em **homologação**.
- O Luna segue a especificação Kentro. Por isso `especificacao: true` e `rotas: {}`: toda rota vai como está na spec.
- A clínica preenche dois campos:
    - o endereço (produção ou homologação);
    - o token do mesmo ambiente.
- O endereço é campo, e não fixo, porque o motor só aceita endereço fixo único. Com um campo `url`, a mesma configuração serve aos dois ambientes. O `baseUrlValida` continua exigindo HTTPS público.

## Diferenças do Luna em relação à spec, e o efeito na ClinFy

| Tema | Luna | Efeito |
|---|---|---|
| Id do paciente | Carrega o tipo: `paciente-123`, `titular-45`, `beneficiario-9` | Nenhum: o id é tratado como texto |
| Convênio | `particular` (aceita também `"0"`), `avelar` (Plano Avelar) ou id numérico | Nenhum: a lista vem de `GET /convenios` |
| Remarcar | Move a consulta: mesmo id, resposta 200, sem status `remarcado` | O adaptador usa a rota de remarcar e devolve o mesmo id. Não há cancelamento separado |
| Confirmações | Não há `/confirmacoes`: o Luna já manda o lembrete pela Kentro | A capacidade `confirmacao` sai desligada, o que evita lembrete em dobro |
| Contas, reservas, webhooks | Não existem nesta versão | `financeiro` sai desligado |
| Unidade | Só id e nome (sem endereço, telefone ou mapa) | A mensagem de marcação sai sem endereço |
| Procedimento | `preparo`, `exige_pedido_medico` e `duracao_minutos` vêm `null` | Sem orientação de preparo |
| Busca de paciente | Compara o telefone principal pelos últimos 8 dígitos, até 50 resultados | Nenhum: o adaptador usa o primeiro |
| Cadastro de paciente | Ignora endereço e convênio. 409 `PACIENTE_JA_EXISTE` traz `paciente_id` | O adaptador trata o 409 como recusa e busca o cadastro pelo CPF |
| Cancelamento | Sem regra de antecedência (`PRAZO_CANCELAMENTO` não ocorre) | Nenhum |
| `Idempotency-Key` | Obrigatória em `POST /agendamentos` e `/remarcar` | O adaptador já manda nas duas (e no cadastro, com `-paciente`) |

Formatos: telefone só com dígitos, DDI e DDD (`5538999998888`); dinheiro em centavos; `slot_id` no formato `<agenda>-<HHMM>`. As agendas são de `horario_marcado` ou `ordem_chegada` (blocos). `/dias-disponiveis` aceita janela de até 90 dias. `/agenda` pede `data` mais `profissional_id` ou `unidade_id`.

## Testes

- `packages/connector/test/avelar.test.ts` roda contra um Luna simulado. Cobre:
    - a configuração e a migração;
    - a credencial;
    - o Bearer;
    - as capacidades;
    - marcar com paciente novo e com paciente já existente;
    - remarcar mantendo o id;
    - as recusas com código;
    - o 429.
- **Falta o teste real** em homologação: "Testar com credencial" na Central, com o token de homologação colado pelo usuário. Antes de publicar, conferir:
    - se `GET /status` e `GET /profissionais` respondem;
    - se os horários vêm com `slot_id`;
    - se uma marcação e uma remarcação de teste funcionam (com paciente fictício, nunca com paciente real).
