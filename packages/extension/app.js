/* Painel Asa Saúde — contato da conversa, paciente, consultas e horários livres (só leitura). */
(function (root) {
  'use strict';

  var C = root.AsaCore, B = root.AsaBridge, omni = root.omni;
  var cfg = {}, api = null, chat = null, seq = 0;
  var agenda = null; // especialidades e prestadores: carregados uma vez por painel

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function show(id) {
    ['v-loading', 'v-empty', 'v-off', 'v-chat'].forEach(function (v) { $(v).hidden = v !== id; });
  }
  function pill(tone, text) { $('pill').setAttribute('data-tone', tone); $('pill-text').textContent = text; }
  function status(id, text, tone) {
    if (tone) $(id).setAttribute('data-tone', tone); else $(id).removeAttribute('data-tone');
    $(id).textContent = text || '';
  }

  function renderContact(name, phone) {
    $('c-name').textContent = name || 'Contato sem nome';
    $('c-phone').textContent = C.formatPhone(phone) || 'Telefone não informado';
    $('avatar').textContent = C.initials(name);
  }

  /* ---------- abas ---------- */
  function selectTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab[data-tab]'), function (t) {
      t.setAttribute('aria-selected', String(t.getAttribute('data-tab') === name));
    });
    ['paciente', 'consultas', 'agendar'].forEach(function (p) { $('pane-' + p).hidden = p !== name; });
    if (name === 'agendar') loadSchedule();
    B.fitHeight();
  }

  /* ---------- paciente e consultas ---------- */
  function resetPatient() {
    $('p-facts').hidden = true;
    $('p-search').hidden = true;
    $('c-list').textContent = '';
    $('count-consultas').hidden = true;
    status('c-status', 'Identifique o paciente primeiro.');
  }

  function renderPatient(p) {
    var idade = C.age(p.nascimento);
    $('p-nome').textContent = p.nome;
    $('p-nasc').textContent = p.nascimento ? C.formatBirth(p.nascimento) + (idade != null ? ' (' + idade + ' anos)' : '') : '—';
    $('p-tel').textContent = p.telefone || '—';
    $('p-cpf').textContent = C.maskCpf(p.cpf) || '—';
    $('p-facts').hidden = false;
  }

  function renderConsultas(list) {
    var ul = $('c-list');
    ul.textContent = '';
    if (list === null) { status('c-status', 'A Asa não devolveu as consultas agora.', 'err'); return; }
    $('count-consultas').hidden = !list.length;
    $('count-consultas').textContent = String(list.length);
    if (!list.length) { status('c-status', 'Nenhuma consulta marcada.'); return; }
    status('c-status', list.length === 1 ? 'Próxima consulta:' : 'Próximas ' + list.length + ' consultas:');
    list.forEach(function (c) {
      var li = el('li', 'item');
      li.appendChild(el('div', 'item__when', (C.formatDay(c.data) || 'Data não informada') + (c.hora ? ' · ' + c.hora : '')));
      var who = [c.prestador, c.procedimentos.join(', ')].filter(Boolean).join(' — ');
      if (who) li.appendChild(el('div', 'item__who', who));
      ul.appendChild(li);
    });
  }

  function findPatient(by, s) {
    resetPatient();
    status('p-status', 'Buscando o paciente na Asa…');
    api.patient(by).then(function (r) {
      if (s !== seq) return;
      if (r.status === 200 && r.body && r.body.encontrado) {
        status('p-status', '');
        renderPatient(r.body.paciente);
        renderConsultas(r.body.consultas);
      } else if (r.status === 200 && r.body) {
        status('p-status', by.cpf ? 'Nenhum paciente com esse CPF na Asa.' : 'Nenhum paciente com o telefone deste contato na Asa.');
        $('p-search').hidden = false;
      } else {
        status('p-status', C.readError(r.status, r.body), 'err');
        $('p-search').hidden = false;
      }
      B.fitHeight();
    });
  }

  /* ---------- agenda (consulta de horários) ---------- */
  function option(value, text) { var o = el('option', null, text); o.value = value; return o; }

  function loadSchedule() {
    if (agenda) return;
    agenda = { loading: true };
    api.schedule().then(function (r) {
      var sel = $('a-esp');
      sel.textContent = '';
      if (r.status !== 200 || !r.body) {
        agenda = null;
        sel.appendChild(option('', 'Indisponível'));
        status('a-status', C.readError(r.status, r.body), 'err');
        return;
      }
      agenda = r.body;
      sel.appendChild(option('', 'Escolha…'));
      agenda.especialidades.forEach(function (e) {
        if (agenda.prestadores.some(function (p) { return p.especialidade_id === e.id; })) sel.appendChild(option(e.id, e.nome));
      });
      status('a-status', '');
    });
  }

  function onSpecialty() {
    var esp = $('a-esp').value, sel = $('a-prest');
    sel.textContent = '';
    $('a-dias-wrap').hidden = true;
    $('a-horas-wrap').hidden = true;
    if (!esp) { sel.disabled = true; sel.appendChild(option('', 'Escolha a especialidade')); return; }
    sel.disabled = false;
    sel.appendChild(option('', 'Escolha…'));
    agenda.prestadores.filter(function (p) { return p.especialidade_id === esp; }).forEach(function (p) {
      sel.appendChild(option(p.id, p.nome + (p.ordem_chegada ? ' (ordem de chegada)' : '')));
    });
  }

  function chip(text, pressed, onClick) {
    if (!onClick) return el('span', 'chip chip--static', text); // horário: só informação, por enquanto
    var b = el('button', 'chip', text);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!pressed));
    b.addEventListener('click', onClick);
    return b;
  }

  var dayReq = 0;
  function onProvider() {
    var id = $('a-prest').value, box = $('a-dias'), r0 = ++dayReq;
    $('a-horas-wrap').hidden = true;
    box.textContent = '';
    if (!id) { $('a-dias-wrap').hidden = true; return; }
    status('a-status', 'Buscando os dias com atendimento…');
    api.days(id).then(function (r) {
      if (r0 !== dayReq) return;
      if (r.status !== 200 || !r.body) { status('a-status', C.readError(r.status, r.body), 'err'); return; }
      var dias = r.body.dias.slice(0, 21);
      status('a-status', dias.length ? '' : 'Este profissional não tem dias com agenda aberta nos próximos 60 dias.');
      $('a-dias-wrap').hidden = !dias.length;
      dias.forEach(function (d) {
        box.appendChild(chip(C.formatDay(d), false, function (ev) { pickDay(id, d, ev.currentTarget); }));
      });
      B.fitHeight();
    });
  }

  var slotReq = 0;
  function pickDay(providerId, day, btn) {
    var r0 = ++slotReq, box = $('a-horas');
    Array.prototype.forEach.call($('a-dias').children, function (c) { c.setAttribute('aria-pressed', String(c === btn)); });
    box.textContent = '';
    $('a-horas-wrap').hidden = true;
    status('a-status', 'Buscando os horários livres…');
    api.slots(providerId, day).then(function (r) {
      if (r0 !== slotReq) return;
      if (r.status !== 200 || !r.body) { status('a-status', C.readError(r.status, r.body), 'err'); return; }
      var hs = r.body.horarios;
      $('a-horas-label').textContent = 'Horários livres em ' + C.formatDay(day);
      status('a-status', hs.length ? '' : 'Sem horários livres neste dia.');
      $('a-horas-wrap').hidden = !hs.length;
      hs.forEach(function (h) { box.appendChild(chip(h.horario)); });
      B.fitHeight();
    });
  }

  /* ---------- conversa ---------- */
  function checkConnection(s, phone) {
    $('conn-text').removeAttribute('data-tone');
    $('conn-text').textContent = 'Verificando…';
    $('conn-retry').hidden = true;
    $('modules').hidden = true;
    return api.testConnection().then(function (r) {
      if (s !== seq) return;
      var st = C.connectionState(r.status, r.body);
      pill(st.tone, st.pill);
      $('conn-text').setAttribute('data-tone', st.tone);
      $('conn-text').textContent = st.text;
      $('conn-retry').hidden = !st.retry;
      if (st.tone !== 'ok') return;
      $('modules').hidden = false;
      selectTab('paciente');
      phone.then(function (p) {
        if (s !== seq) return;
        if (p) findPatient({ telefone: p }, s);
        else { status('p-status', 'O contato não tem telefone. Busque o paciente pelo CPF.'); resetPatient(); $('p-search').hidden = false; }
      });
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
    var phone = !chat.contactId ? Promise.resolve('') : omni.contacts.get(chat.contactId).then(function (ct) {
      if (s === seq && ct) renderContact(ct.name || ct.nickname, C.contactPhone(ct));
      return C.contactPhone(ct);
    }).catch(function () { return ''; });
    checkConnection(s, phone);
    B.fitHeight();
  }

  if (!omni) { show('v-empty'); pill('err', 'Fora do Kentro'); return; }
  omni.ready(function (ctx) {
    cfg = (ctx && ctx.config) || {};
    B.applyTheme(ctx && ctx.theme);
    omni.on('themeChanged', B.applyTheme);
    omni.on('chatPanelOpened', function () { setTimeout(B.fitHeight, 60); });

    Array.prototype.forEach.call(document.querySelectorAll('.tab[data-tab]'), function (t) {
      t.addEventListener('click', function () { selectTab(t.getAttribute('data-tab')); });
    });
    $('a-esp').addEventListener('change', onSpecialty);
    $('a-prest').addEventListener('change', onProvider);
    $('p-search').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var cpf = C.cpfDigits($('p-cpf-input').value);
      if (!cpf) { status('p-status', 'Informe um CPF com 11 dígitos.', 'err'); return; }
      findPatient({ cpf: cpf }, seq);
    });
    $('conn-retry').addEventListener('click', function () {
      if (!chat) return;
      // A chave pode ter sido cadastrada depois que o painel abriu.
      root.AsaApi.load(omni, cfg).then(function (a) { api = a; loadChat(chat); });
    });

    B.fitHeight();
    root.AsaApi.load(omni, cfg).then(function (a) {
      api = a;
      omni.on('omniChatSelected', loadChat);
      omni.chats.getSelected().then(loadChat, function () { loadChat(null); });
    });
  });
})(this);
