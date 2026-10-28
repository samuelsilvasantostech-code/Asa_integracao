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
      // Sem chave reconhecida, explica onde cadastrar; com ela, a credencial da Asa.
      $('key-help').hidden = !!temClinica;
      $('form').hidden = !temClinica;
    });
  }

  function saveCredential(ev) {
    ev.preventDefault();
    var token = $('f-token').value.trim();
    if (!token) { msg($('f-msg'), 'err', 'Cole o token da Asa.'); return; }
    $('f-save').disabled = true;
    msg($('f-msg'), null, 'Validando na Asa…');
    api.saveCredential(token).then(function (r) {
      $('f-save').disabled = false;
      var st = C.credentialSaveState(r.status, r.body);
      msg($('f-msg'), st.tone, st.text);
      if (st.tone === 'ok') { $('f-token').value = ''; refresh(); }
    });
  }

  if (!omni) { pill('err', 'Fora do Kentro'); msg($('conn-text'), 'err', 'Abra esta tela dentro do Kentro.'); return; }
  omni.ready(function (ctx) {
    cfg = (ctx && ctx.config) || {};
    B.applyTheme(ctx && ctx.theme);
    omni.on('themeChanged', B.applyTheme);
    $('form').addEventListener('submit', saveCredential);
    connect().then(refresh);
  });
})(this);
