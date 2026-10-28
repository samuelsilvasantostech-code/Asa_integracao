/* Cliente do Conector. Usa omni.http.request (proxy do host), então não depende de CORS. */
(function (root) {
  'use strict';

  var DEFAULT_URL = 'https://asa-integracao-samuels.kentro.com.br';
  var STORAGE_KEY = 'installKey';

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

    return {
      testConnection: function () { return request('GET', '/v1/tenant/conexao/teste'); },
      saveCredential: function (token) {
        return request('PUT', '/v1/tenant/credencial', { token: token });
      }
    };
  }

  // A chave vem da configuração da instalação ou, quando o host não oferece o campo, do
  // armazenamento da instalação (omni.storage), gravado pela tela "Configurar Asa Saúde".
  function load(omni, cfg) {
    if (usable(cfg.apiKey)) return Promise.resolve(create(cfg, cfg.apiKey));
    if (!omni.storage || !omni.storage.get) return Promise.resolve(create(cfg, null));
    return omni.storage.get(STORAGE_KEY).then(function (k) { return create(cfg, k); }, function () { return create(cfg, null); });
  }

  function saveKey(omni, key) {
    return omni.storage.set(STORAGE_KEY, key.trim());
  }

  root.AsaApi = { create: create, load: load, saveKey: saveKey };
})(this);
