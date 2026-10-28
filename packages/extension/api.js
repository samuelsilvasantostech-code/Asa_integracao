/* Cliente do Conector. Usa omni.http.request (proxy do host), então não depende de CORS. */
(function (root) {
  'use strict';

  function create(cfg) {
    var base = String(cfg.apiUrl || '').replace(/\/+$/, '');
    var key = cfg.apiKey;
    // O host pode entregar o segredo mascarado ("********") a quem não deve vê-lo.
    var configured = !!(base && key && !/^\*+$/.test(key));

    function request(method, path, body) {
      if (!configured) return Promise.resolve({ status: -1, body: null });
      return root.omni.http.request({
        url: base + path,
        method: method,
        timeout: 15000,
        headers: { 'content-type': 'application/json', 'x-install-key': key },
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) {
        var data = null;
        try { data = typeof r.body === 'string' ? JSON.parse(r.body) : r.body; } catch (e) { /* corpo inválido */ }
        return { status: r.status, body: data };
      }, function () {
        return { status: 0, body: null };
      });
    }

    return {
      testConnection: function () { return request('GET', '/v1/tenant/conexao/teste'); }
    };
  }

  root.AsaApi = { create: create };
})(this);
