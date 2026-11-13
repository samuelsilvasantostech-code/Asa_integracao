# Conectores: catálogo de ERPs, configurado pela clínica

Decisões do usuário em 12/11/2026:

1. O rascunho de cada conector é gerado pelo Claude a partir da documentação.
2. A clínica configura sozinha. No início, quem configura é o usuário, então a configuração precisa ser simples.
3. A Central de conectores fica junto da página `/implantacao`.

A pesquisa que motivou este desenho está em [`erps-mercado.md`](erps-mercado.md).

## Fluxo

```
Clínica (Configurar ClinFy)                    Administrador (/implantacao → Central de conectores)
1. Escolhe o sistema na lista de publicados
   ├─ achou → preenche os campos que o conector pede → Testar → Salvar
   └─ "Outro / não encontrei" → informa o nome ─► 2. Pedido aparece na Central
                                                  3. Anexa a documentação (link ou arquivo)
                                                  4. Claude gera o rascunho do conector
                                                  5. Teste com credencial de homologação
                                                     (leitura; depois gravação num paciente de teste)
                                                  6. Aprova → publicado, vale para toda clínica desse sistema
```

## O conector traduz rotas da especificação

O adaptador Padrão Kentro (`src/erp/padrao/`) já orquestra tudo a partir das rotas da especificação:

- busca o paciente antes das consultas;
- cadastra o paciente novo antes de marcar;
- consulta os preços;
- monta a confirmação de véspera;
- entende a idempotência e os erros.

Um conector **não reimplementa essa lógica**. Ele só diz, para cada rota da especificação, como ela se chama no ERP e como a resposta volta ao formato da especificação.

```
adaptador Padrão Kentro ── GET /pacientes?cpf=… ──► conector ── GET /patient/search?paciente_cpf=… ──► Feegow
                        ◄─ {dados:[{id, nome…}]} ──          ◄─ {content:[{id, nome…}]} ─────────
```

- Rota que o conector não descreve = o ERP não tem. As capacidades e o "não encontrado" saem disso.
- O próprio Padrão Kentro é o conector que não traduz nada.
- A Asa continua com adaptador em código, por causa de particularidades que configuração não exprime (recusa com HTTP 200, cadastro relido antes de marcar). Ela aparece no catálogo como os outros.
- A Feegow também é código (`src/erp/feegow`): os horários vêm por especialidade, aninhados, e a marcação pede local, especialidade e valor.
- A Clinicorp é configuração (`src/erp/conectores/clinicorp.json`, migração 016).

### Recursos do motor (desde 13/11)

- **Na resposta:**
    - `"$se"` e `"$exceto"` junto de `"$lista"` filtram os itens. A condição pode ser:
        - um modelo, que vale se não vier vazio, `false` ou `"0"`;
        - um par `["{{$.a}}", "valor"]`, que vale se os dois forem iguais;
        - uma lista de condições: no `$se`, todas precisam valer; no `$exceto`, basta uma.
    - `{{$req.path.id}}`, `{{$req.query.x}}` e `{{$req.corpo.x}}` leem o pedido. Exemplo: separar a agenda de um profissional quando o ERP devolve a de todos.
- **Em qualquer modelo:** `{{hoje}}` é a data de hoje em São Paulo, e o filtro `mais_dias:N` soma dias a uma data.
- **Na rota:**
    - `"fixo"` dá uma resposta fixa, sem chamar o ERP. Exemplo: só "Particular" nos convênios.
    - `"se"` é uma condição sobre o pedido: se for falsa, a rota não existe. Exemplo: o ERP só confirma, sem registrar ausência.
- **No adaptador padrão:**
    - o cadastro de paciente sem id na resposta, ou recusado por CPF repetido, faz o adaptador buscar o paciente pelo CPF;
    - sem a rota de remarcar, ele marca a nova consulta e desmarca a antiga.

## Partes

| Parte | O quê | Situação |
|---|---|---|
| A. Motor | Tradutor de rotas por configuração dentro do adaptador padrão: autenticação (`bearer`, `header`, `basic`, `query`, cabeçalhos fixos com campos da credencial), modelos de caminho, query e corpo (`{{corpo.data \| data:DD-MM-YYYY}}`), mapa de resposta (`$.caminho`, listas, conversores de data, hora e dinheiro) e regras de erro | **Feito** (`src/erp/conector/motor.ts`, 12/11). O padrão Kentro passou a ser o conector que não traduz (`CONECTOR_PADRAO`), e os testes de antes continuam passando. `test/conector-motor.test.ts` prova a tradução com um ERP falso no estilo Feegow: `x-access-token`, rotas em inglês, datas `DD-MM-YYYY`, recusa com HTTP 200 |
| B. Catálogo | Tabela `conectores`: slug, nome, artigo, situação (`rascunho`, `homologacao`, `publicado`, `arquivado`), versão, configuração, campos que a clínica preenche. `tenants.erp` aponta para o slug | **Feito** (12/11): migração 013 (`conectores`, `conector_pedidos`, `conector_documentos`) e `src/erp/catalogo.ts` (cache de 30 s, `adaptadorPara`, `lerCredencial`, `lerConfigConector`). Asa e padrão Kentro já entram publicados |
| C. Central | Seção da `/implantacao` com a lista de conectores e pedidos, o envio de documentação (link ou arquivo, guardado só para o administrador, com credenciais embutidas removidas), o editor da configuração com validação, o teste com credencial e a publicação | **Feito** (12/11): rotas em `src/routes/conectores.ts` (`/admin/conectores*`, `/admin/pedidos/:id`, e `PUT /admin/tenants/:id/erp` para qualquer conector) e a seção "Central de conectores" da página. O bloco do ERP da clínica monta os campos pelo conector escolhido. Layout conferido no navegador sem banco; o fluxo completo ainda não foi exercitado com banco |
| D. Tela de conexão | O "Configurar ClinFy" lista os conectores publicados, monta o formulário com os campos do conector escolhido, testa e salva. "Outro" abre um pedido | **Feito** (12/11, 0.23.0). Rotas `GET /v1/conectores`, `POST /v1/conectores/ligar` (só no primeiro cadastro; a Asa segue pelo cadastro de token próprio) e `POST /v1/conectores/pedido` (até 5 abertos por clínica). Tela conferida no navegador com a Kentro simulada: lista, campos dinâmicos, erro com o artigo certo e pedido |
| E. Primeiros conectores | Feegow, a partir da documentação oficial; depois, por demanda | A fazer |

## Segurança

- A chave da instalação está no navegador de todo atendente. Por isso a clínica **escolhe o sistema e cadastra a credencial uma vez**; trocar depois continua com a implantação (a mesma regra do token da Asa hoje). Isso impede que alguém com a chave aponte a clínica para outro ERP.
- Endereço do ERP vindo de campo da clínica: as mesmas regras de `baseUrlValida`. Só HTTPS, sem host interno, e as chamadas não seguem redirecionamento.
- Só conectores `publicado` aparecem para a clínica. `rascunho` e `homologacao` só existem na Central, para teste.
- Documentação enviada: fica no banco do Conector, visível só pela chave de administrador, com a origem registrada (de qual cliente veio).
