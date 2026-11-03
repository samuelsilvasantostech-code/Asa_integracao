/* Página de implantação do Conector. Fala só com /admin/* deste mesmo endereço, com a chave de
   administrador digitada na tela. A chave fica só numa variável, nunca no armazenamento do navegador. */
(function () {
  'use strict';

  var TEXTOS = ['mensagem', 'confirmado', 'cancelado', 'remarcar', 'ja_respondido', 'indisponivel'];
  var ACOES = ['confirmar', 'remarcar', 'cancelar'];
  var ERROS = {
    NAO_AUTORIZADO: 'Chave de administrador recusada.',
    MUITAS_TENTATIVAS: 'Muitas tentativas com chave errada. Aguarde alguns minutos.',
    BANCO_NAO_CONFIGURADO: 'O Conector está sem banco de dados.',
    ID_INVALIDO: 'Cliente inválido.',
    TENANT_NAO_ENCONTRADO: 'Cliente não encontrado. Atualize a lista.',
    NOME_OBRIGATORIO: 'Informe o nome da clínica (até 120 caracteres).',
    INSTANCIA_INVALIDA: 'Instância inválida. Use o endereço da Kentro, ex.: clinica.atenderbem.com.',
    INSTALACAO_INVALIDA: 'O id da instalação é um número inteiro positivo.',
    INSTITUICAO_INVALIDA: 'A instituição da Asa é só número.',
    OBSERVACAO_INVALIDA: 'A observação passa de 1.000 caracteres.',
    NADA_PARA_ALTERAR: 'Nada para alterar.',
    INSTALACAO_JA_CADASTRADA: 'Esta instalação da Kentro já está ligada a outro cliente.',
    INSTITUICAO_DIVERGENTE: 'Este token é de outra instituição da Asa (diferente da cadastrada no vínculo).',
    ASA_CREDENCIAL_INVALIDA: 'A Asa recusou esse token. Confira se foi copiado inteiro.',
    CIFRA_NAO_CONFIGURADA: 'O Conector está sem a chave de cifra (ASA_CRED_KEY).',
    DADOS_INVALIDOS: 'Dados fora do formato.',
    URL_INVALIDA: 'URL inválida: só captura de webhook (https) em *.atenderbem.com ou *.kentro.com.br.',
    TENANT_NAO_DESLIGADO: 'Desligue o cliente antes de apagar o histórico.',
    CONFIRMACAO_NAO_CONFERE: 'O nome digitado não confere com o do cliente.'
  };

  var chave = '';
  var tenants = [], opcoes = null, atual = null, params = [];

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, texto) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texto != null) n.textContent = texto;
    return n;
  }
  function msg(id, tom, texto) {
    var n = $(id);
    if (tom) n.setAttribute('data-tom', tom); else n.removeAttribute('data-tom');
    n.textContent = texto || '';
  }
  function erroDe(r) {
    var e = r.body && r.body.erro;
    if (e && ERROS[e]) return ERROS[e];
    if (r.status === 0) return 'O Conector não respondeu.';
    return 'Não deu certo' + (e ? ' (' + e + ')' : '') + (r.status > 0 ? ' · HTTP ' + r.status : '') + '.';
  }
  function dataHora(v) {
    if (!v) return '—';
    var d = new Date(v);
    return isNaN(d) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }
  function linhas(v) { return v.split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean); }

  function chamar(metodo, caminho, corpo) {
    var opt = { method: metodo, headers: { 'x-admin-key': chave }, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' };
    if (corpo !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(corpo); }
    return fetch(caminho, opt).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (b) { return { status: r.status, body: b }; });
    }, function () { return { status: 0, body: null }; });
  }
  function rotaDo(id, resto) { return '/admin/tenants/' + encodeURIComponent(id) + (resto || ''); }

  /* ---------- segredo mostrado uma vez ---------- */
  function mostrarSegredo(alvo, titulo, valor) {
    var box = $(alvo);
    box.textContent = '';
    var s = el('div', 'segredo');
    s.setAttribute('role', 'alert');
    s.appendChild(el('strong', null, titulo));
    s.appendChild(el('p', null, 'Copie agora e guarde em lugar seguro: ela não aparece de novo e o Conector guarda só o hash.'));
    var linha = el('div', 'linha');
    var campo = el('input', 'segredo__valor');
    campo.readOnly = true;
    campo.value = valor;
    campo.setAttribute('aria-label', titulo);
    campo.addEventListener('focus', function () { campo.select(); });
    var copiar = el('button', 'btn', 'Copiar');
    copiar.type = 'button';
    copiar.addEventListener('click', function () {
      var ok = function () { copiar.textContent = 'Copiada'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(valor).then(ok, function () { campo.select(); });
      else { campo.select(); try { document.execCommand('copy'); ok(); } catch (e) { /* o usuário copia à mão */ } }
    });
    var ocultar = el('button', 'btn', 'Já copiei');
    ocultar.type = 'button';
    ocultar.addEventListener('click', function () { box.textContent = ''; });
    linha.appendChild(campo);
    linha.appendChild(copiar);
    linha.appendChild(ocultar);
    s.appendChild(linha);
    box.appendChild(s);
  }

  /* ---------- acesso ---------- */
  function entrar(ev) {
    ev.preventDefault();
    chave = $('admin-key').value.trim();
    $('admin-key').value = '';
    if (!chave) return;
    msg('m-acesso', null, 'Conferindo…');
    carregar().then(function (ok) {
      if (!ok) { chave = ''; return; }
      msg('m-acesso', 'ok', 'Chave aceita.');
      $('area').hidden = false;
      $('b-sair').hidden = false;
      $('b-entrar').hidden = true;
      $('admin-key').disabled = true;
    });
  }
  function sair() {
    chave = '';
    tenants = [];
    atual = null;
    $('lista').textContent = '';
    $('s-novo').textContent = '';
    $('s-chaves').textContent = '';
    $('area').hidden = true;
    $('detalhe').hidden = true;
    $('b-sair').hidden = true;
    $('b-entrar').hidden = false;
    $('admin-key').disabled = false;
    msg('m-acesso', null, 'Saiu. A chave foi esquecida por esta página.');
  }

  /* ---------- lista ---------- */
  function carregar() {
    return chamar('GET', '/admin/tenants').then(function (r) {
      if (r.status !== 200 || !r.body) {
        msg($('area').hidden ? 'm-acesso' : 'm-lista', 'err', erroDe(r));
        return false;
      }
      tenants = r.body.tenants || [];
      opcoes = r.body.opcoes || null;
      desenharLista();
      msg('m-lista', null, tenants.length ? '' : 'Nenhum cliente cadastrado.');
      if (atual) {
        var achado = tenants.filter(function (t) { return t.id === atual.id; })[0];
        if (achado) abrir(achado); else fechar();
      }
      return true;
    });
  }

  function situacao(t) {
    if (t.desligado_em && !t.ativo) return { tom: 'off', texto: 'Desligado em ' + dataHora(t.desligado_em) };
    return t.ativo ? { tom: 'ok', texto: 'Ativo' } : { tom: 'warn', texto: 'Inativo' };
  }
  function credencial(t) {
    if (!t.tem_credencial) return 'Sem token';
    var origem = t.credencial_origem === 'clinica' ? 'pela clínica' : t.credencial_origem === 'implantacao' ? 'pela implantação' : '';
    return 'Ok' + (origem ? ', ' + origem : '') + (t.credencial_gravada_em ? ' em ' + dataHora(t.credencial_gravada_em) : '');
  }

  function desenharLista() {
    var tb = $('lista');
    tb.textContent = '';
    tenants.forEach(function (t) {
      var tr = el('tr');
      var nome = el('td');
      nome.appendChild(el('strong', null, t.nome));
      if (t.observacao) nome.appendChild(el('div', 'sub', t.observacao));
      tr.appendChild(nome);
      var st = situacao(t);
      var td = el('td');
      td.appendChild(el('span', 'selo selo--' + st.tom, st.texto));
      tr.appendChild(td);
      tr.appendChild(el('td', t.tem_credencial ? null : 'falta', credencial(t)));
      tr.appendChild(el('td', null, t.asa_instituicao_id || '—'));
      tr.appendChild(el('td', null, (t.kentro_instancia || '—') + ' · ' + (t.kentro_instalacao_id != null ? '#' + t.kentro_instalacao_id : '—')));
      tr.appendChild(el('td', null, dataHora(t.ultimo_uso_em)));
      var acao = el('td');
      var b = el('button', 'btn', 'Abrir');
      b.type = 'button';
      b.setAttribute('aria-label', 'Abrir ' + t.nome);
      b.addEventListener('click', function () { abrir(t); $('detalhe').scrollIntoView({ behavior: 'smooth' }); $('h-detalhe').focus(); });
      acao.appendChild(b);
      tr.appendChild(acao);
      tb.appendChild(tr);
    });
  }

  /* ---------- novo cliente ---------- */
  function criar(ev) {
    ev.preventDefault();
    var corpo = { nome: $('n-nome').value, kentro_instancia: $('n-instancia').value, asa_instituicao_id: $('n-instituicao').value, implantado_por: $('n-por').value };
    msg('m-novo', null, 'Criando…');
    $('s-novo').textContent = '';
    chamar('POST', '/admin/tenants', corpo).then(function (r) {
      if (r.status !== 201 || !r.body) { msg('m-novo', 'err', erroDe(r)); return; }
      msg('m-novo', 'ok', 'Cliente "' + r.body.nome + '" criado.');
      mostrarSegredo('s-novo', 'Chave da instalação de ' + r.body.nome, r.body.chave_instalacao);
      $('f-novo').reset();
      carregar();
    });
  }

  /* ---------- detalhe ---------- */
  function fechar() {
    atual = null;
    $('detalhe').hidden = true;
  }

  function resumo(t) {
    var dl = $('resumo');
    dl.textContent = '';
    [
      ['Situação', situacao(t).texto],
      ['Credencial da Asa', credencial(t)],
      ['Último uso', dataHora(t.ultimo_uso_em)],
      ['Criado em', dataHora(t.criado_em) + (t.implantado_por ? ' por ' + t.implantado_por : '')],
      ['Chave da automação', t.tem_chave_automacao ? 'Gerada' : 'Não gerada'],
      ['URL de disparo', t.tem_disparo ? 'Cadastrada' : 'Não cadastrada']
    ].forEach(function (p) {
      dl.appendChild(el('dt', null, p[0]));
      dl.appendChild(el('dd', null, p[1]));
    });
  }

  function abrir(t) {
    var outro = !atual || atual.id !== t.id;
    atual = t;
    $('detalhe').hidden = false;
    $('h-detalhe').textContent = t.nome;
    $('h-detalhe').tabIndex = -1;
    resumo(t);
    $('v-nome').value = t.nome;
    $('v-instancia').value = t.kentro_instancia || '';
    $('v-instalacao').value = t.kentro_instalacao_id != null ? String(t.kentro_instalacao_id) : '';
    $('v-instituicao').value = t.asa_instituicao_id || '';
    $('v-obs').value = t.observacao || '';
    $('fin-on').checked = !!t.financeiro.ativo;
    $('fin-quem').value = t.financeiro.quem;
    $('d-url').value = t.disparo_url || '';
    preencherConfirmacao(t.confirmacao);
    var desligado = !t.ativo && !!t.desligado_em;
    $('f-desligar').hidden = desligado;
    $('f-historico').hidden = !desligado;
    if (outro) {
      ['m-vinculo', 'm-token', 'm-fin', 'm-conf', 'm-disparo', 'm-chaves', 'm-desligar', 'm-historico'].forEach(function (id) { msg(id, null, ''); });
      $('s-chaves').textContent = '';
      $('x-nome').value = '';
      $('h-nome').value = '';
      $('t-token').value = '';
    }
  }

  function salvarVinculo(ev) {
    ev.preventDefault();
    var corpo = { nome: $('v-nome').value, kentro_instancia: $('v-instancia').value, kentro_instalacao_id: $('v-instalacao').value.trim(), asa_instituicao_id: $('v-instituicao').value, observacao: $('v-obs').value };
    msg('m-vinculo', null, 'Salvando…');
    chamar('PATCH', rotaDo(atual.id), corpo).then(function (r) {
      if (r.status !== 200) { msg('m-vinculo', 'err', erroDe(r)); return; }
      msg('m-vinculo', 'ok', 'Vínculo salvo.');
      carregar();
    });
  }

  function salvarToken(ev) {
    ev.preventDefault();
    var token = $('t-token').value.trim();
    if (!token) return;
    msg('m-token', null, 'Validando na Asa…');
    chamar('PUT', rotaDo(atual.id, '/credencial'), { token: token }).then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.ok) { msg('m-token', 'err', erroDe(r)); return; }
      $('t-token').value = '';
      msg('m-token', 'ok', 'Token gravado. Instituição ' + (r.body.instituicao_id || '?') + ', ' + r.body.prestadores + ' prestador(es) com agenda online.');
      carregar();
    });
  }

  function salvarFinanceiro(ev) {
    ev.preventDefault();
    var cfg = { ativo: $('fin-on').checked, quem: $('fin-quem').value };
    if (cfg.ativo && !atual.financeiro.ativo && !window.confirm('Ligar o lançamento de cobrança para ' + atual.nome + '? A conta lançada não pode ser editada nem excluída pela Kentro.')) return;
    msg('m-fin', null, 'Salvando…');
    chamar('PUT', rotaDo(atual.id, '/financeiro'), { config: cfg }).then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.ok) { msg('m-fin', 'err', erroDe(r)); return; }
      var c = r.body.config;
      msg('m-fin', 'ok', c.ativo ? 'Salvo. Lançamento ligado para ' + (c.quem === 'todos' ? 'todos os atendentes.' : 'administradores.') + ' Quem estiver com o painel aberto precisa recarregar a Kentro.' : 'Salvo. Lançamento desligado.');
      carregar();
    });
  }

  /* ---------- confirmação ---------- */
  function desenharParams() {
    var lista = $('c-params');
    lista.textContent = '';
    var campos = (opcoes && opcoes.campos) || {};
    var max = (opcoes && opcoes.max_parametros) || 10;
    params.forEach(function (p, i) {
      var li = el('li', 'param');
      li.appendChild(el('span', 'param__n', '{{' + (i + 1) + '}}'));
      var sel = el('select');
      sel.setAttribute('aria-label', 'Variável ' + (i + 1));
      Object.keys(campos).forEach(function (k) {
        var o = el('option', null, campos[k]);
        o.value = k;
        sel.appendChild(o);
      });
      sel.value = p.campo;
      sel.addEventListener('change', function () { p.campo = sel.value; if (p.campo !== 'texto') delete p.texto; desenharParams(); });
      li.appendChild(sel);
      if (p.campo === 'texto') {
        var inp = el('input');
        inp.maxLength = 200;
        inp.value = p.texto || '';
        inp.placeholder = 'Texto fixo desta variável';
        inp.setAttribute('aria-label', 'Texto fixo da variável ' + (i + 1));
        inp.addEventListener('input', function () { p.texto = inp.value; });
        li.appendChild(inp);
      }
      var rm = el('button', 'btn', 'Remover');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remover a variável ' + (i + 1));
      rm.disabled = params.length === 1;
      rm.addEventListener('click', function () { params.splice(i, 1); desenharParams(); });
      li.appendChild(rm);
      lista.appendChild(li);
    });
    $('c-param-add').disabled = params.length >= max;
  }

  function canal() {
    var oficial = $('c-canal').value === 'oficial';
    $('c-sec-tpl').hidden = !oficial;
    $('c-wrap-mensagem').hidden = oficial;
  }

  function preencherConfirmacao(c) {
    $('c-on').checked = c.ativo;
    $('c-dias').value = String(c.dias_antes);
    $('c-canal').value = c.canal;
    $('c-sexta').checked = c.sexta_pega_segunda;
    $('c-teste').checked = c.teste.ativo;
    $('c-telefones').value = c.teste.telefones.join('\n');
    $('c-tpl-nome').value = c.template.nome;
    params = c.template.parametros.map(function (p) { return { campo: p.campo, texto: p.texto }; });
    TEXTOS.forEach(function (k) { $('c-t-' + k).value = c.textos[k]; });
    ACOES.forEach(function (a) { $('c-s-' + a).value = c.sinonimos[a].join('\n'); });
    var campos = (opcoes && opcoes.campos) || {};
    $('c-campos').textContent = 'Nos textos, use ' + Object.keys(campos).filter(function (k) { return k !== 'texto'; }).map(function (k) { return '{' + k + '}'; }).join(', ') + '.';
    desenharParams();
    canal();
  }

  function salvarConfirmacao(ev) {
    ev.preventDefault();
    // Parte do que está gravado: o que a tela não mostra (ex.: tamanho do lote) não muda.
    var c = JSON.parse(JSON.stringify(atual.confirmacao));
    c.ativo = $('c-on').checked;
    c.dias_antes = Number($('c-dias').value);
    c.canal = $('c-canal').value;
    c.sexta_pega_segunda = $('c-sexta').checked;
    c.teste = { ativo: $('c-teste').checked, telefones: linhas($('c-telefones').value) };
    c.template = { nome: $('c-tpl-nome').value, parametros: params.map(function (p) { return p.campo === 'texto' ? { campo: 'texto', texto: p.texto || '' } : { campo: p.campo }; }) };
    TEXTOS.forEach(function (k) { c.textos[k] = $('c-t-' + k).value; });
    ACOES.forEach(function (a) { c.sinonimos[a] = $('c-s-' + a).value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); });
    if (c.ativo && c.teste.ativo && !c.teste.telefones.length) { msg('m-conf', 'err', 'No modo teste, informe ao menos um telefone. Sem nenhum, nada é enviado.'); return; }
    if (c.canal === 'oficial' && c.template.parametros.some(function (p) { return p.campo === 'texto' && !p.texto.trim(); })) {
      msg('m-conf', 'err', 'Preencha o texto fixo das variáveis, ou troque o que vai nelas.');
      return;
    }
    msg('m-conf', null, 'Salvando…');
    chamar('PUT', rotaDo(atual.id, '/confirmacao'), { config: c }).then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.ok) { msg('m-conf', 'err', erroDe(r)); return; }
      var s = r.body.config;
      var descartados = c.teste.telefones.length - s.teste.telefones.length;
      msg('m-conf', 'ok', (s.ativo ? (s.teste.ativo ? 'Salvo. Lembretes ligados em modo teste.' : 'Salvo. Lembretes ligados para todos os pacientes.') : 'Salvo. Lembretes desligados.')
        + (descartados > 0 ? ' ' + descartados + ' telefone(s) fora do formato foram descartados.' : ''));
      carregar();
    });
  }

  /* ---------- disparo, chaves, saída ---------- */
  function salvarDisparo(ev) {
    ev.preventDefault();
    msg('m-disparo', null, 'Salvando…');
    chamar('PUT', rotaDo(atual.id, '/disparo'), { url: $('d-url').value.trim() }).then(function (r) {
      if (r.status !== 200) { msg('m-disparo', 'err', erroDe(r)); return; }
      msg('m-disparo', 'ok', r.body.disparo_url ? 'URL salva.' : 'URL removida.');
      carregar();
    });
  }

  function rotacionar() {
    if (!window.confirm('Gerar uma nova chave da instalação para ' + atual.nome + '? A atual para de funcionar na hora, até a nova ser colada na Kentro.')) return;
    msg('m-chaves', null, 'Gerando…');
    chamar('POST', rotaDo(atual.id, '/rotacionar-chave')).then(function (r) {
      if (r.status !== 200 || !r.body) { msg('m-chaves', 'err', erroDe(r)); return; }
      msg('m-chaves', 'ok', 'Nova chave da instalação gerada. Cole em apiKey na instalação da Kentro.');
      mostrarSegredo('s-chaves', 'Chave da instalação de ' + atual.nome, r.body.chave_instalacao);
    });
  }

  function chaveAutomacao() {
    if (atual.tem_chave_automacao && !window.confirm('Já existe uma chave da automação. Gerar outra invalida a atual no fluxo de confirmação. Continuar?')) return;
    msg('m-chaves', null, 'Gerando…');
    chamar('POST', rotaDo(atual.id, '/chave-automacao')).then(function (r) {
      if (r.status !== 200 || !r.body) { msg('m-chaves', 'err', erroDe(r)); return; }
      msg('m-chaves', 'ok', 'Chave da automação gerada. Use no header x-automation-key do fluxo de confirmação.');
      mostrarSegredo('s-chaves', 'Chave da automação de ' + atual.nome, r.body.chave_automacao);
      carregar();
    });
  }

  function desligar(ev) {
    ev.preventDefault();
    if ($('x-nome').value !== atual.nome) { msg('m-desligar', 'err', ERROS.CONFIRMACAO_NAO_CONFERE); return; }
    msg('m-desligar', null, 'Desligando…');
    chamar('POST', rotaDo(atual.id, '/desligar')).then(function (r) {
      if (r.status !== 200) { msg('m-desligar', 'err', erroDe(r)); return; }
      msg('m-desligar', 'ok', 'Cliente desligado.');
      $('x-nome').value = '';
      carregar();
    });
  }

  function apagarHistorico(ev) {
    ev.preventDefault();
    var nome = $('h-nome').value;
    if (nome !== atual.nome) { msg('m-historico', 'err', ERROS.CONFIRMACAO_NAO_CONFERE); return; }
    msg('m-historico', null, 'Apagando…');
    chamar('DELETE', rotaDo(atual.id, '/historico'), { confirmar: nome }).then(function (r) {
      if (r.status !== 200 || !r.body) { msg('m-historico', 'err', erroDe(r)); return; }
      var a = r.body.apagados || {};
      msg('m-historico', 'ok', 'Histórico apagado: ' + (a.agendamentos || 0) + ' agendamento(s), ' + (a.confirmacoes || 0) + ' confirmação(ões), ' + (a.cobrancas || 0) + ' cobrança(s).');
      $('h-nome').value = '';
    });
  }

  $('f-acesso').addEventListener('submit', entrar);
  $('b-sair').addEventListener('click', sair);
  $('b-atualizar').addEventListener('click', function () { msg('m-lista', null, 'Atualizando…'); carregar(); });
  $('b-fechar').addEventListener('click', fechar);
  $('f-novo').addEventListener('submit', criar);
  $('f-vinculo').addEventListener('submit', salvarVinculo);
  $('f-token').addEventListener('submit', salvarToken);
  $('f-fin').addEventListener('submit', salvarFinanceiro);
  $('f-conf').addEventListener('submit', salvarConfirmacao);
  $('c-canal').addEventListener('change', canal);
  $('c-param-add').addEventListener('click', function () { params.push({ campo: 'nome' }); desenharParams(); });
  $('f-disparo').addEventListener('submit', salvarDisparo);
  $('b-rotacionar').addEventListener('click', rotacionar);
  $('b-automacao').addEventListener('click', chaveAutomacao);
  $('f-desligar').addEventListener('submit', desligar);
  $('f-historico').addEventListener('submit', apagarHistorico);
})();
