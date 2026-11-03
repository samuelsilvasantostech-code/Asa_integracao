/* Tela da confirmação de véspera: aberta a administradores, supervisores e atendentes. Só leitura desde a
   0.19.0: quem altera é a implantação (o Conector recusa gravar com a chave da instalação). A prévia vem do
   Conector, para não duplicar as regras. */
(function (root) {
  'use strict';

  var C = root.AsaCore, B = root.AsaBridge, omni = root.omni;
  var TEXTS = ['mensagem', 'confirmado', 'cancelado', 'remarcar', 'ja_respondido', 'indisponivel'];
  var ACTIONS = ['confirmar', 'remarcar', 'cancelar'];
  // Na resposta o Conector só tem o que guardou da consulta.
  var IN_REPLY = ['nome', 'data', 'data_curta', 'dia_semana', 'hora', 'profissional', 'clinica'];
  var api = null, saved = null, fields = {}, params = [], previewSeq = 0;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pill(tone, text) { $('pill').setAttribute('data-tone', tone); $('pill-text').textContent = text; }
  function msg(node, tone, text) { if (tone) node.setAttribute('data-tone', tone); else node.removeAttribute('data-tone'); node.textContent = text; }

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
      sel.disabled = true;
      li.appendChild(sel);
      if (p.campo === 'texto') {
        var inp = el('input');
        inp.maxLength = 200;
        inp.value = p.texto || '';
        inp.placeholder = 'Texto que vai nesta variável';
        inp.setAttribute('aria-label', 'Texto fixo da variável ' + (i + 1));
        inp.readOnly = true;
        li.appendChild(inp);
      }
      li.appendChild(el('span', 'param__ex', ''));
      list.appendChild(li);
    });
  }

  function renderChannel() {
    var official = $('rem-channel').value === 'oficial';
    $('sec-tpl').hidden = !official;
    $('sec-msg').hidden = official;
  }

  /* ---------- ler (só leitura) ---------- */
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
    ACTIONS.forEach(function (a) { $('syn-' + a).value = c.sinonimos[a].join('\n'); });
    renderParams();
    renderChannel();
    statePill(c);
    // Nada aqui é editável: a configuração muda pela implantação.
    Array.prototype.forEach.call($('rem').querySelectorAll('input, select, textarea'), function (n) {
      if (n.tagName === 'SELECT' || n.type === 'checkbox') n.disabled = true; else n.readOnly = true;
    });
  }

  // Prévia com uma consulta de exemplo, calculada pelo Conector com as regras de verdade.
  function preview() {
    if (!saved) return;
    var s = ++previewSeq;
    api.previewReminder(saved).then(function (r) {
      if (s !== previewSeq || r.status !== 200 || !r.body) return;
      Array.prototype.forEach.call(document.querySelectorAll('[data-preview]'), function (n) {
        n.textContent = r.body.textos[n.getAttribute('data-preview')] || '';
      });
      Array.prototype.forEach.call(document.querySelectorAll('.param__ex'), function (n, i) {
        n.textContent = r.body.template[i] != null ? r.body.template[i] : '';
      });
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
    $('rem').addEventListener('submit', function (ev) { ev.preventDefault(); });
    root.AsaApi.load(omni, (ctx && ctx.config) || {}).then(function (a) { api = a; load(); });
  });
})(this);
