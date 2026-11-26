/* Tela Início (primeira aba do ClinFy do administrador): o dia de hoje em números, os próximos pacientes e
 * atalhos para a Agenda, o Painel e a busca de paciente. Os números vêm da agenda de hoje de todos os
 * profissionais, pela rota em lote (8 profissionais por pedido: a Kentro limita as chamadas por minuto).
 * A Agenda aberta logo depois reaproveita o mesmo dia, guardado por alguns segundos em api.js. */
(function (root) {
  'use strict';

  var C = root.AsaCore, B = root.AsaBridge, omni = root.omni;
  var api = null, sched = null, seq = 0;
  var MAX_PROF = 40;

  var IDS = (root.ClinFyIds && root.ClinFyIds.inicio) || {};
  function $(id) { return document.getElementById(IDS[id] || id); }
  var el = C.el;
  function pill(tone, text) { $('pill').setAttribute('data-tone', tone); $('pill-text').textContent = text; }
  function status(text, tone) {
    var s = $('in-status');
    if (tone) s.setAttribute('data-tone', tone); else s.removeAttribute('data-tone');
    s.textContent = text || '';
  }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

  function kpi(box, label, value, note, tone) {
    var k = el('div', 'kpi');
    if (tone) k.setAttribute('data-tone', tone);
    k.appendChild(el('span', 'kpi__label', label));
    k.appendChild(el('span', 'kpi__value', String(value)));
    if (note) k.appendChild(el('span', 'kpi__note', note));
    box.appendChild(k);
  }

  function render(t) {
    var box = $('in-kpis');
    box.textContent = '';
    kpi(box, 'Consultas hoje', t.consultas, t.atendidas ? plural(t.atendidas, 'já atendida', 'já atendidas') : 'nenhuma atendida ainda', 'brand');
    kpi(box, 'Confirmadas', t.confirmadas, t.consultas ? Math.round(100 * t.confirmadas / t.consultas) + '% das consultas' : '');
    kpi(box, 'Aguardando', t.aguardando, 'na sala de espera');
    kpi(box, 'Em consulta', t.em_consulta, 'agora');
    box.hidden = false;

    var ul = $('in-prox');
    ul.textContent = '';
    if (!t.proximos.length) {
      ul.appendChild(el('li', 'todo__empty', t.consultas ? 'Nenhum paciente por chegar no resto do dia.' : 'Nenhuma consulta marcada para hoje.'));
      return;
    }
    t.proximos.forEach(function (p) {
      var li = el('li', 'todo__item');
      if (p.atrasado) li.setAttribute('data-late', 'true');
      var when = el('div', 'todo__when');
      when.appendChild(el('strong', null, p.hora));
      if (p.atrasado) when.appendChild(el('span', null, 'atrasado'));
      li.appendChild(when);
      var body = el('div', 'todo__body');
      body.appendChild(el('span', 'todo__who', p.nome));
      body.appendChild(el('span', 'todo__meta', p.prestador));
      li.appendChild(body);
      var seal = el('span', 'seal', p.selo.label);
      seal.setAttribute('data-tone', p.selo.tone);
      li.appendChild(seal);
      ul.appendChild(li);
    });
    if (t.mais) ul.appendChild(el('li', 'todo__empty', 'E mais ' + plural(t.mais, 'paciente', 'pacientes') + ' hoje: veja na Agenda.'));
  }

  // force = botão Atualizar: passa por cima do dia guardado em api.js.
  function load(force) {
    var s = ++seq, hoje = C.todayIso();
    $('in-dia').textContent = 'Hoje, ' + C.formatDay(hoje, true);
    status('Carregando a agenda de hoje…');
    $('in-refresh').disabled = true;
    function fim() { if (s === seq) $('in-refresh').disabled = false; }
    var pedido = sched ? Promise.resolve({ status: 200, body: sched }) : api.schedule();
    pedido.then(function (r) {
      if (s !== seq) return;
      if (r.status !== 200 || !r.body || !r.body.prestadores) {
        var st = C.connectionState(r.status, r.body);
        pill(st.tone === 'ok' ? 'err' : st.tone, st.pill);
        status(r.status === -1 || r.status === 401 ? st.text : C.readError(r.status, r.body), 'err');
        fim();
        return;
      }
      sched = r.body;
      pill('ok', 'Conectado');
      var profs = sched.prestadores.slice(0, MAX_PROF), corte = sched.prestadores.length > MAX_PROF;
      if (!profs.length) { render(C.todayOverview([], Date.now())); status('Nenhum profissional com agenda ' + C.sis('na') + '.'); fim(); return; }
      var cols = [], falhas = 0, ultima = null, agora = null, i = 0;
      (function lote() {
        if (s !== seq) return;
        var parte = profs.slice(i, i + 8);
        i += parte.length;
        api.columns(parte.map(function (p) { return { prest: p.id, day: hoje }; }), force).then(function (rs) {
          if (s !== seq) return;
          parte.forEach(function (p, j) {
            var x = rs[j];
            if (x && x.status === 200 && x.body) {
              cols.push({ prestador: p.nome, agendados: x.body.agendados });
              if (x.body.agora) agora = Date.parse(x.body.agora);
            } else { falhas++; ultima = x; }
          });
          render(C.todayOverview(cols, agora || Date.now()));
          if (i < profs.length) { status('Carregando ' + i + ' de ' + profs.length + ' profissionais…'); lote(); return; }
          fim();
          var hora = C.nowClock(new Date(agora || Date.now()));
          var aviso = corte ? ' Mostrando os ' + MAX_PROF + ' primeiros profissionais; a Agenda tem todos.' : '';
          if (falhas) {
            status(plural(falhas, 'profissional não carregou', 'profissionais não carregaram') + '. '
              + C.readError(ultima && ultima.status, ultima && ultima.body) + ' Clique em Atualizar para tentar de novo.' + aviso, falhas === profs.length ? 'err' : 'warn');
            return;
          }
          status('Hoje, ' + C.formatDay(hoje, true) + '. Atualizado às ' + hora + '.' + aviso);
        });
      })();
    });
  }

  // Busca de paciente: na tela única, abre a Agenda e busca lá (a ficha do paciente fica na Agenda).
  function buscar(ev) {
    ev.preventDefault();
    var txt = $('in-q').value.trim();
    if (!C.lookupsFrom(txt).length) { $('in-q-msg').textContent = 'Digite um CPF (11 números) ou um telefone com DDD.'; return; }
    $('in-q-msg').textContent = '';
    $('in-q').value = '';
    root.ClinFyHub.buscar(txt);
  }

  if (!omni) { pill('err', 'Fora do Kentro'); status('Abra esta tela dentro do Kentro.', 'err'); return; }
  omni.ready(function (ctx) {
    B.applyTheme(ctx && ctx.theme);
    omni.on('themeChanged', B.applyTheme);
    var hub = root.ClinFyHub;
    // Fora da tela única não há para onde ir: os atalhos somem.
    if (hub) {
      $('in-q-form').addEventListener('submit', buscar);
      Array.prototype.forEach.call($('in-atalhos').querySelectorAll('[data-aba]'), function (b) {
        b.addEventListener('click', function () { hub.mostrar(b.getAttribute('data-aba')); });
      });
    } else {
      $('in-q-form').hidden = true;
      $('in-atalhos').hidden = true;
    }
    $('in-refresh').addEventListener('click', function () { load(true); });
    // De volta à aba depois de um tempo: os números se atualizam sozinhos (o dia guardado vale 20 s).
    var carregadoEm = 0;
    document.addEventListener('clinfy:aba', function (ev) {
      if (api && ev.detail === 'inicio' && Date.now() - carregadoEm > 60000) { carregadoEm = Date.now(); load(false); }
    });
    root.AsaApi.load(omni, (ctx && ctx.config) || {}).then(function (a) {
      api = a;
      carregadoEm = Date.now();
      load(false);
    });
  });
})(this);
