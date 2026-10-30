/* Tela da confirmação de véspera: aberta a administradores, supervisores e atendentes.
   O Conector valida tudo de novo ao gravar; a prévia também vem dele, para não duplicar as regras. */
(function (root) {
  'use strict';

  var C = root.AsaCore, B = root.AsaBridge, omni = root.omni;
  var TEXTS = ['mensagem', 'confirmado', 'cancelado', 'remarcar', 'ja_respondido', 'indisponivel'];
  var ACTIONS = ['confirmar', 'remarcar', 'cancelar'];
  // Na resposta o Conector só tem o que guardou da consulta.
  var IN_REPLY = ['nome', 'data', 'data_curta', 'dia_semana', 'hora', 'profissional', 'clinica'];
  var api = null, saved = null, fields = {}, maxParams = 10, params = [], userLabel = '', previewTimer = null, previewSeq = 0;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pill(tone, text) { $('pill').setAttribute('data-tone', tone); $('pill-text').textContent = text; }
  function msg(node, tone, text) { if (tone) node.setAttribute('data-tone', tone); else node.removeAttribute('data-tone'); node.textContent = text; }
  function words(v) { return v.split(',').map(function (s) { return s.trim(); }).filter(Boolean); }

  function statePill(c) {
    if (!c.ativo) pill('idle', 'Desligada');
    else if (c.teste.ativo) pill('warn', 'Em teste');
    else pill('ok', 'Ligada');
  }

  /* ---------- variáveis do template ---------- */
  function renderParams() {
    var list = $('tpl-params');
    list.textContent = '';
    params.forEach(function (p, i) {
      var li = el('li', 'param');
      li.appendChild(el('span', 'param__n', '{{' + (i + 1) + '}}'));
      var sel = el('select');
      sel.setAttribute('aria-label', 'Variável ' + (i + 1));
      Object.keys(fields).forEach(function (k) {
        var o = el('option', null, fields[k]);
        o.value = k;
        sel.appendChild(o);
      });
      sel.value = p.campo;
      sel.addEventListener('change', function () { p.campo = sel.value; if (p.campo !== 'texto') delete p.texto; renderParams(); schedulePreview(); });
      li.appendChild(sel);
      if (p.campo === 'texto') {
        var inp = el('input');
        inp.maxLength = 200;
        inp.value = p.texto || '';
        inp.placeholder = 'Texto que vai nesta variável';
        inp.setAttribute('aria-label', 'Texto fixo da variável ' + (i + 1));
        inp.addEventListener('input', function () { p.texto = inp.value; schedulePreview(); });
        li.appendChild(inp);
      }
      li.appendChild(el('span', 'param__ex', ''));
      var rm = el('button', 'btn btn--icon', '×');
      rm.type = 'button';
      rm.title = 'Remover a variável ' + (i + 1);
      rm.disabled = params.length === 1;
      rm.addEventListener('click', function () { params.splice(i, 1); renderParams(); schedulePreview(); });
      li.appendChild(rm);
      list.appendChild(li);
    });
    $('tpl-add').disabled = params.length >= maxParams;
  }

  function renderChannel() {
    var official = $('rem-channel').value === 'oficial';
    $('sec-tpl').hidden = !official;
    $('sec-msg').hidden = official;
    $('rem-fri-wrap').hidden = $('rem-days').value !== '1';
  }

  /* ---------- ler e gravar ---------- */
  function fill(c) {
    $('rem-on').checked = c.ativo;
    $('rem-days').value = String(c.dias_antes);
    $('rem-channel').value = c.canal;
    $('rem-fri').checked = c.sexta_pega_segunda;
    $('rem-test').checked = c.teste.ativo;
    $('rem-phones').value = c.teste.telefones.map(C.formatPhone).join('\n');
    $('tpl-name').value = c.template.nome;
    params = c.template.parametros.map(function (p) { return { campo: p.campo, texto: p.texto }; });
    TEXTS.forEach(function (k) { $('rem-t-' + k).value = c.textos[k]; });
    ACTIONS.forEach(function (a) { $('syn-' + a).value = c.sinonimos[a].join(', '); });
    renderParams();
    renderChannel();
    statePill(c);
  }

  function collect() {
    var c = JSON.parse(JSON.stringify(saved));
    c.ativo = $('rem-on').checked;
    c.dias_antes = Number($('rem-days').value);
    c.canal = $('rem-channel').value;
    c.sexta_pega_segunda = $('rem-fri').checked;
    c.teste = { ativo: $('rem-test').checked, telefones: $('rem-phones').value.split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean) };
    c.template = { nome: $('tpl-name').value, parametros: params.map(function (p) { return p.campo === 'texto' ? { campo: 'texto', texto: p.texto || '' } : { campo: p.campo }; }) };
    TEXTS.forEach(function (k) { c.textos[k] = $('rem-t-' + k).value; });
    ACTIONS.forEach(function (a) { c.sinonimos[a] = words($('syn-' + a).value); });
    return c;
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(preview, 350);
  }

  // Prévia com uma consulta de exemplo, calculada pelo Conector com as regras de verdade.
  function preview() {
    if (!saved) return;
    var s = ++previewSeq;
    api.previewReminder(collect()).then(function (r) {
      if (s !== previewSeq || r.status !== 200 || !r.body) return;
      Array.prototype.forEach.call(document.querySelectorAll('[data-preview]'), function (n) {
        n.textContent = r.body.textos[n.getAttribute('data-preview')] || '';
      });
      Array.prototype.forEach.call(document.querySelectorAll('.param__ex'), function (n, i) {
        n.textContent = r.body.template[i] != null ? r.body.template[i] : '';
      });
    });
  }

  function save(ev) {
    ev.preventDefault();
    var next = collect();
    if (next.ativo && next.teste.ativo && !next.teste.telefones.length) {
      msg($('rem-msg'), 'err', 'No modo teste, informe ao menos um telefone. Sem nenhum, nada é enviado.');
      $('rem-phones').focus();
      return;
    }
    var empty = next.template.parametros.filter(function (p) { return p.campo === 'texto' && !p.texto.trim(); }).length;
    if (next.canal === 'oficial' && empty) {
      msg($('rem-msg'), 'err', 'Preencha o texto fixo das variáveis, ou troque o que vai nelas.');
      return;
    }
    $('rem-save').disabled = true;
    msg($('rem-msg'), null, 'Salvando…');
    api.saveReminderConfig(next, userLabel).then(function (r) {
      $('rem-save').disabled = false;
      if (r.status !== 200 || !r.body || !r.body.ok) { msg($('rem-msg'), 'err', 'Não foi possível salvar agora' + (r.status > 0 ? ' (HTTP ' + r.status + ').' : '.')); return; }
      saved = r.body.config;
      var ignored = next.teste.telefones.length - saved.teste.telefones.length;
      fill(saved);
      preview();
      msg($('rem-msg'), 'ok', (saved.ativo ? (saved.teste.ativo ? 'Salvo. Lembretes ligados em modo teste.' : 'Salvo. Lembretes ligados para todos os pacientes.') : 'Salvo. Lembretes desligados.')
        + (ignored > 0 ? ' ' + ignored + ' telefone(s) fora do formato foram descartados.' : ''));
    });
  }

  function load() {
    api.reminderConfig().then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.config) {
        var st = C.connectionState(r.status, r.body);
        pill(st.tone === 'ok' ? 'err' : st.tone, st.pill);
        msg($('conn-text'), 'err', r.status === 0 || r.status >= 500 ? 'O Conector não respondeu. Tente de novo em instantes.' : st.text);
        return;
      }
      saved = r.body.config;
      fields = r.body.campos || {};
      maxParams = r.body.max_parametros || 10;
      $('conn-text').hidden = true;
      $('rem').hidden = false;
      $('rem-auto').hidden = !!r.body.automacao_configurada;
      var all = Object.keys(fields).filter(function (k) { return k !== 'texto'; });
      $('rem-fields').textContent = 'Nos textos, use ' + all.map(function (k) { return '{' + k + '}'; }).join(', ') + '. Nas respostas, só ' + IN_REPLY.map(function (k) { return '{' + k + '}'; }).join(', ') + ' têm valor; os outros ficam vazios.';
      fill(saved);
      preview();
    });
  }

  if (!omni) { pill('err', 'Fora do Kentro'); msg($('conn-text'), 'err', 'Abra esta tela dentro do Kentro.'); return; }
  omni.ready(function (ctx) {
    B.applyTheme(ctx && ctx.theme);
    omni.on('themeChanged', B.applyTheme);
    if (omni.session && omni.session.getUser) {
      Promise.resolve(omni.session.getUser()).then(function (u) {
        if (u) userLabel = [u.id, u.name || u.username].filter(Boolean).join(' ');
      }).catch(function () { /* sem usuário: a trilha fica sem nome */ });
    }
    $('rem').addEventListener('submit', save);
    $('rem').addEventListener('input', schedulePreview);
    $('rem-channel').addEventListener('change', renderChannel);
    $('rem-days').addEventListener('change', renderChannel);
    $('tpl-add').addEventListener('click', function () {
      if (params.length >= maxParams) return;
      params.push({ campo: 'nome' });
      renderParams();
      schedulePreview();
    });
    root.AsaApi.load(omni, (ctx && ctx.config) || {}).then(function (a) { api = a; load(); });
  });
})(this);
