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
    CONFIRMACAO_NAO_CONFERE: 'O nome digitado não confere com o do cliente.',
    ERP_INVALIDO: 'ERP inválido.',
    ERP_URL_INVALIDA: 'Endereço da API inválido: só https, sem usuário e senha, e nunca um endereço interno.',
    ERP_CREDENCIAL_INVALIDA: 'O ERP recusou o token.',
    ERP_FORA_DO_AR: 'O ERP não respondeu (fora do ar, endereço errado ou bloqueio de rede).',
    ERP_RECUSOU: 'O ERP recusou o pedido.',
    ERP_NAO_ENCONTRADO: 'O endereço respondeu, mas sem as rotas da especificação (confira o caminho, ex.: /api/v1).',
    ERP_RESPOSTA_INVALIDA: 'O ERP respondeu fora do formato da especificação.',
    ERP_SEM_FINANCEIRO: 'O ERP desta clínica não tem as rotas de conta a receber. Teste a conexão de novo se elas foram criadas.',
    ERP_SEM_CONFIRMACAO: 'O ERP desta clínica não tem as rotas de confirmação. Teste a conexão de novo se elas foram criadas.',
    SISTEMA_INVALIDO: 'Nome do sistema: até 40 caracteres; letras, números, espaço, ponto, &, apóstrofo e hífen.',
    ARTIGO_INVALIDO: 'Artigo inválido.',
    SLUG_INVALIDO: 'Identificador inválido: letras minúsculas, dígitos e hífen, começando por letra.',
    SLUG_JA_EXISTE: 'Já existe um conector com esse identificador.',
    CONECTOR_NAO_ENCONTRADO: 'Conector não encontrado. Atualize a Central.',
    CONECTOR_EM_CODIGO: 'Este conector é um adaptador em código: a configuração não se edita aqui.',
    CONFIG_INVALIDA: 'A configuração tem problemas.',
    CONECTOR_SEM_CONFIG: 'Salve uma configuração antes de mudar a situação ou testar.',
    CONECTOR_EM_USO: 'Há clínicas ativas usando este conector: troque o sistema delas antes.',
    CAMPO_OBRIGATORIO: 'Falta preencher um campo obrigatório.',
    CAMPO_INVALIDO: 'Um campo está fora do formato (segredos não podem ter espaço).',
    ARQUIVO_GRANDE_DEMAIS: 'O arquivo passa de 10 MB.',
    DOCUMENTO_NAO_ENCONTRADO: 'Documento não encontrado.',
    PEDIDO_NAO_ENCONTRADO: 'Pedido não encontrado.',
    ERP_CONECTOR_INVALIDO: 'A configuração do conector falhou ao montar a chamada.'
  };
  var NOMES_ERP = { asa: 'Asa Saúde', padrao: 'Padrão Kentro' };
  var NOMES_CAPS = { financeiro: 'Lançar cobrança', confirmacao: 'Confirmação pelo WhatsApp', grupos_exames: 'Grupos de procedimentos' };

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
      carregarConectores();
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
    $('cx-detalhe').hidden = true;
    conectores = []; pedidos = []; conectorAtual = null;
    $('cx-lista').textContent = '';
    $('cx-pedidos').textContent = '';
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
      ['ERP', (NOMES_ERP[t.erp] || t.erp) + (t.sistema_nome ? ' · nas telas: ' + t.sistema_nome : '')],
      ['Credencial do ERP', credencial(t)],
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
    preencherSelectErp();
    $('e-erp').value = t.erp || 'asa';
    $('e-nome').value = t.sistema_nome || '';
    $('e-artigo').value = t.sistema_artigo === 'o' ? 'o' : 'a';
    trocarErp();
    mostrarCapacidades(t.erp_capacidades, t.erp_testado_em);
    var desligado = !t.ativo && !!t.desligado_em;
    $('f-desligar').hidden = desligado;
    $('f-historico').hidden = !desligado;
    if (outro) {
      ['m-erp', 'm-vinculo', 'm-token', 'm-fin', 'm-conf', 'm-disparo', 'm-chaves', 'm-desligar', 'm-historico'].forEach(function (id) { msg(id, null, ''); });
      $('s-chaves').textContent = '';
      $('x-nome').value = '';
      $('h-nome').value = '';
      $('t-token').value = '';
    }
  }

  /* ---------- sistema da clínica (ERP) ---------- */
  // Os campos de acesso vêm do conector escolhido (Central). O bloco "Token da Asa" só aparece para clínica que
  // JÁ está na Asa: na Asa, o token tem rota própria.
  var conectores = [], pedidos = [], camposCache = {};

  function camposDoConector(slug) {
    if (camposCache[slug]) return Promise.resolve(camposCache[slug]);
    return chamar('GET', '/admin/conectores/' + encodeURIComponent(slug)).then(function (r) {
      var campos = r.status === 200 && r.body && r.body.campos ? r.body.campos : [];
      camposCache[slug] = campos;
      return campos;
    });
  }

  // Um campo por item: rótulo, tipo (segredo = senha) e ajuda. data-chave guarda o nome do campo.
  function montarCampos(caixa, campos, prefixo) {
    caixa.textContent = '';
    campos.forEach(function (f) {
      var lab = el('label', 'campo' + (f.tipo === 'url' ? ' campo--largo' : ''));
      lab.appendChild(el('span', null, f.rotulo + (f.obrigatorio ? '' : ' (opcional)')));
      var inp = el('input');
      inp.id = prefixo + f.chave;
      inp.type = f.tipo === 'segredo' ? 'password' : f.tipo === 'url' ? 'url' : 'text';
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      inp.maxLength = 4096;
      inp.setAttribute('data-chave', f.chave);
      if (f.ajuda) inp.placeholder = f.ajuda;
      lab.appendChild(inp);
      caixa.appendChild(lab);
    });
    caixa.hidden = !campos.length;
  }

  function lerCampos(caixa) {
    var out = {};
    Array.prototype.forEach.call(caixa.querySelectorAll('input[data-chave]'), function (i) {
      if (i.value.trim()) out[i.getAttribute('data-chave')] = i.value.trim();
    });
    return out;
  }

  function preencherSelectErp() {
    var sel = $('e-erp');
    var valor = sel.value || (atual && atual.erp) || 'asa';
    sel.textContent = '';
    var usaveis = conectores.filter(function (c) { return c.situacao === 'publicado' || c.situacao === 'homologacao' || (atual && c.slug === atual.erp); });
    if (!usaveis.length) usaveis = [{ slug: 'asa', nome: 'Asa', situacao: 'publicado' }, { slug: 'padrao', nome: 'sistema da clínica', situacao: 'publicado' }];
    usaveis.forEach(function (c) {
      var nome = c.slug === 'padrao' ? 'Sistema próprio (padrão Kentro)' : c.nome;
      var o = el('option', null, nome + (c.situacao === 'homologacao' ? ' · em homologação' : ''));
      o.value = c.slug;
      sel.appendChild(o);
    });
    sel.value = valor;
  }

  function trocarErp() {
    var erp = $('e-erp').value;
    $('f-token').hidden = !atual || (atual.erp || 'asa') !== 'asa';
    if (erp === 'asa') { montarCampos($('e-campos'), [], 'e-c-'); return; }
    camposDoConector(erp).then(function (campos) { if ($('e-erp').value === erp) montarCampos($('e-campos'), campos, 'e-c-'); });
  }

  function mostrarCapacidades(caps, testadoEm) {
    var dl = $('e-caps');
    dl.textContent = '';
    dl.appendChild(el('dt', null, 'Último teste'));
    dl.appendChild(el('dd', null, testadoEm ? dataHora(testadoEm) : 'Ainda não testado'));
    if (!caps) return;
    Object.keys(NOMES_CAPS).forEach(function (k) {
      dl.appendChild(el('dt', null, NOMES_CAPS[k]));
      dl.appendChild(el('dd', caps[k] ? null : 'falta', caps[k] ? 'Disponível' : 'O ERP não tem'));
    });
  }

  function salvarErp(ev) {
    ev.preventDefault();
    var erp = $('e-erp').value, eraErp = atual.erp || 'asa';
    var cred = lerCampos($('e-campos'));
    var temCred = Object.keys(cred).length > 0;
    if (erp !== 'asa' && erp !== eraErp && !temCred) { msg('m-erp', 'err', 'Para trocar de sistema, preencha os campos de acesso.'); return; }
    if (erp === 'asa' && eraErp !== 'asa' && !window.confirm('Voltar ' + atual.nome + ' para a Asa? A credencial do sistema atual é apagada e o token da Asa precisa ser cadastrado de novo.')) return;
    msg('m-erp', null, 'Salvando…');
    // 1) nome nas telas; 2) troca de sistema ou nova credencial, quando houver.
    chamar('PATCH', rotaDo(atual.id), { sistema_nome: $('e-nome').value, sistema_artigo: $('e-artigo').value }).then(function (r) {
      if (r.status !== 200) { msg('m-erp', 'err', erroDe(r)); return null; }
      if (erp !== 'asa' && temCred) {
        msg('m-erp', null, 'Testando a conexão com o sistema…');
        return chamar('PUT', rotaDo(atual.id, '/erp'), { erp: erp, credencial: cred });
      }
      if (erp === 'asa' && eraErp !== 'asa') return chamar('PUT', rotaDo(atual.id, '/erp'), { erp: 'asa' });
      return { status: 200, body: { ok: true, soNome: true } };
    }).then(function (r) {
      if (!r) return;
      if (r.status !== 200 || !r.body || !r.body.ok) {
        var extra = (r.body && r.body.campo ? ' Campo: ' + r.body.campo + '.' : '') + (r.body && r.body.msg ? ' Resposta do sistema: ' + r.body.msg : '');
        msg('m-erp', 'err', erroDe(r) + extra);
        return;
      }
      Array.prototype.forEach.call($('e-campos').querySelectorAll('input'), function (i) { i.value = ''; });
      if (r.body.soNome) msg('m-erp', 'ok', 'Nome nas telas salvo.');
      else if (r.body.erp === 'asa') msg('m-erp', 'ok', 'Clínica de volta à Asa. Cadastre o token da Asa abaixo (ou pela tela Configurar ClinFy).');
      else {
        msg('m-erp', 'ok', 'Sistema ligado: a conexão funcionou e ele listou ' + r.body.prestadores + ' profissional(is).');
        mostrarCapacidades(r.body.capacidades, new Date().toISOString());
      }
      carregar();
    });
  }

  function testarErp() {
    msg('m-erp', null, 'Testando a conexão…');
    chamar('POST', rotaDo(atual.id, '/erp/testar')).then(function (r) {
      if (r.status !== 200 || !r.body) { msg('m-erp', 'err', erroDe(r)); return; }
      var b = r.body;
      if (!b.ok) {
        var porque = b.conexao === 'credencial_ausente' ? 'não há credencial cadastrada.' : b.conexao === 'credencial_invalida' ? 'o sistema recusou a credencial.' : 'o sistema não respondeu.';
        msg('m-erp', 'err', 'Sem conexão: ' + porque + (b.msg ? ' (' + b.msg + ')' : ''));
        return;
      }
      msg('m-erp', 'ok', 'Conexão ok: ' + b.prestadores + ' profissional(is). O que o sistema suporta foi atualizado.');
      mostrarCapacidades(b.capacidades, new Date().toISOString());
      carregar();
    });
  }

  /* ---------- Central de conectores ---------- */
  var SITUACOES = { rascunho: { tom: 'off', texto: 'Rascunho' }, homologacao: { tom: 'warn', texto: 'Homologação' }, publicado: { tom: 'ok', texto: 'Publicado' }, arquivado: { tom: 'off', texto: 'Arquivado' } };
  var PEDIDOS = { aberto: 'Aberto', em_andamento: 'Em andamento', atendido: 'Atendido', recusado: 'Recusado' };
  var conectorAtual = null, pedidoAtual = null;
  // Ponto de partida de um rascunho: o motor só aceita rotas da especificação (ver a lista no detalhe).
  var MODELO_CONECTOR = {
    versao: 1,
    base_url: 'https://api.exemplo.com/v1',
    autenticacao: { tipo: 'bearer', campo: 'token' },
    campos: [{ chave: 'token', rotulo: 'Token da API', tipo: 'segredo', obrigatorio: true }],
    rotas: {},
    erros: { mensagem: '{{$.message}}' }
  };

  function carregarConectores() {
    return chamar('GET', '/admin/conectores').then(function (r) {
      if (r.status !== 200 || !r.body) { msg('m-cx', 'err', erroDe(r)); return; }
      conectores = r.body.conectores || [];
      pedidos = r.body.pedidos || [];
      camposCache = {};
      msg('m-cx', null, '');
      desenharCentral();
      preencherSelectErp();
      if (atual) trocarErp();
    });
  }

  function selo(tom, texto) { return el('span', 'selo selo--' + tom, texto); }
  function botao(texto, rotulo, acao) {
    var b = el('button', 'btn', texto);
    b.type = 'button';
    if (rotulo) b.setAttribute('aria-label', rotulo);
    b.addEventListener('click', acao);
    return b;
  }

  function desenharCentral() {
    var tb = $('cx-lista');
    tb.textContent = '';
    conectores.forEach(function (c) {
      var tr = el('tr');
      var nome = el('td');
      nome.appendChild(el('strong', null, c.slug === 'padrao' ? 'Sistema próprio (padrão Kentro)' : c.nome));
      nome.appendChild(el('div', 'sub', c.slug + (c.tipo === 'codigo' ? ' · adaptador em código' : '')));
      tr.appendChild(nome);
      var st = SITUACOES[c.situacao] || { tom: 'off', texto: c.situacao };
      var td = el('td');
      td.appendChild(selo(st.tom, st.texto));
      tr.appendChild(td);
      tr.appendChild(el('td', null, 'v' + c.versao));
      tr.appendChild(el('td', null, String(c.documentos)));
      tr.appendChild(el('td', null, String(c.clinicas)));
      var acao = el('td');
      acao.appendChild(botao('Abrir', 'Abrir o conector ' + c.nome, function () { abrirConector(c.slug); }));
      tr.appendChild(acao);
      tb.appendChild(tr);
    });
    var tp = $('cx-pedidos');
    tp.textContent = '';
    if (!pedidos.length) {
      var vazio = el('tr');
      var td0 = el('td', 'sub', 'Nenhum pedido.');
      td0.colSpan = 6;
      vazio.appendChild(td0);
      tp.appendChild(vazio);
    }
    pedidos.forEach(function (p) {
      var tr = el('tr');
      var sis = el('td');
      sis.appendChild(el('strong', null, p.sistema));
      if (p.observacao) sis.appendChild(el('div', 'sub', p.observacao));
      tr.appendChild(sis);
      tr.appendChild(el('td', null, p.clinica || '—'));
      tr.appendChild(el('td', null, p.contato || '—'));
      tr.appendChild(el('td', null, PEDIDOS[p.situacao] || p.situacao));
      tr.appendChild(el('td', null, dataHora(p.criado_em)));
      var acao = el('td');
      if (p.conector_slug) acao.appendChild(botao('Abrir conector', null, function () { abrirConector(p.conector_slug); }));
      else if (p.situacao === 'aberto' || p.situacao === 'em_andamento') acao.appendChild(botao('Criar conector', 'Criar conector para ' + p.sistema, function () { comecarPeloPedido(p); }));
      if (p.situacao !== 'atendido' && p.situacao !== 'recusado') {
        acao.appendChild(botao('Atendido', null, function () { mudarPedido(p, 'atendido'); }));
        acao.appendChild(botao('Recusar', null, function () { mudarPedido(p, 'recusado'); }));
      }
      tr.appendChild(acao);
      tp.appendChild(tr);
    });
  }

  function slugDe(nome) {
    return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40);
  }

  function comecarPeloPedido(p) {
    pedidoAtual = p;
    $('cx-n-nome').value = p.sistema;
    $('cx-n-slug').value = slugDe(p.sistema);
    msg('m-cx-novo', null, 'Criando o conector do pedido de ' + (p.clinica || 'uma clínica') + '. Confira o nome e o identificador.');
    $('cx-n-nome').focus();
  }

  function mudarPedido(p, situacao) {
    chamar('PATCH', '/admin/pedidos/' + encodeURIComponent(p.id), { situacao: situacao }).then(function (r) {
      if (r.status !== 200) { msg('m-cx', 'err', erroDe(r)); return; }
      carregarConectores();
    });
  }

  function criarConector(ev) {
    ev.preventDefault();
    var corpo = { nome: $('cx-n-nome').value, slug: $('cx-n-slug').value.trim(), artigo: $('cx-n-artigo').value };
    if (pedidoAtual) corpo.pedido_id = pedidoAtual.id;
    msg('m-cx-novo', null, 'Criando…');
    chamar('POST', '/admin/conectores', corpo).then(function (r) {
      if (r.status !== 201) { msg('m-cx-novo', 'err', erroDe(r)); return; }
      msg('m-cx-novo', 'ok', 'Rascunho criado. Anexe a documentação e escreva a configuração abaixo.');
      pedidoAtual = null;
      $('f-cx-novo').reset();
      carregarConectores().then(function () { abrirConector(corpo.slug); });
    });
  }

  function abrirConector(slug) {
    chamar('GET', '/admin/conectores/' + encodeURIComponent(slug)).then(function (r) {
      if (r.status !== 200 || !r.body) { msg('m-cx', 'err', erroDe(r)); return; }
      var c = r.body;
      conectorAtual = c;
      $('cx-detalhe').hidden = false;
      $('cx-titulo').textContent = c.slug === 'padrao' ? 'Sistema próprio (padrão Kentro)' : c.nome;
      var dl = $('cx-resumo');
      dl.textContent = '';
      [
        ['Identificador', c.slug],
        ['Tipo', c.tipo === 'codigo' ? 'Adaptador em código (não editável aqui)' : 'Configuração'],
        ['Versão', 'v' + c.versao],
        ['Atualizado', dataHora(c.atualizado_em)],
        ['Publicado em', dataHora(c.publicado_em)]
      ].forEach(function (p) { dl.appendChild(el('dt', null, p[0])); dl.appendChild(el('dd', null, p[1])); });
      $('cx-nome').value = c.nome;
      $('cx-artigo').value = c.artigo;
      $('cx-situacao').value = c.situacao;
      $('cx-obs').value = c.observacao || '';
      var cfg = c.config_efetiva || c.config || (c.tipo === 'codigo' ? null : MODELO_CONECTOR);
      $('cx-config').value = cfg ? JSON.stringify(cfg, null, 2) : '';
      $('cx-config').disabled = c.tipo === 'codigo' || c.slug === 'padrao';
      $('f-cx-config').querySelector('button').disabled = $('cx-config').disabled;
      $('cx-erros').textContent = '';
      ['m-cx-dados', 'm-cx-config', 'm-cx-doc', 'm-cx-teste'].forEach(function (id) { msg(id, null, ''); });
      if (c.slug === 'padrao') msg('m-cx-config', null, 'O padrão Kentro não traduz nada: a configuração é a do código, só para consulta.');
      desenharDocs(c.documentos || []);
      montarCampos($('cx-teste-campos'), c.campos || [], 'cx-t-');
      $('cx-passos').textContent = '';
      $('cx-titulo').focus();
    });
  }

  function salvarDadosConector(ev) {
    ev.preventDefault();
    var c = conectorAtual;
    var situacao = $('cx-situacao').value;
    msg('m-cx-dados', null, 'Salvando…');
    chamar('PUT', '/admin/conectores/' + encodeURIComponent(c.slug), { nome: $('cx-nome').value, artigo: $('cx-artigo').value, observacao: $('cx-obs').value }).then(function (r) {
      if (r.status !== 200) { msg('m-cx-dados', 'err', erroDe(r)); return null; }
      if (situacao === c.situacao) return r;
      if (situacao === 'publicado' && !window.confirm('Publicar ' + c.nome + '? Ele passa a aparecer para todas as clínicas escolherem.')) return null;
      return chamar('POST', '/admin/conectores/' + encodeURIComponent(c.slug) + '/situacao', { situacao: situacao });
    }).then(function (r) {
      if (!r) return;
      if (r.status !== 200) {
        var extra = r.body && r.body.clinicas ? ' (' + r.body.clinicas + ' clínica(s) ativa(s) usam este conector)' : '';
        msg('m-cx-dados', 'err', erroDe(r) + extra);
        return;
      }
      msg('m-cx-dados', 'ok', 'Salvo.');
      carregarConectores().then(function () { abrirConector(c.slug); });
    });
  }

  function salvarConfigConector(ev) {
    ev.preventDefault();
    var c = conectorAtual;
    var cfg;
    $('cx-erros').textContent = '';
    try { cfg = JSON.parse($('cx-config').value); } catch (e) { msg('m-cx-config', 'err', 'JSON inválido: ' + e.message); return; }
    if (c.situacao === 'publicado' && !window.confirm('Este conector está publicado. A nova configuração vale para todas as clínicas que o usam em até 30 segundos. Salvar?')) return;
    msg('m-cx-config', null, 'Validando…');
    chamar('PUT', '/admin/conectores/' + encodeURIComponent(c.slug), { config: cfg }).then(function (r) {
      if (r.status === 422 && r.body && r.body.erros) {
        msg('m-cx-config', 'err', 'A configuração tem ' + r.body.erros.length + ' problema(s):');
        r.body.erros.forEach(function (e) { $('cx-erros').appendChild(el('li', null, e)); });
        return;
      }
      if (r.status !== 200) { msg('m-cx-config', 'err', erroDe(r)); return; }
      msg('m-cx-config', 'ok', 'Configuração salva: versão ' + r.body.versao + '.');
      carregarConectores().then(function () { abrirConector(c.slug); });
    });
  }

  function tamanho(n) {
    if (!n && n !== 0) return '';
    return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  }

  function desenharDocs(docs) {
    var ul = $('cx-docs');
    ul.textContent = '';
    if (!docs.length) { ul.appendChild(el('li', 'sub', 'Nenhuma documentação anexada.')); return; }
    docs.forEach(function (d) {
      var li = el('li');
      if (d.tipo === 'link') {
        var a = el('a', null, d.url);
        a.href = d.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        li.appendChild(a);
      } else {
        li.appendChild(el('strong', null, d.nome_arquivo));
        li.appendChild(el('span', 'sub', ' · ' + tamanho(d.tamanho) + (d.limpezas ? ' · ' + d.limpezas + ' credencial(is) removida(s)' : '')));
        li.appendChild(document.createTextNode(' '));
        li.appendChild(botao('Baixar', 'Baixar ' + d.nome_arquivo, function () { baixarDoc(d); }));
      }
      li.appendChild(el('div', 'sub', (d.origem ? 'De ' + d.origem + ' · ' : '') + dataHora(d.criado_em)));
      li.appendChild(botao('Remover', null, function () {
        if (!window.confirm('Remover este documento?')) return;
        chamar('DELETE', '/admin/conectores/' + encodeURIComponent(conectorAtual.slug) + '/documentos/' + encodeURIComponent(d.id)).then(function (r) {
          if (r.status !== 200) { msg('m-cx-doc', 'err', erroDe(r)); return; }
          abrirConector(conectorAtual.slug);
        });
      }));
      ul.appendChild(li);
    });
  }

  // O arquivo vem como download (nunca aberto como página deste endereço).
  function baixarDoc(d) {
    fetch('/admin/conectores/' + encodeURIComponent(conectorAtual.slug) + '/documentos/' + encodeURIComponent(d.id), { headers: { 'x-admin-key': chave } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = el('a');
        a.href = url;
        a.download = d.nome_arquivo || 'documento';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      }, function (e) { msg('m-cx-doc', 'err', 'Não deu para baixar (' + e.message + ').'); });
  }

  function anexarDoc(ev) {
    ev.preventDefault();
    var c = conectorAtual;
    var origem = $('cx-doc-origem').value;
    var arq = $('cx-doc-arquivo').files && $('cx-doc-arquivo').files[0];
    var url = $('cx-doc-url').value.trim();
    var enviar = function (corpo) {
      msg('m-cx-doc', null, 'Enviando…');
      chamar('POST', '/admin/conectores/' + encodeURIComponent(c.slug) + '/documentos', corpo).then(function (r) {
        if (r.status !== 201) { msg('m-cx-doc', 'err', erroDe(r)); return; }
        msg('m-cx-doc', 'ok', 'Anexado.' + (r.body.limpezas ? ' ' + r.body.limpezas + ' credencial(is) removida(s) do arquivo.' : ''));
        $('f-cx-doc').reset();
        abrirConector(c.slug);
        carregarConectores();
      });
    };
    if (arq) {
      if (arq.size > 10 * 1024 * 1024) { msg('m-cx-doc', 'err', 'O arquivo passa de 10 MB.'); return; }
      var leitor = new FileReader();
      leitor.onload = function () {
        var dados = String(leitor.result);
        enviar({ tipo: 'arquivo', nome_arquivo: arq.name, mime: arq.type, conteudo_base64: dados.slice(dados.indexOf(',') + 1), origem: origem });
      };
      leitor.onerror = function () { msg('m-cx-doc', 'err', 'Não deu para ler o arquivo.'); };
      leitor.readAsDataURL(arq);
      return;
    }
    if (url) { enviar({ tipo: 'link', url: url, origem: origem }); return; }
    msg('m-cx-doc', 'err', 'Informe um link ou escolha um arquivo.');
  }

  function testarConector(ev) {
    ev.preventDefault();
    var c = conectorAtual;
    var corpo = { credencial: lerCampos($('cx-teste-campos')) };
    var cpf = $('cx-teste-cpf').value.replace(/\D/g, ''), tel = $('cx-teste-tel').value.replace(/\D/g, '');
    if (cpf || tel) corpo.busca = cpf ? { cpf: cpf } : { telefone: tel };
    msg('m-cx-teste', null, 'Testando… pode levar alguns segundos.');
    $('cx-passos').textContent = '';
    chamar('POST', '/admin/conectores/' + encodeURIComponent(c.slug) + '/testar', corpo).then(function (r) {
      if (r.status !== 200 || !r.body) {
        msg('m-cx-teste', 'err', erroDe(r) + (r.body && r.body.campo ? ' Campo: ' + r.body.campo + '.' : ''));
        return;
      }
      var b = r.body;
      msg('m-cx-teste', b.ok ? 'ok' : 'err', b.ok ? 'Tudo certo na versão v' + b.versao + '.' : 'Algum passo falhou (versão v' + b.versao + ').');
      (b.passos || []).forEach(function (p) {
        var li = el('li', p.ok ? 'passo--ok' : 'passo--falha');
        li.appendChild(el('strong', null, (p.ok ? '✔ ' : '✖ ') + p.passo));
        if (p.detalhe) li.appendChild(el('span', null, ' · ' + p.detalhe));
        $('cx-passos').appendChild(li);
      });
      if (b.capacidades) {
        var caps = Object.keys(NOMES_CAPS).map(function (k) { return NOMES_CAPS[k] + ': ' + (b.capacidades[k] ? 'sim' : 'não'); }).join(' · ');
        $('cx-passos').appendChild(el('li', null, 'O sistema suporta → ' + caps));
      }
    });
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
  $('f-erp').addEventListener('submit', salvarErp);
  $('e-erp').addEventListener('change', trocarErp);
  $('e-testar').addEventListener('click', testarErp);
  $('cx-atualizar').addEventListener('click', function () { msg('m-cx', null, 'Atualizando…'); carregarConectores(); });
  $('f-cx-novo').addEventListener('submit', criarConector);
  $('cx-n-nome').addEventListener('input', function () { if (!$('cx-n-slug').dataset.mexido) $('cx-n-slug').value = slugDe($('cx-n-nome').value); });
  $('cx-n-slug').addEventListener('input', function () { $('cx-n-slug').dataset.mexido = '1'; });
  $('cx-fechar').addEventListener('click', function () { conectorAtual = null; $('cx-detalhe').hidden = true; });
  $('f-cx-dados').addEventListener('submit', salvarDadosConector);
  $('f-cx-config').addEventListener('submit', salvarConfigConector);
  $('f-cx-doc').addEventListener('submit', anexarDoc);
  $('f-cx-teste').addEventListener('submit', testarConector);
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
