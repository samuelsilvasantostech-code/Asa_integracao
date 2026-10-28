/* Painel Asa Saúde — Fase 1: contato da conversa e estado da conexão com o Conector. */
(function (root) {
  'use strict';

  var C = root.AsaCore, B = root.AsaBridge, omni = root.omni;
  var cfg = {}, api = null, chat = null, seq = 0;

  function $(id) { return document.getElementById(id); }
  function show(id) {
    ['v-loading', 'v-empty', 'v-off', 'v-chat'].forEach(function (v) { $(v).hidden = v !== id; });
  }
  function pill(tone, text) { $('pill').setAttribute('data-tone', tone); $('pill-text').textContent = text; }

  function renderContact(name, phone) {
    $('c-name').textContent = name || 'Contato sem nome';
    $('c-phone').textContent = C.formatPhone(phone) || 'Telefone não informado';
    $('avatar').textContent = C.initials(name);
  }

  function checkConnection(s) {
    $('conn-text').removeAttribute('data-tone');
    $('conn-text').textContent = 'Verificando…';
    $('conn-retry').hidden = true;
    api.testConnection().then(function (r) {
      if (s !== seq) return;
      var st = C.connectionState(r.status, r.body);
      pill(st.tone, st.pill);
      $('conn-text').setAttribute('data-tone', st.tone);
      $('conn-text').textContent = st.text;
      $('conn-retry').hidden = !st.retry;
    });
  }

  function loadChat(c) {
    var s = ++seq;
    chat = c || null;
    if (!chat) { pill('idle', 'Pronto'); show('v-empty'); return; }
    if (C.queueList(cfg.queueIds).indexOf(Number(chat.queueId)) < 0) { pill('idle', 'Inativo'); show('v-off'); return; }
    show('v-chat');
    pill('idle', 'Verificando');
    renderContact(chat.contact && chat.contact.name, '');
    if (chat.contactId) {
      omni.contacts.get(chat.contactId).then(function (ct) {
        if (s === seq && ct) renderContact(ct.name || ct.nickname, C.contactPhone(ct));
      }).catch(function () { /* mantém o que veio do atendimento */ });
    }
    checkConnection(s);
    B.fitHeight();
  }

  if (!omni) { show('v-empty'); pill('err', 'Fora do Kentro'); return; }
  omni.ready(function (ctx) {
    cfg = (ctx && ctx.config) || {};
    B.applyTheme(ctx && ctx.theme);
    omni.on('themeChanged', B.applyTheme);
    omni.on('chatPanelOpened', function () { setTimeout(B.fitHeight, 60); });
    $('conn-retry').addEventListener('click', function () {
      if (!chat) return;
      // A chave pode ter sido cadastrada depois que o painel abriu.
      root.AsaApi.load(omni, cfg).then(function (a) { api = a; checkConnection(seq); });
    });
    B.fitHeight();
    root.AsaApi.load(omni, cfg).then(function (a) {
      api = a;
      omni.on('omniChatSelected', loadChat);
      omni.chats.getSelected().then(loadChat, function () { loadChat(null); });
    });
  });
})(this);
