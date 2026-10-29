/* Cliente do Conector. Usa omni.http.request (proxy do host), então não depende de CORS. */
(function (root) {
  'use strict';

  var DEFAULT_URL = 'https://asa-integracao-samuels.kentro.com.br';

  // O host pode entregar o segredo mascarado ("********") a quem não deve vê-lo.
  function usable(v) { return typeof v === 'string' && v.trim() !== '' && !/^\*+$/.test(v); }

  function create(cfg, key) {
    var base = String(cfg.apiUrl || DEFAULT_URL).replace(/\/+$/, '');
    var configured = !!(base && usable(key));

    function request(method, path, body) {
      if (!configured) return Promise.resolve({ status: -1, body: null });
      return root.omni.http.request({
        url: base + path,
        method: method,
        timeout: 15000,
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

    return {
      testConnection: function () { return request('GET', '/v1/tenant/conexao/teste'); },
      patient: function (by) { return request('GET', '/v1/paciente' + query({ telefone: by.telefone, cpf: by.cpf })); },
      schedule: function () { return request('GET', '/v1/agenda'); },
      days: function (providerId) { return request('GET', '/v1/agenda/dias' + query({ prestador_id: providerId })); },
      day: function (providerId, day) { return request('GET', '/v1/agenda/dia' + query({ prestador_id: providerId, data: day })); },
      // payload = {chave, status: confirmado|ausente|cancelado, prestador_id, data, usuario}
      setStatus: function (id, payload) { return request('POST', '/v1/agendamentos/' + encodeURIComponent(id) + '/status', payload); },
      slots: function (providerId, day) { return request('GET', '/v1/agenda/horarios' + query({ prestador_id: providerId, data: day })); },
      // slot = {prestador_id, data, horario, agenda_id}
      insurances: function (slot) { return request('GET', '/v1/agenda/convenios' + query(slot)); },
      procedures: function (slot, insuranceId) {
        return request('GET', '/v1/agenda/procedimentos' + query(Object.assign({ convenio_id: insuranceId }, slot)));
      },
      // ÚNICA chamada que grava na Asa. `chave` torna o pedido idempotente.
      book: function (payload) { return request('POST', '/v1/agendamentos', payload); },
      // payload = {chave, busca: {telefone|cpf}, usuario}; a busca prova que a consulta é do paciente.
      cancel: function (id, payload) { return request('POST', '/v1/agendamentos/' + encodeURIComponent(id) + '/cancelar', payload); },
      reminderConfig: function () { return request('GET', '/v1/tenant/confirmacao'); },
      saveReminderConfig: function (config, usuario) { return request('PUT', '/v1/tenant/confirmacao', { config: config, usuario: usuario }); },
      saveCredential: function (token) {
        return request('PUT', '/v1/tenant/credencial', { token: token });
      }
    };
  }

  // A chave vem só da configuração da instalação (campo secret, igual para todos os usuários).
  // omni.storage não serve: é por usuário e por navegador.
  function load(omni, cfg) {
    return Promise.resolve(create(cfg, usable(cfg.apiKey) ? cfg.apiKey : null));
  }

  root.AsaApi = { create: create, load: load };
})(this);
