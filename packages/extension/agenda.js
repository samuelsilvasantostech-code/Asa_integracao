/* Asa Saúde em tela cheia — agenda por profissional (dia, semana ou profissionais lado a lado), busca de
 * paciente, marcar, remarcar, confirmar presença, marcar falta e cancelar. Mesma lógica de negócio do painel (core.js/api.js). */
(function (root) {
  'use strict';

  var C = root.AsaCore, B = root.AsaBridge, omni = root.omni;
  var cfg = {}, api = null, userLabel = '';
  var userType = null, fin = null;          // perfil do usuário (0 = administrador) e financeiro da clínica
  var sched = null;                         // especialidades e prestadores
  var sel = { esp: '', prest: '', day: C.todayIso(), view: 'dia' };
  // Colunas na tela: {prest, day, data: {data, agendados, livres} | null, erro}. Dia = 1 coluna,
  // semana = 7 (um profissional), lado a lado = os profissionais da especialidade num dia.
  var cols = [], viewSeq = 0;
  var MAX_LADO = 8, PARALELO = 3;           // colunas no lado a lado; pedidos simultâneos ao Conector
  var pac = null;                           // paciente buscado: {paciente, consultas, busca}
  var rescheduling = null;                  // {consulta, paciente, busca}
  var booking = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function option(value, text) { var o = el('option', null, text); o.value = value; return o; }
  function pill(tone, text) { $('pill').setAttribute('data-tone', tone); $('pill-text').textContent = text; }
  function status(id, text, tone) {
    if (tone) $(id).setAttribute('data-tone', tone); else $(id).removeAttribute('data-tone');
    $(id).textContent = text || '';
  }
  function button(text, cls, onClick) {
    var b = el('button', 'btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function fact(dl, label, value) {
    var d = el('div');
    d.appendChild(el('dt', null, label));
    d.appendChild(el('dd', null, value || '—'));
    dl.appendChild(d);
  }
  function find(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

  // Preferências deste navegador (última especialidade e profissional). Falhar não atrapalha.
  function remember(k, v) { try { root.localStorage.setItem('asa.' + k, v); } catch (e) { /* sem storage */ } }
  function recall(k) { try { return root.localStorage.getItem('asa.' + k) || ''; } catch (e) { return ''; } }

  var SIDE = ['s-empty', 's-appt', 's-pac', 's-charge', 's-book', 's-review', 's-done'];
  function side(id) { SIDE.forEach(function (v) { $(v).hidden = v !== id; }); }

  function providerName(id) {
    var p = sched && find(sched.prestadores, id);
    return p ? p.nome : 'Profissional';
  }
  function whenText(c) { return (C.formatDay(c.data) || 'Data não informada') + (c.hora ? ' às ' + c.hora : ''); }

  /* ---------- especialidade, profissional e dia ---------- */
  function loadSchedule() {
    api.schedule().then(function (r) {
      if (r.status !== 200 || !r.body) { status('day-status', C.readError(r.status, r.body), 'err'); return; }
      sched = r.body;
      var s = $('f-esp');
      s.textContent = '';
      s.appendChild(option('', 'Escolha…'));
      sched.especialidades.forEach(function (e) {
        if (sched.prestadores.some(function (p) { return p.especialidade_id === e.id; })) s.appendChild(option(e.id, e.nome));
      });
      var esp = recall('esp');
      if (esp && find(sched.especialidades, esp)) { s.value = esp; onSpecialty(recall('prest')); }
    });
  }

  function onSpecialty(prefer) {
    var esp = $('f-esp').value, s = $('f-prest');
    sel.esp = esp;
    remember('esp', esp);
    s.textContent = '';
    var list = sched.prestadores.filter(function (p) { return p.especialidade_id === esp; });
    if (!esp || !list.length) { s.appendChild(option('', 'Escolha a especialidade')); s.disabled = true; setProvider(''); return; }
    s.appendChild(option('', 'Escolha…'));
    list.forEach(function (p) { s.appendChild(option(p.id, p.nome)); });
    s.disabled = false;
    // Um só profissional: já escolhe. Senão, o último usado, se for desta especialidade.
    var pick = list.length === 1 ? list[0].id : (typeof prefer === 'string' && find(list, prefer) ? prefer : '');
    s.value = pick;
    setProvider(pick);
  }

  function setProvider(id) {
    sel.prest = id;
    if (id) remember('prest', id);
    loadView();
  }

  function setDay(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    sel.day = iso;
    loadView();
  }

  function step(n) { setDay(C.shiftDay(sel.day, sel.view === 'semana' ? 7 * n : n)); }

  function setView(v) {
    if (v !== 'dia' && v !== 'semana' && v !== 'lado') v = 'dia';
    sel.view = v;
    remember('view', v);
    Array.prototype.forEach.call(document.querySelectorAll('.seg__btn'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === v));
    });
    $('f-prest-wrap').hidden = v === 'lado'; // lado a lado mostra todos os profissionais da especialidade
    var semana = v === 'semana';
    $('d-prev').setAttribute('aria-label', semana ? 'Semana anterior' : 'Dia anterior');
    $('d-next').setAttribute('aria-label', semana ? 'Próxima semana' : 'Próximo dia');
    if (sched) loadView(); else renderDayLabel();
  }

  // Abre um dia de um profissional na visão Dia (título de coluna da semana ou do lado a lado).
  function openDay(prest, iso) {
    if (prest !== sel.prest && find(sched.prestadores, prest)) {
      $('f-prest').value = prest;
      sel.prest = prest;
      remember('prest', prest);
    }
    sel.day = iso;
    setView('dia');
  }

  function renderDayLabel() {
    var l = C.longDay(sel.day), today = C.todayIso();
    if (sel.view === 'semana') {
      var w = C.weekDays(sel.day), now = w.indexOf(today) >= 0;
      $('d-wd').textContent = now ? 'Esta semana' : 'Semana';
      $('d-date').textContent = C.weekLabel(w);
      $('d-today').disabled = now;
    } else {
      $('d-wd').textContent = sel.day === today ? 'Hoje, ' + l.weekday : sel.day === C.shiftDay(today, 1) ? 'Amanhã, ' + l.weekday : l.weekday;
      $('d-date').textContent = l.date;
      $('d-today').disabled = sel.day === today;
    }
    $('d-pick').value = sel.day;
  }

  /* ---------- a folha: uma coluna (dia) ou várias (semana, lado a lado) ---------- */
  function columns() {
    if (sel.view === 'semana') return sel.prest ? C.weekDays(sel.day).map(function (d) { return { prest: sel.prest, day: d }; }) : [];
    if (sel.view === 'lado') {
      if (!sched || !sel.esp) return [];
      return sched.prestadores.filter(function (p) { return p.especialidade_id === sel.esp; }).slice(0, MAX_LADO)
        .map(function (p) { return { prest: p.id, day: sel.day }; });
    }
    return sel.prest ? [{ prest: sel.prest, day: sel.day }] : [];
  }

  // Roda fn em cada item, no máximo n de cada vez (cada coluna custa 2 chamadas à Asa).
  function queue(items, n, fn) {
    var i = 0;
    function next() {
      if (i >= items.length) return null;
      return Promise.resolve(fn(items[i++])).then(next, next);
    }
    for (var k = 0; k < Math.min(n, items.length); k++) next();
  }

  function loadView() {
    renderDayLabel();
    var s = ++viewSeq, list = columns(), multi = sel.view !== 'dia';
    cols = list;
    renderTally();
    $('sheet').textContent = '';
    $('grid').textContent = '';
    $('day-sum').textContent = '';
    $('sheet').hidden = multi;
    $('grid').hidden = !multi;
    if (!list.length) {
      status('day-status', sel.view === 'lado' ? 'Escolha a especialidade.' : 'Escolha a especialidade e o profissional.');
      return;
    }
    status('day-status', 'Carregando a agenda…');
    if (multi) list.forEach(function (c) { $('grid').appendChild(colNode(c)); });
    else $('sheet').setAttribute('aria-busy', 'true');
    queue(list, PARALELO, function (c) {
      if (s !== viewSeq) return null; // a visão mudou: o resto da fila não é mais pedido
      return api.day(c.prest, c.day).then(function (r) {
        if (s !== viewSeq) return;
        if (r.status === 200 && r.body) c.data = r.body; else c.erro = C.readError(r.status, r.body);
        renderCol(c);
        if (list.every(function (x) { return x.data || x.erro; })) viewStatus();
      });
    });
  }

  function renderAll() { cols.forEach(function (c) { if (c.data) renderCol(c); }); }

  function summaryParts(c, short) {
    var t = C.daySummary(c.data.agendados, c.data.livres), past = c.day < C.todayIso();
    var parts = [t.consultas === 1 ? '1 consulta' : t.consultas + ' consultas'];
    if (!short) {
      if (t.confirmadas) parts.push(t.confirmadas + (t.confirmadas === 1 ? ' confirmada' : ' confirmadas'));
      if (t.atendidas) parts.push(t.atendidas + (t.atendidas === 1 ? ' atendida' : ' atendidas'));
      if (t.faltas) parts.push(t.faltas + (t.faltas === 1 ? ' falta' : ' faltas'));
      if (t.canceladas) parts.push(t.canceladas + (t.canceladas === 1 ? ' cancelada' : ' canceladas'));
    }
    if (!past) parts.push(t.livres === 1 ? (short ? '1 livre' : '1 horário livre') : t.livres + (short ? ' livres' : ' horários livres'));
    return parts;
  }

  // Situação geral, depois que todas as colunas responderam.
  function viewStatus() {
    if (sel.view === 'dia') {
      var c = cols[0];
      if (c.erro) { status('day-status', c.erro, 'err'); return; }
      if (!C.dayRows(c.data.agendados, c.data.livres).length) {
        status('day-status', c.day < C.todayIso() ? 'Nenhuma consulta neste dia.' : 'Nenhuma consulta e nenhum horário livre neste dia.');
        return;
      }
      status('day-status', c.data.livres_ok === false ? 'Os horários livres não vieram da Asa agora. As consultas marcadas estão abaixo.' : '', c.data.livres_ok === false ? 'err' : null);
      return;
    }
    var erros = cols.filter(function (x) { return x.erro; }).length;
    var semLivres = cols.some(function (x) { return x.data && x.data.livres_ok === false; });
    var total = sel.view === 'lado' ? sched.prestadores.filter(function (p) { return p.especialidade_id === sel.esp; }).length : 0;
    var msg = [];
    if (erros) msg.push(erros === 1 ? 'Uma coluna não carregou.' : erros + ' colunas não carregaram.');
    if (semLivres) msg.push('Em algumas colunas os horários livres não vieram da Asa agora.');
    if (total > MAX_LADO) msg.push('Mostrando ' + MAX_LADO + ' de ' + total + ' profissionais desta especialidade.');
    status('day-status', msg.join(' '), erros || semLivres ? 'err' : null);
  }

  function colNode(c) {
    var today = C.todayIso(), n = el('section', 'col');
    if (sel.view === 'semana' && c.day === today) n.classList.add('col--today');
    if (sel.view === 'semana' && c.day < today) n.classList.add('col--past');
    var hd = el('header', 'col__hd');
    var t = el('button', 'col__title', sel.view === 'semana' ? C.formatDay(c.day) : providerName(c.prest));
    t.type = 'button';
    t.title = 'Abrir este dia';
    t.addEventListener('click', function () { openDay(c.prest, c.day); });
    hd.appendChild(t);
    c.sumNode = hd.appendChild(el('div', 'col__sum', 'Carregando…'));
    n.appendChild(hd);
    c.list = n.appendChild(el('ol', 'sheet sheet--compact'));
    return n;
  }

  function renderCol(c) {
    if (sel.view === 'dia') { renderDay(c); return; }
    c.list.textContent = '';
    if (c.erro) { c.sumNode.textContent = c.erro; c.sumNode.setAttribute('data-tone', 'err'); return; }
    c.sumNode.removeAttribute('data-tone');
    var rows = C.dayRows(c.data.agendados, c.data.livres);
    c.sumNode.textContent = rows.length ? summaryParts(c, true).join(' · ') : 'Sem agenda';
    rows.forEach(function (row) { c.list.appendChild(row.kind === 'appt' ? apptRow(row.appt, c) : freeRow(row.slot, c)); });
    placeNow(c.list, c.day);
    renderTally();
  }

  function renderDay(c) {
    var sheet = $('sheet');
    sheet.removeAttribute('aria-busy');
    sheet.textContent = '';
    if (c.erro) return;
    $('day-sum').textContent = providerName(c.prest) + ': ' + summaryParts(c).join(', ') + '.';
    C.dayRows(c.data.agendados, c.data.livres).forEach(function (row) { sheet.appendChild(row.kind === 'appt' ? apptRow(row.appt, c) : freeRow(row.slot, c)); });
    placeNow(sheet, c.day);
    renderTally();
  }

  function nowHm() { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  // Linha do "agora" na folha de hoje; o que já passou fica apagado. Refeita a cada minuto.
  function placeNow(list, day) {
    var old = list.querySelector('.now'), today = C.todayIso(), hm = nowHm(), next = null;
    if (old) old.remove();
    Array.prototype.forEach.call(list.querySelectorAll('.slot'), function (li) {
      var past = day < today || (day === today && li.getAttribute('data-hora') < hm);
      li.classList.toggle('slot--past', past);
      if (day === today && !past && !next) next = li;
    });
    if (day !== today || !list.querySelector('.slot')) return;
    var n = el('li', 'now');
    n.setAttribute('aria-hidden', 'true');
    n.appendChild(el('span', 'now__time', hm));
    list.insertBefore(n, next);
  }
  function tickNow() {
    cols.forEach(function (c) {
      var list = sel.view === 'dia' ? $('sheet') : c.list;
      if (c.data && list) placeNow(list, c.day);
    });
  }

  // Painel vazio = resumo do que está na tela, com as mesmas cores da folha (serve de legenda).
  var TALLY = [['ok', 'Confirmadas'], ['idle', 'A confirmar'], ['warn', 'Faltas e remarcações'], ['done', 'Atendidas'], ['err', 'Canceladas'], ['free', 'Horários livres']];
  function renderTally() {
    var n = {}, loaded = cols.filter(function (c) { return c.data; }), today = C.todayIso();
    $('s-tally').hidden = !loaded.length;
    if (!loaded.length) return;
    loaded.forEach(function (c) {
      (c.data.agendados || []).forEach(function (a) { var t = C.statusInfo(a.status).tone; n[t] = (n[t] || 0) + 1; });
      if (c.day >= today) n.free = (n.free || 0) + (c.data.livres || []).length;
    });
    var esp = sched && find(sched.especialidades, sel.esp);
    $('st-title').textContent = sel.view === 'lado' ? (esp ? esp.nome : 'Especialidade') : providerName(sel.prest);
    $('st-when').textContent = ($('d-wd').textContent ? $('d-wd').textContent + ': ' : '') + $('d-date').textContent;
    var g = $('st-grid');
    g.textContent = '';
    TALLY.forEach(function (t) {
      var row = el('div', 'tally__row');
      row.setAttribute('data-tone', t[0]);
      if (!n[t[0]]) row.classList.add('tally__row--zero');
      row.appendChild(el('dt', null, t[1]));
      row.appendChild(el('dd', null, String(n[t[0]] || 0)));
      g.appendChild(row);
    });
  }

  function apptRow(a, c) {
    var info = C.statusInfo(a.status), li = el('li', 'slot slot--appt');
    li.setAttribute('data-tone', info.tone);
    li.setAttribute('data-hora', a.hora || '');
    if (!info.active) li.classList.add('slot--off');
    var b = el('button', 'slot__btn');
    b.type = 'button';
    b.title = info.label; // nas colunas estreitas o selo some; o tom fica na hora
    b.appendChild(el('span', 'slot__time', a.hora || '--:--'));
    var body = el('span', 'slot__body');
    var who = el('span', 'slot__who', a.paciente.nome || 'Paciente sem nome');
    if (a.paciente.idade != null) who.appendChild(el('span', 'slot__age', a.paciente.idade + ' anos'));
    body.appendChild(who);
    if (a.procedimentos.length) body.appendChild(el('span', 'slot__proc', a.procedimentos.join(', ')));
    b.appendChild(body);
    // Consulta ainda "agendada" com confirmação pedida: o selo mostra que espera a resposta.
    var cf = C.confirmationState(a.confirmacao);
    var seal = el('span', 'seal', info.key === 'agendado' && cf ? cf.label : info.label);
    seal.setAttribute('data-tone', info.key === 'agendado' && cf ? cf.tone : info.tone);
    if (cf) b.title = info.label + ' · ' + cf.label;
    b.appendChild(seal);
    b.addEventListener('click', function () { markSelected(li); showAppt(a, c); });
    li.appendChild(b);
    return li;
  }

  function freeRow(h, c) {
    var li = el('li', 'slot slot--free'), b = el('button', 'slot__btn');
    li.setAttribute('data-hora', h.horario || '');
    b.type = 'button';
    b.appendChild(el('span', 'slot__time', h.horario));
    b.appendChild(el('span', 'slot__body', rescheduling ? 'Livre: remarcar para este horário' : 'Livre'));
    b.appendChild(el('span', 'slot__cta', rescheduling ? 'Remarcar' : 'Marcar'));
    b.addEventListener('click', function () {
      markSelected(li);
      openBooking({ prestador_id: c.prest, data: c.day, horario: h.horario, agenda_id: h.agenda_id });
    });
    li.appendChild(b);
    return li;
  }

  function markSelected(li) {
    Array.prototype.forEach.call(document.querySelectorAll('.slot'), function (x) { x.classList.toggle('slot--sel', x === li); });
  }

  /* ---------- consulta do dia: confirmar, falta, cancelar, remarcar ---------- */
  function showAppt(a, c) {
    var info = C.statusInfo(a.status);
    side('s-appt');
    $('sa-time').textContent = C.formatDay(c.day) + ' · ' + (a.hora || '--:--');
    $('sa-seal').textContent = info.label;
    $('sa-seal').setAttribute('data-tone', info.tone);
    $('sa-name').textContent = a.paciente.nome || 'Paciente sem nome';
    var dl = $('sa-facts');
    dl.textContent = '';
    if (a.paciente.idade != null) fact(dl, 'Idade', a.paciente.idade + ' anos');
    if (a.paciente.telefone) fact(dl, 'Telefone', C.formatPhone(a.paciente.telefone));
    fact(dl, 'Profissional', providerName(c.prest));
    if (a.procedimentos.length) fact(dl, 'Procedimento', a.procedimentos.join(', '));
    if (a.paciente.etiqueta) fact(dl, 'Etiqueta', a.paciente.etiqueta);
    if (a.obs) fact(dl, 'Observação', a.obs);
    var cf = C.confirmationState(a.confirmacao);
    if (cf) fact(dl, 'Confirmação', cf.label);
    fact(dl, 'Nº na Asa', a.id);
    status('sa-status', '');
    apptActions(a, info, c);
  }

  function apptActions(a, info, c) {
    var box = $('sa-actions');
    box.textContent = '';
    if (!info.active) { status('sa-status', 'Consulta ' + info.label.toLowerCase() + ': sem ações.'); return; }
    var today = C.todayIso();
    if (info.key !== 'confirmado' && info.key !== 'atendido' && c.day >= today) {
      box.appendChild(button('Confirmar presença', 'btn--primary', function (ev) { setStatus(a, 'confirmado', ev.currentTarget, c); }));
    }
    if (info.key !== 'ausente' && info.key !== 'atendido' && c.day <= today) {
      box.appendChild(button('Marcar falta', null, function (ev) { setStatus(a, 'ausente', ev.currentTarget, c); }));
    }
    var cf = C.confirmationState(a.confirmacao);
    if (c.day >= today && a.paciente.telefone && info.key !== 'confirmado' && info.key !== 'atendido' && !(cf && cf.answered)) {
      box.appendChild(button(cf ? 'Reenviar confirmação' : 'Enviar confirmação', null, function (ev) { sendConfirmation(a, ev.currentTarget, c); }));
    }
    if (c.day >= today && a.paciente.telefone) box.appendChild(button('Remarcar', null, function (ev) { rescheduleFromAppt(a, ev.currentTarget); }));
    if (a.paciente.telefone && C.canCharge(fin, userType)) box.appendChild(button('Lançar cobrança', null, function (ev) { chargeFromAppt(a, ev.currentTarget, c); }));
    if (c.day >= today) {
      box.appendChild(button('Cancelar', 'btn--danger', function () {
        box.textContent = '';
        box.appendChild(el('span', 'item__ask', 'Cancelar a consulta de ' + (a.paciente.nome || 'este paciente') + ' na Asa?'));
        box.appendChild(button('Sim, cancelar', 'btn--danger', function (ev) { setStatus(a, 'cancelado', ev.currentTarget, c); }));
        box.appendChild(button('Não', null, function () { apptActions(a, info, c); }));
      }));
    }
  }

  // Pede a confirmação ao paciente (mensagem com os botões Confirmar, Remarcar e Cancelar).
  function sendConfirmation(a, btn, c) {
    var box = $('sa-actions');
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) { b.disabled = true; });
    btn.textContent = 'Enviando…';
    api.sendConfirmation({ agendamento_id: a.id, busca: { telefone: a.paciente.telefone }, usuario: userLabel || undefined }).then(function (r) {
      if (r.status === 200 && r.body && r.body.ok) {
        a.confirmacao = { estado: 'fila', resposta: null };
        showAppt(a, c);
        status('sa-status', C.confirmationSent(r.body));
        if (cols.indexOf(c) >= 0) renderCol(c);
        return;
      }
      apptActions(a, C.statusInfo(a.status), c);
      status('sa-status', C.confirmationError(r.status, r.body), 'err');
    });
  }

  // Enquanto houver confirmação esperando resposta na tela, a agenda se atualiza sozinha a cada minuto.
  function refreshWaiting() {
    if (document.hidden || !$('s-book').hidden || !$('s-review').hidden) return;
    var waiting = cols.some(function (c) {
      return c.data && (c.data.agendados || []).some(function (a) { var cf = C.confirmationState(a.confirmacao); return cf && cf.waiting; });
    });
    if (waiting) loadView();
  }

  var DONE = { confirmado: 'Presença confirmada na Asa.', ausente: 'Falta registrada na Asa.', cancelado: 'Consulta cancelada na Asa.' };
  function setStatus(a, st, btn, c) {
    var box = $('sa-actions');
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) { b.disabled = true; });
    btn.textContent = 'Gravando…';
    a.keys = a.keys || {};
    var key = a.keys[st] || (a.keys[st] = C.newKey()); // a mesma chave numa nova tentativa
    api.setStatus(a.id, { chave: key, status: st, prestador_id: c.prest, data: c.day, usuario: userLabel || undefined }).then(function (r) {
      if (r.status === 200 && r.body && r.body.ok) {
        a.status = st;
        showAppt(a, c);
        status('sa-status', DONE[st]);
        if (cols.indexOf(c) >= 0) renderCol(c); // a coluna ainda está na tela
        return;
      }
      var erro = r.body && r.body.erro;
      if (erro !== 'AGENDAMENTO_INCERTO' && erro !== 'AGENDAMENTO_EM_ANDAMENTO') a.keys[st] = null;
      apptActions(a, C.statusInfo(a.status), c);
      status('sa-status', erro === 'CONSULTA_NAO_ENCONTRADA'
        ? 'Essa consulta não está mais na agenda deste dia na Asa. A agenda foi atualizada.'
        : C.bookingError(r.status, r.body), 'err');
      if (erro === 'CONSULTA_NAO_ENCONTRADA') loadView();
    });
  }

  // Remarcar pela folha do dia: o Conector exige a consulta na lista do paciente, achada pelo telefone.
  function rescheduleFromAppt(a, btn) {
    btn.disabled = true;
    btn.textContent = 'Buscando o paciente…';
    var busca = { telefone: a.paciente.telefone };
    api.patient(busca).then(function (r) {
      btn.disabled = false;
      btn.textContent = 'Remarcar';
      var c = r.status === 200 && r.body && r.body.encontrado && find(r.body.consultas || [], a.id);
      if (!c || !r.body.paciente.id) {
        status('sa-status', r.status === 200 ? 'Não achei esta consulta pelo telefone do paciente. Busque o paciente pelo CPF e remarque por lá.' : C.readError(r.status, r.body), 'err');
        return;
      }
      startReschedule(c, r.body.paciente, busca);
    });
  }

  /* ---------- financeiro: lançar cobrança (grava na Asa, sem volta) ---------- */
  // Pela folha do dia: acha o paciente pelo telefone (horarios-agendados não traz o id dele).
  function chargeFromAppt(a, btn, c) {
    btn.disabled = true;
    btn.textContent = 'Buscando o paciente…';
    var busca = { telefone: a.paciente.telefone };
    api.patient(busca).then(function (r) {
      btn.disabled = false;
      btn.textContent = 'Lançar cobrança';
      if (!(r.status === 200 && r.body && r.body.encontrado && r.body.paciente.id)) {
        status('sa-status', r.status === 200 ? 'Não achei o paciente pelo telefone desta consulta. Busque pelo CPF e lance por lá.' : C.readError(r.status, r.body), 'err');
        return;
      }
      var label = C.formatDay(c.day) + ' às ' + (a.hora || '--:--') + ' — ' + providerName(c.prest);
      openCharge(r.body.paciente, busca, [{ id: a.id, label: label, prestador_id: c.prest, data: c.day }], a.id, function () { showAppt(a, c); });
    });
  }

  function openCharge(paciente, busca, appointments, preselect, back) {
    side('s-charge');
    root.AsaCharge.mount($('s-charge'), {
      api: api, user: userLabel, patient: paciente, busca: busca, appointments: appointments, preselect: preselect,
      onClose: back
    });
  }

  function loadFinance() {
    api.financeConfig().then(function (r) { fin = r.status === 200 && r.body ? r.body.config : null; });
  }

  function startReschedule(c, paciente, busca) {
    rescheduling = { consulta: c, paciente: paciente, busca: busca };
    $('rs-text').textContent = 'Remarcando ' + paciente.nome + ': ' + whenText(c) + (c.prestador ? ' com ' + c.prestador : '') + '. Escolha um horário livre.';
    $('rs-banner').hidden = false;
    side('s-empty');
    renderAll();
  }

  function stopReschedule() {
    rescheduling = null;
    $('rs-banner').hidden = true;
    if (booking && booking.original) closeSide();
    renderAll();
  }

  function closeSide() {
    booking = null;
    side('s-empty');
    markSelected(null);
  }

  /* ---------- busca de paciente ---------- */
  // Tenta as buscas em ordem (telefone e depois CPF, quando o número pode ser os dois).
  function lookup(tries) {
    var t = tries[0];
    return api.patient(t).then(function (r) {
      if (r.status === 200 && r.body && !r.body.encontrado && tries.length > 1) return lookup(tries.slice(1));
      return { r: r, busca: t };
    });
  }

  function searchPatient(ev) {
    ev.preventDefault();
    var tries = C.lookupsFrom($('q-input').value);
    side('s-pac');
    $('sp-name').textContent = '';
    $('sp-facts').hidden = true;
    $('sp-hint').hidden = true;
    $('sp-list-label').hidden = true;
    $('sp-list').textContent = '';
    $('sp-charge').hidden = true;
    $('sp-fin-label').hidden = $('sp-fin').hidden = true;
    if (!tries.length) { status('sp-status', 'Digite um CPF (11 dígitos) ou um telefone com DDD.', 'err'); return; }
    status('sp-status', 'Buscando na Asa…');
    lookup(tries).then(function (x) {
      var r = x.r;
      if (r.status === 200 && r.body && r.body.encontrado) {
        pac = { paciente: r.body.paciente, consultas: r.body.consultas, busca: x.busca };
        renderPatient();
      } else if (r.status === 200) {
        pac = null;
        status('sp-status', 'Nenhum paciente com esse CPF ou telefone na Asa. Para cadastrar, escolha um horário livre e marque a consulta como paciente novo.');
      } else {
        status('sp-status', C.readError(r.status, r.body), 'err');
      }
    });
  }

  function renderPatient(notice) {
    var p = pac.paciente, dl = $('sp-facts');
    side('s-pac');
    $('sp-name').textContent = p.nome;
    dl.textContent = '';
    var idade = C.age(p.nascimento);
    if (p.nascimento) fact(dl, 'Nascimento', C.formatBirth(p.nascimento) + (idade != null ? ' (' + idade + ' anos)' : ''));
    if (p.telefone) fact(dl, 'Telefone', C.formatPhone(p.telefone));
    if (p.cpf) fact(dl, 'CPF', C.maskCpf(p.cpf));
    dl.hidden = false;
    $('sp-hint').hidden = false;
    $('sp-charge').hidden = !(p.id && C.canCharge(fin, userType));
    $('sp-fin-label').hidden = $('sp-fin').hidden = !(p.id && fin && fin.ativo);
    if (p.id && fin && fin.ativo) root.AsaCharge.history($('sp-fin'), api, p.id);
    var list = pac.consultas, ul = $('sp-list');
    ul.textContent = '';
    $('sp-list-label').hidden = !list || !list.length;
    if (list === null) status('sp-status', 'A Asa não devolveu as consultas agora.', 'err');
    else if (!list.length) status('sp-status', notice || 'Nenhuma consulta marcada.');
    else status('sp-status', notice || '');
    (list || []).forEach(function (c) {
      var li = el('li', 'item'), body = el('div', 'appt__body');
      body.appendChild(el('div', 'item__when', whenText(c)));
      if (c.prestador) body.appendChild(el('div', 'item__who', c.prestador));
      if (c.procedimentos.length) body.appendChild(el('div', 'item__proc', c.procedimentos.join(', ')));
      if (p.id) body.appendChild(consultaActions(c));
      li.appendChild(body);
      ul.appendChild(li);
    });
  }

  function consultaActions(c) {
    var box = el('div', 'item__actions');
    function normal() {
      box.textContent = '';
      box.appendChild(button('Remarcar', null, function () { startReschedule(c, pac.paciente, pac.busca); }));
      box.appendChild(button('Cancelar', 'btn--danger', ask));
    }
    function ask() {
      box.textContent = '';
      box.appendChild(el('span', 'item__ask', 'Cancelar esta consulta na Asa?'));
      box.appendChild(button('Sim, cancelar', 'btn--danger', function (ev) { cancelFromPatient(c, box, ev.currentTarget); }));
      box.appendChild(button('Não', null, normal));
    }
    normal();
    return box;
  }

  function cancelFromPatient(c, box, btn) {
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) { b.disabled = true; });
    btn.textContent = 'Cancelando…';
    var key = c.cancelKey || (c.cancelKey = C.newKey());
    var busca = pac.busca;
    api.cancel(c.id, { chave: key, busca: busca, usuario: userLabel || undefined }).then(function (r) {
      if (r.status === 200 && r.body && r.body.ok) { refreshPatient(busca, 'Consulta de ' + whenText(c) + ' cancelada na Asa.'); loadView(); return; }
      var erro = r.body && r.body.erro;
      if (erro !== 'AGENDAMENTO_INCERTO' && erro !== 'AGENDAMENTO_EM_ANDAMENTO') c.cancelKey = null;
      box.textContent = '';
      box.appendChild(el('span', 'item__ask', erro === 'CONSULTA_NAO_ENCONTRADA'
        ? 'Essa consulta não está mais na lista do paciente na Asa.'
        : C.bookingError(r.status, r.body)));
      box.appendChild(button('Voltar', null, function () { box.parentNode.replaceChild(consultaActions(c), box); }));
    });
  }

  function refreshPatient(busca, notice) {
    api.patient(busca).then(function (r) {
      if (r.status === 200 && r.body && r.body.encontrado) {
        pac = { paciente: r.body.paciente, consultas: r.body.consultas, busca: busca };
        if (!$('s-pac').hidden) renderPatient(notice);
      }
    });
  }

  /* ---------- marcar e remarcar ---------- */
  function fillSelect(s, items, label, empty) {
    s.textContent = '';
    if (!items.length) { s.appendChild(option('', empty)); s.disabled = true; return; }
    s.appendChild(option('', 'Escolha…'));
    items.forEach(function (it) { s.appendChild(option(it.id, label(it))); });
    s.disabled = false;
  }

  function openBooking(slot) {
    var orig = rescheduling;
    booking = {
      slot: slot, providerName: providerName(slot.prestador_id), key: C.newKey(), insurances: [], procedures: [],
      original: orig ? orig.consulta : null, busca: orig ? orig.busca : pac && pac.busca,
      known: orig ? orig.paciente : pac && pac.paciente && pac.paciente.id ? pac.paciente : null
    };
    var b = booking;
    side('s-book');
    $('sb-title').textContent = b.original ? 'Remarcar consulta' : 'Marcar consulta';
    $('sb-slot').textContent = b.providerName + ' · ' + C.formatDay(slot.data) + ' · ' + slot.horario;
    ['sb-obs', 'sb-q', 'sb-nome', 'sb-cpf', 'sb-nasc', 'sb-tel'].forEach(function (id) { $(id).value = ''; });
    status('sb-status', '');
    status('sb-pac-status', '');
    setKnown(b.known);
    $('sb-pac-change').hidden = !!b.original; // na remarcação o paciente é o da consulta original
    $('sb-proc').disabled = true;
    $('sb-proc').textContent = '';
    $('sb-proc').appendChild(option('', 'Escolha o convênio'));
    $('sb-conv').disabled = true;
    $('sb-conv').textContent = '';
    $('sb-conv').appendChild(option('', 'Carregando…'));
    api.insurances(slot).then(function (r) {
      if (booking !== b) return;
      if (r.status !== 200 || !r.body) { fillSelect($('sb-conv'), [], null, 'Indisponível'); status('sb-status', C.readError(r.status, r.body), 'err'); return; }
      b.insurances = r.body.convenios;
      fillSelect($('sb-conv'), b.insurances, function (c) { return c.nome; }, 'Nenhum convênio aceito neste horário');
    });
  }

  // Paciente do agendamento: conhecido (com id na Asa) ou a buscar / cadastrar.
  function setKnown(p) {
    if (booking) booking.known = p;
    $('sb-pac-known').hidden = !p;
    $('sb-pac-find').hidden = !!p;
    $('sb-new').hidden = true;
    if (p) $('sb-pac-name').textContent = p.nome + (p.nascimento ? ' · ' + C.formatBirth(p.nascimento) : '');
  }

  function bookingFindPatient() {
    var b = booking, raw = $('sb-q').value, tries = C.lookupsFrom(raw);
    if (!b) return;
    if (!tries.length) { status('sb-pac-status', 'Digite um CPF (11 dígitos) ou um telefone com DDD.', 'err'); return; }
    status('sb-pac-status', 'Buscando na Asa…');
    $('sb-new').hidden = true;
    lookup(tries).then(function (x) {
      if (booking !== b) return;
      var r = x.r;
      if (r.status === 200 && r.body && r.body.encontrado && r.body.paciente.id) {
        b.busca = x.busca;
        setKnown(r.body.paciente);
        status('sb-pac-status', '');
      } else if (r.status === 200) {
        status('sb-pac-status', 'Paciente não encontrado na Asa: preencha o cadastro para marcar como paciente novo.');
        $('sb-new').hidden = false;
        // Só preenche o que o número certamente é; o ambíguo (telefone ou CPF) vai só no telefone.
        if (tries.length === 1 && tries[0].cpf) $('sb-cpf').value = tries[0].cpf;
        if (tries[0].telefone) $('sb-tel').value = C.formatPhone(tries[0].telefone);
        $('sb-nome').focus();
      } else {
        status('sb-pac-status', C.readError(r.status, r.body), 'err');
      }
    });
  }

  function onInsurance() {
    var b = booking, conv = $('sb-conv').value, s = $('sb-proc');
    if (!b) return;
    b.procedures = [];
    s.textContent = '';
    if (!conv) { s.disabled = true; s.appendChild(option('', 'Escolha o convênio')); return; }
    s.disabled = true;
    s.appendChild(option('', 'Carregando…'));
    api.procedures(b.slot, conv).then(function (r) {
      if (booking !== b || $('sb-conv').value !== conv) return;
      if (r.status !== 200 || !r.body) { fillSelect(s, [], null, 'Indisponível'); status('sb-status', C.readError(r.status, r.body), 'err'); return; }
      b.procedures = r.body.procedimentos;
      fillSelect(s, b.procedures, function (p) { return p.nome + (p.valor > 0 ? ' — ' + C.formatMoney(p.valor) : ''); }, 'Nenhum procedimento para este convênio');
    });
  }

  function review(ev) {
    ev.preventDefault();
    var b = booking;
    if (!b) return;
    var who;
    if (b.known) {
      b.patient = { paciente_id: b.known.id, busca: b.busca };
      who = b.known.nome;
    } else if (!$('sb-new').hidden) {
      var np = C.newPatient({ nome: $('sb-nome').value, cpf: $('sb-cpf').value, nascimento: $('sb-nasc').value, telefone: $('sb-tel').value });
      if (!np.ok) { status('sb-status', np.error, 'err'); return; }
      b.patient = { paciente: np.value };
      who = np.value.nome + ' (cadastro novo, CPF ' + C.maskCpf(np.value.cpf) + ')';
    } else {
      status('sb-status', 'Busque o paciente pelo CPF ou telefone.', 'err');
      return;
    }
    var conv = find(b.insurances, $('sb-conv').value), proc = find(b.procedures, $('sb-proc').value);
    if (!conv || !proc) { status('sb-status', 'Escolha o convênio e o procedimento.', 'err'); return; }
    b.conv = conv;
    b.proc = proc;
    b.obs = $('sb-obs').value.trim();

    var dl = $('sr-summary');
    dl.textContent = '';
    fact(dl, 'Paciente', who);
    if (b.original) fact(dl, 'Sai de', whenText(b.original) + (b.original.prestador ? ' com ' + b.original.prestador : ''));
    fact(dl, 'Profissional', b.providerName);
    fact(dl, b.original ? 'Vai para' : 'Quando', C.formatDay(b.slot.data, true) + ' às ' + b.slot.horario);
    fact(dl, 'Convênio', conv.nome);
    fact(dl, 'Procedimento', proc.nome + (proc.valor > 0 ? ' — ' + C.formatMoney(proc.valor) : ''));
    if (b.obs) fact(dl, 'Observação', b.obs);
    $('sr-title').textContent = b.original ? 'Confirme a remarcação' : 'Confirme o agendamento';
    $('sr-go').textContent = b.original ? 'Confirmar remarcação' : 'Confirmar agendamento';
    $('sr-hint').textContent = b.original
      ? 'Ao confirmar, a consulta original é trocada pelo novo horário na agenda da clínica na Asa.'
      : 'Ao confirmar, a consulta é gravada na agenda da clínica na Asa.';
    status('sr-status', '');
    $('sr-go').disabled = false;
    side('s-review');
  }

  function confirmBooking() {
    var b = booking;
    if (!b) return;
    $('sr-go').disabled = true;
    $('sr-back').disabled = true;
    status('sr-status', $('sr-go').textContent === 'Conferir na Asa' ? 'Conferindo na agenda da Asa…' : 'Gravando na Asa… pode levar até um minuto.');
    var payload = Object.assign({
      chave: b.key,
      convenio_id: b.conv.id,
      convenio_procedimento_id: b.proc.id,
      obs: b.obs || undefined,
      usuario: userLabel || undefined,
      remarcar: b.original ? { agendamento_id: b.original.id, busca: b.busca } : undefined
    }, b.slot, b.patient);
    api.book(payload).then(function (r) {
      $('sr-back').disabled = false;
      if (booking !== b) return;
      if (r.status === 200 && r.body && r.body.ok) { bookingDone(b, r.body); return; }
      var erro = r.body && r.body.erro;
      status('sr-status', C.bookingError(r.status, r.body), 'err');
      // Recusa definitiva: um novo pedido precisa de chave nova. Incerto, sem resposta ou em andamento:
      // mantém a chave, e o botão passa a só conferir (o Conector nunca grava duas vezes a mesma chave).
      var unsure = erro === 'AGENDAMENTO_INCERTO' || erro === 'AGENDAMENTO_EM_ANDAMENTO' || (r.status === 0 && !erro);
      if (!unsure) b.key = C.newKey();
      $('sr-go').textContent = unsure ? 'Conferir na Asa' : (b.original ? 'Confirmar remarcação' : 'Confirmar agendamento');
      $('sr-go').disabled = erro === 'HORARIO_INDISPONIVEL';
      if (erro === 'HORARIO_INDISPONIVEL') setTimeout(loadView, 1500);
    });
  }

  function bookingDone(b, res) {
    $('sd-title').textContent = b.original ? 'Consulta remarcada' : 'Consulta marcada';
    var dl = $('sd-facts');
    dl.textContent = '';
    fact(dl, 'Paciente', b.known ? b.known.nome : b.patient.paciente.nome);
    fact(dl, 'Quando', C.formatDay(b.slot.data, true) + ' às ' + b.slot.horario);
    fact(dl, 'Profissional', b.providerName);
    fact(dl, 'Procedimento', b.proc.nome);
    if (res.agendamento_id) fact(dl, 'Nº na Asa', res.agendamento_id);
    if (res.clinica || res.endereco) fact(dl, 'Local', [res.clinica, res.endereco].filter(Boolean).join(' — '));
    side('s-done');
    booking = null;
    if (b.original) { rescheduling = null; $('rs-banner').hidden = true; }
    if (pac && b.busca && pac.busca === b.busca) refreshPatient(b.busca);
    loadView();
  }

  /* ---------- conexão e início ---------- */
  function connect() {
    pill('idle', 'Verificando');
    $('g-off').hidden = true;
    return root.AsaApi.load(omni, cfg).then(function (a) {
      api = a;
      return api.testConnection();
    }).then(function (r) {
      var st = C.connectionState(r.status, r.body);
      pill(st.tone, st.pill);
      if (st.tone !== 'ok') {
        $('ws').hidden = true;
        $('q-form').hidden = true;
        $('g-off-title').textContent = st.pill;
        $('g-off-text').textContent = st.text;
        $('g-off').hidden = false;
        return;
      }
      $('ws').hidden = false;
      $('q-form').hidden = false;
      if (!fin) loadFinance();
      if (!sched) loadSchedule(); else loadView();
    });
  }

  if (!omni) { pill('err', 'Fora do Kentro'); return; }
  omni.ready(function (ctx) {
    cfg = (ctx && ctx.config) || {};
    B.applyTheme(ctx && ctx.theme);
    omni.on('themeChanged', B.applyTheme);
    if (omni.session && omni.session.getUser) {
      Promise.resolve(omni.session.getUser()).then(function (u) {
        if (u) userLabel = [u.id, u.name || u.username].filter(Boolean).join(' ');
        userType = C.userType(u);
        // O SDK não documenta o campo do perfil: registra os nomes (não os valores) para ajustar.
        if (u && userType === null && root.console) root.console.info('[Asa] perfil do usuário não reconhecido; campos:', Object.keys(u).join(', '));
      }).catch(function () { /* sem usuário: a trilha fica sem nome */ });
    }

    $('sp-charge').addEventListener('click', function () {
      if (!pac || !pac.paciente.id) return;
      var appts = (pac.consultas || []).filter(function (c) { return c.id; }).map(function (c) {
        return { id: c.id, label: whenText(c) + (c.prestador ? ' — ' + c.prestador : '') };
      });
      openCharge(pac.paciente, pac.busca, appts, '', function () { renderPatient(); });
    });
    $('f-esp').addEventListener('change', function () { onSpecialty(); });
    $('f-prest').addEventListener('change', function () { setProvider($('f-prest').value); });
    $('d-prev').addEventListener('click', function () { step(-1); });
    $('d-next').addEventListener('click', function () { step(1); });
    Array.prototype.forEach.call(document.querySelectorAll('.seg__btn'), function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });
    $('d-today').addEventListener('click', function () { setDay(C.todayIso()); });
    $('d-pick').addEventListener('change', function () { setDay($('d-pick').value); });
    $('q-form').addEventListener('submit', searchPatient);
    $('sp-close').addEventListener('click', closeSide);
    $('rs-stop').addEventListener('click', stopReschedule);
    $('s-book').addEventListener('submit', review);
    $('sb-conv').addEventListener('change', onInsurance);
    $('sb-q-go').addEventListener('click', bookingFindPatient);
    $('sb-q').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); bookingFindPatient(); } });
    $('sb-pac-change').addEventListener('click', function () { setKnown(null); $('sb-q').focus(); });
    $('sb-cancel').addEventListener('click', closeSide);
    $('sr-go').addEventListener('click', confirmBooking);
    $('sr-back').addEventListener('click', function () { side('s-book'); });
    $('sd-close').addEventListener('click', closeSide);
    $('g-retry').addEventListener('click', connect);

    setView(recall('view'));
    side('s-empty');
    root.setInterval(tickNow, 60000);
    root.setInterval(refreshWaiting, 60000);
    connect();
  });
})(this);
