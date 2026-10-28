/* Painel Asa Saúde — contato da conversa, paciente, consultas e horários livres (só leitura). */
(function (root) {
  'use strict';

  var C = root.AsaCore, B = root.AsaBridge, omni = root.omni;
  var cfg = {}, api = null, chat = null, seq = 0;
  var agenda = null; // especialidades e prestadores: carregados uma vez por painel
  var patient = null; // paciente identificado na aba Paciente (tem id na Asa)
  var lastLookup = null; // última busca de paciente, para atualizar depois de agendar
  var booking = null; // agendamento em montagem: {slot, providerName, key, insurances, procedures}
  var userLabel = ''; // "id nome" do usuário do Kentro, para a trilha do Conector

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
    patient = null;
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
      li.appendChild(el('div', 'item__when', whenText(c)));
      var who = [c.prestador, c.procedimentos.join(', ')].filter(Boolean).join(' — ');
      if (who) li.appendChild(el('div', 'item__who', who));
      if (patient && patient.id && c.id) li.appendChild(consultaActions(c));
      ul.appendChild(li);
    });
  }

  function whenText(c) {
    return (C.formatDay(c.data) || 'Data não informada') + (c.hora ? ' · ' + c.hora : '');
  }

  function button(text, cls, onClick) {
    var b = el('button', 'btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  // Remarcar / Cancelar. Cancelar pede uma segunda confirmação ali mesmo.
  function consultaActions(c) {
    var box = el('div', 'item__actions');
    function normal() {
      box.textContent = '';
      box.appendChild(button('Remarcar', null, function () { startReschedule(c); }));
      box.appendChild(button('Cancelar', 'btn--danger', ask));
    }
    function ask() {
      box.textContent = '';
      box.appendChild(el('span', 'item__ask', 'Cancelar esta consulta na Asa?'));
      box.appendChild(button('Sim, cancelar', 'btn--danger', function (ev) { doCancel(c, box, ev.currentTarget); }));
      box.appendChild(button('Não', null, normal));
    }
    normal();
    return box;
  }

  function doCancel(c, box, btn) {
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) { b.disabled = true; });
    btn.textContent = 'Cancelando…';
    var key = c.cancelKey || (c.cancelKey = C.newKey()); // a mesma chave numa nova tentativa
    api.cancel(c.id, { chave: key, busca: lastLookup, usuario: userLabel || undefined }).then(function (r) {
      if (r.status === 200 && r.body && r.body.ok) {
        var notice = 'Consulta de ' + whenText(c) + ' cancelada na Asa.';
        if (lastLookup) findPatient(lastLookup, seq, notice); else status('c-status', notice);
        return;
      }
      var erro = r.body && r.body.erro;
      if (erro !== 'AGENDAMENTO_INCERTO' && erro !== 'AGENDAMENTO_EM_ANDAMENTO') c.cancelKey = null;
      box.textContent = '';
      box.appendChild(el('span', 'item__ask', erro === 'CONSULTA_NAO_ENCONTRADA'
        ? 'Essa consulta não está mais na lista do paciente na Asa. Atualize.'
        : C.bookingError(r.status, r.body)));
      box.appendChild(button('Voltar', null, function () { box.parentNode.replaceChild(consultaActions(c), box); }));
      B.fitHeight();
    });
  }

  /* ---------- remarcar ---------- */
  var rescheduling = null; // consulta original sendo remarcada

  function startReschedule(c) {
    rescheduling = c;
    $('a-remarcar-text').textContent = 'Remarcando ' + whenText(c) + (c.prestador ? ' — ' + c.prestador : '');
    $('a-remarcar').hidden = false;
    closeBooking();
    selectTab('agendar');
    status('a-status', 'Escolha o novo horário.');
  }

  function stopReschedule() {
    rescheduling = null;
    $('a-remarcar').hidden = true;
    closeBooking();
    status('a-status', '');
  }

  // notice: aviso para mostrar acima das consultas depois de recarregar (ex.: "cancelada").
  function findPatient(by, s, notice) {
    resetPatient();
    lastLookup = by;
    status('p-status', 'Buscando o paciente na Asa…');
    api.patient(by).then(function (r) {
      if (s !== seq) return;
      if (r.status === 200 && r.body && r.body.encontrado) {
        status('p-status', '');
        patient = r.body.paciente;
        renderPatient(r.body.paciente);
        renderConsultas(r.body.consultas);
        if (notice) status('c-status', notice + ' ' + $('c-status').textContent);
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
    var b = el('button', 'chip', text);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!pressed));
    b.addEventListener('click', onClick);
    return b;
  }

  var dayReq = 0;
  function onProvider() {
    var id = $('a-prest').value, box = $('a-dias'), r0 = ++dayReq;
    closeBooking();
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
    closeBooking();
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
      hs.forEach(function (h) {
        box.appendChild(chip(h.horario, false, function (ev) {
          Array.prototype.forEach.call(box.children, function (c) { c.setAttribute('aria-pressed', String(c === ev.currentTarget)); });
          openBooking({ prestador_id: providerId, data: day, horario: h.horario, agenda_id: h.agenda_id });
        }));
      });
      B.fitHeight();
    });
  }

  /* ---------- marcar consulta (grava na Asa) ---------- */
  function providerName(id) {
    var p = agenda && agenda.prestadores && agenda.prestadores.filter(function (x) { return x.id === id; })[0];
    return p ? p.nome : '';
  }

  function closeBooking() {
    booking = null;
    ['b-form', 'b-confirm', 'b-done'].forEach(function (id) { $(id).hidden = true; });
  }

  function fillSelect(sel, items, label, empty) {
    sel.textContent = '';
    if (!items.length) { sel.appendChild(option('', empty)); sel.disabled = true; return; }
    sel.appendChild(option('', 'Escolha…'));
    items.forEach(function (it) { sel.appendChild(option(it.id, label(it))); });
    sel.disabled = false;
  }

  function openBooking(slot) {
    booking = { slot: slot, providerName: providerName(slot.prestador_id), key: C.newKey(), insurances: [], procedures: [], user: userLabel, original: rescheduling };
    var b = booking;
    $('b-review').textContent = b.original ? 'Revisar remarcação' : 'Revisar';
    $('b-done').hidden = true;
    $('b-confirm').hidden = true;
    $('b-form').hidden = false;
    $('b-slot').textContent = b.providerName + ' · ' + C.formatDay(slot.data) + ' · ' + slot.horario;
    status('b-status', '');
    $('b-proc').disabled = true;
    $('b-proc').textContent = '';
    $('b-proc').appendChild(option('', 'Escolha o convênio'));
    $('b-conv').disabled = true;
    $('b-conv').textContent = '';
    $('b-conv').appendChild(option('', 'Carregando…'));

    // Paciente: o identificado na aba Paciente, ou um cadastro novo junto com o agendamento.
    $('b-pac-known').hidden = !patient;
    $('b-pac-new').hidden = !!patient;
    if (patient) {
      $('b-pac-name').textContent = patient.nome + (patient.nascimento ? ' · ' + C.formatBirth(patient.nascimento) : '');
    } else if (!$('b-tel').value) {
      $('b-tel').value = $('c-phone').textContent.indexOf('(') === 0 ? $('c-phone').textContent : '';
      if (!$('b-nome').value && $('c-name').textContent !== 'Contato sem nome') $('b-nome').value = $('c-name').textContent;
    }

    api.insurances(slot).then(function (r) {
      if (booking !== b) return;
      if (r.status !== 200 || !r.body) { fillSelect($('b-conv'), [], null, 'Indisponível'); status('b-status', C.readError(r.status, r.body), 'err'); return; }
      b.insurances = r.body.convenios;
      fillSelect($('b-conv'), b.insurances, function (c) { return c.nome; }, 'Nenhum convênio aceito neste horário');
      B.fitHeight();
    });
    B.fitHeight();
    $('b-form').scrollIntoView({ block: 'nearest' });
  }

  function onInsurance() {
    var b = booking, conv = $('b-conv').value, sel = $('b-proc');
    if (!b) return;
    b.procedures = [];
    sel.textContent = '';
    if (!conv) { sel.disabled = true; sel.appendChild(option('', 'Escolha o convênio')); return; }
    sel.disabled = true;
    sel.appendChild(option('', 'Carregando…'));
    api.procedures(b.slot, conv).then(function (r) {
      if (booking !== b || $('b-conv').value !== conv) return;
      if (r.status !== 200 || !r.body) { fillSelect(sel, [], null, 'Indisponível'); status('b-status', C.readError(r.status, r.body), 'err'); return; }
      b.procedures = r.body.procedimentos;
      fillSelect(sel, b.procedures, function (p) {
        return p.nome + (p.valor > 0 ? ' — ' + C.formatMoney(p.valor) : '');
      }, 'Nenhum procedimento para este convênio');
    });
  }

  function fact(dl, label, value) {
    var d = el('div');
    d.appendChild(el('dt', null, label));
    d.appendChild(el('dd', null, value || '—'));
    dl.appendChild(d);
  }

  function find(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

  function review(ev) {
    ev.preventDefault();
    var b = booking;
    if (!b) return;
    var conv = find(b.insurances, $('b-conv').value), proc = find(b.procedures, $('b-proc').value);
    if (!conv || !proc) { status('b-status', 'Escolha o convênio e o procedimento.', 'err'); return; }
    var who;
    if (b.original && !(patient && patient.id)) { status('b-status', 'Para remarcar, o paciente precisa estar identificado na aba Paciente.', 'err'); return; }
    if (patient) {
      b.patient = { paciente_id: patient.id };
      who = patient.nome;
    } else {
      var np = C.newPatient({ nome: $('b-nome').value, cpf: $('b-cpf').value, nascimento: $('b-nasc').value, telefone: $('b-tel').value });
      if (!np.ok) { status('b-status', np.error, 'err'); return; }
      b.patient = { paciente: np.value };
      who = np.value.nome + ' (cadastro novo, CPF ' + C.maskCpf(np.value.cpf) + ')';
    }
    b.conv = conv;
    b.proc = proc;
    b.obs = $('b-obs').value.trim();

    var dl = $('b-summary');
    dl.textContent = '';
    fact(dl, 'Paciente', who);
    if (b.original) fact(dl, 'Sai de', whenText(b.original) + (b.original.prestador ? ' — ' + b.original.prestador : ''));
    fact(dl, 'Profissional', b.providerName);
    fact(dl, b.original ? 'Vai para' : 'Quando', C.formatDay(b.slot.data, true) + ' às ' + b.slot.horario);
    $('b-confirm-title').textContent = b.original ? 'Confirme a remarcação' : 'Confirme o agendamento';
    $('b-go').textContent = b.original ? 'Confirmar remarcação' : 'Confirmar agendamento';
    $('b-confirm-hint').textContent = b.original
      ? 'Ao confirmar, a consulta original é trocada pelo novo horário na agenda da clínica na Asa.'
      : 'Ao confirmar, a consulta é gravada na agenda da clínica na Asa.';
    fact(dl, 'Convênio', conv.nome);
    fact(dl, 'Procedimento', proc.nome + (proc.valor > 0 ? ' — ' + C.formatMoney(proc.valor) : ''));
    if (b.obs) fact(dl, 'Observação', b.obs);
    status('b-confirm-status', '');
    $('b-go').disabled = false;
    $('b-form').hidden = true;
    $('b-confirm').hidden = false;
    B.fitHeight();
  }

  function confirmBooking() {
    var b = booking;
    if (!b) return;
    $('b-go').disabled = true;
    $('b-back').disabled = true;
    status('b-confirm-status', 'Gravando na Asa…');
    var payload = Object.assign({
      chave: b.key,
      convenio_id: b.conv.id,
      convenio_procedimento_id: b.proc.id,
      obs: b.obs || undefined,
      usuario: b.user || undefined,
      remarcar: b.original ? { agendamento_id: b.original.id, busca: lastLookup } : undefined
    }, b.slot, b.patient);
    api.book(payload).then(function (r) {
      $('b-back').disabled = false;
      if (booking !== b) return;
      if (r.status === 200 && r.body && r.body.ok) { bookingDone(b, r.body); return; }
      var erro = r.body && r.body.erro;
      status('b-confirm-status', C.bookingError(r.status, r.body), 'err');
      // Recusa definitiva: um novo pedido precisa de chave nova. Incerto ou em andamento: mantém.
      if (erro !== 'AGENDAMENTO_INCERTO' && erro !== 'AGENDAMENTO_EM_ANDAMENTO') b.key = C.newKey();
      $('b-go').disabled = erro === 'AGENDAMENTO_INCERTO' || erro === 'HORARIO_INDISPONIVEL';
      if (erro === 'HORARIO_INDISPONIVEL') {
        var day = Array.prototype.filter.call($('a-dias').children, function (c) { return c.getAttribute('aria-pressed') === 'true'; })[0];
        if (day) setTimeout(function () { if (booking === b) pickDay(b.slot.prestador_id, b.slot.data, day); }, 1500);
      }
    });
  }

  function bookingDone(b, res) {
    $('b-confirm').hidden = true;
    $('b-done-title').textContent = b.original ? 'Consulta remarcada' : 'Consulta marcada';
    if (b.original) { rescheduling = null; $('a-remarcar').hidden = true; }
    var dl = $('b-done-facts');
    dl.textContent = '';
    fact(dl, 'Quando', C.formatDay(b.slot.data, true) + ' às ' + b.slot.horario);
    fact(dl, 'Profissional', b.providerName);
    fact(dl, 'Procedimento', b.proc.nome);
    if (res.agendamento_id) fact(dl, 'Nº na Asa', res.agendamento_id);
    if (res.clinica || res.endereco) fact(dl, 'Local', [res.clinica, res.endereco].filter(Boolean).join(' — '));
    $('b-done').hidden = false;
    booking = null;
    ['b-nome', 'b-cpf', 'b-nasc', 'b-obs'].forEach(function (id) { $(id).value = ''; });
    // Atualiza paciente e consultas: o paciente pode ter acabado de ser cadastrado.
    var by = b.patient.paciente ? { cpf: b.patient.paciente.cpf } : lastLookup;
    if (by) findPatient(by, seq);
    B.fitHeight();
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
    stopReschedule();
    ['b-nome', 'b-cpf', 'b-nasc', 'b-tel', 'b-obs'].forEach(function (id) { $(id).value = ''; });
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
    $('b-conv').addEventListener('change', onInsurance);
    $('b-form').addEventListener('submit', review);
    $('b-go').addEventListener('click', confirmBooking);
    $('b-back').addEventListener('click', function () { $('b-confirm').hidden = true; $('b-form').hidden = false; B.fitHeight(); });
    $('a-remarcar-sair').addEventListener('click', stopReschedule);
    $('b-new').addEventListener('click', function () {
      closeBooking();
      Array.prototype.forEach.call($('a-horas').children, function (c) { c.setAttribute('aria-pressed', 'false'); });
      B.fitHeight();
    });
    if (omni.session && omni.session.getUser) {
      Promise.resolve(omni.session.getUser()).then(function (u) {
        if (u) userLabel = [u.id, u.name || u.username].filter(Boolean).join(' ');
      }).catch(function () { /* sem usuário: a trilha fica sem nome */ });
    }
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
