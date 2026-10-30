/* Painel da clínica (administradores e supervisores): confirmações, atividade da equipe, cobranças,
 * alertas e ocupação da agenda. Os números vêm de /v1/painel/resumo; a ocupação, de /v1/agenda/dia
 * de cada profissional. */
(function (root) {
  'use strict';

  var C = root.AsaCore, B = root.AsaBridge, omni = root.omni;
  var api = null, dias = 7, seq = 0, sched = null, ocSeq = 0;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pill(tone, text) { $('pill').setAttribute('data-tone', tone); $('pill-text').textContent = text; }
  function status(id, text, tone) {
    if (tone) $(id).setAttribute('data-tone', tone); else $(id).removeAttribute('data-tone');
    $(id).textContent = text || '';
  }
  function pct(a, b) { return b ? Math.round(100 * a / b) : null; }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }
  function money(v) { return C.formatMoney(Math.round(v * 100) / 100) || 'R$ 0,00'; }
  function shortDay(iso) { var p = String(iso).split('-'); return p[2] + '/' + p[1]; }

  /* ---------- dica ao passar o mouse (e no foco, pelo teclado) ---------- */
  function hint(node, text) {
    node.setAttribute('aria-label', text);
    node.tabIndex = 0;
    function on() {
      var t = $('tip'), r = node.getBoundingClientRect();
      t.textContent = text;
      t.hidden = false;
      var w = t.offsetWidth;
      t.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
      t.style.top = Math.max(8, r.top - t.offsetHeight - 8) + 'px';
    }
    function off() { $('tip').hidden = true; }
    node.addEventListener('mouseenter', on);
    node.addEventListener('focus', on);
    node.addEventListener('mouseleave', off);
    node.addEventListener('blur', off);
  }

  function legend(box, items) {
    box.textContent = '';
    items.forEach(function (it) {
      var i = el('span', 'legend__item');
      var sw = el('i', 'legend__sw');
      sw.setAttribute('data-tone', it.tone);
      i.appendChild(sw);
      i.appendChild(el('span', null, it.label));
      box.appendChild(i);
    });
  }

  /* ---------- números do topo ---------- */
  function kpi(box, label, value, note, tone) {
    var k = el('div', 'kpi');
    if (tone) k.setAttribute('data-tone', tone);
    k.appendChild(el('span', 'kpi__label', label));
    k.appendChild(el('span', 'kpi__value', value));
    if (note) k.appendChild(el('span', 'kpi__note', note));
    box.appendChild(k);
    return k;
  }

  function renderKpis(d) {
    var box = $('d-kpis'), c = d.confirmacoes, a = d.atividade.por_tipo;
    var resp = c.confirmadas + c.remarcar + c.canceladas;
    var taxa = pct(c.confirmadas, c.enviadas);
    box.textContent = '';
    var k = kpi(box, 'Taxa de confirmação', taxa == null ? '—' : taxa + '%',
      c.enviadas ? plural(c.confirmadas, 'confirmada', 'confirmadas') + ' de ' + plural(c.enviadas, 'enviada', 'enviadas') : 'nenhuma confirmação enviada', 'brand');
    if (taxa != null) { var bar = el('span', 'kpi__bar'), f = el('span', 'kpi__fill'); f.style.width = taxa + '%'; bar.appendChild(f); k.appendChild(bar); }
    kpi(box, 'Responderam', c.enviadas ? pct(resp, c.enviadas) + '%' : '—', c.sem_resposta ? plural(c.sem_resposta, 'ainda sem resposta', 'ainda sem resposta') : 'todas respondidas');
    kpi(box, 'Consultas marcadas', String(a.criar || 0), plural(a.remarcar || 0, 'remarcação', 'remarcações') + ' · ' + plural(a.cancelar || 0, 'cancelamento', 'cancelamentos'));
    kpi(box, 'Cobranças lançadas', money(d.cobrancas.total), plural(d.cobrancas.quantidade, 'lançamento', 'lançamentos'));
    var alertas = d.alertas.agendamentos_incertos.length + d.cobrancas.incertas + c.falharam;
    kpi(box, 'Alertas', String(alertas), alertas ? 'veja em Cobranças › Alertas' : 'nada a conferir', alertas ? 'err' : 'ok');
    box.hidden = false;
  }

  /* ---------- confirmações ---------- */
  var DESFECHOS = [
    ['confirmadas', 'Confirmou', 'ok'], ['remarcar', 'Pediu para remarcar', 'warn'], ['canceladas', 'Cancelou', 'err'],
    ['sem_resposta', 'Sem resposta', 'idle']
  ];
  function renderConfirmations(d) {
    var c = d.confirmacoes, stack = $('conf-stack'), total = c.enviadas;
    $('conf-sub').textContent = total
      ? plural(total, 'mensagem enviada', 'mensagens enviadas') + ' no período' + (c.manuais ? ', ' + c.manuais + ' pelo botão do atendente' : '') + (c.falharam ? '. ' + plural(c.falharam, 'não foi entregue', 'não foram entregues') + '.' : '.')
      : 'Nenhuma confirmação saiu no período.';
    stack.textContent = '';
    stack.hidden = !total;
    var items = [];
    DESFECHOS.forEach(function (x) {
      var n = c[x[0]];
      items.push({ tone: x[2], label: x[1] + ': ' + n + (total ? ' (' + pct(n, total) + '%)' : '') });
      if (!n) return;
      var seg = el('span', 'stack__seg');
      seg.setAttribute('data-tone', x[2]);
      seg.style.flexGrow = String(n);
      if (pct(n, total) >= 8) seg.appendChild(el('span', 'stack__val', pct(n, total) + '%'));
      hint(seg, x[1] + ': ' + n + ' de ' + total + ' (' + pct(n, total) + '%)');
      stack.appendChild(seg);
    });
    legend($('conf-legend'), total ? items : []);

    // Enviadas por dia, com a parte confirmada em cor cheia.
    var days = fillDays(d.periodo, c.por_dia, function (r) { return { total: r.enviadas, part: r.confirmadas }; });
    columns($('conf-days'), days, function (x) { return shortDay(x.dia) + ': ' + plural(x.total, 'enviada', 'enviadas') + ', ' + plural(x.part, 'confirmada', 'confirmadas'); });
    legend($('conf-days-legend'), days.some(function (x) { return x.total; }) ? [{ tone: 'brand', label: 'Confirmadas' }, { tone: 'soft', label: 'Enviadas sem confirmação' }] : []);
  }

  // Um item por dia do período (dias sem movimento entram zerados, para o eixo não pular).
  function fillDays(p, rows, map) {
    var by = {};
    (rows || []).forEach(function (r) { by[r.dia] = map(r); });
    var out = [];
    for (var day = p.inicio; day <= p.fim; day = C.shiftDay(day, 1)) {
      var v = by[day] || { total: 0, part: 0 };
      out.push({ dia: day, total: v.total, part: v.part || 0 });
    }
    return out;
  }

  // Colunas por dia. Com mais de 31 dias as colunas ficam finas e só alguns rótulos aparecem.
  function columns(box, days, text) {
    box.textContent = '';
    var max = Math.max.apply(null, days.map(function (x) { return x.total; }).concat([0]));
    if (!max) { box.appendChild(el('p', 'muted', 'Sem movimento no período.')); box.classList.add('cols--empty'); return; }
    box.classList.remove('cols--empty');
    var every = days.length > 31 ? 7 : days.length > 15 ? 3 : 1;
    box.style.setProperty('--n', days.length);
    days.forEach(function (x, i) {
      var col = el('div', 'cols__col');
      var bar = el('span', 'cols__bar');
      bar.style.height = (100 * x.total / max) + '%';
      if (x.part) { var part = el('span', 'cols__part'); part.style.height = (100 * x.part / x.total) + '%'; bar.appendChild(part); }
      col.appendChild(bar);
      col.appendChild(el('span', 'cols__lbl', i % every === 0 || i === days.length - 1 ? shortDay(x.dia) : ''));
      if (x.dia === days[days.length - 1].dia || x.total === max) col.appendChild(el('span', 'cols__val', String(x.total)));
      hint(col, text(x));
      box.appendChild(col);
    });
  }

  function renderTodo(d) {
    var ul = $('tratar'), list = d.confirmacoes.a_tratar;
    ul.textContent = '';
    if (!list.length) { ul.appendChild(el('li', 'todo__empty', 'Nenhum paciente aguardando contato.')); return; }
    list.forEach(function (r) {
      var li = el('li', 'todo__item');
      var stub = el('span', 'todo__when');
      stub.appendChild(el('strong', null, shortDay(r.data)));
      stub.appendChild(el('span', null, r.hora || '--:--'));
      li.appendChild(stub);
      var body = el('span', 'todo__body');
      body.appendChild(el('span', 'todo__who', r.nome || C.formatPhone(r.telefone) || 'Paciente'));
      body.appendChild(el('span', 'todo__meta', [r.nome ? C.formatPhone(r.telefone) : '', r.prestador].filter(Boolean).join(' · ')));
      li.appendChild(body);
      var s = r.estado === 'falhou' ? ['Não entregue', 'err'] : r.resposta === 'cancelar' ? ['Cancelou', 'err'] : ['Remarcar', 'warn'];
      var seal = el('span', 'seal', s[0]);
      seal.setAttribute('data-tone', s[1]);
      li.appendChild(seal);
      ul.appendChild(li);
    });
  }

  /* ---------- atividade ---------- */
  var TIPOS = [['criar', 'Marcou'], ['remarcar', 'Remarcou'], ['cancelar', 'Cancelou'], ['confirmar', 'Presença'], ['ausente', 'Falta']];
  function renderActivity(d) {
    var a = d.atividade, total = TIPOS.reduce(function (s, t) { return s + (a.por_tipo[t[0]] || 0); }, 0);
    $('ativ-sub').textContent = total ? plural(total, 'ação gravada', 'ações gravadas') + ' na Asa pela Kentro.' + (a.incertas ? ' ' + plural(a.incertas, 'ficou incerta', 'ficaram incertas') + '.' : '') : 'Nenhuma ação gravada na Asa pela Kentro no período.';
    var chips = $('ativ-tipos');
    chips.textContent = '';
    TIPOS.forEach(function (t) {
      var c = el('span', 'stat');
      c.appendChild(el('strong', null, String(a.por_tipo[t[0]] || 0)));
      c.appendChild(el('span', null, t[1]));
      chips.appendChild(c);
    });
    var days = fillDays(d.periodo, a.por_dia, function (r) {
      return { total: TIPOS.reduce(function (s, t) { return s + (r[t[0]] || 0); }, 0) };
    });
    columns($('ativ-days'), days, function (x) { return shortDay(x.dia) + ': ' + plural(x.total, 'ação', 'ações'); });

    var tb = $('equipe');
    tb.textContent = '';
    if (!a.equipe.length) { tb.appendChild(el('caption', 'muted', 'Ninguém da equipe gravou na Asa no período.')); return; }
    var head = el('tr');
    ['Atendente'].concat(TIPOS.map(function (t) { return t[1]; }), ['Cobranças']).forEach(function (h, i) {
      var th = el('th', i ? 'num' : null, h);
      th.scope = 'col';
      head.appendChild(th);
    });
    tb.appendChild(el('thead')).appendChild(head);
    var body = tb.appendChild(el('tbody'));
    var top = Math.max.apply(null, a.equipe.map(function (m) { return TIPOS.reduce(function (s, t) { return s + (m.acoes[t[0]] || 0); }, 0); }));
    a.equipe.forEach(function (m) {
      var tr = el('tr'), soma = TIPOS.reduce(function (s, t) { return s + (m.acoes[t[0]] || 0); }, 0);
      var th = el('th');
      th.scope = 'row';
      var who = th.appendChild(el('span', 'who'));
      var av = el('span', 'avatar avatar--sm', C.initials(m.usuario));
      who.appendChild(av);
      var name = el('span', 'who__name');
      name.appendChild(el('span', null, m.usuario));
      var bar = el('span', 'who__bar');
      bar.style.width = (top ? 100 * soma / top : 0) + '%';
      name.appendChild(bar);
      who.appendChild(name);
      tr.appendChild(th);
      TIPOS.forEach(function (t) { tr.appendChild(el('td', 'num' + (m.acoes[t[0]] ? '' : ' zero'), String(m.acoes[t[0]] || 0))); });
      tr.appendChild(el('td', 'num' + (m.cobrancas ? '' : ' zero'), m.cobrancas ? money(m.valor) : '—'));
      body.appendChild(tr);
    });
  }

  /* ---------- cobranças e alertas ---------- */
  function hbar(box, label, value, frac, note, tone) {
    var row = el('div', 'hbar');
    row.appendChild(el('span', 'hbar__lbl', label));
    var track = el('span', 'hbar__track');
    var f = el('span', 'hbar__fill');
    f.style.width = Math.max(frac * 100, frac ? 2 : 0) + '%';
    if (tone) f.setAttribute('data-tone', tone);
    track.appendChild(f);
    row.appendChild(track);
    row.appendChild(el('span', 'hbar__val', value));
    if (note) hint(row, note);
    box.appendChild(row);
    return row;
  }

  function renderCharges(d) {
    var c = d.cobrancas, box = $('cob-formas'), formas = Object.keys(c.formas);
    $('cob-sub').textContent = c.quantidade ? money(c.total) + ' em ' + plural(c.quantidade, 'lançamento', 'lançamentos') + ' pela Kentro.' : 'Nenhuma cobrança lançada pela Kentro no período.';
    box.textContent = '';
    var max = Math.max.apply(null, formas.map(function (k) { return c.formas[k].total; }).concat([0]));
    formas.sort(function (x, y) { return c.formas[y].total - c.formas[x].total; }).forEach(function (k) {
      var f = c.formas[k];
      hbar(box, C.paymentLabel(k), money(f.total), max ? f.total / max : 0, C.paymentLabel(k) + ': ' + plural(f.n, 'lançamento', 'lançamentos') + ', ' + money(f.total));
    });

    var ul = $('alertas'), any = false;
    ul.textContent = '';
    function alert(title, text, tone) {
      any = true;
      var li = el('li', 'alert');
      li.setAttribute('data-tone', tone || 'err');
      li.appendChild(el('strong', null, title));
      if (text) li.appendChild(el('span', null, text));
      ul.appendChild(li);
    }
    d.alertas.agendamentos_incertos.forEach(function (x) {
      var tipo = { criar: 'Marcação', remarcar: 'Remarcação', cancelar: 'Cancelamento', confirmar: 'Presença', ausente: 'Falta' }[x.tipo] || 'Ação';
      alert(tipo + ' sem confirmação da Asa',
        [x.data ? C.formatDay(x.data) + (x.horario ? ' às ' + x.horario : '') : '', providerName(x.prestador_id), x.usuario ? 'por ' + x.usuario.replace(/^\d+\s+/, '') : '']
          .filter(Boolean).join(' · ') + '. Confira na agenda do profissional.');
    });
    if (c.incertas) alert(plural(c.incertas, 'cobrança incerta', 'cobranças incertas'), 'A Asa não confirmou o lançamento: confira no financeiro da Asa antes de lançar de novo.');
    if (d.confirmacoes.falharam) alert(plural(d.confirmacoes.falharam, 'confirmação não entregue', 'confirmações não entregues'), 'Veja os pacientes em "Precisa de contato".', 'warn');
    if (!any) ul.appendChild(el('li', 'alert', 'Nada a conferir no período.')).setAttribute('data-tone', 'ok');
  }

  /* ---------- ocupação ---------- */
  function providerName(id) {
    var p = sched && id && sched.prestadores.filter(function (x) { return String(x.id) === String(id); })[0];
    return p ? p.nome : id ? 'Profissional ' + id : '';
  }

  function loadSchedule() {
    return api.schedule().then(function (r) {
      if (r.status !== 200 || !r.body) return;
      sched = r.body;
      var sel = $('oc-esp');
      sched.especialidades.forEach(function (e) {
        if (!sched.prestadores.some(function (p) { return p.especialidade_id === e.id; })) return;
        var o = el('option', null, e.nome);
        o.value = e.id;
        sel.appendChild(o);
      });
    });
  }

  var MAX_PROF = 40;
  function loadOccupancy() {
    if (!sched) { status('oc-status', 'A lista de profissionais não veio da Asa. Tente de novo.', 'err'); loadSchedule(); return; }
    var s = ++ocSeq, esp = $('oc-esp').value, day = $('oc-day').value || C.todayIso();
    var profs = sched.prestadores.filter(function (p) { return !esp || p.especialidade_id === esp; });
    var cut = profs.length > MAX_PROF;
    profs = profs.slice(0, MAX_PROF);
    var box = $('oc-list'), done = 0, rows = [];
    box.textContent = '';
    $('oc-legend').hidden = true;
    if (!profs.length) { status('oc-status', 'Nenhum profissional nessa especialidade.'); return; }
    status('oc-status', 'Carregando 0 de ' + profs.length + '…');
    $('ocup-sub').textContent = 'Consultas marcadas e horários livres de cada profissional em ' + C.formatDay(day, true) + '.';
    var i = 0;
    function next() {
      if (s !== ocSeq || i >= profs.length) return null;
      var p = profs[i++];
      return api.day(p.id, day).then(function (r) {
        if (s !== ocSeq) return;
        done++;
        if (r.status === 200 && r.body) {
          var t = C.daySummary(r.body.agendados, r.body.livres);
          if (t.consultas + t.livres) rows.push({ nome: p.nome, consultas: t.consultas, livres: t.livres, confirmadas: t.confirmadas });
        }
        drawOccupancy(rows);
        status('oc-status', done < profs.length ? 'Carregando ' + done + ' de ' + profs.length + '…'
          : (rows.length ? plural(rows.length, 'profissional com agenda', 'profissionais com agenda') + ' no dia.' : 'Ninguém tem agenda neste dia.') + (cut ? ' Mostrando os ' + MAX_PROF + ' primeiros: filtre pela especialidade.' : ''));
      }).then(next, next);
    }
    for (var k = 0; k < Math.min(3, profs.length); k++) next();
  }

  function drawOccupancy(rows) {
    var box = $('oc-list');
    box.textContent = '';
    rows.sort(function (a, b) { return (b.consultas / (b.consultas + b.livres)) - (a.consultas / (a.consultas + a.livres)) || b.consultas - a.consultas; });
    var tot = rows.reduce(function (s, r) { return { c: s.c + r.consultas, l: s.l + r.livres }; }, { c: 0, l: 0 });
    if (rows.length > 1) {
      var all = hbar(box, 'Clínica toda', pct(tot.c, tot.c + tot.l) + '%', tot.c / (tot.c + tot.l), plural(tot.c, 'consulta', 'consultas') + ' e ' + plural(tot.l, 'horário livre', 'horários livres'));
      all.classList.add('hbar--total');
    }
    rows.forEach(function (r) {
      var cap = r.consultas + r.livres;
      var row = hbar(box, r.nome, r.consultas + '/' + cap + ' · ' + pct(r.consultas, cap) + '%', r.consultas / cap,
        r.nome + ': ' + plural(r.consultas, 'consulta', 'consultas') + ' (' + r.confirmadas + ' confirmadas), ' + plural(r.livres, 'horário livre', 'horários livres'));
      if (!r.livres) row.classList.add('hbar--full');
    });
    legend($('oc-legend'), [{ tone: 'brand', label: 'Consultas marcadas' }, { tone: 'soft', label: 'Horários livres' }]);
    $('oc-legend').hidden = !rows.length;
  }

  /* ---------- carga ---------- */
  function load() {
    var s = ++seq;
    status('d-status', 'Carregando os números…');
    $('d-body').setAttribute('aria-busy', 'true');
    api.dashboard(dias).then(function (r) {
      if (s !== seq) return;
      $('d-body').removeAttribute('aria-busy');
      if (r.status !== 200 || !r.body || !r.body.confirmacoes) {
        var st = C.connectionState(r.status, r.body);
        pill(st.tone === 'ok' ? 'err' : st.tone, st.pill);
        status('d-status', r.status === 404 ? 'O Conector ainda não tem o painel: falta publicar a versão nova.' : C.readError(r.status, r.body), 'err');
        return;
      }
      pill('ok', 'Conectado');
      var d = r.body, p = d.periodo;
      status('d-status', p.dias === 1 ? 'Hoje, ' + C.formatDay(p.fim) + '.' : 'De ' + C.formatDay(p.inicio) + ' a ' + C.formatDay(p.fim) + '.');
      renderKpis(d);
      renderConfirmations(d);
      renderTodo(d);
      renderActivity(d);
      renderCharges(d);
      $('d-body').hidden = false;
    });
  }

  if (!omni) { pill('err', 'Fora do Kentro'); status('d-status', 'Abra esta tela dentro do Kentro.', 'err'); return; }
  omni.ready(function (ctx) {
    B.applyTheme(ctx && ctx.theme);
    omni.on('themeChanged', B.applyTheme);
    $('oc-day').value = C.todayIso();
    Array.prototype.forEach.call(document.querySelectorAll('#period .seg__btn'), function (b) {
      b.addEventListener('click', function () {
        dias = Number(b.getAttribute('data-dias'));
        Array.prototype.forEach.call(document.querySelectorAll('#period .seg__btn'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        load();
      });
    });
    $('oc-go').addEventListener('click', loadOccupancy);
    root.AsaApi.load(omni, (ctx && ctx.config) || {}).then(function (a) {
      api = a;
      // Os nomes dos profissionais servem também aos alertas: a agenda vem antes dos números.
      loadSchedule().then(load, load);
    });
  });
})(this);
