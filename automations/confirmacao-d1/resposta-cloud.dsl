flow "Asa — Resposta D-1 (WhatsApp oficial)" {
  type="ura"
  description="Recebe o atendimento aberto pelo Disparo D-1: o template já levou o lembrete; espera o botão e grava a resposta na Asa pelo Conector. Modelo: automations/confirmacao-d1 no repositório Asa_integracao."
  timeout=86400
}

start -> pergunta
timeout -> encerrar

pergunta: waitMessage
acao: jscode code="""
vars.asa_acao = vars.message_button_id || vars.asa_resp || vars.message_text || '';
vars.asa_payload = JSON.stringify({ agendamento_id: vars.asa_agendamento_id || '', acao: vars.asa_acao, nome: vars.asa_nome || '' });
"""
resposta: request varPrefix="resp" dataType="jsonraw" method="post" url="%%CONECTOR_URL%%/v1/confirmacao/resposta" dataRaw="{{asa_payload}}" headers={"x-automation-key": "%%CHAVE_AUTOMACAO%%", "content-type": "application/json"} timeout=20 retrys=1
tem_texto: varCondition value="" {
  case sim conditionOperator="expression" conditionValue="resp_httpStatus * 1 == 200 && resp_parsedBody.texto" conditionArray=[] -> falar
  else -> decidir
}
falar: message text="{{resp_parsedBody.texto}}"
decidir: varCondition value="" {
  case fica conditionOperator="expression" conditionValue="resp_httpStatus * 1 == 200 && !resp_parsedBody.transferir" conditionArray=[] -> encerrar
  else { equipe: transfer %%DESTINO_REMARCAR%% }
}
encerrar: terminate reason="Confirmação de véspera respondida" dontSendEndMsg=true
