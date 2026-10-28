/* Tela de administração: chave da instalação e credencial da Asa. Visível só para administradores. */
(function (root) {
  'use strict';

  var C = root.AsaCore, B = root.AsaBridge, omni = root.omni;
  var cfg = {}, api = null;

  function $(id) { return document.getElementById(id); }
  function pill(tone, text) { $('pill').setAttribute('data-tone', tone); $('pill-text').textContent = text; }
  function msg(el, tone, text) { if (tone) el.setAttribute('data-tone', tone); else el.removeAttribute('data-tone'); el.textContent = text; }

  function connect() {
    return root.AsaApi.load(omni, cfg).then(function (a) { api = a; });
  }

  function refresh() {
    msg($('conn-text'), null, 'Verificando…');
    return api.testConnection().then(function (r) {
      var st = C.connectionState(r.status, r.body);
      pill(st.tone, st.pill);
      msg($('conn-text'), st.tone, st.text);
      var temClinica = r.status === 200 && r.body && r.body.tenant;
      // Sem chave reconhecida, pede a chave; com ela, a credencial da Asa.
      $('key-form').hidden = !!temClinica;
      $('form').hidden = !temClinica;
    });
  }

  function saveKey(ev) {
    ev.preventDefault();
    var key = $('k-key').value.trim();
    if (!key) { msg($('k-msg'), 'err', 'Cole a chave da instalação.'); return; }
    $('k-save').disabled = true;
    msg($('k-msg'), null, 'Verificando no Conector…');
    // Confere antes de gravar: uma chave errada não substitui a que funciona.
    root.AsaApi.create(cfg, key).testConnection().then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.tenant) {
        $('k-save').disabled = false;
        msg($('k-msg'), 'err', C.connectionState(r.status, r.body).text);
        return;
      }
      return root.AsaApi.saveKey(omni, key).then(connect).then(function () {
        $('k-save').disabled = false;
        $('k-key').value = '';
        msg($('k-msg'), 'ok', 'Chave salva para ' + r.body.tenant.nome + '.');
        return refresh();
      });
    }).catch(function () {
      $('k-save').disabled = false;
      msg($('k-msg'), 'err', 'Não foi possível salvar a chave agora. Tente de novo.');
    });
  }

  function saveCredential(ev) {
    ev.preventDefault();
    var id = $('f-id').value.trim(), hash = $('f-hash').value.trim();
    if (!/^\d+$/.test(id) || !hash) { msg($('f-msg'), 'err', 'Informe o ID (só números) e o hash.'); return; }
    $('f-save').disabled = true;
    msg($('f-msg'), null, 'Validando na Asa…');
    api.saveCredential(id, hash).then(function (r) {
      $('f-save').disabled = false;
      var st = C.credentialSaveState(r.status, r.body);
      msg($('f-msg'), st.tone, st.text);
      if (st.tone === 'ok') { $('f-hash').value = ''; refresh(); }
    });
  }

  if (!omni) { pill('err', 'Fora do Kentro'); msg($('conn-text'), 'err', 'Abra esta tela dentro do Kentro.'); return; }
  omni.ready(function (ctx) {
    cfg = (ctx && ctx.config) || {};
    B.applyTheme(ctx && ctx.theme);
    omni.on('themeChanged', B.applyTheme);
    $('key-form').addEventListener('submit', saveKey);
    $('form').addEventListener('submit', saveCredential);
    connect().then(refresh);
  });
})(this);
