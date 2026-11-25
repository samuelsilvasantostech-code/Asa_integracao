/* Página de implantação do Conector. Fala só com /admin/* deste mesmo endereço, com a chave de
   administrador digitada na tela. A chave fica só numa variável, nunca no armazenamento do navegador. */
(function () {
  'use strict';

  var TEXTOS = ['mensagem', 'confirmado', 'cancelado', 'remarcar', 'ja_respondido', 'indisponivel'];
  var ACOES = ['confirmar', 'remarcar', 'cancelar'];
  var ERROS = {
    NAO_AUTORIZADO: 'Chave de administrador recusada, ou a sessão terminou. Entre de novo.',
    LOGIN_INVALIDO: 'Usuário ou senha incorretos.',
    JA_HA_USUARIOS: 'O primeiro acesso já foi criado. Entre com usuário e senha.',
    USUARIO_INVALIDO: 'Usuário: 3 a 80 caracteres, só letras minúsculas, números e . _ @ -',
    SENHA_FRACA: 'A senha precisa ter pelo menos 10 caracteres.',
    USUARIO_JA_EXISTE: 'Já existe um usuário com esse nome de acesso.',
    NAO_PODE_DESATIVAR_A_SI: 'Você não pode desativar o seu próprio acesso.',
    USUARIO_NAO_ENCONTRADO: 'Usuário não encontrado.',
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
  // Texto para a tela. Código sem tradução vai só para o console (quem depura vê; a tela não).
  function erroDe(r) {
    var e = r.body && r.body.erro, s = r.status;
    if (e && ERROS[e]) return ERROS[e];
    if (e && window.console) console.warn('Conector: erro sem texto na tela', e, s);
    if (s === 0) return 'O Conector não respondeu. Confira a internet e tente de novo.';
    if (s === 400) return 'Algum dado está fora do formato. Confira os campos e tente de novo.';
    if (s === 401) return ERROS.NAO_AUTORIZADO;
    if (s === 403) return 'Sem permissão para isso.';
    if (s === 404) return 'Não encontrado. Atualize a página e tente de novo.';
    if (s === 409) return 'Os dados mudaram nesse meio-tempo. Atualize e tente de novo.';
    if (s === 413) return 'O arquivo é grande demais.';
    if (s === 429) return 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.';
    if (s >= 500) return 'O Conector teve um erro interno. Tente de novo em instantes.';
    return 'Não deu certo. Tente de novo.';
  }
  function dataHora(v) {
    if (!v) return '—';
    var d = new Date(v);
    return isNaN(d) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }
  function linhas(v) { return v.split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean); }

  // Com sessão (usuário e senha), o cookie vai sozinho e o x-clinfy prova que o pedido saiu desta tela.
  // Com a chave de administrador (emergência), ela vai no header.
  function cabecalhos() {
    var h = { 'x-clinfy': '1' };
    if (chave) h['x-admin-key'] = chave;
    return h;
  }
  function chamar(metodo, caminho, corpo) {
    var opt = { method: metodo, headers: cabecalhos(), cache: 'no-store', credentials: 'same-origin', referrerPolicy: 'no-referrer' };
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

  /* ---------- abas (barra lateral, Sistemas e detalhe do cliente) ---------- */
  // Um grupo de abas = botões role=tab cujo aria-controls aponta o painel. Setas (as quatro), Home e End mudam de aba.
  function ligarAbas(ids, aoTrocar) {
    function ativar(id, foco) {
      ids.forEach(function (outro) {
        var b = $(outro), sel = outro === id;
        b.setAttribute('aria-selected', sel ? 'true' : 'false');
        b.tabIndex = sel ? 0 : -1;
        $(b.getAttribute('aria-controls')).hidden = !sel;
      });
      if (foco) $(id).focus();
      if (aoTrocar) aoTrocar(id);
    }
    ids.forEach(function (id, i) {
      $(id).addEventListener('click', function () { ativar(id); });
      $(id).addEventListener('keydown', function (ev) {
        var k = ev.key, alvo = null;
        if (k === 'ArrowRight' || k === 'ArrowDown') alvo = ids[(i + 1) % ids.length];
        else if (k === 'ArrowLeft' || k === 'ArrowUp') alvo = ids[(i - 1 + ids.length) % ids.length];
        else if (k === 'Home') alvo = ids[0];
        else if (k === 'End') alvo = ids[ids.length - 1];
        if (!alvo) return;
        ev.preventDefault();
        ativar(alvo, true);
      });
    });
    return ativar;
  }
  var irPara = ligarAbas(['nav-clientes', 'nav-uso', 'nav-sistemas', 'nav-usuarios'], function (id) {
    window.scrollTo(0, 0);
    if (id === 'nav-usuarios') carregarUsuarios();
    if (id === 'nav-uso') carregarUso();
  });
  // Sistemas (ERP) tem duas sub-abas: conectores e pedidos. Ir a um conector sempre mostra a primeira.
  var abaDeSistemas = ligarAbas(['sx-conectores', 'sx-pedidos']);
  function irParaConectores() { irPara('nav-sistemas'); abaDeSistemas('sx-conectores'); }
  var ABAS_CLIENTE = ['da-geral', 'da-sistema', 'da-instalacao', 'da-financeiro', 'da-confirmacao', 'da-avancado'];
  var abaDoCliente = ligarAbas(ABAS_CLIENTE);

  function urlManifest() { return location.origin + '/extensao/manifest.json'; }

  /* ---------- acesso ---------- */
  var eu = null; // usuário da sessão; null quando entrou pela chave

  function abrirArea() {
    document.body.classList.add('com-sessao');
    $('acesso').hidden = true;
    $('area').hidden = false;
    $('nav').hidden = false;
    $('b-sair').hidden = false;
    $('nav-usuarios').hidden = false;
    $('quem').textContent = eu ? eu.nome : 'Chave de administrador';
    $('u-eu').value = eu ? eu.usuario : '';
    $('f-u-senha').hidden = !eu;
    irPara('nav-clientes');
    carregarConectores();
  }

  // Ao abrir a página: sessão ainda válida entra direto; sem nenhum usuário, mostra o primeiro acesso.
  function conferirSessao() {
    chamar('GET', '/admin/sessao').then(function (r) {
      if (r.status === 200 && r.body && r.body.usuario) {
        eu = r.body.usuario;
        carregar().then(function (ok) { if (ok) abrirArea(); });
        return;
      }
      var primeiro = !!(r.body && r.body.primeiro_acesso);
      $('f-primeiro').hidden = !primeiro;
      $('f-login').hidden = primeiro;
      if (r.status === 503) msg('m-login', 'err', erroDe(r));
      (primeiro ? $('p-chave') : $('l-usuario')).focus();
    });
  }

  function login(ev) {
    ev.preventDefault();
    var corpo = { usuario: $('l-usuario').value, senha: $('l-senha').value };
    msg('m-login', null, 'Conferindo…');
    chamar('POST', '/admin/sessao', corpo).then(function (r) {
      $('l-senha').value = '';
      if (r.status !== 200) { msg('m-login', 'err', erroDe(r)); $('l-senha').focus(); return; }
      msg('m-login', null, '');
      conferirSessao();
    });
  }

  function primeiroAcesso(ev) {
    ev.preventDefault();
    if ($('p-senha').value !== $('p-senha2').value) { msg('m-primeiro', 'err', 'As duas senhas não são iguais.'); return; }
    var corpo = { nome: $('p-nome').value, usuario: $('p-usuario').value, senha: $('p-senha').value };
    var chaveUmaVez = $('p-chave').value.trim();
    msg('m-primeiro', null, 'Criando…');
    fetch('/admin/primeiro-acesso', { method: 'POST', headers: { 'x-clinfy': '1', 'x-admin-key': chaveUmaVez, 'content-type': 'application/json' }, body: JSON.stringify(corpo), credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (b) { return { status: r.status, body: b }; }); }, function () { return { status: 0, body: null }; })
      .then(function (r) {
        $('p-chave').value = ''; $('p-senha').value = ''; $('p-senha2').value = '';
        if (r.status !== 201) { msg('m-primeiro', 'err', erroDe(r)); return; }
        msg('m-primeiro', 'ok', 'Acesso criado.');
        conferirSessao();
      });
  }

  // Emergência: entra com a ADMIN_KEY, que fica só nesta variável.
  function entrar(ev) {
    ev.preventDefault();
    chave = $('admin-key').value.trim();
    $('admin-key').value = '';
    if (!chave) return;
    msg('m-acesso', null, 'Conferindo…');
    carregar().then(function (ok) {
      if (!ok) { chave = ''; return; }
      msg('m-acesso', null, '');
      eu = null;
      abrirArea();
    });
  }

  function sair() {
    if (!podeDescartar(FORMS_CLIENTE.concat(FORMS_CONECTOR))) return;
    fotos = {};
    var tinhaSessao = !!eu;
    chave = '';
    eu = null;
    tenants = []; atual = null; wiz = null;
    conectores = []; pedidos = []; conectorAtual = null;
    ['lista', 's-chaves', 'w-chave', 'cx-lista', 'cx-pedidos', 'd-docs', 'u-lista', 'quem'].forEach(function (id) { $(id).textContent = ''; });
    if ($('dlg-senha').open) $('dlg-senha').close();
    document.body.classList.remove('com-sessao');
    $('area').hidden = true;
    $('nav').hidden = true;
    $('b-sair').hidden = true;
    $('detalhe').hidden = true;
    $('c-lista').hidden = false;
    $('assistente').hidden = true;
    $('cx-detalhe').hidden = true;
    $('acesso').hidden = false;
    $('f-login').hidden = false;
    $('f-primeiro').hidden = true;
    msg('m-login', null, 'Saiu.');
    if (tinhaSessao) chamar('DELETE', '/admin/sessao');
    $('l-usuario').focus();
  }

  /* ---------- usuários ---------- */
  function carregarUsuarios() {
    msg('m-usuarios', null, 'Carregando…');
    return chamar('GET', '/admin/usuarios').then(function (r) {
      if (r.status !== 200 || !r.body) { msg('m-usuarios', 'err', erroDe(r)); return; }
      msg('m-usuarios', null, r.body.usuarios.length ? '' : 'Nenhum usuário ainda.');
      var tb = $('u-lista');
      tb.textContent = '';
      r.body.usuarios.forEach(function (u) {
        var tr = el('tr');
        var nome = el('td');
        nome.appendChild(el('strong', null, u.nome));
        if (eu && eu.id === u.id) nome.appendChild(el('span', 'sub', ' (você)'));
        tr.appendChild(nome);
        tr.appendChild(el('td', null, u.usuario));
        var st = el('td');
        st.appendChild(el('span', 'selo selo--' + (u.ativo ? 'ok' : 'off'), u.ativo ? 'Ativo' : 'Desativado'));
        tr.appendChild(st);
        tr.appendChild(el('td', null, dataHora(u.ultimo_acesso_em)));
        tr.appendChild(el('td', null, dataHora(u.criado_em) + (u.criado_por ? ' · ' + u.criado_por : '')));
        var acao = el('td');
        if (!(eu && eu.id === u.id)) {
          acao.appendChild(botao(u.ativo ? 'Desativar' : 'Reativar', null, function () { mudarUsuario(u, { ativo: !u.ativo }, u.ativo ? 'Desativar ' + u.nome + '? As sessões desse usuário são encerradas.' : null); }));
          acao.appendChild(botao('Nova senha', 'Definir nova senha para ' + u.nome, function () { abrirNovaSenha(u); }));
        }
        tr.appendChild(acao);
        tb.appendChild(tr);
      });
    });
  }

  function mudarUsuario(u, corpo, pergunta) {
    if (pergunta && !window.confirm(pergunta)) return;
    chamar('PATCH', '/admin/usuarios/' + encodeURIComponent(u.id), corpo).then(function (r) {
      if (r.status !== 200) { msg('m-usuarios', 'err', erroDe(r)); return; }
      msg('m-usuarios', 'ok', corpo.senha ? 'Senha de ' + u.nome + ' trocada.' : 'Salvo.');
      carregarUsuarios();
    });
  }

  var senhaDe = null; // usuário cuja senha o diálogo está trocando
  function abrirNovaSenha(u) {
    senhaDe = u;
    $('dlg-senha-quem').textContent = 'Para ' + u.nome + ' (' + u.usuario + '). As sessões abertas desse usuário são encerradas.';
    $('dlg-senha-usuario').value = u.usuario;
    msg('m-dlg-senha', null, '');
    $('dlg-senha').showModal();
    $('dlg-nova').focus();
  }
  function definirNovaSenha(ev) {
    ev.preventDefault();
    var u = senhaDe, a = $('dlg-nova').value;
    if (!u) return;
    if (a.length < 10) { msg('m-dlg-senha', 'err', ERROS.SENHA_FRACA); $('dlg-nova').focus(); return; }
    if (a !== $('dlg-nova2').value) { msg('m-dlg-senha', 'err', 'As duas senhas não são iguais.'); $('dlg-nova2').focus(); return; }
    msg('m-dlg-senha', null, 'Salvando…');
    chamar('PATCH', '/admin/usuarios/' + encodeURIComponent(u.id), { senha: a }).then(function (r) {
      if (r.status !== 200) { msg('m-dlg-senha', 'err', erroDe(r)); return; }
      $('dlg-senha').close();
      msg('m-usuarios', 'ok', 'Senha de ' + u.nome + ' trocada.');
      carregarUsuarios();
    });
  }

  function novoUsuario(ev) {
    ev.preventDefault();
    var corpo = { nome: $('u-nome').value, usuario: $('u-usuario').value, senha: $('u-senha').value };
    msg('m-u-novo', null, 'Criando…');
    chamar('POST', '/admin/usuarios', corpo).then(function (r) {
      $('u-senha').value = '';
      if (r.status !== 201) { msg('m-u-novo', 'err', erroDe(r)); return; }
      msg('m-u-novo', 'ok', 'Usuário criado. Passe a senha inicial por um canal seguro e peça para trocar no primeiro acesso.');
      $('f-u-novo').reset();
      carregarUsuarios();
    });
  }

  function trocarMinhaSenha(ev) {
    ev.preventDefault();
    if ($('u-nova').value !== $('u-nova2').value) { msg('m-u-senha', 'err', 'As duas senhas não são iguais.'); return; }
    msg('m-u-senha', null, 'Salvando…');
    chamar('PATCH', '/admin/usuarios/' + encodeURIComponent(eu.id), { senha: $('u-nova').value }).then(function (r) {
      $('u-nova').value = ''; $('u-nova2').value = '';
      if (r.status !== 200) { msg('m-u-senha', 'err', erroDe(r)); return; }
      msg('m-u-senha', 'ok', 'Senha trocada. As suas outras sessões (outros navegadores) foram encerradas.');
    });
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
      msg('m-lista', null, tenants.length ? '' : 'Nenhum cliente cadastrado. Use + Novo cliente.');
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
    if (!t.tem_credencial) return 'Sem acesso cadastrado';
    var origem = t.credencial_origem === 'clinica' ? 'pela clínica' : t.credencial_origem === 'implantacao' ? 'pela implantação' : '';
    return 'Ok' + (origem ? ', ' + origem : '') + (t.credencial_gravada_em ? ' em ' + dataHora(t.credencial_gravada_em) : '');
  }
  function nomeConector(slug) {
    if (slug === 'padrao') return 'Sistema próprio (padrão Kentro)';
    var c = conectores.filter(function (x) { return x.slug === slug; })[0];
    return c ? c.nome : (NOMES_ERP[slug] || slug || '—');
  }
  // Pedido de sistema ainda em aberto deste cliente (o sistema dele não tem conector publicado).
  function pedidoDe(t) {
    return pedidos.filter(function (p) { return p.tenant_id === t.id && (p.situacao === 'aberto' || p.situacao === 'em_andamento'); })[0] || null;
  }

  function diasDesde(v) { return v ? Math.floor((Date.now() - new Date(v).getTime()) / 864e5) : null; }
  function dobrado(x) { return String(x == null ? '' : x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

  // O que falta para a clínica usar o ClinFy de verdade. aba: onde se resolve na ficha (null = não se resolve aqui).
  function pendencias(t) {
    if (!t.ativo) return [];
    var p = [], ped = pedidoDe(t);
    if (ped) p.push({ texto: 'Aguardando conector de ' + ped.sistema, aba: 'da-sistema', grave: true });
    else if (!t.tem_credencial) p.push({ texto: 'Sem acesso ao sistema', aba: 'da-sistema', grave: true });
    else if (!t.erp_testado_em) p.push({ texto: 'Conexão ainda não testada', aba: 'da-sistema' });
    if (t.kentro_instalacao_id == null) p.push({ texto: 'Id da instalação não anotado', aba: 'da-instalacao' });
    if (!t.kentro_instancia) p.push({ texto: 'Instância da Kentro não informada', aba: 'da-instalacao' });
    var d = diasDesde(t.ultimo_uso_em);
    if (d == null) p.push({ texto: 'Ainda sem uso', aba: null });
    else if (d >= 7) p.push({ texto: 'Sem uso há ' + d + ' dias', aba: null });
    return p;
  }

  var filtroClientes = 'todos';
  var FILTROS = {
    todos: function () { return true; },
    pendentes: function (t) { return pendencias(t).length > 0; },
    ativos: function (t) { return !!t.ativo; },
    desligados: function (t) { return !t.ativo; }
  };
  function textoDeBusca(t) {
    var ped = pedidoDe(t);
    return dobrado([t.nome, t.observacao, t.kentro_instancia, t.kentro_instalacao_id, nomeConector(t.erp || 'asa'), t.sistema_nome, ped && ped.sistema].join(' '));
  }

  function listaDePendencias(lista) {
    var ul = el('ul', 'alertas');
    lista.forEach(function (p) { ul.appendChild(el('li', 'alerta' + (p.grave ? ' alerta--critico' : ''), p.texto)); });
    return ul;
  }

  function desenharLista() {
    var tb = $('lista');
    tb.textContent = '';
    Object.keys(FILTROS).forEach(function (k) {
      var n = tenants.filter(FILTROS[k]).length;
      document.querySelector('#c-filtros [data-n="' + k + '"]').textContent = String(n);
    });
    var termos = dobrado($('c-busca').value).split(/\s+/).filter(Boolean);
    var visiveis = tenants.filter(FILTROS[filtroClientes]).filter(function (t) {
      var txt = textoDeBusca(t);
      return termos.every(function (w) { return txt.indexOf(w) >= 0; });
    });
    $('c-contagem').textContent = tenants.length ? (visiveis.length === tenants.length ? tenants.length + (tenants.length === 1 ? ' cliente' : ' clientes') : visiveis.length + ' de ' + tenants.length) : '';
    if (tenants.length && !visiveis.length) {
      var vazio = el('tr'), td0 = el('td', null, 'Nenhum cliente com essa busca ou filtro.');
      td0.colSpan = 5;
      vazio.appendChild(td0);
      tb.appendChild(vazio);
    }
    visiveis.forEach(function (t) {
      var tr = el('tr');
      var nome = el('td');
      nome.appendChild(el('strong', null, t.nome));
      var st = situacao(t);
      nome.appendChild(document.createTextNode(' '));
      nome.appendChild(el('span', 'selo selo--' + st.tom, st.texto));
      nome.appendChild(el('div', 'sub', (t.kentro_instancia || 'Instância não informada') + (t.kentro_instalacao_id != null ? ' · instalação #' + t.kentro_instalacao_id : '')));
      if (t.observacao) nome.appendChild(el('div', 'sub', t.observacao));
      tr.appendChild(nome);

      var sis = el('td');
      var ped = pedidoDe(t);
      if (ped) {
        sis.appendChild(el('strong', null, ped.sistema));
        sis.appendChild(el('div', 'sub falta', 'Aguardando conector'));
      } else {
        sis.appendChild(el('strong', null, nomeConector(t.erp || 'asa')));
        if (t.sistema_nome) sis.appendChild(el('div', 'sub', 'Nas telas: ' + t.sistema_nome));
      }
      tr.appendChild(sis);

      var pend = el('td'), lp = pendencias(t);
      if (!t.ativo) pend.appendChild(el('span', 'sub', '—'));
      else if (!lp.length) pend.appendChild(el('span', 'selo selo--ok', 'Em dia'));
      else pend.appendChild(listaDePendencias(lp));
      tr.appendChild(pend);

      tr.appendChild(el('td', null, dataHora(t.ultimo_uso_em)));
      var acao = el('td');
      var b = botao('Abrir', 'Abrir ' + t.nome, function () { abrir(t, true); });
      b.setAttribute('data-id', t.id);
      acao.appendChild(b);
      tr.appendChild(acao);
      tb.appendChild(tr);
    });
  }

  /* ---------- assistente de novo cliente ---------- */
  // Estado só desta tela: o cliente criado, a chave (mostrada uma vez) e o sistema escolhido.
  var wiz = null;
  var OUTRO = '__outro__';

  function etapa(n) {
    ['w-1', 'w-2', 'w-3', 'w-4'].forEach(function (id, i) { $(id).hidden = i + 1 !== n; });
    Array.prototype.forEach.call($('w-etapas').children, function (li) {
      var k = Number(li.getAttribute('data-etapa'));
      li.setAttribute('data-estado', k === 3 && n > 3 && wiz && wiz.pulou3 ? 'pulada' : k < n ? 'feita' : k === n ? 'atual' : 'futura');
      if (k === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (wiz) wiz.etapa = n;
  }

  function novoCliente() {
    fechar();
    wiz = { etapa: 1 };
    ['w-1', 'w-2', 'w-3', 'w-4f'].forEach(function (id) { $(id).reset(); });
    ['m-w-1', 'm-w-2', 'm-w-3', 'm-w-4'].forEach(function (id) { msg(id, null, ''); });
    $('w-chave').textContent = '';
    $('h-assistente').textContent = 'Novo cliente';
    $('assistente').hidden = false;
    etapa(1);
    $('assistente').scrollIntoView({ behavior: 'smooth' });
    $('w-nome').focus();
  }

  function fecharAssistente() {
    if (wiz && wiz.etapa === 4 && $('w-chave').textContent && !window.confirm('A chave da instalação não aparece de novo. Já copiou?')) return;
    var criado = wiz && wiz.tenant;
    wiz = null;
    $('assistente').hidden = true;
    $('w-chave').textContent = '';
    if (criado) carregar().then(function () {
      var t = tenants.filter(function (x) { return x.id === criado.id; })[0];
      if (t) abrir(t, true);
    });
  }

  function w1(ev) {
    ev.preventDefault();
    if (wiz.tenant) { etapa(2); return; }
    msg('m-w-1', null, 'Criando…');
    chamar('POST', '/admin/tenants', { nome: $('w-nome').value, kentro_instancia: $('w-instancia').value, implantado_por: $('w-por').value }).then(function (r) {
      if (r.status !== 201 || !r.body) { msg('m-w-1', 'err', erroDe(r)); return; }
      wiz.tenant = { id: r.body.id, nome: r.body.nome };
      wiz.chave = r.body.chave_instalacao;
      $('h-assistente').textContent = 'Novo cliente · ' + r.body.nome;
      msg('m-w-1', 'ok', 'Cliente criado.');
      carregar();
      opcoesErp();
      etapa(2);
      $('w-erp').focus();
    });
  }

  function opcoesErp() {
    var sel = $('w-erp'), antes = sel.value;
    sel.textContent = '';
    var usaveis = conectores.filter(function (c) { return c.situacao === 'publicado' || c.situacao === 'homologacao'; });
    if (!usaveis.length) usaveis = [{ slug: 'asa', nome: 'Asa', situacao: 'publicado' }, { slug: 'padrao', nome: '', situacao: 'publicado' }];
    usaveis.forEach(function (c) {
      var o = el('option', null, nomeConector(c.slug) + (c.situacao === 'homologacao' ? ' · em homologação' : ''));
      o.value = c.slug;
      sel.appendChild(o);
    });
    var outro = el('option', null, 'Outro sistema (não está na lista)');
    outro.value = OUTRO;
    sel.appendChild(outro);
    if (antes) sel.value = antes;
    if (!sel.value) sel.selectedIndex = 0;
    trocarErpAssistente();
  }

  function trocarErpAssistente() {
    var v = $('w-erp').value;
    $('w-asa').hidden = v !== 'asa';
    $('w-outro').hidden = v !== OUTRO;
    $('w-sistema').required = v === OUTRO;
  }

  // Lê o arquivo escolhido (se houver) como base64; sem arquivo, usa o link; sem os dois, devolve null.
  function lerDocumento(campoArquivo, campoUrl, origem) {
    var arq = $(campoArquivo).files && $(campoArquivo).files[0];
    var url = $(campoUrl).value.trim();
    if (!arq) return Promise.resolve(url ? { tipo: 'link', url: url, origem: origem } : null);
    if (arq.size > 10 * 1024 * 1024) return Promise.reject(new Error('O arquivo passa de 10 MB.'));
    return new Promise(function (ok, falha) {
      var leitor = new FileReader();
      leitor.onload = function () {
        var dados = String(leitor.result);
        ok({ tipo: 'arquivo', nome_arquivo: arq.name, mime: arq.type, conteudo_base64: dados.slice(dados.indexOf(',') + 1), origem: origem });
      };
      leitor.onerror = function () { falha(new Error('Não deu para ler o arquivo.')); };
      leitor.readAsDataURL(arq);
    });
  }

  function anexarEm(slug, doc) {
    return chamar('POST', '/admin/conectores/' + encodeURIComponent(slug) + '/documentos', doc);
  }

  // Cria o rascunho do conector (ou reaproveita o que já existe com o mesmo identificador).
  function garantirConector(nome, pedidoId) {
    var slug = slugDe(nome);
    if (!slug || slug.length < 2) return Promise.resolve({ erro: 'SLUG_INVALIDO' });
    var corpo = { nome: nome, slug: slug, artigo: 'o' };
    if (pedidoId) corpo.pedido_id = pedidoId;
    return chamar('POST', '/admin/conectores', corpo).then(function (r) {
      if (r.status === 201 || (r.body && r.body.erro === 'SLUG_JA_EXISTE')) return { slug: slug, novo: r.status === 201 };
      return { erro: r.body && r.body.erro && ERROS[r.body.erro] ? r.body.erro : null, texto: erroDe(r) };
    });
  }

  function w2(ev) {
    ev.preventDefault();
    var erp = $('w-erp').value, t = wiz.tenant;
    if (erp === OUTRO) {
      var sistema = $('w-sistema').value.trim();
      if (!sistema) { msg('m-w-2', 'err', 'Informe o nome do sistema.'); return; }
      var doc;
      msg('m-w-2', null, 'Registrando o sistema…');
      lerDocumento('w-doc-arquivo', 'w-doc-url', $('w-contato').value || t.nome).then(function (d) {
        doc = d;
        return garantirConector(sistema);
      }).then(function (c) {
        if (!c.slug) throw new Error(c.erro ? ERROS[c.erro] : c.texto);
        wiz.conector = c.slug;
        return chamar('POST', '/admin/pedidos', { tenant_id: t.id, sistema: sistema, contato: $('w-contato').value, conector_slug: c.slug });
      }).then(function (r) {
        if (r.status !== 201) throw new Error(erroDe(r));
        return doc ? anexarEm(wiz.conector, doc) : null;
      }).then(function (r) {
        if (r && r.status !== 201) throw new Error('O pedido foi aberto, mas a documentação não subiu: ' + erroDe(r) + ' Anexe de novo na aba Sistema do cliente.');
        wiz.pulou3 = true;
        carregarConectores();
        msg('m-w-4', 'ok', 'Pedido aberto para ' + sistema + (doc ? ', com a documentação anexada' : ', sem documentação: anexe depois na aba Sistema do cliente') + '. O conector é preparado em Sistemas (ERP).');
        mostrarChaveAssistente();
      }).catch(function (e) { msg('m-w-2', 'err', e.message); });
      return;
    }
    wiz.erp = erp;
    var passo = Promise.resolve({ status: 200 });
    var inst = $('w-instituicao').value.trim();
    if (erp === 'asa' && inst) passo = chamar('PATCH', rotaDo(t.id), { asa_instituicao_id: inst });
    msg('m-w-2', null, '');
    passo.then(function (r) {
      if (r.status !== 200) { msg('m-w-2', 'err', erroDe(r)); return; }
      var campos = erp === 'asa' ? Promise.resolve([{ chave: 'token', rotulo: 'Token da Asa', tipo: 'segredo', obrigatorio: true }]) : camposDoConector(erp);
      return campos.then(function (lista) {
        montarCampos($('w-campos'), lista, 'w-c-');
        $('w-3-dica').textContent = 'Os campos que ' + nomeConector(erp) + ' pede. O acesso é testado antes de gravar, fica cifrado e não volta para esta tela.';
        msg('m-w-3', null, lista.length ? '' : 'Este sistema não pede campos de acesso.');
        etapa(3);
        var primeiro = $('w-campos').querySelector('input');
        if (primeiro) primeiro.focus();
      });
    });
  }

  function w3(ev) {
    ev.preventDefault();
    var t = wiz.tenant, cred = lerCampos($('w-campos'));
    msg('m-w-3', null, 'Testando o acesso ao sistema…');
    var r0 = wiz.erp === 'asa'
      ? chamar('PUT', rotaDo(t.id, '/credencial'), { token: cred.token || '' })
      : chamar('PUT', rotaDo(t.id, '/erp'), { erp: wiz.erp, credencial: cred });
    r0.then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.ok) {
        var extra = (r.body && r.body.campo ? ' Campo: ' + r.body.campo + '.' : '') + (r.body && r.body.msg ? ' Resposta do sistema: ' + r.body.msg : '');
        msg('m-w-3', 'err', erroDe(r) + extra);
        return;
      }
      Array.prototype.forEach.call($('w-campos').querySelectorAll('input'), function (i) { i.value = ''; });
      var n = r.body.prestadores;
      msg('m-w-4', 'ok', 'Sistema ligado: ' + nomeConector(wiz.erp) + (n != null ? ' respondeu com ' + n + ' profissional(is).' : ' respondeu.'));
      mostrarChaveAssistente();
    });
  }

  function pularAcesso() {
    wiz.pulou3 = true;
    msg('m-w-4', null, 'O acesso ao sistema ficou para depois: a clínica escolhe e preenche em ClinFy → Configurar, ou você completa na aba Sistema do cliente.');
    mostrarChaveAssistente();
  }

  function mostrarChaveAssistente() {
    $('w-manifest').textContent = urlManifest();
    if (wiz.chave) mostrarSegredo('w-chave', 'Chave da instalação de ' + wiz.tenant.nome, wiz.chave);
    etapa(4);
    $('w-instalacao').focus();
  }

  function w4(ev) {
    ev.preventDefault();
    var id = $('w-instalacao').value.trim();
    var fim = function () { wiz.chave = null; $('w-chave').textContent = ''; fecharAssistente(); };
    if (!id) { fim(); return; }
    msg('m-w-4', null, 'Salvando…');
    chamar('PATCH', rotaDo(wiz.tenant.id), { kentro_instalacao_id: id }).then(function (r) {
      if (r.status !== 200) { msg('m-w-4', 'err', erroDe(r)); return; }
      fim();
    });
  }

  /* ---------- detalhe ---------- */
  // Volta para a lista. A ficha some e o foco vai para o "Abrir" do cliente que estava aberto.
  function fechar() {
    var id = atual && atual.id;
    atual = null;
    FORMS_CLIENTE.forEach(function (f) { delete fotos[f]; });
    marcarAbas();
    $('detalhe').hidden = true;
    $('c-lista').hidden = false;
    var b = id && document.querySelector('#lista button[data-id="' + id + '"]');
    if (b) b.focus();
  }

  function resumo(t) {
    var dl = $('resumo');
    dl.textContent = '';
    var ped = pedidoDe(t), st = situacao(t), d = diasDesde(t.ultimo_uso_em);
    $('d-situacao').textContent = '';
    $('d-situacao').appendChild(el('span', 'selo selo--' + st.tom, st.texto));
    $('d-sub').textContent = [t.kentro_instancia || 'Instância da Kentro não informada', t.implantado_por ? 'implantado por ' + t.implantado_por : ''].filter(Boolean).join(' · ');
    [
      ['Sistema (ERP)', ped ? ped.sistema : nomeConector(t.erp || 'asa'), ped ? 'Aguardando conector' : t.sistema_nome ? 'Nas telas: ' + t.sistema_nome : '', !!ped],
      ['Acesso ao sistema', t.tem_credencial ? 'Ok' : 'Sem acesso', t.tem_credencial ? (t.erp_testado_em ? 'Testado em ' + dataHora(t.erp_testado_em) : 'Não testado') : 'Cadastre na aba Sistema', !t.tem_credencial],
      ['Instalação na Kentro', t.kentro_instalacao_id != null ? '#' + t.kentro_instalacao_id : 'Id não anotado', t.kentro_instancia || '', t.kentro_instalacao_id == null],
      ['Último uso', t.ultimo_uso_em ? (d === 0 ? 'Hoje' : d === 1 ? 'Ontem' : 'Há ' + d + ' dias') : 'Nunca', t.ultimo_uso_em ? dataHora(t.ultimo_uso_em) : '', !t.ultimo_uso_em && t.ativo],
      ['Cliente desde', dataHora(t.criado_em).split(' ')[0], '', false]
    ].forEach(function (p) {
      var item = el('div');
      item.appendChild(el('dt', null, p[0]));
      var dd = el('dd', p[3] ? 'falta' : null, p[1]);
      if (p[2]) dd.appendChild(el('span', 'sub', p[2]));
      item.appendChild(dd);
      dl.appendChild(item);
    });
    visaoGeral(t);
  }

  function visaoGeral(t) {
    var ul = $('g-pend'), lp = pendencias(t);
    ul.textContent = '';
    if (!t.ativo) ul.appendChild(el('li', 'sub', 'Cliente desligado.'));
    else if (!lp.length) ul.appendChild(el('li', 'pendencias__ok', 'Nada pendente: sistema ligado, instalação anotada e em uso.'));
    lp.forEach(function (p) {
      var li = el('li', 'pendencias__item' + (p.grave ? ' pendencias__item--grave' : ''));
      li.appendChild(el('span', null, p.texto));
      if (p.aba) li.appendChild(botao('Resolver', 'Resolver: ' + p.texto, function () { abaDoCliente(p.aba, true); }));
      ul.appendChild(li);
    });
    var dl = $('g-recursos'), c = t.confirmacao || {};
    dl.textContent = '';
    [
      ['Lançar cobrança', t.financeiro && t.financeiro.ativo, t.financeiro && t.financeiro.ativo ? (t.financeiro.quem === 'todos' ? 'Todos os atendentes' : 'Só administradores') : 'Desligado', 'da-financeiro'],
      ['Confirmação de véspera', c.ativo, c.ativo ? (c.dias_antes + (c.dias_antes === 1 ? ' dia antes' : ' dias antes') + ' · ' + (c.canal === 'oficial' ? 'WhatsApp oficial' : 'WhatsApp não oficial') + (c.teste && c.teste.ativo ? ' · modo teste' : '')) : 'Desligada', 'da-confirmacao'],
      ['URL de disparo', !!t.disparo_url, t.disparo_url ? 'Configurada' : 'Não configurada', 'da-confirmacao']
    ].forEach(function (r) {
      var item = el('div');
      item.appendChild(el('dt', null, r[0]));
      var dd = el('dd');
      dd.appendChild(el('span', 'selo selo--' + (r[1] ? 'ok' : 'idle'), r[1] ? 'Ligado' : 'Desligado'));
      dd.appendChild(el('span', 'sub', r[2]));
      item.appendChild(dd);
      var ir = botao('Abrir', 'Abrir ' + r[0], function () { abaDoCliente(r[3], true); });
      item.appendChild(ir);
      dl.appendChild(item);
    });
    if (t.observacao) {
      var obs = el('div');
      obs.appendChild(el('dt', null, 'Observação'));
      obs.appendChild(el('dd', 'recursos__obs', t.observacao));
      dl.appendChild(obs);
    }
  }

  function abrir(t, mostrar) {
    var outro = !atual || atual.id !== t.id;
    // Recarregar o mesmo cliente (depois de salvar uma aba) não apaga o que está sendo editado nas outras.
    var manter = function (f) { return !outro && sujo(f); };
    atual = t;
    if (mostrar && wiz) { wiz = null; $('assistente').hidden = true; }
    $('c-lista').hidden = true;
    $('detalhe').hidden = false;
    $('h-detalhe').textContent = t.nome;
    $('h-detalhe').tabIndex = -1;
    resumo(t);
    if (!manter('f-vinculo')) {
      $('v-nome').value = t.nome;
      $('v-instancia').value = t.kentro_instancia || '';
      $('v-instalacao').value = t.kentro_instalacao_id != null ? String(t.kentro_instalacao_id) : '';
      $('v-instituicao').value = t.asa_instituicao_id || '';
      $('v-obs').value = t.observacao || '';
    }
    $('d-manifest').textContent = urlManifest();
    if (!manter('f-fin')) {
      $('fin-on').checked = !!t.financeiro.ativo;
      $('fin-quem').value = t.financeiro.quem;
    }
    if (!manter('f-disparo')) $('d-url').value = t.disparo_url || '';
    if (!manter('f-conf')) preencherConfirmacao(t.confirmacao);
    if (!manter('f-erp')) {
      if (outro) $('e-erp').value = '';
      preencherSelectErp();
      $('e-erp').value = t.erp || 'asa';
      $('e-nome').value = t.sistema_nome || '';
      $('e-artigo').value = t.sistema_artigo === 'o' ? 'o' : 'a';
      trocarErp();
    }
    mostrarCapacidades(t.erp_capacidades, t.erp_testado_em);
    var desligado = !t.ativo && !!t.desligado_em;
    $('f-desligar').hidden = desligado;
    $('f-historico').hidden = !desligado;
    if (outro) {
      ['m-erp', 'm-vinculo', 'm-token', 'm-fin', 'm-conf', 'm-disparo', 'm-chaves', 'm-desligar', 'm-historico', 'm-d-doc'].forEach(function (id) { msg(id, null, ''); });
      $('s-chaves').textContent = '';
      $('x-nome').value = '';
      $('h-nome').value = '';
      $('t-token').value = '';
      $('f-d-doc').reset();
      abaDoCliente('da-geral');
    }
    FORMS_CLIENTE.forEach(function (f) { if (!manter(f)) fotografar(f); });
    marcarAbas();
    sistemaDoCliente(t);
    if (mostrar) { window.scrollTo(0, 0); $('h-detalhe').focus(); }
  }

  /* ---------- alterações não salvas ---------- */
  // "Foto" dos valores de cada formulário logo depois de preenchido. Diferente da foto = alteração não salva.
  // Campos vazios ficam de fora: campos de acesso que chegam depois (vazios) não contam como alteração.
  var ABA_DO_FORM = { 'f-erp': 'da-sistema', 'f-token': 'da-sistema', 'f-d-doc': 'da-sistema', 'f-vinculo': 'da-instalacao', 'f-fin': 'da-financeiro', 'f-conf': 'da-confirmacao', 'f-disparo': 'da-confirmacao' };
  var FORMS_CLIENTE = Object.keys(ABA_DO_FORM);
  var FORMS_CONECTOR = ['f-cx-dados', 'f-cx-config', 'f-cx-doc'];
  var fotos = {};
  function valoresDe(id) {
    var partes = [];
    Array.prototype.forEach.call($(id).elements, function (e, i) {
      if (e.tagName === 'FIELDSET' || e.tagName === 'BUTTON' || e.disabled) return;
      var v = e.type === 'checkbox' || e.type === 'radio' ? (e.checked ? '1' : '') : e.type === 'file' ? (e.files && e.files.length ? e.files[0].name : '') : e.value;
      if (v) partes.push((e.id || '#' + i) + '=' + v);
    });
    return partes.join('\u0001');
  }
  function fotografar(id) { fotos[id] = valoresDe(id); }
  function sujo(id) { return fotos[id] != null && valoresDe(id) !== fotos[id]; }
  function marcarAbas() {
    ABAS_CLIENTE.forEach(function (aba) {
      var s = FORMS_CLIENTE.some(function (f) { return ABA_DO_FORM[f] === aba && sujo(f); });
      $(aba).classList.toggle('aba--suja', s);
      if (s) $(aba).title = 'Alterações não salvas'; else $(aba).removeAttribute('title');
    });
  }
  // Pergunta antes de descartar. Devolve true quando pode seguir.
  function podeDescartar(forms) {
    var s = forms.filter(sujo);
    if (!s.length) return true;
    var onde = s.map(function (f) { return ABA_DO_FORM[f] ? $(ABA_DO_FORM[f]).textContent.trim() : f === 'f-cx-config' ? 'Configuração' : f === 'f-cx-doc' ? 'Documentação' : 'Dados do conector'; });
    onde = onde.filter(function (x, i) { return onde.indexOf(x) === i; });
    return window.confirm('Há alterações não salvas (' + onde.join(', ') + '). Sair sem salvar?');
  }
  function salvou(id) { fotografar(id); marcarAbas(); }

  /* ---------- aba Sistema: pedido em aberto e documentação ---------- */
  // Para onde vai a documentação: o conector do pedido em aberto; sem pedido, o conector do sistema atual.
  function destinoDocs(t) {
    var ped = pedidoDe(t);
    if (ped) return { slug: ped.conector_slug || null, pedido: ped };
    return { slug: t.erp || 'asa', pedido: null };
  }

  function sistemaDoCliente(t) {
    var d = destinoDocs(t), caixa = $('d-pedido');
    caixa.textContent = '';
    caixa.hidden = !d.pedido;
    if (d.pedido) {
      caixa.appendChild(el('strong', null, 'Sistema pedido: ' + d.pedido.sistema));
      caixa.appendChild(el('p', 'dica', 'Este sistema ainda não tem conector publicado (pedido ' + (PEDIDOS[d.pedido.situacao] || d.pedido.situacao).toLowerCase() + ' desde ' + dataHora(d.pedido.criado_em) + '). A documentação anexada abaixo vai para o conector dele; quando ele for publicado, escolha-o aqui em "Sistema" e preencha o acesso.'));
      if (d.pedido.conector_slug) caixa.appendChild(botao('Abrir em Sistemas (ERP)', null, function () { abrirConector(d.pedido.conector_slug); }));
    }
    $('d-doc-destino').textContent = d.slug ? 'Destino: conector ' + nomeConector(d.slug) + ' (' + d.slug + ').' : 'Destino: o conector de ' + d.pedido.sistema + ' é criado como rascunho ao anexar.';
    $('d-docs').textContent = '';
    if (!d.slug) { $('d-docs').appendChild(el('li', 'sub', 'Nenhuma documentação anexada.')); return; }
    chamar('GET', '/admin/conectores/' + encodeURIComponent(d.slug)).then(function (r) {
      if (!atual || atual.id !== t.id) return;
      desenharDocs($('d-docs'), r.status === 200 && r.body ? r.body.documentos || [] : [], d.slug, 'm-d-doc', function () { if (atual) sistemaDoCliente(atual); carregarConectores(); });
    });
  }

  function anexarDocCliente(ev) {
    ev.preventDefault();
    var t = atual, d = destinoDocs(t), doc;
    msg('m-d-doc', null, 'Enviando…');
    lerDocumento('d-doc-arquivo', 'd-doc-url', $('d-doc-origem').value || t.nome).then(function (x) {
      if (!x) throw new Error('Informe um link ou escolha um arquivo.');
      doc = x;
      if (d.slug) return { slug: d.slug };
      return garantirConector(d.pedido.sistema, d.pedido.id);
    }).then(function (c) {
      if (!c.slug) throw new Error(c.erro ? ERROS[c.erro] : c.texto);
      return anexarEm(c.slug, doc);
    }).then(function (r) {
      if (r.status !== 201) throw new Error(erroDe(r));
      msg('m-d-doc', 'ok', 'Anexado.' + (r.body && r.body.limpezas ? ' ' + r.body.limpezas + ' credencial(is) removida(s) do arquivo.' : ''));
      $('f-d-doc').reset();
      salvou('f-d-doc');
      return carregarConectores();
    }).catch(function (e) { msg('m-d-doc', 'err', e.message); });
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
      salvou('f-erp');
      if (r.body.soNome) msg('m-erp', 'ok', 'Nome nas telas salvo.');
      else if (r.body.erp === 'asa') msg('m-erp', 'ok', 'Clínica de volta à Asa. Cadastre o token da Asa abaixo (ou em ClinFy → Configurar, na extensão).');
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
      var abertos = pedidos.filter(function (p) { return p.situacao === 'aberto' || p.situacao === 'em_andamento'; }).length;
      ['nav-pedidos-n', 'sx-pedidos-n'].forEach(function (id) { $(id).textContent = String(abertos); $(id).hidden = !abertos; });
      $('nav-sistemas').setAttribute('aria-label', 'Sistemas (ERP)' + (abertos ? ', ' + abertos + (abertos === 1 ? ' pedido aberto' : ' pedidos abertos') : ''));
      desenharLista();
      if (atual) {
        if (!sujo('f-erp')) { preencherSelectErp(); $('e-erp').value = atual.erp || 'asa'; trocarErp(); fotografar('f-erp'); }
        resumo(atual);
        sistemaDoCliente(atual);
      }
      if (wiz && wiz.etapa === 2) opcoesErp();
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
    irParaConectores();
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
    if (conectorAtual && conectorAtual.slug !== slug && !podeDescartar(FORMS_CONECTOR)) return;
    chamar('GET', '/admin/conectores/' + encodeURIComponent(slug)).then(function (r) {
      if (r.status !== 200 || !r.body) { msg('m-cx', 'err', erroDe(r)); return; }
      var c = r.body;
      var manter = function (f) { return conectorAtual && conectorAtual.slug === c.slug && sujo(f); };
      var kDados = manter('f-cx-dados'), kConfig = manter('f-cx-config'), kDoc = manter('f-cx-doc');
      conectorAtual = c;
      irParaConectores();
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
      if (!kDados) {
        $('cx-nome').value = c.nome;
        $('cx-artigo').value = c.artigo;
        $('cx-situacao').value = c.situacao;
        $('cx-obs').value = c.observacao || '';
      }
      var cfg = c.config_efetiva || c.config || (c.tipo === 'codigo' ? null : MODELO_CONECTOR);
      if (!kConfig) $('cx-config').value = cfg ? JSON.stringify(cfg, null, 2) : '';
      $('cx-config').disabled = c.tipo === 'codigo' || c.slug === 'padrao';
      $('f-cx-config').querySelector('button').disabled = $('cx-config').disabled;
      $('cx-erros').textContent = '';
      ['m-cx-dados', 'm-cx-config', 'm-cx-doc', 'm-cx-teste'].forEach(function (id) { msg(id, null, ''); });
      if (c.slug === 'padrao') msg('m-cx-config', null, 'O padrão Kentro não traduz nada: a configuração é a do código, só para consulta.');
      desenharDocs($('cx-docs'), c.documentos || [], c.slug, 'm-cx-doc', function () { abrirConector(c.slug); carregarConectores(); });
      montarCampos($('cx-teste-campos'), c.campos || [], 'cx-t-');
      $('cx-passos').textContent = '';
      if (!kDados) fotografar('f-cx-dados');
      if (!kConfig) fotografar('f-cx-config');
      if (!kDoc) fotografar('f-cx-doc');
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
      salvou('f-cx-dados');
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
      salvou('f-cx-config');
      carregarConectores().then(function () { abrirConector(c.slug); });
    });
  }

  function tamanho(n) {
    if (!n && n !== 0) return '';
    return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  }

  // Lista de documentos de um conector; serve à Central e à aba Sistema do cliente.
  function desenharDocs(ul, docs, slug, msgId, depois) {
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
        li.appendChild(botao('Baixar', 'Baixar ' + d.nome_arquivo, function () { baixarDoc(slug, d, msgId); }));
      }
      li.appendChild(el('div', 'sub', (d.origem ? 'De ' + d.origem + ' · ' : '') + dataHora(d.criado_em)));
      li.appendChild(botao('Remover', null, function () {
        if (!window.confirm('Remover este documento?')) return;
        chamar('DELETE', '/admin/conectores/' + encodeURIComponent(slug) + '/documentos/' + encodeURIComponent(d.id)).then(function (r) {
          if (r.status !== 200) { msg(msgId, 'err', erroDe(r)); return; }
          depois();
        });
      }));
      ul.appendChild(li);
    });
  }

  // O arquivo vem como download (nunca aberto como página deste endereço).
  function baixarDoc(slug, d, msgId) {
    fetch('/admin/conectores/' + encodeURIComponent(slug) + '/documentos/' + encodeURIComponent(d.id), { headers: cabecalhos(), credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) { var x = new Error(erroDe({ status: r.status, body: null })); x.nosso = true; throw x; } return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = el('a');
        a.href = url;
        a.download = d.nome_arquivo || 'documento';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      }, function (e) { msg(msgId, 'err', 'Não deu para baixar. ' + (e && e.nosso ? e.message : 'O Conector não respondeu.')); });
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
        salvou('f-cx-doc');
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
      salvou('f-vinculo');
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
      salvou('f-token');
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
      salvou('f-fin');
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
    marcarAbas();
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
      salvou('f-conf');
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
      salvou('f-disparo');
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
  $('f-login').addEventListener('submit', login);
  $('f-primeiro').addEventListener('submit', primeiroAcesso);
  $('u-atualizar').addEventListener('click', carregarUsuarios);
  $('f-u-novo').addEventListener('submit', novoUsuario);
  $('f-u-senha').addEventListener('submit', trocarMinhaSenha);
  $('f-dlg-senha').addEventListener('submit', definirNovaSenha);
  $('dlg-cancelar').addEventListener('click', function () { $('dlg-senha').close(); });
  // Fechar (Esc, Cancelar ou depois de salvar) apaga o que foi digitado.
  $('dlg-senha').addEventListener('close', function () { $('dlg-nova').value = ''; $('dlg-nova2').value = ''; senhaDe = null; });
  $('b-sair').addEventListener('click', sair);
  $('b-atualizar').addEventListener('click', function () { msg('m-lista', null, 'Atualizando…'); carregar(); });
  $('b-fechar').addEventListener('click', function () { if (podeDescartar(FORMS_CLIENTE)) fechar(); });
  $('c-busca').addEventListener('input', desenharLista);
  Array.prototype.forEach.call(document.querySelectorAll('#c-filtros .seg__btn'), function (b) {
    b.addEventListener('click', function () {
      filtroClientes = b.getAttribute('data-filtro');
      Array.prototype.forEach.call(document.querySelectorAll('#c-filtros .seg__btn'), function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
      desenharLista();
    });
  });
  // Qualquer digitação num formulário da ficha atualiza a marca de "não salvo" nas abas.
  ['input', 'change'].forEach(function (tipo) {
    $('detalhe').addEventListener(tipo, function (ev) { if (ev.target.form && ABA_DO_FORM[ev.target.form.id]) marcarAbas(); });
  });
  window.addEventListener('beforeunload', function (ev) {
    if (FORMS_CLIENTE.concat(FORMS_CONECTOR).some(sujo)) { ev.preventDefault(); ev.returnValue = ''; }
  });
  $('b-novo').addEventListener('click', novoCliente);
  $('w-fechar').addEventListener('click', fecharAssistente);
  $('w-1').addEventListener('submit', w1);
  $('w-2').addEventListener('submit', w2);
  $('w-erp').addEventListener('change', trocarErpAssistente);
  $('w-3').addEventListener('submit', w3);
  $('w-pular').addEventListener('click', pularAcesso);
  $('w-4f').addEventListener('submit', w4);
  $('f-d-doc').addEventListener('submit', anexarDocCliente);
  $('f-vinculo').addEventListener('submit', salvarVinculo);
  $('f-token').addEventListener('submit', salvarToken);
  $('f-erp').addEventListener('submit', salvarErp);
  $('e-erp').addEventListener('change', trocarErp);
  $('e-testar').addEventListener('click', testarErp);
  $('cx-atualizar').addEventListener('click', function () { msg('m-cx', null, 'Atualizando…'); carregarConectores(); });
  $('f-cx-novo').addEventListener('submit', criarConector);
  $('cx-n-nome').addEventListener('input', function () { if (!$('cx-n-slug').dataset.mexido) $('cx-n-slug').value = slugDe($('cx-n-nome').value); });
  $('cx-n-slug').addEventListener('input', function () { $('cx-n-slug').dataset.mexido = '1'; });
  $('cx-fechar').addEventListener('click', function () {
    if (!podeDescartar(FORMS_CONECTOR)) return;
    FORMS_CONECTOR.forEach(function (f) { delete fotos[f]; });
    conectorAtual = null;
    $('cx-detalhe').hidden = true;
  });
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
  /* ---------- uso das clínicas ---------- */
  // Uma linha por clínica, alertas primeiro (a ordem vem do Conector). "Ver" abre os números do período
  // numa linha logo abaixo. Nada de paciente: só contagens.
  var usoDias = 30, usoSeq = 0, usoAberto = null, usoDados = null;
  var NOMES_FUNCAO = { agenda: 'Marcar', presenca: 'Presença', espera: 'Tempo de espera', cobranca: 'Cobrança', confirmacao: 'Confirmação D-1', confirmacao_manual: 'Confirmação manual', busca: 'Busca de paciente', cadastro: 'Cadastro de paciente' };

  function num(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function reais(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function pctDe(n, d) { return d ? Math.round((n / d) * 100) + '%' : '—'; }
  function celula(texto, detalhe) {
    var td = el('td', null, texto);
    if (detalhe) td.appendChild(el('div', 'sub', detalhe));
    return td;
  }

  function carregarUso() {
    var s = ++usoSeq;
    msg('m-uso', null, 'Carregando…');
    $('uso-lista').setAttribute('aria-busy', 'true');
    return chamar('GET', '/admin/uso?dias=' + usoDias).then(function (r) {
      if (s !== usoSeq) return;
      $('uso-lista').removeAttribute('aria-busy');
      if (r.status !== 200 || !r.body) {
        usoDados = null;
        $('uso-lista').textContent = '';
        $('uso-kpis').textContent = '';
        msg('m-uso', 'err', erroDe(r));
        return;
      }
      usoDados = r.body;
      desenharUso();
      msg('m-uso', null, r.body.clinicas.length ? '' : 'Nenhuma clínica cadastrada.');
    });
  }

  function kpi(dl, rotulo, valor, detalhe, tend) {
    var d = el('div', 'kpi');
    d.appendChild(el('dt', null, rotulo));
    var dd = el('dd', null, valor);
    if (detalhe) dd.appendChild(el('span', 'kpi__sub', detalhe));
    if (tend && tend.textContent) { tend.className = 'tend kpi__tend'; dd.appendChild(tend); }
    d.appendChild(dd);
    dl.appendChild(d);
  }

  // Seta e porcentagem contra o período anterior de mesmo tamanho. A cor reforça; a seta e o texto dizem.
  function comparar(atual, anterior, curto) {
    var span = el('span', 'tend');
    var sufixo = curto ? '' : ' vs. período anterior';
    if (!anterior) { span.textContent = atual ? (curto ? 'novo' : 'sem uso no período anterior') : ''; return span; }
    var v = Math.round(((atual - anterior) / anterior) * 100);
    span.textContent = (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '= ') + Math.abs(v) + '%' + sufixo;
    span.setAttribute('data-tom', v >= 0 ? 'ok' : v <= -50 ? 'err' : 'warn');
    return span;
  }

  function dataCurta(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
  function diasDoPeriodo(p) {
    var dias = [];
    for (var t = Date.parse(p.inicio + 'T12:00:00Z'); t <= Date.parse(p.fim + 'T12:00:00Z'); t += 86400000) dias.push(new Date(t).toISOString().slice(0, 10));
    return dias;
  }
  // Série diária da clínica: a do Conector (agenda + cobranças + espera); se não vier, só as ações de agenda.
  function serieDe(c, p) {
    var dias = diasDoPeriodo(p);
    if (c.spark && c.spark.length === dias.length) return dias.map(function (d, i) { return { dia: d, n: c.spark[i] }; });
    var m = {};
    c.por_dia.forEach(function (x) { m[x.dia] = x.n; });
    return dias.map(function (d) { return { dia: d, n: m[d] || 0 }; });
  }
  function resumoSerie(s, unidade) {
    var total = 0, comUso = 0, pico = null;
    s.forEach(function (x) { total += x.n; if (x.n) comUso++; if (!pico || x.n > pico.n) pico = x; });
    return num(total) + ' ' + unidade + ' em ' + comUso + ' de ' + s.length + ' dias'
      + (pico && pico.n ? '; pico de ' + num(pico.n) + ' em ' + dataCurta(pico.dia) : '');
  }

  // Minigráfico de linha (série única, na cor da marca): área suave, linha de 2px e ponto no último dia.
  var SVG = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    var n = document.createElementNS(SVG, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function sparkline(s) {
    var L = 128, A = 32, pad = 3, max = 0;
    s.forEach(function (x) { if (x.n > max) max = x.n; });
    var passo = s.length > 1 ? L / (s.length - 1) : 0;
    var pts = s.map(function (x, i) {
      var y = max ? A - pad - (x.n / max) * (A - 2 * pad) : A - pad;
      return [Math.round(i * passo * 10) / 10, Math.round(y * 10) / 10];
    });
    var resumo = 'Uso por dia: ' + resumoSerie(s, 'usos');
    var g = svg('svg', { class: 'spark', viewBox: '0 0 ' + L + ' ' + A, role: 'img', 'aria-label': resumo });
    var t = svg('title', {});
    t.textContent = resumo;
    g.appendChild(t);
    g.appendChild(svg('line', { class: 'spark__base', x1: 0, y1: A - pad, x2: L, y2: A - pad }));
    if (max) {
      var linha = pts.map(function (p) { return p.join(','); }).join(' ');
      g.appendChild(svg('polygon', { class: 'spark__area', points: '0,' + (A - pad) + ' ' + linha + ' ' + L + ',' + (A - pad) }));
      g.appendChild(svg('polyline', { class: 'spark__linha', points: linha }));
      var u = pts[pts.length - 1];
      g.appendChild(svg('circle', { class: 'spark__ponto', cx: u[0], cy: u[1], r: 3 }));
    }
    return g;
  }

  function desenharUso() {
    var d = usoDados;
    if (!d) return;
    var t = d.totais, k = $('uso-kpis');
    k.textContent = '';
    var ta = d.totais_anterior;
    var volume = (d.serie || []).reduce(function (s, x) { return s + x.n; }, 0);
    kpi(k, 'Clínicas em uso', num(t.usaram_7d) + ' de ' + num(t.ativas), 'usaram nos últimos 7 dias');
    if (ta) kpi(k, 'Uso total', num(volume), 'agenda, cobranças e espera', comparar(volume, ta.volume));
    kpi(k, 'Buscas de paciente', num(t.buscas), 'por CPF ou telefone');
    kpi(k, 'Ações na agenda', num(t.acoes), 'marcar, remarcar, cancelar, presença e falta', ta && comparar(t.acoes, ta.acoes));
    kpi(k, 'Cobranças', num(t.cobrancas.n), reais(t.cobrancas.valor), ta && comparar(t.cobrancas.n, ta.cobrancas));
    kpi(k, 'Confirmações enviadas', num(t.confirmacoes));
    kpi(k, 'Com alerta', num(t.com_alerta), t.com_alerta ? 'no topo da lista' : 'nenhuma');

    var tb = $('uso-lista');
    tb.textContent = '';
    d.clinicas.forEach(function (c) {
      var tr = el('tr');
      var nome = el('td');
      nome.appendChild(el('strong', null, c.nome));
      nome.appendChild(document.createTextNode(' '));
      var saude = c.saude || c.situacao;
      nome.appendChild(selo(saude.tom, saude.texto));
      if (c.saude && c.situacao.tom === 'warn') nome.appendChild(el('div', 'sub', c.situacao.texto));
      if (c.alertas.length) {
        var ul = el('ul', 'alertas');
        c.alertas.forEach(function (a) {
          var li = el('li', 'alerta alerta--' + a.nivel);
          li.appendChild(el('span', 'sr', a.nivel === 'critico' ? 'Crítico: ' : 'Aviso: '));
          li.appendChild(document.createTextNode(a.texto));
          ul.appendChild(li);
        });
        nome.appendChild(ul);
      }
      tr.appendChild(nome);

      var uso = el('td'), caixa = el('div', 'uso-tend');
      caixa.appendChild(sparkline(serieDe(c, d.periodo)));
      var nums = el('div', 'uso-tend__n');
      nums.appendChild(el('strong', null, num(c.volume)));
      var tend = comparar(c.volume, c.volume_anterior, true);
      if (tend.textContent) { tend.title = 'Comparado com o período anterior (' + num(c.volume_anterior) + ')'; nums.appendChild(tend); }
      caixa.appendChild(nums);
      uso.appendChild(caixa);
      tr.appendChild(uso);

      var fn = el('td', 'uso-funcoes');
      var paradas = c.ativo ? c.configuradas.filter(function (f) { return c.funcoes.indexOf(f) < 0; }) : [];
      if (c.funcoes.length || paradas.length) {
        var chips = el('ul', 'chips');
        c.funcoes.forEach(function (f) { chips.appendChild(el('li', 'chip', NOMES_FUNCAO[f] || f)); });
        paradas.forEach(function (f) {
          var li = el('li', 'chip chip--parada', (NOMES_FUNCAO[f] || f) + ' (sem uso)');
          li.title = 'Ligada, mas sem uso no período';
          chips.appendChild(li);
        });
        fn.appendChild(chips);
      } else fn.appendChild(el('span', 'sub', 'nenhuma no período'));
      tr.appendChild(fn);

      tr.appendChild(celula(dataHora(c.ultima_acao_em), 'Acesso: ' + dataHora(c.ultimo_uso_em) + (c.versao && c.versao.extensao ? ' · v' + c.versao.extensao : '')));

      var acao = el('td');
      var aberto = usoAberto === c.id;
      var ver = botao(aberto ? 'Fechar' : 'Ver', (aberto ? 'Fechar o detalhe de ' : 'Ver o detalhe de ') + c.nome, function () {
        usoAberto = aberto ? null : c.id;
        desenharUso();
        var volta = document.querySelector('#uso-lista [data-uso="' + c.id + '"]');
        if (volta) volta.focus();
      });
      ver.setAttribute('aria-expanded', aberto ? 'true' : 'false');
      ver.setAttribute('data-uso', c.id);
      acao.appendChild(ver);
      tr.appendChild(acao);
      tb.appendChild(tr);
      if (aberto) tb.appendChild(detalheUso(c, d.periodo));
    });
  }

  // Linha de detalhe: uso por dia (barras), os números de cada função e os dados técnicos.
  function detalheUso(c, p) {
    var tr = el('tr', 'uso-detalhe'), td = el('td');
    td.colSpan = 5;
    td.appendChild(el('h3', null, 'Uso por dia · ' + p.dias + ' dias'));
    var dias = serieDe(c, p), max = 0;
    dias.forEach(function (x) { if (x.n > max) max = x.n; });
    var barras = el('div', 'barras');
    barras.setAttribute('role', 'img');
    barras.setAttribute('aria-label', 'Uso por dia: ' + resumoSerie(dias, 'usos'));
    dias.forEach(function (x) {
      var b = el('span', 'barras__b');
      b.style.height = max && x.n ? Math.max(4, Math.round((x.n / max) * 100)) + '%' : '0';
      b.title = dataCurta(x.dia) + ': ' + num(x.n);
      barras.appendChild(b);
    });
    td.appendChild(barras);
    var total = dias.reduce(function (s, x) { return s + x.n; }, 0);
    td.appendChild(el('p', 'dica', total ? resumoSerie(dias, 'usos') + ' (ações na agenda, cobranças e atendimentos com espera).' : 'Nenhum uso gravado no período.'));

    var dl = el('dl', 'resumo');
    function linha(r, v) { dl.appendChild(el('dt', null, r)); dl.appendChild(el('dd', null, v)); }
    var a = c.acoes;
    linha('Agenda', num(a.criar) + ' marcadas · ' + num(a.remarcar) + ' remarcadas · ' + num(a.cancelar) + ' canceladas' + (c.incertos ? ' · ' + num(c.incertos) + ' a conferir' : ''));
    linha('Presença e espera', num(a.confirmar) + ' presenças · ' + num(a.ausente) + ' faltas · ' + num(c.espera.atendimentos) + ' com tempo de espera');
    linha('Cobranças', c.cobrancas.n ? num(c.cobrancas.n) + ' · ' + reais(c.cobrancas.valor) + (c.cobrancas.incertas ? ' · ' + num(c.cobrancas.incertas) + ' a conferir' : '')
      : (c.configuradas.indexOf('cobranca') >= 0 ? 'ligada, sem uso no período' : 'desligada'));
    var cf = c.confirmacoes;
    linha('Confirmação D-1', cf.enviadas || cf.falharam
      ? num(cf.enviadas) + ' enviadas (' + num(cf.manuais) + ' pelo botão) · ' + pctDe(cf.respondidas, cf.enviadas) + ' responderam · ' + num(cf.confirmadas) + ' confirmaram · ' + num(cf.falharam) + ' não entregues'
      : (c.configuradas.indexOf('confirmacao') >= 0 ? 'ligada, sem envio no período' : 'desligada'));
    linha('Atendentes', num(c.usuarios) + ' com ação gravada');
    var ev = c.eventos || {};
    linha('Telas e buscas', num(ev.abertura) + ' aberturas do ClinFy · ' + num(ev.busca_paciente) + ' buscas de paciente · ' + num(ev.agenda_dia) + ' dias da agenda · ' + num(ev.horarios) + ' consultas de horários · ' + num(ev.painel) + ' painéis');
    var ee = c.erros_erp;
    if (ee && ee.chamadas) {
      linha('Falhas do sistema (ERP)', ee.total
        ? num(ee.total) + ' em ' + num(ee.chamadas) + ' chamadas (' + pctDe(ee.total, ee.chamadas) + '): ' + ee.principais.map(function (x) { return x.erro + ' ' + num(x.n); }).join(', ')
        : 'nenhuma em ' + num(ee.chamadas) + ' chamadas');
    }
    var vs = c.versao || {};
    linha('Versão da extensão', vs.extensao ? vs.extensao + (vs.atual && vs.atual !== vs.extensao ? ' (atual: ' + vs.atual + ')' : ' (atual)') + (vs.em ? ' · vista em ' + dataHora(vs.em) : '') : 'ainda não informada');
    linha('Sistema (ERP)', nomeConector(c.erp));
    linha('Cliente desde', dataHora(c.criado_em));
    td.appendChild(dl);
    tr.appendChild(td);
    return tr;
  }

  Array.prototype.forEach.call(document.querySelectorAll('#v-uso .seg__btn'), function (b) {
    b.addEventListener('click', function () {
      usoDias = Number(b.getAttribute('data-dias'));
      Array.prototype.forEach.call(document.querySelectorAll('#v-uso .seg__btn'), function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
      carregarUso();
    });
  });
  $('uso-atualizar').addEventListener('click', carregarUso);

  conferirSessao();
})();
