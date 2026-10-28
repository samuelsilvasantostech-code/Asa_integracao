/* Tela de administração: grava a credencial da Asa no Conector. Visível só para administradores. */
(function (root) {
  'use strict';

  var C = root.AsaCore, B = root.AsaBridge, omni = root.omni;
  var api = null;

  function $(id) { return document.getElementById(id); }
  function pill(tone, text) { $('pill').setAttribute('data-tone', tone); $('pill-text').textContent = text; }
  function msg(el, tone, text) { if (tone) el.setAttribute('data-tone', tone); else el.removeAttribute('data-tone'); el.textContent = text; }

  function refresh() {
    msg($('conn-text'), null, 'Verificando…');
    return api.testConnection().then(function (r) {
      var st = C.connectionState(r.status, r.body);
      pill(st.tone, st.pill);
      msg($('conn-text'), st.tone, st.text);
      // Sem chave válida não há clínica para receber a credencial.
      $('form').hidden = !(r.status === 200 && r.body && r.body.tenant);
    });
  }

  function save(ev) {
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
    api = root.AsaApi.create((ctx && ctx.config) || {});
    B.applyTheme(ctx && ctx.theme);
    omni.on('themeChanged', B.applyTheme);
    $('form').addEventListener('submit', save);
    refresh();
  });
})(this);
