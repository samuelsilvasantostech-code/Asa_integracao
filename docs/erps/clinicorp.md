# Clinicorp: documentação da API e encaixe no ClinFy

Levantado em 13/11/2026.

**Situação:** o conector está pronto e em homologação, por configuração (`packages/connector/src/erp/conectores/clinicorp.json`, migração 016). Foi testado só contra uma Clinicorp simulada, com o formato do Swagger. Falta o teste com credencial real.

- **Campos da clínica:** ID de acesso, Token API e ID da clínica.
- **Fora do conector:**
    - convênios (fica só Particular) e valores;
    - cobrança e grupos;
    - "ausente": a Clinicorp marca ausência por um status próprio de cada assinante, que fica para depois.
- **Na confirmação de véspera:**
    - o lembrete vai para todas as consultas não desmarcadas do dia, porque o id do status "confirmado" é próprio de cada assinante;
    - o nome do profissional não vem na agenda.
- **A conferir no teste real:**
    - se `subscriber_id` é o mesmo ID de acesso;
    - o formato de `BirthDate`;
    - a resposta do `patient/get` quando não acha o paciente;
    - se o `create_appointment_by_api` aceita sem `PatientName` e sem `Procedures`.

## Fonte

- **Documentação oficial:** Swagger público em https://sistema.clinicorp.com/api-docs/. É um OpenAPI 3.0.1, "API Clinicorp" 1.0.0, com 51 rotas.
- **Cópia da especificação:** [`clinicorp-openapi.json`](clinicorp-openapi.json), extraída da página em 13/11.
- **Endereço da API:** `https://api.clinicorp.com/rest/v1`.
- **Autenticação:** HTTP **Basic**.
    - Usuário = **ID de acesso / Usuário API**.
    - Senha = **Token API**.
    - Onde encontrar, no sistema: Gerenciar Assinatura → Acesso Externo e Integrações → Integrações.
- **Atenção ao escopo do token:** fontes de terceiros dizem que ele é negociado na contratação ([OdontoResults](https://odontoresults.com.br/blog/api-clinicorp/)). Uma rota que existe no Swagger pode responder 401/403 para um token sem esse escopo.
- **Formato:** muitas rotas pedem `subscriber_id` (o ID do assinante) na query ou no corpo, e as datas variam conforme a rota:
    - `YYYYMMDD` em `list_available_times`;
    - `YYYY-MM-DD` em `get_avaliable_days`;
    - ISO 8601 em UTC na criação de agendamento.

## Rotas por grupo

| Grupo | Rotas |
|---|---|
| Agenda (`appointment`) | `GET /appointment/list` (agenda do período: agendamentos, eventos e compromissos), `POST /appointment/create_appointment_by_api`, `POST /appointment/confirm_appointment`, `POST /appointment/cancel_appointment`, `GET /appointment/change_status`, `GET /appointment/status_list`, `GET /appointment/list_categories`, `GET /appointment/list_info`, `GET /appointment/schedule_occupation` |
| Agendamento online (link de agenda) | `GET /appointment/get_avaliable_days`, `GET /appointment/get_avaliable_times_calendar`, `GET /appointment/get_appointment`, `POST /appointment/create_online_scheduling`. Dependem do `code_link` da agenda online (agenda.link/{código}) e criam **solicitações**, que a clínica ainda aprova |
| Horários livres | `GET /business/list_available_times` (profissional + clínica + período) |
| Clínicas e unidades | `GET /business/list`, `GET /business/list_chairs` (cadeiras), `GET /group/list_subscribers`, `GET /group/list_subscribers_clinics` |
| Profissionais e usuários | `GET /professional/list_all_professionals`, `GET /security/list_users` |
| Pacientes | `GET /patient/get` (por id, nome, CPF, telefone ou e-mail), `POST /patient/create`, `GET /patient/list_appointments`, `GET /patient/list_estimates`, `GET /patient/birthdays` |
| Procedimentos | `GET /procedures/list` (das tabelas de preço), `GET /procedures/list_specialties` |
| Financeiro (só leitura) | `GET /financial/list_payments`, `list_receipt`, `list_cash_flow`, `list_summary`, `list_invoices`, `average_installments`, `GET /payment/list`, `GET /payment/list_reconcile_claim` |
| Orçamentos e vendas | `GET /estimates/get`, `GET /estimates/list`, `GET /sales/estimates_and_conversion`, `GET /sales/expertise_revenue` |
| Gestão | `GET /analytics/list_results`, `GET /operational/list_misses_goals`, `GET /operational/list_sales_goals` |
| CRM | `POST /crm/add_leads`, `GET /crm/list_active_campaigns` |
| Outros | `POST /file/upload`, `POST /products/orders`, `POST /migration/*` |

## Encaixe nas rotas do ClinFy

| O que o ClinFy precisa | Rota da Clinicorp | Observação |
|---|---|---|
| Testar conexão | `GET /professional/list_all_professionals` | |
| Profissionais | `GET /professional/list_all_professionals` | Volta só `id`, `name` e `cpf`, **sem especialidade** |
| Especialidades | `GET /procedures/list_specialties` | Não liga especialidade a profissional |
| Clínica (unidade) | `GET /business/list?subscriber_id=` | O `clinicId` é obrigatório nos horários livres: vira um campo da credencial (ou a primeira clínica) |
| Dias e horários livres | `GET /business/list_available_times?professionalId&clinicId&fromDate&toDate` (YYYYMMDD) | Lista `[{date, slots: [{fromTime, toTime}]}]`, **por profissional**, como a especificação. O `toTime` precisa ir na vaga, porque a marcação pede início e fim |
| Buscar paciente | `GET /patient/get?subscriber_id&OtherDocumentId=` (CPF) ou `&Phone=` | Volta **um** objeto (`PatientId`, `Name`, `Phone`, `OtherDocumentId`, `BirthDate`, plano de saúde) |
| Cadastrar paciente | `POST /patient/create` (`subscriber_id`, `Name`, `BirthDate`, `MobilePhone`, `OtherDocumentId`) | A resposta documentada **não traz o id**: buscar pelo CPF depois de criar. Já recusa CPF repetido (a não ser com `IgnoreSameDoc`) |
| Consultas do paciente | `GET /appointment/list?from&to&patientId=` (ou `/patient/list_appointments`) | Filtrar `Canceled`/`Deleted` = "X" |
| Agenda do dia | `GET /appointment/list?from=&to=&businessId=` | Vem a agenda **de todos os profissionais**: filtrar por `Dentist_PersonId`. Traz nome, celular e status do paciente |
| Marcar | `POST /appointment/create_appointment_by_api` | `Patient_PersonId`, `PatientName`, `MobilePhone`, `date` (ISO), `fromTime`, `toTime`, `Clinic_BusinessId`, `Dentist_PersonId`, `Procedures` (texto), `CategoryId`. Também aceita agenda **por cadeira** (`ScheduleToId`/`ScheduleToType`), comum em odonto |
| Remarcar | **não tem rota** | Desmarcar a antiga e marcar a nova |
| Confirmar | `POST /appointment/confirm_appointment` (`subscriber_id`, `id`) | Ou `change_status` com o status do tipo `CONFIRMED` |
| Cancelar | `POST /appointment/cancel_appointment` (`subscriber_id`, `id`) | |
| Ausente | `GET /appointment/change_status?id&status_id` | O id do status sai de `/appointment/status_list` (é por assinante). A rota usa **GET** para gravar |
| Consultas a confirmar (véspera) | `GET /appointment/list?from=&to=` | Filtrar as não confirmadas pelo `StatusId` |
| Convênios | **não tem rota** | Só o plano de saúde no cadastro do paciente. Na prática, Particular |
| Procedimentos com preço | `GET /procedures/list` | Nome, especialidade e tabela de preço, **sem valor** |
| Lançar cobrança | **não tem rota de criação** | Financeiro só leitura: capacidade desligada |
| Grupos de procedimentos | — | Capacidade desligada |

## Conclusão

- **Dá para integrar o essencial:** paciente, profissionais, horários livres, marcar, confirmar e cancelar. A confirmação de véspera também dá.
- **Ficam de fora:** convênio, valor do procedimento e lançamento de cobrança, porque a API não tem essas rotas.
- **Remarcar** precisa ser feito em duas etapas: desmarcar e marcar de novo.
- **Configuração ou código?** A maior parte cabe no conector por **configuração**: Basic, rotas por profissional e listas simples. Faltam ao motor três coisas:
    1. filtrar a agenda pelo profissional (a lista vem com todos);
    2. levar o `toTime` do horário livre até a marcação (cabe no `slot_id`);
    3. buscar o paciente pelo CPF depois de cadastrar, porque a criação não devolve o id.

  O item 3 já existe no adaptador padrão. Os itens 1 e 2 pedem um filtro de lista no motor (`$filtro`), que serve para outros ERPs também.
- **Para testar:** o ID de acesso e o Token API de uma assinatura de teste, com o escopo de agenda e pacientes liberado.

## Outras fontes

- [Integração Clinicorp na Clinia](https://docs.clinia.io/guias/integracoes/clinicorp/): ID de acesso, token e ID da agenda online.
- [Integração Clinicorp no NicoChat](https://docs.nicochat.com/integrations/clinicorp): operações de agenda usadas por um chatbot.
- [OdontoResults: API do Clinicorp](https://odontoresults.com.br/blog/api-clinicorp/): escopo do token negociado na contratação.
