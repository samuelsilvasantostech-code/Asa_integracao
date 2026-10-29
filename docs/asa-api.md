# API Asa Saúde — mapa de rotas

Fonte: workspace público do Postman `asasaudeapi` (coleção **AsaSaude AgendamentoApi**, lida em 28/10/2026).
A coleção "API PARA TESTES LOCAIS" aponta para `http://asa.localhost/api` e é do ambiente de desenvolvimento da Asa;
as rotas marcadas com ★ aparecem **só** nela.

## Convenções

| Item | Valor |
|---|---|
| Base | `https://sistema.asasaude.app.br/api` |
| Método | Sempre `POST` |
| Parâmetros | Query string (o corpo é ignorado, salvo `api-gerar-conta-paciente`, que aceita form-data também) |
| Autenticação | `Authorization: base64("<ID_instituicao>:<hash>")` — sem prefixo `Basic`/`Bearer` |
| Credencial | Token da clínica entregue pela Asa (já é o `base64("ID:hash")`), cadastrado em "Configurar Asa Saúde" e enviado como está no `Authorization`. Uma por clínica |
| Visibilidade | Prestador, procedimento e convênio só aparecem com **"Permite agendamento online"** marcado |
| Erros | Ver "Comportamento observado" abaixo |
| User-Agent | **Obrigatório um UA próprio.** O Cloudflare da Asa devolve `403` texto `error code: 1010` para UAs de biblioteca (ex.: `Python-urllib`) |

### Comportamento observado (chamadas reais em 28/10/2026)

| Situação | HTTP | Corpo |
|---|---|---|
| UA de biblioteca bloqueado no Cloudflare | 403 | `error code: 1010` (texto, não JSON) |
| Sem `Authorization` ou valor que não decodifica em `ID:hash` | 403 | `{"status":"error","msg":"Autorização não foi enviada corretamente, consulte a documentação."}` |
| `ID:hash` bem formado mas recusado | 403 | `{"status":"error","msg":"Não autorizado."}` |
| Rota inexistente | 404 | `{"message": "..."}` (formato Laravel) |

A autenticação é checada **antes** dos parâmetros: com credencial recusada, toda rota responde 403 igual.
A credencial de exemplo publicada na coleção (clínica ID 7) foi **recusada** em produção — está desatualizada.

### Formatos de data (o motivo dos normalizadores)

| Formato | Onde |
|---|---|
| `YYYY-MM-DD HH:MM:SS` | entrada de `horarios-atendimento`; saída de `dias-atendimento` e `proximos-agendamento` |
| `YYYY-MM-DD` | entrada de `horarios-agendados`, `proximos-agendamento`, `nascimento`, `data_vencimento`; saída de `agendamentos-futuros` e `status` |
| `DD/MM/YYYY` | entrada de `get-convenio-instituicao`, `get-procedimentos-instituicao`, `agendar-instituicao`; saída `data_nascimento` |
| `DD/MM/YYYY HH:MM` | saída `data_hora` de `horarios-agendados` |
| `HH:MM` / `HH:MM:SS` | horário de entrada / horário na saída de `status` |

Telefone: entrada em dígitos puros (10 ou 11), saída formatada `(38) 99999-9999`. `ddi` indica número estrangeiro.

## Rotas

L = leitura, **E = grava na Asa**.

### Prestador e agenda

| Rota | Tipo | Parâmetros | Retorno |
|---|---|---|---|
| `api-agendamento` | L | — | `especialidades[] {id, descricao}`, `prestadores[] {id, nome, ordem_chegada, especialidade_id, especialidade}` |
| `api-agendamento-prestadores-instituicao` | L | `especialidade_id` | `prestadores[]` (registro completo do prestador) |
| `api-agendamento-dias-atendimento` | L | `prestador_id` | array de datas `YYYY-MM-DD 00:00:00`, até 60 dias (pode repetir dia) |
| `api-agendamento-horarios-atendimento` | L | `prestador_id`, `data` (`YYYY-MM-DD 00:00:00`, ≥ hoje) | `horarios {"1": {horario, agenda_id}}` — objeto, não array |
| `api-agendamento-horarios-agendados` | L | `prestador_id`, `data` (`YYYY-MM-DD`) | `agendamentos[] {id, paciente{nome, telefone, data_nascimento, idade, etiqueta}, data_hora, status, procedimentos[], obs}` |
| `api-agendamento-get-convenio-instituicao` | L | `prestador_id`, `data` (`DD/MM/YYYY`), `horario`, `agenda_id` | `convenios[]` (registro completo) |
| `api-agendamento-get-procedimentos-instituicao` | L | `prestador_id`, `convenio_id`, `data` (`DD/MM/YYYY`), `horario`, `agenda_id` | `procedimentos[]` — o `id` é o `convenio_procedimento_id` usado ao agendar; traz `valor`/`valor_convenio` |

### Procedimento e convênio

| Rota | Tipo | Parâmetros | Retorno |
|---|---|---|---|
| `api-agendamento-procedimentos` | L | `descricao`, `page` (100/pág.), `convenio_id`? | `procedimentos[] {id, descricao, tipo: consulta\|exame, odontologico}` |
| `api-agendamento-get-convenios-procedimento` | L | `procedimento_id`, `prestador_id`? | `convenios[] {id, nome, valor}` |
| `api-agendamento-get-prestadores-procedimento` | L | `procedimento_id`, `convenio_id`? | `prestadores[] {id, nome, especialidade, ordem_chegada, convenios[] {convenio_id, convenio_nome, valor_procedimento}}` |
| ★ `api-agendamento-grupos-procedimentos` | L | — | `grupos_procedimentos[]` |
| ★ `api-agendamento-procedimentos-grupo` | L | `grupo_id` | `grupo`, `procedimentos[]` |

### Paciente

| Rota | Tipo | Parâmetros | Retorno |
|---|---|---|---|
| `api-agendamento-paciente-instituicao` | L | `cpf` ou `telefone` (dígitos), `ddi` | `{paciente_id, nome, nascimento, telefone}` |
| `api-agendamentos-futuros` | L | `telefone` (ou `cpf`), `ddi` | `paciente {nome, cpf, telefone}`, `msg[]` — próximos 10, `{id, data, hora, nome_prestador, procedimentos[]}` |
| `api-agendamento-paciente-create-edit` | **E** | `nome`, `cpf` (11 dígitos), `telefone`; opcionais `email`, `nascimento`, endereço | `tipo: criado\|editado`, `paciente` — CPF existente **edita** o cadastro |

### Agendamento e disparo

| Rota | Tipo | Parâmetros | Retorno |
|---|---|---|---|
| `api-agendamento-agendar-instituicao` | **E** | `prestador_id`, `data` (`DD/MM/YYYY`), `horario`, `agenda_id`, `convenio_id`, `convenio_procedimento_id`, paciente (`paciente_id` ou `cpf`+`nome`+`nascimento`+`telefone`); `agendamento` para **remarcar**; `obs`, `ddi` | `{paciente, agendamento, setor, clínica, endereco}` |
| `api-agendamento-status` | **E** | `status` ∈ `confirmado, cancelado, desistencia, ausente, remarcar`; `agendamento` **ou** `telefone` | dados do agendamento. Com `telefone`, atua no agendamento do próximo dia útil (sexta → segunda; feriado → próximo dia útil) |
| `api-proximos-agendamento` | L | `data_inicio`, `data_fim` (`YYYY-MM-DD`), `envio_final_semana` (1 = sexta pega segunda) | `agendamentos[]` **ainda não disparados**: `{id, data, profissional, paciente, telefone1, cpf, especialidade, clinica, clinica_endereco, procedimentos}` |
| `api-agendamento-disparados` | **E** | `agendamentos[]` (até 50 ids) | `{status}` — marca como já disparado; some de `proximos-agendamento` |

### Financeiro

| Rota | Tipo | Parâmetros | Retorno |
|---|---|---|---|
| `api-gerar-conta-paciente` | **E** | `paciente_id`, `valor_parcela` (`350.00`), `forma_pagamento` (pix, cartao_credito, cartao_debito, dinheiro, …); opcionais `agendamento_id`, `data_vencimento`, `status` 0/1, `id_externo` | `{status, msg}` |

## Fluxos que importam para a integração

**Agendar consulta (por prestador):**
`api-agendamento` → `dias-atendimento` → `horarios-atendimento` (dá `agenda_id`) → `get-convenio-instituicao` → `get-procedimentos-instituicao` (dá `convenio_procedimento_id`) → `agendar-instituicao`.

**Agendar exame (por procedimento):**
`procedimentos` → `get-convenios-procedimento` → `get-prestadores-procedimento` → `dias`/`horarios` do prestador → `agendar-instituicao`.

**Confirmação D-1 (automação):**
`proximos-agendamento` (amanhã; sexta com `envio_final_semana=1`) → envia mensagem com botões → `disparados` com os ids enviados → resposta do botão → `status` (`confirmado` / `cancelado` / `remarcar`).

**Identificar o paciente da conversa:** telefone do contato Kentro → `paciente-instituicao` → `agendamentos-futuros`.

## Riscos que o Conector precisa cobrir

1. **Duplicidade:** `agendar-instituicao` grava N vezes se chamado N vezes. Revalidar o horário em `horarios-atendimento` imediatamente antes e usar chave de idempotência por operação.
2. **Remarcar é o mesmo endpoint** de agendar com `agendamento=<id>`; não confundir com criar.
3. **`create-edit` sobrescreve** o cadastro quando o CPF já existe: só enviar campos que o atendente confirmou.
4. **`status` por telefone** escolhe o agendamento sozinho (próximo dia útil). No painel, sempre mandar o `agendamento` explícito.
5. **`disparados` é irreversível** pela API: só marcar depois que a mensagem saiu de fato.
6. **Respostas inconsistentes:** `horarios` vem como objeto indexado, `agendamentos-futuros` usa `msg` para a lista, `proximos-agendamento` não traz `status`.
7. **Erros não documentados:** mapear na primeira chamada real (credencial inválida, parâmetro faltando, data no passado).

## Teste de conexão

Rota escolhida: `api-agendamento` — leitura, sem parâmetros, e responde mesmo com agenda vazia.

## Agendamento pelo painel (Conector)

Três rotas do Conector gravam na Asa, e só elas:
- `POST /v1/agendamentos` marca consulta (`agendar-instituicao`).
- A mesma rota, com `remarcar: {agendamento_id, busca}`, remarca: chama `agendar-instituicao` com `agendamento`.
- `POST /v1/agendamentos/:id/cancelar` cancela (`agendamento-status` com `status=cancelado` e o id **explícito**, nunca pelo telefone).

Remarcar e cancelar só aceitam uma consulta que esteja em `agendamentos-futuros` do paciente da conversa (`busca` = telefone ou CPF).

Como ela se protege:
- **Idempotência:** o painel gera uma `chave` por confirmação. A tabela `agendamentos` guarda essa chave, e a mesma chave nunca chama a Asa duas vezes.
- **Horário revalidado:** logo antes de gravar, a rota confere de novo `horarios-atendimento`. Se a vaga sumiu, responde 409 `HORARIO_INDISPONIVEL`.
- **Sem resposta da Asa:** em timeout ou erro de rede, a chave fica `incerto` e a rota responde 504 `AGENDAMENTO_INCERTO`. Não libera a chave, porque a Asa pode ter gravado.
- **Paciente novo:** vai com `cpf`, `nome`, `nascimento` e `telefone` no próprio agendamento. Não usa `paciente-create-edit`, que sobrescreveria o cadastro de um CPF existente.
- **Dados pessoais:** a trilha no banco não guarda nome, CPF nem telefone.

## Agendar por exame (Conector, 0.13.0)

Somente leitura: `GET /v1/exames` (`procedimentos`; sem `busca`, todas as páginas até 6.000 itens, buscadas em lotes de 6 em paralelo, em ordem alfabética e guardadas por 1 h por clínica; o painel mostra uma lista única de seleção com filtro local). O campo `tipo` da Asa **não é confiável**: na clínica de teste, 940 de 999 itens vêm como "consulta", incluindo exames de laboratório (ex.: CORTISOL), e aparecem também "procedimento" e "cirurgico". Por isso a lista não é agrupada por tipo, `GET /v1/exames/:id/convenios` (`get-convenios-procedimento`) e `GET /v1/exames/:id/prestadores?convenio_id=` (`get-prestadores-procedimento`, com o valor no convênio).

Depois do prestador, o painel segue o fluxo normal: dias, horários, `get-procedimentos-instituicao` e `agendar-instituicao`. No formulário, o convênio e o procedimento buscados já vêm escolhidos. O procedimento é casado pelo `procedimento_id`, quando a Asa o traz em `procedimento_instituicao`, ou pelo nome.

## Cobrança pelo painel (Conector, 0.12.0)

`POST /v1/cobrancas` lança conta a receber na Asa (`api-gerar-conta-paciente`). É gravação **sem volta**: a Asa não tem rota para ler, editar nem excluir a conta. Correções são feitas direto na Asa.

- **Só com o financeiro ligado** para a clínica (`tenants.financeiro.ativo`, em "Configurar Asa Saúde"). Nasce desligado. "Quem pode lançar" (`admin` ou `todos`) é aplicado no painel, porque o Conector não conhece o usuário da Kentro.
- **Paciente conferido:** o `paciente_id` tem de ser o que a Asa devolve em `paciente-instituicao` para a `busca` (telefone ou CPF) do painel.
- **Consulta vinculada (opcional) conferida:**
  - vinda da agenda do dia (com `prestador_id` e `data`): precisa estar em `horarios-agendados`, com o telefone do paciente;
  - sem esses campos: precisa estar em `agendamentos-futuros` do paciente.
- **Idempotência:** a `chave` vai na tabela `cobrancas` (migração 006) e também como `id_externo` na Asa. Sem resposta da Asa, a cobrança fica `incerto` (504 `COBRANCA_INCERTA`), e a `chave` permite achar a conta na Asa.
- **Valor:** em reais, com ponto (`350.00`), maior que zero e até R$ 100.000.
- **`status` (0/1) não é enviado:** a Asa não documenta o significado de cada valor. Antes de usar, confirmar com a Asa ou num teste.
- `GET /v1/cobrancas?paciente_id=` lista as 20 últimas cobranças lançadas pela Kentro (trilha local).
