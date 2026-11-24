/* Cliente do Conector. Usa omni.http.request (proxy do host), então não depende de CORS. */
(function (root) {
  'use strict';

  var DEFAULT_URL = 'https://asa-integracao-samuels.kentro.com.br';

  // O host pode entregar o segredo mascarado ("********") a quem não deve vê-lo.
  function usable(v) { return typeof v === 'string' && v.trim() !== '' && !/^\*+$/.test(v); }

  // Respostas que mudam pouco ficam guardadas na página por alguns minutos, e pedidos iguais em andamento
  // viram um só (na tela única, Agenda, Painel e Configurar pediam as mesmas coisas ao mesmo tempo).
  // Só guarda resposta boa: erro ou recusa é pedido de novo na próxima vez.
  var memo = {};
  var MIN = 60000;
  function shared(id, ttl, fn, keep, force) {
    var m = memo[id], now = Date.now();
    if (!force && m && (m.pending || now - m.at < ttl)) return m.p;
    var e = { at: now, pending: true };
    e.p = fn().then(function (r) {
      e.pending = false;
      e.at = Date.now();
      if (!(keep ? keep(r) : r.status === 200) && memo[id] === e) delete memo[id];
      return r;
    });
    memo[id] = e;
    return e.p;
  }
  // Conexão só fica guardada se estiver ok: credencial ausente ou ERP fora do ar é verificado de novo.
  function connected(r) { return r.status === 200 && r.body && r.body.tenant && (r.body.conexao || r.body.asa) === 'ok'; }

  function create(cfg, key) {
    var base = String(cfg.apiUrl || DEFAULT_URL).replace(/\/+$/, '');
    var configured = !!(base && usable(key));
    var ns = base + '|' + (configured ? key.trim() : '') + '|';

    function request(method, path, body, timeout) {
      if (!configured) return Promise.resolve({ status: -1, body: null });
      return root.omni.http.request({
        url: base + path,
        method: method,
        timeout: timeout || 15000,
        headers: { 'content-type': 'application/json', 'x-install-key': key.trim() },
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) {
        var data = null;
        try { data = typeof r.body === 'string' ? JSON.parse(r.body) : r.body; } catch (e) { /* corpo inválido */ }
        return { status: r.status, body: data };
      }, function () {
        return { status: 0, body: null };
      });
    }

    function query(params) {
      var parts = Object.keys(params).filter(function (k) { return params[k]; }).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      });
      return parts.length ? '?' + parts.join('&') : '';
    }

    var api = {
      // force = verificar agora (botão "Tentar de novo", credencial recém-salva).
      testConnection: function (force) {
        return shared(ns + 'conexao', 5 * MIN, function () { return request('GET', '/v1/tenant/conexao/teste'); }, connected, force);
      },
      capabilities: function () { return shared(ns + 'capacidades', 10 * MIN, function () { return request('GET', '/v1/capacidades', null, 8000); }); },
      connectors: function () { return request('GET', '/v1/conectores'); },
      connect: function (erp, credencial) {
        return request('POST', '/v1/conectores/ligar', { erp: erp, credencial: credencial }, 45000).then(function (r) { forget(); return r; });
      },
      requestSystem: function (payload) { return request('POST', '/v1/conectores/pedido', payload); },
      // Grava no ERP. payload = {chave, paciente: {nome, cpf, nascimento, telefone}, usuario}
      createPatient: function (payload) { return request('POST', '/v1/pacientes', payload, 40000); },
      patient: function (by) { return request('GET', '/v1/paciente' + query({ telefone: by.telefone, cpf: by.cpf })); },
      schedule: function () { return shared(ns + 'agenda', 5 * MIN, function () { return request('GET', '/v1/agenda'); }); },
      days: function (providerId) { return request('GET', '/v1/agenda/dias' + query({ prestador_id: providerId })); },
      day: function (providerId, day) { return request('GET', '/v1/agenda/dia' + query({ prestador_id: providerId, data: day })); },
      // payload = {chave, status: confirmado|ausente|cancelado, prestador_id, data, usuario}
      setStatus: function (id, payload) { return request('POST', '/v1/agendamentos/' + encodeURIComponent(id) + '/status', payload); },
      // Tempo de espera (só no Conector, não vai ao ERP). payload = {acao: chegada|chamada|fim|desfazer|ajustar,
      // etapa?, hora? (HH:MM, só no ajuste), prestador_id, data, hora_marcada, usuario}
      attendance: function (id, payload) { return request('POST', '/v1/atendimentos/' + encodeURIComponent(id), payload, 10000); },
      exams: function () { return shared(ns + 'exames', 30 * MIN, function () { return request('GET', '/v1/exames'); }); },
      examGroups: function () { return shared(ns + 'grupos', 30 * MIN, function () { return request('GET', '/v1/exames/grupos'); }); },
      examGroup: function (groupId) { return request('GET', '/v1/exames/grupos/' + encodeURIComponent(groupId)); },
      examInsurances: function (examId) { return request('GET', '/v1/exames/' + encodeURIComponent(examId) + '/convenios'); },
      examProviders: function (examId, insuranceId) { return request('GET', '/v1/exames/' + encodeURIComponent(examId) + '/prestadores' + query({ convenio_id: insuranceId })); },
      slots: function (providerId, day) { return request('GET', '/v1/agenda/horarios' + query({ prestador_id: providerId, data: day })); },
      // slot = {prestador_id, data, horario, agenda_id}
      insurances: function (slot) { return request('GET', '/v1/agenda/convenios' + query(slot)); },
      procedures: function (slot, insuranceId) {
        return request('GET', '/v1/agenda/procedimentos' + query(Object.assign({ convenio_id: insuranceId }, slot)));
      },
      // ÚNICA chamada que grava na Asa. `chave` torna o pedido idempotente.
      // A Asa pode levar até 40 s para gravar, e o Conector ainda confere a agenda se ela não responder.
      book: function (payload) { return request('POST', '/v1/agendamentos', payload, 60000); },
      // payload = {chave, busca: {telefone|cpf}, usuario}; a busca prova que a consulta é do paciente.
      cancel: function (id, payload) { return request('POST', '/v1/agendamentos/' + encodeURIComponent(id) + '/cancelar', payload, 60000); },
      financeConfig: function () { return shared(ns + 'financeiro', 5 * MIN, function () { return request('GET', '/v1/tenant/financeiro'); }); },
      charges: function (patientId) { return request('GET', '/v1/cobrancas' + query({ paciente_id: patientId })); },
      // Grava na Asa SEM VOLTA (conta a receber). payload = {chave, paciente_id, busca, valor, forma, vencimento?, agendamento?, usuario}
      charge: function (payload) { return request('POST', '/v1/cobrancas', payload, 60000); },
      reminderConfig: function () { return request('GET', '/v1/tenant/confirmacao'); },
      // payload = {agendamento_id, busca: {telefone|cpf}, usuario}: põe na fila e aciona o envio da confirmação.
      sendConfirmation: function (payload) { return request('POST', '/v1/confirmacao/enviar', payload, 30000); },
      // Números do painel do administrador nos últimos `dias` dias (1, 7, 15, 30 ou 90).
      dashboard: function (dias) { return request('GET', '/v1/painel/resumo' + query({ dias: String(dias) }), null, 20000); },
      previewReminder: function (config) { return request('POST', '/v1/tenant/confirmacao/previa', { config: config }); },
      saveCredential: function (token) {
        return request('PUT', '/v1/tenant/credencial', { token: token }).then(function (r) { forget(); return r; });
      },
      // Credencial ou sistema trocado: tudo o que foi guardado desta clínica é pedido de novo.
      forget: forget
    };
    function forget() {
      Object.keys(memo).forEach(function (k) { if (k.indexOf(ns) === 0) delete memo[k]; });
    }
    return api;
  }

  // A chave vem só da configuração da instalação (campo secret, igual para todos os usuários).
  // omni.storage não serve: é por usuário e por navegador.
  // Também busca o ERP da clínica (nome nas frases e o que ele suporta) antes de entregar a api: as telas
  // já abrem falando "na Asa" ou "no Feegow". Sem resposta, segue com "o sistema da clínica" e nada extra.
  // Na tela única as quatro telas chamam load juntas: a mesma configuração recebe a mesma api (e um só
  // /v1/capacidades). fresh = montar de novo (a chave pode ter sido cadastrada depois que a tela abriu).
  var loaded = {};
  function load(omni, cfg, fresh) {
    var id = String(cfg.apiUrl || '') + '|' + (usable(cfg.apiKey) ? cfg.apiKey.trim() : '');
    if (!fresh && loaded[id]) return loaded[id];
    var p = loaded[id] = build(omni, cfg, fresh);
    // Sem resposta do Conector, a próxima tela que abrir tenta de novo.
    p.then(function (api) { if (!api.loadedOk && loaded[id] === p) delete loaded[id]; });
    return p;
  }

  function build(omni, cfg, fresh) {
    var api = create(cfg, usable(cfg.apiKey) ? cfg.apiKey : null);
    if (fresh) api.forget();
    api.capacidades = { financeiro: false, confirmacao: false, grupos_exames: false, cadastro_paciente: false };
    api.erp = null;
    if (!usable(cfg.apiKey)) return Promise.resolve(api);
    return api.capabilities().then(function (r) {
      var C = root.AsaCore;
      if (r.status === 200 && r.body) {
        api.loadedOk = true;
        api.erp = r.body.erp || null;
        if (r.body.capacidades) api.capacidades = r.body.capacidades;
        if (C) C.setSistema(r.body.sistema);
      }
      if (C && root.document) C.applySistema(root.document);
      return api;
    });
  }

  root.AsaApi = { create: create, load: load };
})(this);
