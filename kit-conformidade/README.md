# Kit de conformidade · ClinFy

Este kit diz se a API do seu ERP segue a **Especificação da API do ERP para a extensão ClinFy** (Kentro). Quando a pasta **Obrigatórias** passa inteira, a Kentro liga a clínica ao seu ERP só com o endereço da API e um token, sem desenvolvimento do lado da Kentro.

**Rode só em homologação.** O kit cadastra um paciente de teste ("Paciente Kit Conformidade", com CPF gerado a cada execução), marca, confirma, remarca e cancela consultas dele, e lança e cancela uma conta de R$ 10,00. Nunca use a URL ou o token de produção.

## O que você precisa

- Uma URL de homologação da API, por exemplo `https://homolog.seuerp.com.br/api/v1`, sem barra no fim.
- Um token de homologação, enviado como `Authorization: Bearer <token>`.
- Na clínica de teste, ao menos:
    - um profissional com `tipo_agenda = horario_marcado`, um procedimento e um convênio;
    - dois horários livres num mesmo dia dos próximos 30 dias.

## Como rodar

**No aplicativo do Postman**

1. Importe `clinfy-conformidade.postman_collection.json`.
2. Na coleção, aba *Variables*, preencha `baseUrl` e `token`.
3. Rode a coleção pelo *Runner*, na ordem, porque cada passo usa os ids do anterior.

**Pela linha de comando** (Postman CLI)

```bash
postman collection run clinfy-conformidade.postman_collection.json --env-var "baseUrl=https://homolog.seuerp.com.br/api/v1" --env-var "token=SEU_TOKEN"
```

O resumo no fim mostra quantas verificações falharam. Mande à Kentro o resultado completo, ou a lista dos passos que falharam.

## O que é verificado

| Pasta | Passos | Cobre |
|---|---|---|
| Obrigatórias | 01 a 28 | Status e autenticação; cadastro e busca de paciente (CPF, telefone sem DDI, busca vazia, 404, CPF repetido → 409); especialidades, profissionais, procedimentos e convênios; dias e horários livres; agenda do dia; marcar; a mesma `Idempotency-Key` sem duplicar; horário ocupado → 409; dados inválidos → 4xx; consulta pelo id e do paciente; confirmar; remarcar (a antiga vira `remarcado`); cancelar duas vezes; mudança de status recusada em consulta cancelada → 409 |
| Desejáveis | D1 a D7 | Unidades, grupos, preços em centavos, `alterados_desde`, confirmações pendentes, lançar e cancelar conta |

Em toda resposta, o kit confere:

- o tempo de resposta, que deve ficar abaixo de 10 s;
- o JSON, nos sucessos;
- o formato de erro `{"erro": {"codigo": "EM_MAIUSCULAS", "mensagem": "..."}}`, nas falhas.

## Erros mais comuns

- **Recusa voltando com HTTP 200.** O passo 20 falha. Toda recusa precisa de um código 4xx.
- **Idempotency-Key ignorada.** O passo 18 cria uma segunda consulta.
- **Horário ocupado aceito.** O passo 19 marca duas consultas no mesmo horário.
- **Busca sem resultado voltando 404.** O passo 07 espera `200` com `dados: []`.
- **Data sem fuso em `inicio`.** O passo 17 espera, por exemplo, `2026-11-20T08:30:00-03:00`.

## Para a Kentro

A coleção é gerada por `packages/connector/tools/gerar-kit-conformidade.ts` (`npx tsx tools/gerar-kit-conformidade.ts`). Para conferir o próprio kit, rode-o contra o ERP simulado (`npx tsx tools/erp-simulado.ts`, porta 4010, token `token-de-teste`): todas as verificações devem passar.
