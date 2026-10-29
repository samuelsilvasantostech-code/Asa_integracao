# Retomada: Asa Saúde × Kentro

Situação em **29/10/2026**, quando o trabalho parou. A visão geral do projeto está em [`visao-geral.md`](visao-geral.md), e o que a API não entrega e o que falta validar está em [`pendencias.md`](pendencias.md) (P1 a P35).

## Onde paramos

| Item | Situação |
|---|---|
| Último commit | **0.12.0**: Financeiro (lançar cobrança), no GitHub |
| Conector no Doca | **0.12.0** (deploy feito em 29/10) |
| Instalação 29 (`apresentacao`) | **0.12.0**, ativa, para os usuários 508 e 509. Financeiro ainda **desligado** |
| Fila 19 (WhatsApp oficial) | Ligada pelo usuário em 29/10 |

## O que foi feito nesta sessão (29/10)

- **0.9.0**: novo visual do painel, com o cartão de consulta.
- **0.10.0**: Confirmação de véspera (D-1).
  - No Conector: rotas `/v1/confirmacao/{lote,enviados,resposta}`, migração 004 e chave `x-automation-key`.
  - Na extensão: seção "Confirmação de véspera" em Configurar e selo na aba Consultas.
  - Modelos dos fluxos em `automations/confirmacao-d1/` (WAMD e Cloud), validados mas **não criados** na Kentro.
- **0.11.0**: **Asa em tela cheia** (`agenda.html` e `agenda.js`).
  - Agenda do dia por profissional, com consultas marcadas e horários livres, e resumo do dia.
  - Busca de paciente por CPF ou telefone.
  - Marcar, remarcar, cancelar, confirmar presença e marcar falta.
  - No Conector: `GET /v1/agenda/dia` e `POST /v1/agendamentos/:id/status`, mais a migração 005.
  - Conferido com dados reais: a consulta 42655586 aparece às 08:00 de 29/10, com o Dr. Demonstração
    (59632). A Asa devolve o estado dela como "pendente", que a tela mostra como "Agendada".
- **0.11.1**: a Agenda virou **ícone na barra superior** (`topMenu` em `fullscreen`), no mesmo formato do
  Monitor de Atendimento, com ícone branco `icon-agenda.svg`. Como `mainNav`, ela não aparecia como ícone.
- **0.11.2**: ícone branco `icon-config.svg` para "Configurar Asa Saúde".

## 0.12.0: Financeiro (29/10, à tarde)

- Lançar conta a receber na Asa: aba Financeiro e botão "Cobrar" no cartão da consulta, no painel; e "Lançar cobrança" na Agenda (consulta do dia e paciente buscado).
- Liga e desliga em Configurar → Financeiro, e lá também se escolhe quem lança (administradores ou todos). Nasce **desligado**.
- A Asa só cria a conta (sem ler, editar ou excluir). O histórico mostrado é o que a Kentro lançou, pela tabela `cobrancas`. Detalhes em `asa-api.md`.
- **A conferir no primeiro teste:**
  - o perfil do usuário vem de `omni.session.getUser()`, cujo campo não está documentado. Se o botão não aparecer para o admin, o console mostra `[Asa] perfil do usuário não reconhecido; campos: …`;
  - o que o `status` 0/1 da Asa significa (pago ou em aberto). Hoje ele não é enviado.

## Próximos passos, em ordem

1. Fazer o deploy da 0.12.0 no Doca e rodar `extension_installs_refresh_manifest` na 29. Ligar o Financeiro em Configurar.
2. O usuário testa a tela cheia com o login 509, **só com consultas próprias**, porque tudo grava na Asa:
   marcar → confirmar presença → remarcar → marcar falta ou cancelar.
3. Melhorias de funcionalidade da Asa: o usuário quer priorizar isso. Ideias ainda não discutidas:
   - visão da semana;
   - vários profissionais lado a lado;
   - aba Financeiro (`api-gerar-conta-paciente`);
   - agendar exame pelo procedimento.
4. Depois, as automações:
   - gerar a chave de automação (`POST /admin/tenants/<id>/chave-automacao`, com a admin key colada pelo usuário);
   - criar a URA de resposta e a automação de disparo pela fila 19, com um template aprovado
     (5 variáveis e os botões Confirmar, Remarcar e Cancelar);
   - criar a agenda **pausada**;
   - testar em modo teste, só com o número do usuário. Roteiro em `automations/confirmacao-d1/README.md`.

## Regras que valem sempre

- **O push não faz deploy.** O usuário clica em "Fazer deploy" no Doca (o modo automático bloqueia esse clique).
  Só diga que está no ar depois de conferir o `manifest.json` servido pelo Conector.
- Ícones de `topMenu` vão em **branco**, porque a barra superior é escura.
- A extensão é genérica, para várias clínicas: canal, fila, template e textos são configuração, nunca valores fixos.
- Segredos (admin key, token da Asa) o usuário cola. Não se digitam segredos em formulários.
- Não usar a credencial de teste publicada no Postman da Asa. Nunca mandar mensagem para paciente real.
