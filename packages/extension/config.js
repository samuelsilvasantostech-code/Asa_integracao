/* Tela de conexão (Configurar ClinFy): a clínica escolhe o sistema de gestão (ERP) que usa e preenche o acesso
   que ele pede, ou pede um sistema que ainda não está na lista. Só no primeiro cadastro: trocar depois é com a
   implantação. Visível só para administradores. O financeiro aparece só para leitura (quem liga é a implantação). */
(function (root) {
  'use strict';

  var C = root.AsaCore, B = root.AsaBridge, omni = root.omni;
  var cfg = {}, api = null, sistemas = [];
  var OUTRO = '__outro__';

  // Na tela única (clinfy.html), os ids repetidos entre telas têm prefixo: o mapa vem de hub.js.
  var IDS = (root.ClinFyIds && root.ClinFyIds.config) || {};
  function $(id) { return document.getElementById(IDS[id] || id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function pill(tone, text) { $('pill').setAttribute('data-tone', tone); $('pill-text').textContent = text; }
  function msg(node, tone, text) { if (tone) node.setAttribute('data-tone', tone); else node.removeAttribute('data-tone'); node.textContent = text; }

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
      // Sem chave reconhecida, explica onde cadastrar. Com ela e sem credencial: o formulário de conexão.
      // Credencial já gravada: trocar é com a implantação (o Conector recusa sem a chave de admin).
      var semCredencial = temClinica && (r.body.conexao || r.body.asa) === 'credencial_ausente';
      $('key-help').hidden = !!temClinica;
      $('form').hidden = !semCredencial;
      $('token-locked').hidden = !temClinica || semCredencial;
      if (semCredencial) loadSystems(r.body.erp);
      if (temClinica && !semCredencial) loadFinance();
    });
  }

  /* ---------- sistemas (catálogo da Central de conectores) ---------- */
  function loadSystems(atual) {
    var sel = $('f-erp');
    sel.disabled = true;
    msg($('f-msg'), null, 'Carregando os sistemas…');
    api.connectors().then(function (r) {
      sel.disabled = false;
      sel.textContent = '';
      sistemas = r.status === 200 && r.body && r.body.conectores ? r.body.conectores : [];
      if (!sistemas.length) msg($('f-msg'), 'err', 'Não deu para carregar a lista de sistemas agora. Tente de novo em instantes.');
      else msg($('f-msg'), null, '');
      var vazio = el('option', null, 'Escolha o sistema');
      vazio.value = '';
      sel.appendChild(vazio);
      sistemas.forEach(function (s) {
        var o = el('option', null, s.nome);
        o.value = s.slug;
        sel.appendChild(o);
      });
      var outro = el('option', null, 'Outro / não encontrei');
      outro.value = OUTRO;
      sel.appendChild(outro);
      // A clínica nova nasce na Asa; só pré-seleciona se o sistema dela estiver na lista.
      sel.value = sistemas.some(function (s) { return s.slug === atual; }) ? atual : '';
      onSystemChange();
    });
  }

  // "a Asa", "o Feegow"; com 'ao': "à Asa", "ao Feegow"; com 'A': "A Asa".
  function com(s, forma) {
    var f = s && s.artigo === 'a', n = s ? s.nome : 'o sistema';
    if (forma === 'ao') return (f ? 'à ' : 'ao ') + n;
    if (forma === 'A') return (f ? 'A ' : 'O ') + n;
    return (f ? 'a ' : 'o ') + n;
  }

  function current() {
    var slug = $('f-erp').value;
    return sistemas.filter(function (s) { return s.slug === slug; })[0] || null;
  }

  // Um campo por item do conector: rótulo, tipo (segredo = senha) e a ajuda como dica.
  function onSystemChange() {
    var slug = $('f-erp').value;
    var box = $('f-campos');
    box.textContent = '';
    $('f-outro').hidden = slug !== OUTRO;
    $('f-save').textContent = slug === OUTRO ? 'Enviar pedido' : 'Testar e salvar';
    $('f-save').disabled = !slug;
    msg($('f-msg'), null, '');
    var s = current();
    if (!s) return;
    s.campos.forEach(function (f) {
      var lab = el('label', 'field');
      lab.appendChild(el('span', null, f.rotulo + (f.obrigatorio ? '' : ' (opcional)')));
      var inp = el('input');
      inp.type = f.tipo === 'segredo' ? 'password' : f.tipo === 'url' ? 'url' : 'text';
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      inp.maxLength = 4096;
      inp.setAttribute('data-chave', f.chave);
      if (f.obrigatorio) inp.required = true;
      lab.appendChild(inp);
      if (f.ajuda) lab.appendChild(el('span', 'hint', f.ajuda));
      box.appendChild(lab);
    });
  }

  // Resposta de POST /v1/conectores/ligar → mensagem. `s` = o sistema escolhido.
  function connectError(r, s) {
    var nome = com(s, 'A');
    var e = r.body && r.body.erro;
    var campo = r.body && r.body.campo;
    var rotulo = campo && current() ? (current().campos.filter(function (f) { return f.chave === campo; })[0] || {}).rotulo : null;
    if (e === 'CAMPO_OBRIGATORIO') return 'Preencha "' + (rotulo || campo) + '".';
    if (e === 'CAMPO_INVALIDO') return '"' + (rotulo || campo) + '" está fora do formato (sem espaços, no máximo 4.096 caracteres).';
    if (e === 'ERP_URL_INVALIDA') return '"' + (rotulo || 'Endereço') + '" precisa ser um endereço https público.';
    if (e === 'ERP_CREDENCIAL_INVALIDA' || e === 'ASA_CREDENCIAL_INVALIDA') return nome + ' recusou esse acesso. Confira se foi copiado inteiro, sem espaços.';
    if (e === 'ERP_FORA_DO_AR' || e === 'ASA_FORA_DO_AR') return nome + ' não respondeu agora' + (r.body && r.body.msg ? ' (' + r.body.msg + ')' : '') + '. Tente de novo em instantes.';
    if (e === 'ERP_NAO_ENCONTRADO') return 'O endereço respondeu, mas não como ' + com(s, 'a') + ' (confira o endereço da API).';
    if (e === 'ERP_RECUSOU') return nome + ' recusou: ' + ((r.body && r.body.msg) || 'sem detalhe') + '.';
    if (e === 'ERP_INVALIDO') return 'Este sistema não está mais disponível. Recarregue a tela.';
    if (e === 'CREDENCIAL_JA_CADASTRADA') return 'Esta clínica já tem um acesso cadastrado. Para trocar, fale com a implantação.';
    return C.credentialSaveState(r.status, r.body).text;
  }

  function save(ev) {
    ev.preventDefault();
    var slug = $('f-erp').value;
    if (!slug) return;
    if (slug === OUTRO) { sendRequest(); return; }
    var s = current();
    var cred = {};
    var falta = null;
    Array.prototype.forEach.call($('f-campos').querySelectorAll('input[data-chave]'), function (i) {
      var v = i.value.trim();
      if (v) cred[i.getAttribute('data-chave')] = v;
      else if (i.required && !falta) falta = i;
    });
    if (falta) { msg($('f-msg'), 'err', 'Preencha "' + falta.parentNode.firstChild.textContent + '".'); falta.focus(); return; }
    $('f-save').disabled = true;
    msg($('f-msg'), null, 'Testando a conexão com ' + com(s, 'a') + '… pode levar alguns segundos.');
    api.connect(slug, cred).then(function (r) {
      $('f-save').disabled = false;
      if (r.status === 200 && r.body && r.body.ok) {
        Array.prototype.forEach.call($('f-campos').querySelectorAll('input'), function (i) { i.value = ''; });
        var n = r.body.prestadores;
        msg($('f-msg'), 'ok', 'Conectado ' + com(s, 'ao') + (n != null ? ': ' + n + ' profissional(is) encontrado(s)' : '') + '. Recarregue a Kentro para as telas usarem o sistema novo.');
        refresh();
        return;
      }
      msg($('f-msg'), 'err', connectError(r, s));
    });
  }

  function sendRequest() {
    var sistema = $('f-sistema').value.trim();
    if (sistema.length < 2) { msg($('f-msg'), 'err', 'Informe o nome do sistema.'); $('f-sistema').focus(); return; }
    $('f-save').disabled = true;
    msg($('f-msg'), null, 'Enviando o pedido…');
    api.requestSystem({ sistema: sistema, contato: $('f-contato').value.trim(), observacao: $('f-obs').value.trim() }).then(function (r) {
      $('f-save').disabled = false;
      if (r.status === 201) {
        $('f-sistema').value = ''; $('f-contato').value = ''; $('f-obs').value = '';
        msg($('f-msg'), 'ok', 'Pedido enviado. A equipe da Kentro prepara a conexão com ' + sistema + ' e avisa quando estiver pronta.');
        return;
      }
      var e = r.body && r.body.erro;
      msg($('f-msg'), 'err', e === 'MUITOS_PEDIDOS' ? 'Esta clínica já tem pedidos em aberto. Aguarde o retorno da implantação.' : e === 'SISTEMA_INVALIDO' ? 'Informe o nome do sistema (2 a 80 caracteres).' : 'Não deu para enviar agora' + (r.status > 0 ? ' (HTTP ' + r.status + ')' : '') + '. Tente de novo.');
    });
  }

  /* ---------- financeiro (só leitura: quem liga e desliga é a implantação) ---------- */
  function loadFinance() {
    api.financeConfig().then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.config) { $('fin').hidden = true; return; }
      $('fin').hidden = false;
      $('fin-on').checked = r.body.config.ativo;
      $('fin-who').value = r.body.config.quem;
    });
  }

  if (!omni) { pill('err', 'Fora do Kentro'); msg($('conn-text'), 'err', 'Abra esta tela dentro do Kentro.'); return; }
  omni.ready(function (ctx) {
    cfg = (ctx && ctx.config) || {};
    B.applyTheme(ctx && ctx.theme);
    omni.on('themeChanged', B.applyTheme);
    $('form').addEventListener('submit', save);
    $('f-erp').addEventListener('change', onSystemChange);
    connect().then(refresh);
  });
})(this);
