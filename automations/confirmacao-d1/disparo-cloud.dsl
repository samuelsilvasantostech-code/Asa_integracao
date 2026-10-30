flow "Asa — Disparo D-1 (WhatsApp oficial)" {
  type="automation"
  description="Pede ao Conector o lote de lembretes de véspera e abre um atendimento por paciente na URA de resposta. Modelo: automations/confirmacao-d1 no repositório Asa_integracao."
  timeout=900
}

start -> lote

lote: request varPrefix="lote" dataType="json" method="get" url="%%CONECTOR_URL%%/v1/confirmacao/lote" headers={"x-automation-key": "%%CHAVE_AUTOMACAO%%"} timeout=30
tem_lote: varCondition value="" {
  case com_itens conditionOperator="expression" conditionValue="lote_httpStatus * 1 == 200 && lote_parsedBody.total * 1 > 0" conditionArray=[] -> inicio
  else -> end
}

inicio: jscode code="""
vars.asa_resultado = '[]';
"""
laco: loop mode="forEach" list="{{lote_parsedBody.itens}}" itemVar="asa_item" indexVar="asa_i" maxIterations=40 {
  body {
    dados: jscode code="""
    var it = vars.asa_item || {};
    vars.asa_agendamento_id = String(it.agendamento_id || '');
    vars.asa_nome = it.nome || '';
    vars.asa_texto = it.texto || '';
    vars.asa_canal = 'cloud';
    // O que vai em cada variável é configurado na tela "Confirmação Asa"; aqui só se distribui.
    var t = it.template || [];
    for (var n = 1; n <= 10; n++) vars['asa_t' + n] = t[n - 1] || '-';
    vars.asa_chat = '';
    vars.asa_chat_error = '';
    """
    abrir: openChatCloud countryCode="BR" phoneNumber="{{asa_item.telefone}}" templateId=%%TEMPLATE_ID%% templateData=%%TEMPLATE_DATA%% queueId="%%FILA_ID%%" destinationType=2 destinationId="%%URA_RESPOSTA_ID%%" resultVariableName="asa_chat"
    registrar: jscode code="""
    var lista = JSON.parse(vars.asa_resultado || '[]');
    lista.push({ agendamento_id: vars.asa_agendamento_id, chat_id: vars.asa_chat || '', erro: vars.asa_chat_error || (vars.asa_chat ? '' : 'SEM_ATENDIMENTO') });
    vars.asa_resultado = JSON.stringify(lista);
    """
    pausa: sleep time=2 -> laco
  }
}
montar: jscode code="""
vars.asa_payload = JSON.stringify({ itens: JSON.parse(vars.asa_resultado || '[]') });
"""
enviados: request varPrefix="env" dataType="jsonraw" method="post" url="%%CONECTOR_URL%%/v1/confirmacao/enviados" dataRaw="{{asa_payload}}" headers={"x-automation-key": "%%CHAVE_AUTOMACAO%%", "content-type": "application/json"} timeout=30 retrys=2 -> end
