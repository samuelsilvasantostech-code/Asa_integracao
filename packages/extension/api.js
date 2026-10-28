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
      slots: function (providerId, day) { return request('GET', '/v1/agenda/horarios' + query({ prestador_id: providerId, data: day })); },
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
