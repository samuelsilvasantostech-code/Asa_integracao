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
  var userType = null; // perfil do usuário do Kentro (0 = administrador); null = desconhecido
  var fin = null; // configuração do financeiro da clínica ({ativo, quem})
  var consultas = []; // próximas consultas do paciente, para vincular a cobrança

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
    ['paciente', 'consultas', 'agendar', 'financeiro'].forEach(function (p) { $('pane-' + p).hidden = p !== name; });
    if (name === 'agendar') { loadSchedule(); fetchExams(); }
    if (name === 'financeiro') renderFinance();
    B.fitHeight();
  }

  /* ---------- paciente e consultas ---------- */
  function resetPatient() {
    patient = null;
    consultas = [];
    $('f-box').textContent = '';
    $('p-facts').hidden = true;
    $('p-search').hidden = true;
    $('c-list').textContent = '';
    $('count-consultas').hidden = true;
    $('c-tags').hidden = true;
    $('c-next').hidden = true;
    status('c-status', 'Identifique o paciente primeiro.');
  }

  function renderPatient(p) {
    var idade = C.age(p.nascimento);
    $('p-nome').textContent = p.nome;
    $('p-nasc').textContent = p.nascimento ? C.formatBirth(p.nascimento) + (idade != null ? ' (' + idade + ' anos)' : '') : '—';
    $('p-tel').textContent = p.telefone || '—';
    $('p-cpf').textContent = C.maskCpf(p.cpf) || '—';
    $('p-facts').hidden = false;
    var tags = $('c-tags');
    tags.textContent = '';
    tags.appendChild(tag('Paciente na Asa', 'ok'));
    if (idade != null) tags.appendChild(tag(idade + ' anos'));
    if (p.cpf) tags.appendChild(tag('CPF ' + C.maskCpf(p.cpf)));
    tags.hidden = false;
  }
  function tag(text, tone) {
    var t = el('span', 'tag', text);
    if (tone) t.setAttribute('data-tone', tone);
    return t;
  }

  // Resumo da próxima consulta no topo do painel, visível em qualquer aba; o toque abre Consultas.
  function renderNext(c) {
    if (!c) { $('c-next').hidden = true; return; }
    var when = $('c-next-when');
    when.textContent = whenText(c);
    var selo = confirmacaoSelo(c.confirmacao);
    if (selo) when.appendChild(selo);
    $('c-next-who').textContent = [c.prestador, c.procedimentos.join(', ')].filter(Boolean).join(' · ');
    $('c-next').hidden = false;
  }

  function renderConsultas(list) {
    var ul = $('c-list');
    ul.textContent = '';
    consultas = list || [];
    if (list === null) { status('c-status', 'A Asa não devolveu as consultas agora.', 'err'); return; }
    $('count-consultas').hidden = !list.length;
    $('count-consultas').textContent = String(list.length);
    renderNext(list[0]);
    if (!list.length) { status('c-status', 'Nenhuma consulta marcada.'); return; }
    status('c-status', list.length === 1 ? 'Próxima consulta:' : 'Próximas ' + list.length + ' consultas:');
    list.forEach(function (c, i) {
      var li = el('li', 'item appt' + (i === 0 ? ' appt--next' : ''));
      li.appendChild(dateStub(c.data));
      var body = el('div', 'appt__body');
      var when = el('div', 'item__when', c.hora || 'Horário não informado');
      var selo = confirmacaoSelo(c.confirmacao);
      if (selo) when.appendChild(selo);
      body.appendChild(when);
      if (c.prestador) body.appendChild(el('div', 'item__who', c.prestador));
      if (c.procedimentos.length) body.appendChild(el('div', 'item__proc', c.procedimentos.join(', ')));
      if (patient && patient.id && c.id) body.appendChild(consultaActions(c));
      li.appendChild(body);
      ul.appendChild(li);
    });
  }

  // Andamento da confirmação (véspera ou botão "Enviar confirmação").
  function confirmacaoSelo(cf) {
    var s = C.confirmationState(cf);
    if (!s) return null;
    var b = el('span', 'seal', s.label);
    b.setAttribute('data-tone', s.tone);
    return b;
  }

  // Canhoto do cartão de consulta: dia em destaque, mês e dia da semana embaixo.
  var MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function dateStub(iso) {
    var stub = el('div', 'appt__stub'), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) { stub.appendChild(el('span', 'appt__mon', 'sem data')); return stub; }
    stub.appendChild(el('span', 'appt__day', m[3]));
    stub.appendChild(el('span', 'appt__mon', MONTHS[Number(m[2]) - 1]));
    stub.appendChild(el('span', 'appt__wd', C.formatDay(iso).split(',')[0]));
    return stub;
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
      var cf = C.confirmationState(c.confirmacao);
      if (!(cf && cf.answered)) box.appendChild(button(cf ? 'Reenviar confirmação' : 'Enviar confirmação', null, function (ev) { sendConfirmation(c, box, ev.currentTarget); }));
      box.appendChild(button('Remarcar', null, function () { startReschedule(c); }));
      if (C.canCharge(fin, userType)) box.appendChild(button('Cobrar', null, function () { openCharge(c.id); }));
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

  function sendConfirmation(c, box, btn) {
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) { b.disabled = true; });
    btn.textContent = 'Enviando…';
    api.sendConfirmation({ agendamento_id: c.id, busca: lastLookup, usuario: userLabel || undefined }).then(function (r) {
      if (r.status === 200 && r.body && r.body.ok) {
        var notice = C.confirmationSent(r.body);
        if (lastLookup) findPatient(lastLookup, seq, notice); else status('c-status', notice);
        return;
      }
      box.textContent = '';
      box.appendChild(el('span', 'item__ask', C.confirmationError(r.status, r.body)));
      box.appendChild(button('Voltar', null, function () { box.parentNode.replaceChild(consultaActions(c), box); }));
      B.fitHeight();
    });
  }

  // Enquanto alguma consulta espera a resposta do paciente, a lista se atualiza a cada minuto.
  setInterval(function () {
    if (document.hidden || !lastLookup || booking) return;
    if (consultas.some(function (c) { var cf = C.confirmationState(c.confirmacao); return cf && cf.waiting; })) findPatient(lastLookup, seq);
  }, 60000);

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

  /* ---------- financeiro: lançar cobrança (grava na Asa, sem volta) ---------- */
  function renderFinance() {
    var ok = !!(patient && patient.id);
    var can = C.canCharge(fin, userType);
    $('f-new').hidden = !ok || !can;
    $('f-list-label').hidden = !ok;
    $('f-hint').hidden = !ok;
    if (!ok) { $('f-list').textContent = ''; $('f-box').textContent = ''; status('f-status', 'Identifique o paciente na aba Paciente primeiro.'); B.fitHeight(); return; }
    status('f-status', can ? '' : 'Lançar cobrança é permitido só para administradores nesta clínica.');
    root.AsaCharge.history($('f-list'), api, patient.id, B.fitHeight);
  }

  function openCharge(preselect) {
    if (!(patient && patient.id) || !C.canCharge(fin, userType)) return;
    selectTab('financeiro');
    $('f-new').hidden = true;
    root.AsaCharge.mount($('f-box'), {
      api: api, user: userLabel, patient: patient, busca: lastLookup, preselect: preselect,
      appointments: consultas.filter(function (c) { return c.id; }).map(function (c) {
        return { id: c.id, label: whenText(c) + (c.prestador ? ' — ' + c.prestador : '') };
      }),
      onDone: function () { root.AsaCharge.history($('f-list'), api, patient.id, B.fitHeight); },
      onClose: function () { $('f-box').textContent = ''; $('f-new').hidden = false; B.fitHeight(); },
      fit: B.fitHeight
    });
  }

  function loadFinance() {
    api.financeConfig().then(function (r) {
      fin = r.status === 200 && r.body ? r.body.config : null;
      $('tab-fin').hidden = !(fin && fin.ativo);
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
        if (!$('pane-financeiro').hidden) renderFinance();
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
  function onProvider(pick) {
    var id = typeof pick === 'string' ? pick : $('a-prest').value, box = $('a-dias'), r0 = ++dayReq;
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
        var b = chip('', false, function (ev) { pickDay(id, d, ev.currentTarget); }), parts = C.formatDay(d).split(', ');
        b.className = 'chip chip--day';
        b.setAttribute('aria-label', C.formatDay(d));
        b.appendChild(el('span', 'chip__wd', parts[0]));
        b.appendChild(el('span', 'chip__date', parts[1]));
        box.appendChild(b);
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
    if (!p && exam) p = exam.providers.filter(function (x) { return x.id === id; })[0];
    return p ? p.nome : '';
  }

  /* ---------- agendar por exame: procedimento → convênio → quem faz → dias e horários ---------- */
  var exam = null; // {results, item, insurances, insurance, providers}; null no modo "por profissional"
  var EXAM_STEPS = ['ex-conv-wrap', 'ex-prest-wrap', 'a-dias-wrap', 'a-horas-wrap'];
  var examList = null; // lista completa de procedimentos: carregada uma vez por painel
  function hideFrom(i) { EXAM_STEPS.slice(i).forEach(function (id) { $(id).hidden = true; }); }
  function money(v) { return v > 0 ? ' — ' + C.formatMoney(v) : ''; }

  function setMode(byExam) {
    $('a-mode-prof').setAttribute('aria-pressed', String(!byExam));
    $('a-mode-exam').setAttribute('aria-pressed', String(byExam));
    $('a-by-prof').hidden = byExam;
    $('a-by-exam').hidden = !byExam;
    exam = byExam ? { results: [], item: null, insurances: [], insurance: null, providers: [] } : null;
    hideFrom(0);
    $('a-prest').value = '';
    closeBooking();
    status('a-status', '');
    if (byExam) loadExams();
    B.fitHeight();
  }

  // Lista de seleção com todos os procedimentos com agenda online, separados em Exames e Consultas.
  // Uma busca por painel; a primeira da clínica pode levar alguns segundos (a Asa pagina de 100 em 100).
  var examReq = null;
  function fetchExams() {
    if (!examReq) {
      examReq = api.exams().then(function (r) {
        if (r.status === 200 && r.body) examList = r.body.exames; else examReq = null;
        return r;
      });
    }
    return examReq;
  }

  function loadExams() {
    var e = exam;
    if (examList) { e.results = examList; renderExams(); return; }
    $('ex-q').value = '';
    $('ex-clear').hidden = true;
    $('ex-q').disabled = true;
    $('ex-q').placeholder = 'Carregando a lista da Asa…';
    $('ex-hint').textContent = '';
    fetchExams().then(function (r) {
      if (exam !== e) return;
      $('ex-q').disabled = false;
      $('ex-q').placeholder = 'Buscar exame ou procedimento';
      if (r.status !== 200 || !r.body) {
        $('ex-q').disabled = true;
        $('ex-q').placeholder = 'Lista indisponível';
        status('a-status', C.readError(r.status, r.body), 'err');
        return;
      }
      e.results = examList;
      renderExams();
      if (r.body.completa === false) status('a-status', 'A Asa devolveu só parte da lista. Se não achar o procedimento, tente de novo em instantes.', 'err');
    });
  }

  // O "tipo" da Asa não é confiável (exame de laboratório vem como "consulta"): lista única, em ordem
  // alfabética. Um campo só: o que se digita (sem acento) filtra a lista logo abaixo, e o toque escolhe.
  var COMBO_MAX = 60;
  var combo = { list: [], active: -1 };
  function renderExams() {
    var e = exam;
    if (!e) return;
    var raw = $('ex-q').value.trim(), term = C.fold(raw);
    $('ex-clear').hidden = !raw;
    // Texto mudou depois de escolher: a escolha (e o que veio depois dela) deixa de valer.
    if (e.item && raw !== e.item.nome) { e.item = null; e.insurance = null; hideFrom(0); closeBooking(); status('a-status', ''); }
    if (!e.results.length) { $('ex-hint').textContent = 'Nenhum procedimento com agenda online.'; closeCombo(); B.fitHeight(); return; }
    // Palavras em qualquer ordem: "glicose jejum" acha "Glicemia de jejum (glicose)".
    var words = term.split(/\s+/).filter(Boolean);
    var list = e.results.filter(function (x) {
      var n = C.fold(x.nome);
      return words.every(function (w) { return n.indexOf(w) >= 0; });
    });
    // Quem começa com o que foi digitado vem primeiro (sort estável: o resto segue alfabético).
    if (term) list.sort(function (a, b) { return (C.fold(a.nome).indexOf(term) === 0 ? 0 : 1) - (C.fold(b.nome).indexOf(term) === 0 ? 0 : 1); });
    combo.list = list;
    combo.active = list.length ? 0 : -1;
    $('ex-hint').textContent = e.item ? '' : !term ? e.results.length + ' procedimentos. Digite parte do nome.'
      : !list.length ? 'Nada com esse nome. Tente outra palavra.'
      : list.length + (list.length === 1 ? ' encontrado' : ' encontrados') + (list.length > COMBO_MAX ? '; mostrando os ' + COMBO_MAX + ' primeiros, continue digitando' : '') + '.';
    if (e.item || document.activeElement !== $('ex-q')) { closeCombo(); B.fitHeight(); return; }
    drawCombo(term);
  }

  function drawCombo(term) {
    var ul = $('ex-list');
    ul.textContent = '';
    combo.list.slice(0, COMBO_MAX).forEach(function (x, i) {
      var li = el('li', 'combo__opt');
      li.id = 'ex-opt-' + i;
      li.setAttribute('role', 'option');
      mark(li, x.nome, term);
      // mousedown: escolhe antes de o campo perder o foco (o blur fecha a lista).
      li.addEventListener('mousedown', function (ev) { ev.preventDefault(); pickExam(x); });
      ul.appendChild(li);
    });
    ul.hidden = !ul.children.length;
    $('ex-q').setAttribute('aria-expanded', String(!ul.hidden));
    activeOpt();
    B.fitHeight();
  }

  // Realça o trecho digitado no nome, só com nós de texto (nada de HTML vindo da Asa).
  function mark(li, nome, term) {
    var i = term ? C.fold(nome).indexOf(term) : -1;
    if (i < 0 || C.fold(nome).length !== nome.length) { li.textContent = nome; return; }
    li.appendChild(document.createTextNode(nome.slice(0, i)));
    li.appendChild(el('mark', null, nome.slice(i, i + term.length)));
    li.appendChild(document.createTextNode(nome.slice(i + term.length)));
  }

  function activeOpt() {
    var cur = null;
    Array.prototype.forEach.call($('ex-list').children, function (li, i) {
      li.setAttribute('aria-selected', String(i === combo.active));
      if (i === combo.active) cur = li;
    });
    if (cur) { $('ex-q').setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }); }
    else $('ex-q').removeAttribute('aria-activedescendant');
  }

  function closeCombo() {
    $('ex-list').hidden = true;
    $('ex-q').setAttribute('aria-expanded', 'false');
    $('ex-q').removeAttribute('aria-activedescendant');
  }

  function comboKey(ev) {
    var open = !$('ex-list').hidden, n = Math.min(combo.list.length, COMBO_MAX);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!open) { if (!exam || !exam.item) renderExams(); return; }
      if (!n) return;
      combo.active = (combo.active + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n;
      activeOpt();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (open && combo.list[combo.active]) pickExam(combo.list[combo.active]);
    } else if (ev.key === 'Escape' && open) {
      ev.preventDefault();
      closeCombo();
      B.fitHeight();
    }
  }

  function pickExam(x) {
    $('ex-q').value = x.nome;
    $('ex-clear').hidden = false;
    $('ex-hint').textContent = '';
    closeCombo();
    onExam(x.id);
  }

  function clearExam() {
    $('ex-q').value = '';
    $('ex-q').focus();
    renderExams();
  }

  function onExam(id) {
    var e = exam;
    if (!e) return;
    e.item = find(e.results, id) || null;
    e.insurance = null;
    hideFrom(0);
    closeBooking();
    if (!e.item) return;
    status('a-status', 'Buscando os convênios…');
    api.examInsurances(id).then(function (r) {
      if (exam !== e || !e.item || e.item.id !== id) return;
      if (r.status !== 200 || !r.body) { status('a-status', C.readError(r.status, r.body), 'err'); return; }
      e.insurances = r.body.convenios;
      if (!e.insurances.length) { status('a-status', 'Nenhum convênio cobre este procedimento na agenda online.'); return; }
      fillSelect($('ex-conv'), e.insurances, function (c) { return c.nome + money(c.valor); }, '');
      $('ex-conv-wrap').hidden = false;
      status('a-status', 'Escolha o convênio do paciente.');
      B.fitHeight();
    });
  }

  function onExamInsurance() {
    var e = exam, conv = $('ex-conv').value;
    if (!e || !e.item) return;
    e.insurance = find(e.insurances, conv) || null;
    hideFrom(1);
    closeBooking();
    if (!e.insurance) return;
    status('a-status', 'Buscando quem faz…');
    api.examProviders(e.item.id, conv).then(function (r) {
      if (exam !== e || !e.insurance || e.insurance.id !== conv) return;
      if (r.status !== 200 || !r.body) { status('a-status', C.readError(r.status, r.body), 'err'); return; }
      e.providers = r.body.prestadores;
      if (!e.providers.length) { status('a-status', 'Nenhum profissional faz este procedimento por esse convênio na agenda online.'); return; }
      fillSelect($('ex-prest'), e.providers, function (p) {
        return p.nome + (p.especialidade ? ' · ' + p.especialidade : '') + (p.ordem_chegada ? ' (ordem de chegada)' : '') + money(p.valor);
      }, '');
      $('ex-prest-wrap').hidden = false;
      status('a-status', '');
      if (e.providers.length === 1) { $('ex-prest').value = e.providers[0].id; onProvider(e.providers[0].id); }
      B.fitHeight();
    });
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
    booking = { slot: slot, providerName: providerName(slot.prestador_id), key: C.newKey(), insurances: [], procedures: [], user: userLabel, original: rescheduling,
      prefer: exam && exam.item && exam.insurance ? { convenio_id: exam.insurance.id, exame: exam.item } : null };
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
      if (b.prefer && find(b.insurances, b.prefer.convenio_id)) { $('b-conv').value = b.prefer.convenio_id; onInsurance(); }
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
      // Vindo do modo exame: já deixa escolhido o procedimento buscado (pelo id ou, sem ele, pelo nome).
      var ex = b.prefer && b.prefer.exame;
      var match = ex && b.procedures.filter(function (p) {
        return p.procedimento_id ? p.procedimento_id === ex.id : p.nome.toLowerCase() === ex.nome.toLowerCase();
      })[0];
      if (match) sel.value = match.id;
      else if (ex) status('b-status', 'Confira o procedimento: "' + ex.nome + '" não apareceu com esse nome neste horário.', 'err');
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
      b.patient = { paciente_id: patient.id, busca: lastLookup };
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
    status('b-confirm-status', $('b-go').textContent === 'Conferir na Asa' ? 'Conferindo na agenda da Asa…' : 'Gravando na Asa… pode levar até um minuto.');
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
      // Recusa definitiva: um novo pedido precisa de chave nova. Incerto, sem resposta ou em andamento:
      // mantém a chave, e o botão passa a só conferir (o Conector nunca grava duas vezes a mesma chave).
      var unsure = erro === 'AGENDAMENTO_INCERTO' || erro === 'AGENDAMENTO_EM_ANDAMENTO' || (r.status === 0 && !erro);
      if (!unsure) b.key = C.newKey();
      $('b-go').textContent = unsure ? 'Conferir na Asa' : (b.original ? 'Confirmar remarcação' : 'Confirmar agendamento');
      $('b-go').disabled = erro === 'HORARIO_INDISPONIVEL';
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
      if (!fin) loadFinance();
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
    $('c-next').addEventListener('click', function () { selectTab('consultas'); });
    $('a-mode-prof').addEventListener('click', function () { setMode(false); });
    $('a-mode-exam').addEventListener('click', function () { setMode(true); });
    $('ex-q').addEventListener('input', renderExams);
    $('ex-q').addEventListener('focus', renderExams);
    $('ex-q').addEventListener('keydown', comboKey);
    $('ex-q').addEventListener('blur', function () { closeCombo(); B.fitHeight(); });
    $('ex-clear').addEventListener('click', clearExam);
    $('ex-conv').addEventListener('change', onExamInsurance);
    $('ex-prest').addEventListener('change', function () { if ($('ex-prest').value) onProvider($('ex-prest').value); });
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
        userType = C.userType(u);
        // O SDK não documenta o campo do perfil: registra os nomes (não os valores) para ajustar.
        if (u && userType === null && root.console) root.console.info('[Asa] perfil do usuário não reconhecido; campos:', Object.keys(u).join(', '));
      }).catch(function () { /* sem usuário: a trilha fica sem nome */ });
    }
    $('f-new').addEventListener('click', function () { openCharge(''); });
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
