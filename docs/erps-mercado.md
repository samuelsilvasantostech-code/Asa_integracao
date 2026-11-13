# ERPs de clínica no Brasil: o que as APIs têm em comum

Pesquisa de 12/11/2026, para tornar a ClinFy capaz de ligar em qualquer ERP. Nesta data, a rede desta máquina não resolvia a maioria dos domínios; os dados vêm de buscas na web e de páginas que abriram, com a fonte em cada linha. **O que vem de terceiros** (SDKs não oficiais, conectores, freelas) **está marcado e precisa ser conferido na documentação oficial antes de virar código.**

## Resumo

Todos os ERPs com API cobrem as mesmas 6 operações do núcleo da ClinFy:

1. buscar paciente;
2. cadastrar paciente;
3. listar profissionais;
4. horários livres;
5. marcar;
6. cancelar ou mudar status.

O que muda de um para outro é a **forma** dessas operações:

- autenticação;
- formato de data;
- nomes dos campos;
- parâmetros na query ou em JSON;
- o que identifica a vaga.

Por isso o caminho geral é **o modelo canônico da ClinFy + uma descrição de cada ERP (configuração), e não código novo por ERP**. Ver a proposta no fim.

Dos ERPs pesquisados, metade não tem API pública (iClinic, Amplimed, ProDoctor, GestãoDS, Simples Dental). Para esses, os caminhos são o padrão Kentro (o fornecedor implementa a especificação) ou um parceiro que já tenha acesso.

## ERPs pesquisados

| ERP | API para terceiros | Autenticação | Documentação | Situação para a ClinFy |
|---|---|---|---|---|
| **Asa Saúde** | Sim | Token (Base64 de id:hash) no `Authorization` | Coleção pública no Postman | **Integrado** (adaptador próprio) |
| **Feegow** | Sim, pública | `x-access-token` (JWT gerado no sistema) | [docs.feegow.com](https://docs.feegow.com/) | **Melhor candidato:** docs abertas e as 6 operações |
| **Ninsaúde Clinic** | Sim ("Toro", REST) | OAuth2: access token de 15 min + refresh token | [Página de desenvolvedores](https://www.ninsaude.com/en/developers/) + coleção pública no Postman | Bom candidato; tem webhooks ("Triggers") |
| **Clínica nas Nuvens** | Sim, módulo pago | Basic (client_id e secret de parceiro) + header `clinicaNasNuvens-cid` | [Swagger em api.clinicanasnuvens.com.br](https://api.clinicanasnuvens.com.br/) | Bom candidato; Swagger aberto |
| **Clinicorp** (odonto) | Sim; o escopo do token é negociado na contratação | HTTP Basic: ID de acesso + Token API, com `subscriber_id` nas rotas | [Swagger público em sistema.clinicorp.com/api-docs](https://sistema.clinicorp.com/api-docs/); análise em [`erps/clinicorp.md`](erps/clinicorp.md) | Bom candidato: agenda, paciente, horários livres, confirmar e cancelar. Sem convênio, preço e cobrança |
| **Klingo** | Sim ("API externa") | — | SwaggerHub "klingo-api-externa"; [SDK não oficial](https://github.com/ValleSaude/klingo-node-sdk) | Precisa da documentação oficial |
| **Shosp** | Sim, agenda com chave + id | Chave personalizada + id | [Página de desenvolvedores](https://www.shosp.com.br/desenvolvedores) | Precisa abrir a documentação |
| **Doctoralia / Docplanner** | Sim, mas é **marketplace**, não ERP | Client credentials | [Integrations API](https://integrations.docplanner.com/docs/) | Outro tipo de integração (ver abaixo) |
| iClinic | Não encontrada | — | — | Só pelo padrão Kentro |
| Amplimed | Não encontrada | — | — | Só pelo padrão Kentro |
| ProDoctor | Não encontrada | — | — | Só pelo padrão Kentro |
| GestãoDS | Não encontrada | — | — | Só pelo padrão Kentro |
| Simples Dental | **Não tem**: a [própria ajuda](https://ajuda.simplesdental.com/pt-BR/articles/2667300-o-simples-dental-tem-integracao-via-api-com-outros-softwares) diz que não há API para terceiros | — | — | Fora, salvo parceria |

## Como cada um faz as operações do núcleo

| Operação | Asa | Feegow | Ninsaúde ¹ | Clinicorp ¹ |
|---|---|---|---|---|
| Buscar paciente | `POST api-agendamento-paciente-instituicao` (cpf ou telefone) | `GET patient/search` | — | `GET /patient/get` |
| Cadastrar paciente | `POST api-agendamento-paciente-create-edit` (sobrescreve) | `POST patient/create` | `POST /cadastro_paciente`, `PUT /cadastro_paciente/{id}` | `POST /patient/create` |
| Profissionais | `POST api-agendamento` | `GET professional/list` (ativo, unidade, especialidade) | — | `GET /business/list` (clínicas) |
| Horários livres | `POST …horarios-atendimento` (profissional + dia) | `GET appoints/available-schedule` (por **especialidade ou procedimento**, período `DD-MM-YYYY`) ¹ | — | `GET /business/list_available_times` |
| Marcar | `POST …agendar-instituicao` (com `agenda_id`) | `POST appoints/new-appoint` (unidade, paciente, profissional, especialidade, procedimento, data `DD-MM-YYYY`, hora `HH:MM:SS`, valor em centavos, plano 0/1); **409 se ocupado** ¹ | `POST /atendimento_agenda` | — |
| Remarcar | Mesma rota com o id original | — | `POST /atendimento_agenda/reagendar/agendamento/{id}` | — |
| Status e cancelar | `POST api-agendamento-status` | `POST appoints/statusUpdate`, `GET appoints/status` | — | — |
| Listar consultas | `api-agendamentos-futuros` (10 próximas) | `GET appoints/search` (profissional, paciente, período) | — | — |
| Webhooks | Não | — | Sim ("Triggers") | — |

¹ Fonte de terceiros: [conectores MCP da Feegow](https://glama.ai/mcp/connectors/io.github.mcp-dir/feegow-mcp/tools/feegow_appointment_write_create), [nó n8n da Feegow](https://ncnodes.com/package/n8n-nodes-feegow/feegow/Paciente:Criar%20Paciente), [guia NicoChat da Ninsaúde](https://docs.nicochat.com/en/integrations/ninsaude) e da Clinicorp. Conferir na documentação oficial.

## O que muda de ERP para ERP

| Diferença | Exemplos | Como a ClinFy absorve |
|---|---|---|
| Autenticação | Token fixo em header (Asa, Feegow), Bearer, Basic + header de clínica (Clínica nas Nuvens), OAuth2 com refresh de 15 min (Ninsaúde) | Tipos de autenticação prontos no Conector, escolhidos por configuração. O OAuth2 guarda o access token em memória e renova sozinho |
| Formato de data | `YYYY-MM-DD`, `DD/MM/YYYY` (Asa), `DD-MM-YYYY` (Feegow), `HH:MM:SS` | Conversores declarados por campo |
| Transporte | Query em POST (Asa), JSON (Feegow, padrão Kentro) | Declarado por operação |
| Identidade da vaga | `agenda_id` (Asa), `slot_id` (padrão), unidade + especialidade + procedimento + hora (Feegow) | A vaga do modelo leva um `agenda_id` opaco que o adaptador monta e desmonta. **Acrescentar `unidade_id` e `especialidade_id` à vaga** |
| Ponto de partida da busca | Por profissional (Asa, padrão) ou por especialidade ou procedimento, devolvendo vários profissionais (Feegow) | **Acrescentar ao modelo "horários por especialidade/procedimento"**, com o profissional em cada horário |
| Dinheiro | Reais (Asa), centavos (Feegow, padrão Kentro) | Conversão declarada |
| Erros | Recusa com HTTP 200 (Asa), 409 de horário ocupado (Feegow) | Regras de erro declaradas: status, campo e texto que indicam "não achei", "credencial" e "recusa" |
| Avisos de mudança | Webhooks (Ninsaúde, Docplanner) ou nenhum | Capacidade `eventos`; sem ela, consulta periódica |

## Marketplaces (Doctoralia)

A Doctoralia não é o ERP da clínica: é uma vitrine de agendamento que sincroniza com o ERP. O modelo dela tem clínicas, médicos, endereços, horários e reservas. O integrador envia **períodos de trabalho**, e a Doctoralia os divide em horários; as reservas podem nascer dos dois lados e chegam por webhook ([guia](https://integrations.docplanner.com/guide/)).

Para a ClinFy, isso é uma **segunda fonte de agenda**, não um ERP. Fica fora do núcleo até um cliente pedir.

## Padrão aberto: FHIR

O FHIR R4 (HL7) tem os recursos `Patient`, `Schedule`, `Slot` (horário, com status `free` ou `busy`) e `Appointment` ([Slot](https://hl7.org/fhir/R4/Slot.html)). Sistemas hospitalares e a RNDS usam FHIR. Os ERPs de clínica pequena pesquisados não usam.

Um adaptador FHIR serviria a todos os sistemas que o falam, mas hoje nenhum cliente da Kentro está nesse grupo. É um candidato para depois, não para agora.

## Proposta: adaptador por configuração

Hoje, cada ERP novo é um arquivo TypeScript (`src/erp/<nome>/adaptador.ts`). A proposta é que a maioria vire **uma descrição em JSON**, interpretada por um adaptador único:

```json
{
  "erp": "feegow",
  "nome": "Feegow",
  "autenticacao": { "tipo": "header", "header": "x-access-token" },
  "base_url": "https://api.feegow.com/v1/api",
  "datas": { "data": "DD-MM-YYYY", "hora": "HH:MM:SS" },
  "operacoes": {
    "buscarPaciente": { "metodo": "GET", "caminho": "/patient/search", "query": { "paciente_cpf": "{{cpf}}" }, "lista": "$.content", "mapa": { "id": "$.id", "nome": "$.nome" } },
    "marcar": { "metodo": "POST", "caminho": "/appoints/new-appoint", "corpo": { "...": "..." }, "id": "$.content.agendamento_id" }
  },
  "erros": { "naoEncontrado": [{ "status": 404 }], "credencial": [{ "status": 401 }], "recusa": [{ "status": 409 }, { "status": 422 }] }
}
```

O que se ganha:

- Um ERP novo vira configuração, revisada e testada contra o simulador e o kit, sem deploy de código. O código só entra para o que a configuração não exprime, como o "relê o cadastro antes de marcar" da Asa.
- As capacidades saem da própria configuração: a operação que não está descrita não existe para aquele ERP.
- O padrão Kentro passa a ser só mais uma configuração, e a prova de que o motor funciona é ele passar nos mesmos testes do adaptador atual.

O que precisa existir no motor:

- autenticação: `header`, `bearer`, `basic` e `oauth2_refresh`;
- conversores de data e de dinheiro;
- caminhos JSON simples (`$.a.b`, listas);
- modelos de parâmetro (`{{cpf}}`);
- regras de erro;
- paginação nos estilos `pagina`/`total` e `offset`.

## Ordem sugerida

1. **Motor do adaptador por configuração**, provado com o padrão Kentro escrito como configuração, passando nos testes de hoje e no kit.
2. **Modelo:** acrescentar `unidade_id` e `especialidade_id` à vaga e os horários por especialidade ou procedimento.
3. **Feegow como primeira configuração**, a partir da documentação oficial. Só vai para uma clínica depois de testado com uma credencial real de homologação.
4. Ninsaúde (exige `oauth2_refresh`) e Clínica nas Nuvens, por demanda.
5. Clinicorp, Klingo e Shosp, quando um cliente trouxer o acesso à documentação.
