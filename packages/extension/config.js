/* Tela de administração: chave da instalação e credencial da Asa. Visível só para administradores. */
(function (root) {
  'use strict';

  var C = root.AsaCore, B = root.AsaBridge, omni = root.omni;
  var cfg = {}, api = null, userLabel = '';

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
      // Sem chave reconhecida, explica onde cadastrar. Com ela: o formulário do token só no primeiro
      // cadastro; trocar um token gravado é com a implantação (o Conector recusa sem a chave de admin).
      var semToken = temClinica && r.body.asa === 'credencial_ausente';
      $('key-help').hidden = !!temClinica;
      $('form').hidden = !semToken;
      $('token-locked').hidden = !temClinica || semToken;
      if (temClinica && !semToken) loadFinance();
    });
  }

  /* ---------- financeiro ---------- */
  function loadFinance() {
    api.financeConfig().then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.config) { $('fin').hidden = true; return; }
      $('fin').hidden = false;
      $('fin-on').checked = r.body.config.ativo;
      $('fin-who').value = r.body.config.quem;
    });
  }

  function saveFinance(ev) {
    ev.preventDefault();
    var next = { ativo: $('fin-on').checked, quem: $('fin-who').value };
    $('fin-save').disabled = true;
    msg($('fin-msg'), null, 'Salvando…');
    api.saveFinanceConfig(next, userLabel).then(function (r) {
      $('fin-save').disabled = false;
      if (r.status !== 200 || !r.body || !r.body.ok) { msg($('fin-msg'), 'err', 'Não foi possível salvar agora' + (r.status > 0 ? ' (HTTP ' + r.status + ').' : '.')); return; }
      var c = r.body.config;
      msg($('fin-msg'), 'ok', c.ativo
        ? 'Salvo. Lançamento de cobrança ligado para ' + (c.quem === 'todos' ? 'todos os atendentes.' : 'administradores.') + ' Quem estiver com o painel aberto precisa recarregar a Kentro.'
        : 'Salvo. Lançamento de cobrança desligado.');
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
    if (omni.session && omni.session.getUser) {
      Promise.resolve(omni.session.getUser()).then(function (u) {
        if (u) userLabel = [u.id, u.name || u.username].filter(Boolean).join(' ');
      }).catch(function () { /* sem usuário: a trilha fica sem nome */ });
    }
    $('form').addEventListener('submit', saveCredential);
    $('fin').addEventListener('submit', saveFinance);
    connect().then(refresh);
  });
})(this);
