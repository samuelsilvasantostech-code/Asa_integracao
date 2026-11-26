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
  // Erro ao carregar uma tela: a mensagem e um "Tentar de novo" ao lado.
  function falhou(id, texto, tentar) {
    msg(id, 'err', texto);
    var b = el('button', 'btn', 'Tentar de novo');
    b.type = 'button';
    b.addEventListener('click', function () { msg(id, null, 'Carregando…'); tentar(); });
    $(id).appendChild(b);
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
    // A aba Uso sempre abre na visão geral.
    if (id === 'nav-uso') { usoClinica = null; carregarUso(); }
  });
  // Sistemas (ERP) tem duas sub-abas: conectores e pedidos. Ir a um conector sempre mostra a primeira.
  var abaDeSistemas = ligarAbas(['sx-conectores', 'sx-pedidos']);
  // O detalhe do conector tem quatro abas: dados, documentação, configuração e teste.
  var abaDoConector = ligarAbas(['cxa-dados', 'cxa-docs', 'cxa-config', 'cxa-teste']);
  var ABAS_CLIENTE = ['da-geral', 'da-sistema', 'da-instalacao', 'da-recursos', 'da-avancado'];
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
    $('b-senha').hidden = !eu;
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
    $('b-senha').hidden = true;
    $('detalhe').hidden = true;
    $('c-lista').hidden = false;
    $('assistente').hidden = true;
    mostrarDetalheCx(false);
    if ($('dlg-cx-novo').open) $('dlg-cx-novo').close();
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
      if (r.status !== 200 || !r.body) { falhou('m-usuarios', erroDe(r), carregarUsuarios); return; }
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
    var propria = !!(eu && u.id === eu.id);
    $('dlg-senha-t').textContent = propria ? 'Trocar a minha senha' : 'Nova senha';
    $('dlg-senha-quem').textContent = propria
      ? 'A sua senha (' + u.usuario + '). As suas sessões em outros navegadores são encerradas; esta continua aberta.'
      : 'Para ' + u.nome + ' (' + u.usuario + '). As sessões abertas desse usuário são encerradas.';
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
      if (eu && u.id === eu.id) {
        // A própria senha: confirma no diálogo, que fica aberto até a pessoa fechar.
        $('dlg-nova').value = ''; $('dlg-nova2').value = '';
        msg('m-dlg-senha', 'ok', 'Senha trocada. As suas outras sessões foram encerradas.');
        $('dlg-cancelar').textContent = 'Fechar';
        $('dlg-cancelar').focus();
        return;
      }
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

  /* ---------- lista ---------- */
  function carregar() {
    return chamar('GET', '/admin/tenants').then(function (r) {
      if (r.status !== 200 || !r.body) {
        if ($('area').hidden) msg('m-acesso', 'err', erroDe(r)); else falhou('m-lista', erroDe(r), carregar);
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
    var grade = $('lista');
    grade.textContent = '';
    desenharKpisClientes();
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
    if (tenants.length && !visiveis.length) grade.appendChild(vazio('Nenhum cliente com essa busca ou filtro.'));
    visiveis.forEach(function (t) { grade.appendChild(cartaoCliente(t)); });
  }

  // Totais do topo da lista: quem está ativo, em uso e o que trava a implantação.
  function desenharKpisClientes() {
    var k = $('c-kpis');
    k.textContent = '';
    if (!tenants.length) return;
    var ativos = tenants.filter(function (t) { return t.ativo; });
    var conta = function (f) { return ativos.filter(f).length; };
    var emUso = conta(function (t) { var d = diasDesde(t.ultimo_uso_em); return d != null && d < 7; });
    kpi2(k, 'Clientes ativos', num(ativos.length), tenants.length - ativos.length ? num(tenants.length - ativos.length) + ' desligado(s)' : 'nenhum desligado');
    kpi2(k, 'Em uso', num(emUso) + ' de ' + num(ativos.length), 'usaram nos últimos 7 dias');
    kpi2(k, 'Com pendência', num(conta(function (t) { return pendencias(t).length > 0; })), 'algo falta para usar');
    kpi2(k, 'Sem acesso ao sistema', num(conta(function (t) { return !t.tem_credencial && !pedidoDe(t); })), 'credencial do ERP não cadastrada');
    kpi2(k, 'Aguardando conector', num(conta(function (t) { return !!pedidoDe(t); })), 'sistema ainda sem conector');
    kpi2(k, 'Sem uso há 7+ dias', num(conta(function (t) { var d = diasDesde(t.ultimo_uso_em); return d == null || d >= 7; })), 'ou que nunca usaram');
  }

  function quandoUsou(t) {
    var d = diasDesde(t.ultimo_uso_em);
    return d == null ? 'Nunca usou' : d <= 0 ? 'Usou hoje' : d === 1 ? 'Usou ontem' : 'Usou há ' + d + ' dias';
  }

  // Cartão clicável do cliente: situação, sistema, último uso e o que falta.
  function cartaoCliente(t) {
    var st = situacao(t), lp = pendencias(t), ped = pedidoDe(t);
    var grave = lp.some(function (p) { return p.grave; });
    var b = el('button', 'cartao-clinica cartao-cliente' + (grave ? ' cartao-clinica--critico' : lp.length ? ' cartao-clinica--aviso' : ''));
    b.type = 'button';
    b.setAttribute('data-id', t.id);
    var topo = el('div', 'cartao-clinica__topo');
    topo.appendChild(el('span', 'cartao-clinica__nome', t.nome));
    topo.appendChild(selo(st.tom, t.ativo ? st.texto : 'Desligado'));
    b.appendChild(topo);
    b.appendChild(el('div', 'cartao-conector__id', ped ? ped.sistema + ' · aguardando conector' : nomeConector(t.erp || 'asa') + (t.sistema_nome ? ' · nas telas: ' + t.sistema_nome : '')));
    var d = diasDesde(t.ultimo_uso_em);
    var uso = el('div', 'cartao-cliente__uso' + (t.ativo && (d == null || d >= 7) ? ' cartao-cliente__uso--parado' : ''));
    uso.appendChild(el('span', 'cartao-cliente__quando', quandoUsou(t)));
    if (t.ultimo_uso_em) uso.appendChild(el('span', 'cartao-clinica__un', dataHora(t.ultimo_uso_em)));
    b.appendChild(uso);
    if (!t.ativo) b.appendChild(el('div', 'cartao-clinica__motivo cartao-clinica__motivo--neutro', t.desligado_em ? 'Desligado em ' + dataHora(t.desligado_em).split(',')[0] : 'Inativo'));
    else if (!lp.length) b.appendChild(el('div', 'cartao-clinica__motivo cartao-clinica__motivo--ok', 'Em dia'));
    else {
      var mostrar = lp.slice(0, 3);
      if (lp.length > 3) mostrar = lp.slice(0, 2).concat([{ texto: 'e mais ' + (lp.length - 2) }]);
      b.appendChild(listaDePendencias(mostrar));
    }
    var pe = el('div', 'cartao-clinica__pe');
    pe.appendChild(el('span', null, (t.kentro_instancia || 'Instância não informada') + (t.kentro_instalacao_id != null ? ' · #' + t.kentro_instalacao_id : '')));
    pe.appendChild(el('span', null, 'Desde ' + dataHora(t.criado_em).split(',')[0]));
    b.appendChild(pe);
    if (t.observacao) b.title = t.observacao;
    b.setAttribute('aria-label', t.nome + ', ' + (t.ativo ? st.texto : 'desligado') + ', ' + quandoUsou(t).toLowerCase() + (lp.length ? ', ' + lp.length + (lp.length === 1 ? ' pendência' : ' pendências') : t.ativo ? ', em dia' : '') + '. Abrir a ficha.');
    b.addEventListener('click', function () { abrir(t, true); });
    return b;
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
    $('c-lista').hidden = true;
    $('assistente').hidden = false;
    etapa(1);
    window.scrollTo(0, 0);
    $('w-nome').focus();
  }

  function fecharAssistente() {
    if (wiz && wiz.etapa === 4 && $('w-chave').textContent && !window.confirm('A chave da instalação não aparece de novo. Já copiou?')) return;
    var criado = wiz && wiz.tenant;
    wiz = null;
    $('assistente').hidden = true;
    $('w-chave').textContent = '';
    // Sem cliente criado, volta para a lista; com cliente, abre a ficha dele.
    if (!criado) { $('c-lista').hidden = false; $('b-novo').focus(); return; }
    carregar().then(function () {
      var t = tenants.filter(function (x) { return x.id === criado.id; })[0];
      if (t) abrir(t, true); else $('c-lista').hidden = false;
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
    var b = id && document.querySelector('#lista [data-id="' + id + '"]');
    if (b) b.focus();
  }

  function resumo(t) {
    var k = $('resumo');
    k.textContent = '';
    var ped = pedidoDe(t), st = situacao(t), d = diasDesde(t.ultimo_uso_em);
    $('d-situacao').textContent = '';
    $('d-situacao').appendChild(el('span', 'selo selo--' + st.tom, st.texto));
    $('d-sub').textContent = [t.kentro_instancia || 'Instância da Kentro não informada', t.implantado_por ? 'implantado por ' + t.implantado_por : ''].filter(Boolean).join(' · ');
    [
      ['Sistema (ERP)', ped ? ped.sistema : nomeConector(t.erp || 'asa'), ped ? 'Aguardando conector' : t.sistema_nome ? 'Nas telas: ' + t.sistema_nome : 'conector ' + (t.erp || 'asa'), !!ped],
      ['Acesso ao sistema', t.tem_credencial ? 'Ok' : 'Sem acesso', t.tem_credencial ? (t.erp_testado_em ? 'Testado em ' + dataHora(t.erp_testado_em) : 'Não testado') : 'Cadastre na aba Sistema', !t.tem_credencial],
      ['Instalação na Kentro', t.kentro_instalacao_id != null ? '#' + t.kentro_instalacao_id : 'Não anotada', t.kentro_instancia || 'instância não informada', t.kentro_instalacao_id == null],
      ['Último uso', t.ultimo_uso_em ? (d === 0 ? 'Hoje' : d === 1 ? 'Ontem' : 'Há ' + d + ' dias') : 'Nunca', t.ultimo_uso_em ? dataHora(t.ultimo_uso_em) : 'nenhuma ação gravada', t.ativo && (d == null || d >= 7)],
      ['Cliente desde', dataHora(t.criado_em).split(',')[0], t.implantado_por ? 'por ' + t.implantado_por : '', false]
    ].forEach(function (p) {
      kpi2(k, p[0], p[1], p[2]);
      if (p[3]) k.lastChild.classList.add('kpi2--falta');
    });
    visaoGeral(t);
  }

  // Uso da clínica na Visão geral: mesma fonte da aba Uso (30 dias), só a linha desta clínica.
  var usoFichaSeq = 0;
  function usoNaFicha(t) {
    var s = ++usoFichaSeq, box = $('g-uso');
    box.textContent = '';
    box.appendChild(el('p', 'painel-uso__sub', 'Carregando…'));
    $('g-uso-ver').hidden = true;
    chamar('GET', '/admin/uso?dias=30').then(function (r) {
      if (s !== usoFichaSeq || !atual || atual.id !== t.id) return;
      box.textContent = '';
      if (r.status !== 200 || !r.body) { box.appendChild(vazio('Não deu para carregar o uso agora.')); return; }
      var c = (r.body.clinicas || []).filter(function (x) { return x.id === t.id; })[0];
      if (!c) { box.appendChild(vazio('Sem dados de uso para este cliente.')); return; }
      var linha = el('div', 'kpi2__linha');
      linha.appendChild(el('span', 'kpi2__num', num(c.volume)));
      linha.appendChild(el('span', 'cartao-clinica__un', c.volume === 1 ? 'uso' : 'usos'));
      var dl = delta(c.volume, c.volume_anterior);
      if (dl.textContent) linha.appendChild(dl);
      linha.appendChild(selo(c.saude.tom, c.saude.texto));
      box.appendChild(linha);
      box.appendChild(el('p', 'painel-uso__sub', 'Ações na agenda, cobranças e atendimentos com espera, comparados com os 30 dias anteriores.'));
      var caixa = el('div', 'graf-area graf-area--baixa');
      box.appendChild(caixa);
      grafArea(caixa, serieDe(c, r.body.periodo), 'usos', 'Uso por dia de ' + c.nome);
      $('g-uso-ver').hidden = false;
    });
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
      ['Lançar cobrança', t.financeiro && t.financeiro.ativo, t.financeiro && t.financeiro.ativo ? (t.financeiro.quem === 'todos' ? 'Todos os atendentes' : 'Só administradores') : 'Desligado', 'f-fin'],
      ['Confirmação de véspera', c.ativo, c.ativo ? (c.dias_antes + (c.dias_antes === 1 ? ' dia antes' : ' dias antes') + ' · ' + (c.canal === 'oficial' ? 'WhatsApp oficial' : 'WhatsApp não oficial') + (c.teste && c.teste.ativo ? ' · modo teste' : '')) : 'Desligada', 'f-conf'],
      ['URL de disparo', !!t.disparo_url, t.disparo_url ? 'Configurada' : 'Não configurada', 'f-disparo']
    ].forEach(function (r) {
      var item = el('div');
      item.appendChild(el('dt', null, r[0]));
      var dd = el('dd');
      dd.appendChild(el('span', 'selo selo--' + (r[1] ? 'ok' : 'idle'), r[1] ? 'Ligado' : 'Desligado'));
      dd.appendChild(el('span', 'sub', r[2]));
      item.appendChild(dd);
      var ir = botao('Abrir', 'Abrir ' + r[0], function () { irParaRecurso(r[3]); });
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
      usoNaFicha(t);
    }
    FORMS_CLIENTE.forEach(function (f) { if (!manter(f)) fotografar(f); });
    marcarAbas();
    sistemaDoCliente(t);
    if (mostrar) { window.scrollTo(0, 0); $('h-detalhe').focus(); }
  }

  /* ---------- alterações não salvas ---------- */
  // "Foto" dos valores de cada formulário logo depois de preenchido. Diferente da foto = alteração não salva.
  // Campos vazios ficam de fora: campos de acesso que chegam depois (vazios) não contam como alteração.
  var ABA_DO_FORM = { 'f-erp': 'da-sistema', 'f-token': 'da-sistema', 'f-d-doc': 'da-sistema', 'f-vinculo': 'da-instalacao', 'f-fin': 'da-recursos', 'f-conf': 'da-recursos', 'f-disparo': 'da-recursos' };
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
      caixa.appendChild(el('p', 'dica', 'Este sistema ainda não tem conector publicado (pedido ' + (PEDIDOS[d.pedido.situacao] ? PEDIDOS[d.pedido.situacao].texto : d.pedido.situacao).toLowerCase() + ' desde ' + dataHora(d.pedido.criado_em) + '). A documentação anexada abaixo vai para o conector dele; quando ele for publicado, escolha-o aqui em "Sistema" e preencha o acesso.'));
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
  // Rascunho e arquivado são neutros (não são erro); homologação pede atenção.
  var SITUACOES = { rascunho: { tom: 'idle', texto: 'Rascunho' }, homologacao: { tom: 'warn', texto: 'Homologação' }, publicado: { tom: 'ok', texto: 'Publicado' }, arquivado: { tom: 'idle', texto: 'Arquivado' } };
  var PEDIDOS = { aberto: { tom: 'warn', texto: 'Aberto' }, em_andamento: { tom: 'idle', texto: 'Em andamento' }, atendido: { tom: 'ok', texto: 'Atendido' }, recusado: { tom: 'idle', texto: 'Recusado' } };
  var ORDEM_SITUACAO = { homologacao: 0, rascunho: 1, publicado: 2, arquivado: 3 };
  var cxFiltro = 'todos', cxBusca = '', pedFiltro = 'abertos';
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

  function pedidoEmAberto(p) { return p.situacao === 'aberto' || p.situacao === 'em_andamento'; }

  function carregarConectores() {
    return chamar('GET', '/admin/conectores').then(function (r) {
      if (r.status !== 200 || !r.body) { falhou('m-cx', erroDe(r), carregarConectores); return; }
      conectores = r.body.conectores || [];
      pedidos = r.body.pedidos || [];
      camposCache = {};
      msg('m-cx', null, '');
      desenharCentral();
      var abertos = pedidos.filter(pedidoEmAberto).length;
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
  function nomeDoConector(c) { return c.slug === 'padrao' ? 'Sistema próprio (padrão Kentro)' : c.nome; }
  function dataCurtaDe(v) { return v ? dataHora(v).split(',')[0] : '—'; }
  function haTempo(v) {
    var d = diasDesde(v);
    return d == null ? '—' : d <= 0 ? 'hoje' : d === 1 ? 'ontem' : 'há ' + d + ' dias';
  }
  function plural(n, um, varios) { return num(n) + ' ' + (n === 1 ? um : varios); }

  // O que falta para o conector andar, só com os dados da lista. null = nada a fazer.
  function faltaDe(c) {
    if (c.slug === 'padrao') return { tom: 'idle', texto: 'Interno: clínicas com sistema próprio' };
    if (c.situacao === 'arquivado') return { tom: 'idle', texto: 'Arquivado: não aparece para as clínicas' };
    if (c.situacao === 'rascunho') return c.documentos || c.tipo === 'codigo' ? { tom: 'warn', texto: 'Falta configurar, testar e enviar para homologação' } : { tom: 'warn', texto: 'Falta anexar a documentação da API' };
    if (c.situacao === 'homologacao') return { tom: 'warn', texto: 'Em homologação: falta publicar' };
    if (!c.clinicas) return { tom: 'idle', texto: 'Publicado, ainda sem clínicas' };
    return null;
  }

  // Botões .seg com data-filtro: marca o escolhido e avisa quem chamou.
  function ligarSeg(id, aoEscolher) {
    Array.prototype.forEach.call(document.querySelectorAll('#' + id + ' .seg__btn'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('#' + id + ' .seg__btn'), function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        aoEscolher(b.getAttribute('data-filtro'));
      });
    });
  }
  function contarNoSeg(id, chave, n) { var s = document.querySelector('#' + id + ' [data-n="' + chave + '"]'); if (s) s.textContent = String(n); }

  function desenharCentral() {
    desenharKpisCx();
    desenharConectores();
    desenharPedidos();
  }

  function desenharKpisCx() {
    var k = $('cx-kpis');
    k.textContent = '';
    var conta = function (s) { return conectores.filter(function (c) { return c.situacao === s; }).length; };
    var soma = function (campo) { return conectores.reduce(function (s, c) { return s + (c[campo] || 0); }, 0); };
    var abertos = pedidos.filter(pedidoEmAberto).length;
    kpi2(k, 'Publicados', num(conta('publicado')), 'aparecem para todas as clínicas');
    kpi2(k, 'Em homologação', num(conta('homologacao')), 'em teste numa clínica');
    kpi2(k, 'Rascunhos', num(conta('rascunho')), 'em construção');
    kpi2(k, 'Clínicas conectadas', num(soma('clinicas')), 'somando todos os sistemas');
    kpi2(k, 'Documentos de API', num(soma('documentos')), 'anexados aos conectores');
    kpi2(k, 'Pedidos em aberto', num(abertos), abertos ? 'aguardando um conector' : 'nenhum aguardando');
  }

  function desenharConectores() {
    ['publicado', 'homologacao', 'rascunho', 'arquivado'].forEach(function (s) {
      contarNoSeg('cx-filtro', s, conectores.filter(function (c) { return c.situacao === s; }).length);
    });
    contarNoSeg('cx-filtro', 'todos', conectores.length);
    var busca = dobrado(cxBusca.trim());
    var max = conectores.reduce(function (m, c) { return Math.max(m, c.clinicas || 0); }, 0);
    var lista = conectores.filter(function (c) {
      return (cxFiltro === 'todos' || c.situacao === cxFiltro) && (!busca || dobrado(nomeDoConector(c) + ' ' + c.slug).indexOf(busca) >= 0);
    }).sort(function (a, b) {
      var oa = ORDEM_SITUACAO[a.situacao], ob = ORDEM_SITUACAO[b.situacao];
      return (oa == null ? 9 : oa) - (ob == null ? 9 : ob) || nomeDoConector(a).localeCompare(nomeDoConector(b), 'pt-BR');
    });
    $('cx-contagem').textContent = plural(lista.length, 'sistema', 'sistemas');
    var grade = $('cx-lista');
    grade.textContent = '';
    if (!lista.length) {
      grade.appendChild(vazio(conectores.length ? 'Nenhum sistema neste filtro.' : 'Nenhum sistema cadastrado. Crie o primeiro em + Novo sistema.'));
      return;
    }
    lista.forEach(function (c) { grade.appendChild(cartaoConector(c, max)); });
  }

  function cartaoConector(c, max) {
    var st = SITUACOES[c.situacao] || { tom: 'idle', texto: c.situacao };
    var nome = nomeDoConector(c), falta = faltaDe(c);
    var b = el('button', 'cartao-clinica cartao-conector' + (c.situacao === 'homologacao' ? ' cartao-clinica--aviso' : ''));
    b.type = 'button';
    b.dataset.slug = c.slug;
    var topo = el('div', 'cartao-clinica__topo');
    topo.appendChild(el('span', 'cartao-clinica__nome', nome));
    topo.appendChild(selo(st.tom, st.texto));
    b.appendChild(topo);
    b.appendChild(el('div', 'cartao-conector__id', c.slug + ' · ' + (c.tipo === 'codigo' ? 'adaptador em código' : 'configuração') + ' · v' + c.versao));
    var linha = el('div', 'cartao-clinica__linha');
    linha.appendChild(el('span', 'cartao-clinica__num', num(c.clinicas)));
    linha.appendChild(el('span', 'cartao-clinica__un', c.clinicas === 1 ? 'clínica usa' : 'clínicas usam'));
    b.appendChild(linha);
    var trilho = el('span', 'barras-h__trilho cartao-conector__trilho'), barra = el('span', 'barras-h__barra');
    barra.style.width = max && c.clinicas ? Math.max(3, (c.clinicas / max) * 100) + '%' : '0';
    trilho.appendChild(barra);
    b.appendChild(trilho);
    if (falta) b.appendChild(el('div', 'cartao-clinica__motivo' + (falta.tom === 'idle' ? ' cartao-clinica__motivo--neutro' : ''), falta.texto));
    var pe = el('div', 'cartao-clinica__pe');
    pe.appendChild(el('span', null, c.documentos ? plural(c.documentos, 'documento', 'documentos') : 'Sem documentação'));
    pe.appendChild(el('span', null, 'Atualizado ' + dataCurtaDe(c.atualizado_em)));
    b.appendChild(pe);
    b.setAttribute('aria-label', nome + ', ' + st.texto + ', ' + plural(c.clinicas, 'clínica', 'clínicas') + (falta ? ', ' + falta.texto : '') + '. Abrir o conector.');
    b.addEventListener('click', function () { abrirConector(c.slug); });
    return b;
  }

  var FILTROS_PEDIDO = {
    abertos: pedidoEmAberto,
    atendido: function (p) { return p.situacao === 'atendido'; },
    recusado: function (p) { return p.situacao === 'recusado'; },
    todos: function () { return true; }
  };

  function desenharPedidos() {
    Object.keys(FILTROS_PEDIDO).forEach(function (f) { contarNoSeg('cx-ped-filtro', f, pedidos.filter(FILTROS_PEDIDO[f]).length); });
    var lista = pedidos.filter(FILTROS_PEDIDO[pedFiltro]).sort(function (a, b) { return String(b.criado_em).localeCompare(String(a.criado_em)); });
    var grade = $('cx-pedidos');
    grade.textContent = '';
    if (!lista.length) {
      grade.appendChild(vazio(pedFiltro === 'abertos' ? 'Nenhum pedido em aberto. Os pedidos chegam das clínicas e do assistente de novo cliente.' : 'Nenhum pedido aqui.'));
      return;
    }
    lista.forEach(function (p) { grade.appendChild(cartaoPedido(p)); });
  }

  function cartaoPedido(p) {
    var st = PEDIDOS[p.situacao] || { tom: 'idle', texto: p.situacao };
    var aberto = pedidoEmAberto(p);
    var a = el('article', 'cartao-clinica cartao-pedido' + (p.situacao === 'aberto' ? ' cartao-clinica--aviso' : ''));
    var topo = el('div', 'cartao-clinica__topo');
    topo.appendChild(el('h3', 'cartao-clinica__nome', p.sistema));
    topo.appendChild(selo(st.tom, st.texto));
    a.appendChild(topo);
    var quem = el('div', 'cartao-pedido__quem');
    quem.appendChild(el('span', null, p.clinica || 'Clínica não informada'));
    if (p.contato) quem.appendChild(el('span', null, p.contato));
    a.appendChild(quem);
    if (p.observacao) a.appendChild(el('p', 'cartao-pedido__obs', p.observacao));
    var quando = el('time', 'cartao-pedido__quando', 'Pedido ' + haTempo(p.criado_em));
    quando.setAttribute('datetime', p.criado_em || '');
    quando.title = dataHora(p.criado_em);
    a.appendChild(quando);
    var acoes = el('div', 'cartao-pedido__acoes');
    var principal = null;
    if (p.conector_slug) principal = botao('Abrir conector', 'Abrir o conector de ' + p.sistema, function () { abrirConector(p.conector_slug); });
    else if (aberto) principal = botao('Criar conector', 'Criar conector para ' + p.sistema, function () { comecarPeloPedido(p); });
    if (principal) { principal.classList.add('btn--primario'); acoes.appendChild(principal); }
    if (aberto) {
      acoes.appendChild(botao('Atendido', 'Marcar o pedido de ' + p.sistema + ' como atendido', function () { mudarPedido(p, 'atendido'); }));
      acoes.appendChild(botao('Recusar', 'Recusar o pedido de ' + p.sistema, function () {
        if (window.confirm('Recusar o pedido de ' + p.sistema + (p.clinica ? ' (' + p.clinica + ')' : '') + '?')) mudarPedido(p, 'recusado');
      }));
    }
    if (acoes.firstChild) a.appendChild(acoes);
    return a;
  }

  function slugDe(nome) {
    return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40);
  }

  // "Novo sistema" abre num diálogo; vindo de um pedido, já chega preenchido.
  function abrirNovoSistema(p) {
    pedidoAtual = p || null;
    $('f-cx-novo').reset();
    delete $('cx-n-slug').dataset.mexido;
    $('cx-n-nome').value = p ? p.sistema : '';
    $('cx-n-slug').value = p ? slugDe(p.sistema) : '';
    $('cx-novo-pedido').textContent = p ? 'Para o pedido de ' + (p.clinica || 'uma clínica') + '. Confira o nome e o identificador.' : '';
    $('cx-novo-pedido').hidden = !p;
    msg('m-cx-novo', null, '');
    previaArtigo();
    $('dlg-cx-novo').showModal();
    $('cx-n-nome').focus();
  }
  function previaArtigo() {
    var nome = $('cx-n-nome').value.trim() || 'Feegow';
    $('cx-n-previa').textContent = 'Nas telas da clínica: "' + ($('cx-n-artigo').value === 'a' ? 'na ' : 'no ') + nome + '".';
  }

  function comecarPeloPedido(p) {
    irPara('nav-sistemas');
    abrirNovoSistema(p);
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
      pedidoAtual = null;
      $('dlg-cx-novo').close();
      carregarConectores().then(function () { return abrirConector(corpo.slug, 'cxa-docs'); }).then(function () {
        msg('m-cx-acao', 'ok', 'Rascunho criado. Anexe a documentação e depois escreva a configuração.');
      });
    });
  }

  // Lista e detalhe dividem a mesma aba: um aparece, o outro some.
  function mostrarDetalheCx(sim) {
    $('cx-central').hidden = sim;
    $('cx-detalhe').hidden = !sim;
  }
  function fecharConector() {
    if (!podeDescartar(FORMS_CONECTOR)) return;
    FORMS_CONECTOR.forEach(function (f) { delete fotos[f]; });
    var slug = conectorAtual && conectorAtual.slug;
    conectorAtual = null;
    mostrarDetalheCx(false);
    window.scrollTo(0, 0);
    var volta = slug && Array.prototype.filter.call($('cx-lista').querySelectorAll('.cartao-conector'), function (b) { return b.dataset.slug === slug; })[0];
    if (volta) volta.focus(); else $('h-central').focus();
  }

  // Passos até publicar. "Homologação" e "Publicado" vêm da situação; não há registro de teste gravado.
  function etapasDoConector(c) {
    var ol = $('cx-etapas');
    ol.textContent = '';
    var docs = (c.documentos || []).length, codigo = c.tipo === 'codigo' || c.slug === 'padrao';
    var nivel = { rascunho: 0, homologacao: 1, publicado: 2 }[c.situacao];
    if (nivel == null) nivel = -1;
    var passos = [
      { nome: 'Documentação', feito: docs > 0 || codigo, sub: docs ? plural(docs, 'anexado', 'anexados') : codigo ? 'no código' : 'falta anexar' },
      { nome: 'Configuração', feito: codigo || !!c.config, sub: codigo ? 'no código' : c.config ? 'v' + c.versao : 'falta escrever' },
      { nome: 'Homologação', feito: nivel >= 2, sub: nivel >= 2 ? 'concluída' : nivel === 1 ? 'em teste agora' : 'uma clínica testa' },
      { nome: 'Publicado', feito: nivel >= 2, sub: nivel >= 2 ? dataCurtaDe(c.publicado_em) : 'todas as clínicas veem' }
    ];
    var atualMarcado = false;
    passos.forEach(function (p) {
      var li = el('li');
      var estado = p.feito ? 'feita' : atualMarcado ? '' : 'atual';
      if (!p.feito) atualMarcado = true;
      if (estado) li.setAttribute('data-estado', estado);
      li.appendChild(el('span', null, p.nome));
      li.appendChild(el('span', 'etapas__sub', p.sub));
      li.appendChild(el('span', 'sr', p.feito ? ' (concluído)' : ' (pendente)'));
      ol.appendChild(li);
    });
    ol.hidden = c.situacao === 'arquivado';
  }

  // Ação principal conforme a situação (a mesma rota do formulário Dados).
  function acoesDoConector(c) {
    var box = $('cx-acoes');
    box.textContent = '';
    var proxima = { rascunho: ['homologacao', 'Enviar para homologação'], homologacao: ['publicado', 'Publicar'], arquivado: ['rascunho', 'Reativar como rascunho'] }[c.situacao];
    if (!proxima || c.slug === 'padrao') return;
    var b = botao(proxima[1], null, function () { mudarSituacao(c, proxima[0]); });
    if (c.situacao !== 'arquivado') b.classList.add('btn--primario');
    box.appendChild(b);
  }

  function mudarSituacao(c, situacao) {
    if (situacao === 'publicado' && !window.confirm('Publicar ' + c.nome + '? Ele passa a aparecer para todas as clínicas escolherem.')) return;
    msg('m-cx-acao', null, 'Salvando…');
    chamar('POST', '/admin/conectores/' + encodeURIComponent(c.slug) + '/situacao', { situacao: situacao }).then(function (r) {
      if (r.status !== 200) {
        var extra = r.body && r.body.clinicas ? ' (' + r.body.clinicas + ' clínica(s) ativa(s) usam este conector)' : '';
        msg('m-cx-acao', 'err', erroDe(r) + extra);
        return;
      }
      carregarConectores().then(function () { return abrirConector(c.slug); }).then(function () {
        msg('m-cx-acao', 'ok', 'Situação: ' + SITUACOES[situacao].texto + '.');
      });
    });
  }

  function abrirConector(slug, aba) {
    if (conectorAtual && conectorAtual.slug !== slug && !podeDescartar(FORMS_CONECTOR)) return Promise.resolve();
    return chamar('GET', '/admin/conectores/' + encodeURIComponent(slug)).then(function (r) {
      if (r.status !== 200 || !r.body) { msg(conectorAtual ? 'm-cx-acao' : 'm-cx', 'err', erroDe(r)); return; }
      var c = r.body;
      var mesmo = conectorAtual && conectorAtual.slug === c.slug;
      var manter = function (f) { return mesmo && sujo(f); };
      var kDados = manter('f-cx-dados'), kConfig = manter('f-cx-config'), kDoc = manter('f-cx-doc');
      conectorAtual = c;
      if ($('v-sistemas').hidden) irPara('nav-sistemas');
      mostrarDetalheCx(true);
      var daLista = conectores.filter(function (x) { return x.slug === c.slug; })[0] || {};
      var st = SITUACOES[c.situacao] || { tom: 'idle', texto: c.situacao };
      $('cx-titulo').textContent = nomeDoConector(c);
      $('cx-selo').textContent = '';
      $('cx-selo').appendChild(selo(st.tom, st.texto));
      $('cx-sub').textContent = c.slug + ' · ' + (c.tipo === 'codigo' ? 'adaptador em código (não editável aqui)' : 'conector por configuração') + (c.observacao ? ' · ' + c.observacao : '');
      etapasDoConector(c);
      acoesDoConector(c);
      var k = $('cx-resumo');
      k.textContent = '';
      kpi2(k, 'Clínicas', num(daLista.clinicas), 'usam este sistema');
      kpi2(k, 'Documentos', num((c.documentos || []).length), 'de API anexados');
      kpi2(k, 'Versão', 'v' + c.versao, c.tipo === 'codigo' ? 'adaptador em código' : 'sobe a cada gravação');
      kpi2(k, 'Atualizado', dataCurtaDe(c.atualizado_em), haTempo(c.atualizado_em));
      kpi2(k, 'Publicado em', c.publicado_em ? dataCurtaDe(c.publicado_em) : '—', c.publicado_em ? haTempo(c.publicado_em) : 'ainda não publicado');
      if (!kDados) {
        $('cx-nome').value = c.nome;
        $('cx-artigo').value = c.artigo;
        $('cx-situacao').value = c.situacao;
        $('cx-obs').value = c.observacao || '';
      }
      var cfg = c.config_efetiva || c.config || (c.tipo === 'codigo' ? null : MODELO_CONECTOR);
      if (!kConfig) $('cx-config').value = cfg ? JSON.stringify(cfg, null, 2) : '';
      $('cx-config').disabled = c.tipo === 'codigo' || c.slug === 'padrao';
      $('f-cx-config').querySelector('button[type="submit"]').disabled = $('cx-config').disabled;
      if (!kConfig) preencherGuiado();
      $('cx-erros').textContent = '';
      ['m-cx-dados', 'm-cx-config', 'm-cx-doc', 'm-cx-teste'].forEach(function (id) { msg(id, null, ''); });
      if (!mesmo) msg('m-cx-acao', null, '');
      if (c.slug === 'padrao') msg('m-cx-config', null, 'O padrão Kentro não traduz nada: a configuração é a do código, só para consulta.');
      else if (c.tipo === 'codigo') msg('m-cx-config', null, 'Este adaptador é código: a configuração aparece só para consulta.');
      desenharDocs($('cx-docs'), c.documentos || [], c.slug, 'm-cx-doc', function () { abrirConector(c.slug); carregarConectores(); });
      montarCampos($('cx-teste-campos'), c.campos || [], 'cx-t-');
      if (!mesmo) $('cx-passos').textContent = '';
      if (!kDados) fotografar('f-cx-dados');
      if (!kConfig) fotografar('f-cx-config');
      if (!kDoc) fotografar('f-cx-doc');
      if (aba) abaDoConector(aba);
      else if (!mesmo) abaDoConector('cxa-dados');
      if (!mesmo) { window.scrollTo(0, 0); $('cx-titulo').focus(); }
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

  /* ---------- Configuração do conector: formulário guiado ---------- */
  // O formulário cobre a parte comum (endereço, acesso, campos, idempotência, especificação) e escreve no
  // JSON; rotas, cabeçalhos e erros ficam só no JSON. O JSON é a fonte: chaves que o formulário não conhece
  // são preservadas. Regras iguais às de validarConector (motor.ts).
  var CHAVE_CAMPO = /^[a-z][a-z0-9_]{0,39}$/;
  var BASE_CLINICA = '{{cred.base_url}}';
  var AUT_PADRAO = { campo: 'token', usuario: 'usuario', senha: 'senha' };
  var AUT_DICA = {
    nenhuma: 'Nenhuma credencial é enviada.',
    bearer: 'Envia Authorization: Bearer seguido do valor do campo escolhido.',
    header: 'Envia o valor do campo escolhido no cabeçalho informado (vazio = Authorization).',
    basic: 'Envia Authorization: Basic com usuário e senha dos campos escolhidos.',
    query: 'Acrescenta ?parametro=valor em toda chamada (vazio = token).'
  };
  var AUT_ALVOS = { bearer: ['campo'], header: ['campo', 'header'], query: ['campo', 'param'], basic: ['usuario', 'senha'], nenhuma: [] };

  function cfgDoJson() {
    try {
      var o = JSON.parse($('cx-config').value);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
    } catch (e) { return null; }
  }
  function escreverJson(cfg) { $('cx-config').value = JSON.stringify(cfg, null, 2); }

  function linhaCampo(f) {
    var li = el('div', 'cxg-campo');
    function caixa(rotulo, controle, cls) {
      var l = el('label', 'campo' + (cls ? ' ' + cls : ''));
      l.appendChild(el('span', null, rotulo));
      l.appendChild(controle);
      li.appendChild(l);
      return controle;
    }
    var chave = caixa('Chave', el('input'));
    chave.className = 'mono';
    chave.spellcheck = false;
    chave.maxLength = 40;
    chave.value = f.chave || '';
    chave.setAttribute('data-k', 'chave');
    var rot = caixa('Rótulo na tela', el('input'));
    rot.value = f.rotulo || '';
    rot.setAttribute('data-k', 'rotulo');
    var tipo = el('select');
    [['texto', 'Texto'], ['segredo', 'Segredo'], ['url', 'Endereço (URL)']].forEach(function (o) {
      var op = el('option', null, o[1]);
      op.value = o[0];
      tipo.appendChild(op);
    });
    tipo.value = ['texto', 'segredo', 'url'].indexOf(f.tipo) >= 0 ? f.tipo : 'texto';
    tipo.setAttribute('data-k', 'tipo');
    caixa('Tipo', tipo);
    var ajuda = caixa('Ajuda (opcional)', el('input'), 'cxg-campo__ajuda');
    ajuda.value = f.ajuda || '';
    ajuda.setAttribute('data-k', 'ajuda');
    var ob = el('label', 'marca cxg-campo__ob');
    var cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!f.obrigatorio;
    cb.setAttribute('data-k', 'obrigatorio');
    ob.appendChild(cb);
    ob.appendChild(el('span', null, 'Obrigatório'));
    li.appendChild(ob);
    var rm = el('button', 'btn cxg-campo__rm', 'Remover');
    rm.type = 'button';
    rm.setAttribute('aria-label', 'Remover o campo ' + (f.chave || ''));
    rm.addEventListener('click', function () { li.remove(); guiadoMudou(); });
    li.appendChild(rm);
    return li;
  }

  // Campos extras de cada item (ex.: um "padrao" que só o JSON conhece) voltam iguais.
  var camposOriginais = [];
  function camposDaTela() {
    return Array.prototype.map.call($('cxg-campos').querySelectorAll('.cxg-campo'), function (li) {
      var v = {};
      Array.prototype.forEach.call(li.querySelectorAll('[data-k]'), function (e) {
        v[e.getAttribute('data-k')] = e.type === 'checkbox' ? e.checked : e.value.trim();
      });
      var orig = camposOriginais.filter(function (o) { return o && o.chave === li.getAttribute('data-chave'); })[0] || {};
      var f = {};
      Object.keys(orig).forEach(function (k) { f[k] = orig[k]; });
      f.chave = v.chave;
      f.rotulo = v.rotulo;
      f.tipo = v.tipo;
      if (v.obrigatorio) f.obrigatorio = true; else delete f.obrigatorio;
      if (v.ajuda) f.ajuda = v.ajuda; else delete f.ajuda;
      return f;
    });
  }

  function opcoesDeCampo(sel, chaves, atual) {
    sel.textContent = '';
    var lista = chaves.slice();
    if (atual && lista.indexOf(atual) < 0) lista.push(atual);
    if (!lista.length) lista.push('');
    lista.forEach(function (k) {
      var op = el('option', null, !k ? '(nenhum campo)' : chaves.indexOf(k) < 0 ? k + ' (não existe nos campos)' : k);
      op.value = k;
      sel.appendChild(op);
    });
    sel.value = atual || '';
  }

  function mostrarAut() {
    var t = $('cxg-aut').value;
    Array.prototype.forEach.call($('cxg').querySelectorAll('[data-aut]'), function (l) {
      l.hidden = l.getAttribute('data-aut').split(' ').indexOf(t) < 0;
    });
    $('cxg-aut-dica').textContent = AUT_DICA[t] || '';
    $('cxg-idem-nome-caixa').hidden = $('cxg-idem').value !== 'outro';
  }

  // Leva o JSON para o formulário. `campos` = false mantém a lista da tela (para não perder o foco ao digitar nela).
  function preencherGuiado(campos) {
    var cfg = cfgDoJson();
    var travado = $('cx-config').disabled;
    $('cxg-aviso').hidden = !!cfg || travado;
    Array.prototype.forEach.call($('cxg').querySelectorAll('input, select, button'), function (e) { e.disabled = travado || !cfg; });
    if (!cfg) return;
    var a = cfg.autenticacao && typeof cfg.autenticacao === 'object' ? cfg.autenticacao : {};
    var lista = Array.isArray(cfg.campos) ? cfg.campos : [];
    var porClinica = cfg.base_url === BASE_CLINICA;
    $('cxg-base-clinica').checked = porClinica;
    $('cxg-base-fixo').checked = !porClinica;
    if (!porClinica) $('cxg-base').value = typeof cfg.base_url === 'string' ? cfg.base_url : '';
    $('cxg-base').disabled = $('cxg-base').disabled || porClinica;
    $('cxg-aut').value = AUT_DICA[a.tipo] ? a.tipo : 'nenhuma';
    $('cxg-aut-header').value = a.header || '';
    $('cxg-aut-param').value = a.param || '';
    var chaves = lista.map(function (f) { return f && f.chave; }).filter(Boolean);
    var alvos = AUT_ALVOS[$('cxg-aut').value];
    ['campo', 'usuario', 'senha'].forEach(function (k) {
      opcoesDeCampo($('cxg-aut-' + k), chaves, a[k] || (alvos.indexOf(k) >= 0 ? AUT_PADRAO[k] : ''));
    });
    var idem = cfg.idempotencia_header;
    $('cxg-idem').value = idem === undefined || idem === 'Idempotency-Key' ? 'padrao' : idem === null || idem === '' ? 'nenhum' : 'outro';
    $('cxg-idem-nome').value = typeof idem === 'string' && idem !== 'Idempotency-Key' ? idem : '';
    $('cxg-espec').checked = cfg.especificacao === true;
    var rotas = cfg.rotas && typeof cfg.rotas === 'object' ? Object.keys(cfg.rotas) : [];
    $('cxg-rotas').textContent = rotas.length
      ? 'Rotas traduzidas no JSON (' + rotas.length + '): ' + rotas.join(', ') + '.'
      : 'Nenhuma rota traduzida no JSON ainda' + (cfg.especificacao === true ? ': todas vão como estão na especificação.' : '.');
    if (campos !== false) {
      camposOriginais = lista;
      var box = $('cxg-campos');
      box.textContent = '';
      lista.forEach(function (f) {
        var li = linhaCampo(f || {});
        li.setAttribute('data-chave', (f && f.chave) || '');
        box.appendChild(li);
      });
      if (!lista.length) box.appendChild(el('p', 'dica cxg-vazio', 'Nenhum campo: a clínica não preenche nada.'));
      Array.prototype.forEach.call(box.querySelectorAll('input, select, button'), function (e) { e.disabled = travado; });
    }
    mostrarAut();
  }

  // Formulário → JSON. Só mexe nas chaves do formulário; o resto do JSON fica como está.
  function guiadoMudou() {
    var cfg = cfgDoJson();
    if (!cfg) return;
    var campos = camposDaTela();
    var porClinica = $('cxg-base-clinica').checked;
    if (porClinica && !campos.some(function (f) { return f.chave === 'base_url'; })) {
      // Endereço por clínica precisa do campo base_url: entra sozinho no topo da lista.
      campos.unshift({ chave: 'base_url', rotulo: 'Endereço da API', tipo: 'url', obrigatorio: true, ajuda: 'Ex.: https://erp.exemplo.com/api/v1' });
      cfg.campos = campos;
      cfg.base_url = BASE_CLINICA;
      escreverJson(cfg);
      preencherGuiado();
      return;
    }
    cfg.base_url = porClinica ? BASE_CLINICA : $('cxg-base').value.trim();
    var tipo = $('cxg-aut').value, aut = { tipo: tipo };
    AUT_ALVOS[tipo].forEach(function (k) {
      if (k === 'header' || k === 'param') { var v = $('cxg-aut-' + k).value.trim(); if (v) aut[k] = v; }
      else if ($('cxg-aut-' + k).value) aut[k] = $('cxg-aut-' + k).value;
    });
    var tipoAntes = cfg.autenticacao && cfg.autenticacao.tipo;
    cfg.autenticacao = aut;
    var idem = $('cxg-idem').value;
    if (idem === 'padrao') delete cfg.idempotencia_header;
    else if (idem === 'nenhum') cfg.idempotencia_header = null;
    else cfg.idempotencia_header = $('cxg-idem-nome').value.trim() || 'Idempotency-Key';
    if ($('cxg-espec').checked) cfg.especificacao = true; else delete cfg.especificacao;
    cfg.campos = campos;
    escreverJson(cfg);
    // Mudou o tipo de acesso ou a lista de campos: as listas de "campo com o token" se refazem.
    var chaves = campos.map(function (f) { return f.chave; }).filter(Boolean);
    ['campo', 'usuario', 'senha'].forEach(function (k) {
      var padrao = AUT_ALVOS[tipo].indexOf(k) >= 0 ? AUT_PADRAO[k] : '';
      opcoesDeCampo($('cxg-aut-' + k), chaves, aut[k] || (tipo !== tipoAntes ? padrao : $('cxg-aut-' + k).value) || padrao);
    });
    $('cxg-base').disabled = porClinica;
    mostrarAut();
    var vazio = $('cxg-campos').querySelector('.cxg-vazio');
    if (vazio && campos.length) vazio.remove();
  }

  // Erros que o formulário consegue apontar antes de ir ao servidor.
  function errosDoGuiado(cfg) {
    var erros = [], chaves = {};
    if (typeof cfg.base_url !== 'string' || !cfg.base_url) erros.push('Informe o endereço da API (ou marque que cada clínica informa o seu).');
    else if (cfg.base_url !== BASE_CLINICA && cfg.base_url.indexOf('{{') < 0 && !/^https?:\/\/\S+$/.test(cfg.base_url)) erros.push('Endereço da API: use um endereço completo, começando com https://.');
    (Array.isArray(cfg.campos) ? cfg.campos : []).forEach(function (f, i) {
      var nome = 'Campo ' + (i + 1) + (f && f.rotulo ? ' (' + f.rotulo + ')' : '');
      if (!f || !CHAVE_CAMPO.test(String(f.chave))) erros.push(nome + ': a chave usa só letras minúsculas, dígitos e _, começando por letra.');
      else if (chaves[f.chave]) erros.push(nome + ': a chave ' + f.chave + ' se repete.');
      else chaves[f.chave] = true;
      if (f && !f.rotulo) erros.push(nome + ': falta o rótulo.');
    });
    var a = cfg.autenticacao || {};
    (AUT_ALVOS[a.tipo] || []).forEach(function (k) {
      if (k === 'header' || k === 'param') return;
      var chave = a[k] || AUT_PADRAO[k];
      if (!chaves[chave]) erros.push('Autenticação: o campo ' + chave + ' não existe na lista de campos.');
    });
    if (typeof cfg.idempotencia_header === 'string' && !/^[A-Za-z0-9-]+$/.test(cfg.idempotencia_header)) erros.push('Chave de idempotência: nome de cabeçalho inválido.');
    return erros;
  }

  function salvarConfigConector(ev) {
    ev.preventDefault();
    var c = conectorAtual;
    var cfg;
    $('cx-erros').textContent = '';
    try { cfg = JSON.parse($('cx-config').value); } catch (e) { $('cx-avancado').open = true; msg('m-cx-config', 'err', 'JSON inválido: ' + e.message); return; }
    var locais = cfg && typeof cfg === 'object' ? errosDoGuiado(cfg) : [];
    if (locais.length) {
      msg('m-cx-config', 'err', 'Corrija antes de salvar:');
      locais.forEach(function (e) { $('cx-erros').appendChild(el('li', null, e)); });
      return;
    }
    if (c.situacao === 'publicado' && !window.confirm('Este conector está publicado. A nova configuração vale para todas as clínicas que o usam em até 30 segundos. Salvar?')) return;
    msg('m-cx-config', null, 'Validando…');
    chamar('PUT', '/admin/conectores/' + encodeURIComponent(c.slug), { config: cfg }).then(function (r) {
      if (r.status === 422 && r.body && r.body.erros) {
        msg('m-cx-config', 'err', 'A configuração tem ' + r.body.erros.length + ' problema(s):');
        r.body.erros.forEach(function (e) { $('cx-erros').appendChild(el('li', null, e)); });
        // Erro de rota, filtro ou regra de erro só se corrige no JSON: abre o JSON completo.
        if (r.body.erros.some(function (e) { return !/^(versao|base_url|autenticacao|campos)/.test(e); })) $('cx-avancado').open = true;
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
    agendarPrevia();
  }

  // O que a tela está editando, por cima do que está gravado: o que a tela não mostra (ex.: tamanho do lote)
  // não muda. Serve ao salvar e à prévia.
  function configDaTela() {
    var c = JSON.parse(JSON.stringify(atual.confirmacao));
    c.ativo = $('c-on').checked;
    c.dias_antes = Number($('c-dias').value);
    c.canal = $('c-canal').value;
    c.sexta_pega_segunda = $('c-sexta').checked;
    c.teste = { ativo: $('c-teste').checked, telefones: linhas($('c-telefones').value) };
    c.template = { nome: $('c-tpl-nome').value, parametros: params.map(function (p) { return p.campo === 'texto' ? { campo: 'texto', texto: p.texto || '' } : { campo: p.campo }; }) };
    TEXTOS.forEach(function (k) { c.textos[k] = $('c-t-' + k).value; });
    ACOES.forEach(function (a) { c.sinonimos[a] = $('c-s-' + a).value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); });
    return c;
  }

  /* ---------- prévia da confirmação ---------- */
  // Pede ao Conector a mensagem montada com uma consulta de exemplo (a mesma regra do envio de verdade).
  // Espera a pessoa parar de digitar; um pedido antigo que chega depois de um novo é ignorado.
  var previaSeq = 0, previaTimer = null;
  var RESPOSTAS = [['confirmado', 'Quando confirma'], ['remarcar', 'Quando pede para remarcar'], ['cancelado', 'Quando cancela'], ['ja_respondido', 'Quando responde de novo'], ['indisponivel', 'Quando o sistema está fora do ar']];
  function agendarPrevia() {
    clearTimeout(previaTimer);
    previaTimer = setTimeout(atualizarPrevia, 500);
  }
  function balao(texto) {
    var b = el('div', 'balao' + (texto ? '' : ' balao--vazio'));
    b.textContent = texto || '(vazio)';
    return b;
  }
  function atualizarPrevia() {
    if (!atual || !atual.confirmacao) return;
    var s = ++previaSeq, c = configDaTela();
    chamar('POST', rotaDo(atual.id, '/confirmacao/previa'), { config: c }).then(function (r) {
      if (s !== previaSeq) return;
      var box = $('c-previa-corpo');
      if (r.status !== 200 || !r.body || !r.body.textos) { msg('m-previa', 'err', erroDe(r)); return; }
      msg('m-previa', null, '');
      box.textContent = '';
      var b = r.body;
      box.appendChild(el('h4', null, 'Lembrete'));
      if (c.canal === 'oficial') {
        var tpl = el('div', 'balao balao--tpl');
        tpl.appendChild(el('strong', null, 'Template ' + (c.template.nome || '(sem nome)')));
        var ol = el('ol', 'previa-vars');
        (b.template || []).forEach(function (v, i) {
          var li = el('li');
          li.appendChild(el('code', null, '{{' + (i + 1) + '}}'));
          li.appendChild(el('span', null, v || '(vazio)'));
          ol.appendChild(li);
        });
        tpl.appendChild(ol);
        tpl.appendChild(el('span', 'sub', 'O texto do template fica na Meta; daqui vão só as variáveis, nesta ordem.'));
        box.appendChild(tpl);
      } else {
        box.appendChild(balao(b.textos.mensagem));
      }
      box.appendChild(el('h4', null, 'Respostas ao paciente'));
      RESPOSTAS.forEach(function (x) {
        var d = el('div', 'previa-resp');
        d.appendChild(el('span', 'sub', x[1]));
        d.appendChild(balao(b.textos[x[0]]));
        box.appendChild(d);
      });
    });
  }

  // Visão geral → Recursos: abre a aba e leva até o formulário certo.
  function irParaRecurso(form) {
    abaDoCliente('da-recursos');
    var f = $(form);
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var alvo = f.querySelector('input, select, textarea');
    if (alvo) alvo.focus({ preventScroll: true });
  }

  function salvarConfirmacao(ev) {
    ev.preventDefault();
    var c = configDaTela();
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
  $('b-senha').addEventListener('click', function () { if (eu) abrirNovaSenha(eu); });
  $('f-dlg-senha').addEventListener('submit', definirNovaSenha);
  $('dlg-cancelar').addEventListener('click', function () { $('dlg-senha').close(); });
  // Fechar (Esc, Cancelar ou depois de salvar) apaga o que foi digitado.
  // "Mostrar senha": troca o tipo dos campos ligados. Ao enviar o formulário (ou fechar o diálogo) volta a esconder,
  // para o navegador não guardar a senha como texto visível.
  function esconderSenhas(caixa) {
    Array.prototype.forEach.call(caixa.querySelectorAll('[data-mostrar]'), function (cb) {
      cb.checked = false;
      cb.getAttribute('data-mostrar').split(' ').forEach(function (id) { $(id).type = 'password'; });
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-mostrar]'), function (cb) {
    cb.addEventListener('change', function () {
      cb.getAttribute('data-mostrar').split(' ').forEach(function (id) { $(id).type = cb.checked ? 'text' : 'password'; });
    });
    var form = cb.closest('form'), dlg = cb.closest('dialog');
    form.addEventListener('submit', function () { esconderSenhas(form); }, true);
    if (dlg) dlg.addEventListener('close', function () { esconderSenhas(dlg); });
  });
  $('dlg-senha').addEventListener('close', function () { $('dlg-nova').value = ''; $('dlg-nova2').value = ''; senhaDe = null; $('dlg-cancelar').textContent = 'Cancelar'; });
  $('b-sair').addEventListener('click', sair);
  // Em telas estreitas a barra lateral vira uma faixa horizontal; o leitor de tela precisa saber.
  var estreita = window.matchMedia('(max-width: 900px)');
  function orientarNav() { $('nav').setAttribute('aria-orientation', estreita.matches ? 'horizontal' : 'vertical'); }
  orientarNav();
  if (estreita.addEventListener) estreita.addEventListener('change', orientarNav);
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
  $('cx-fechar').addEventListener('click', fecharConector);
  // Da ficha para o painel da clínica na aba Uso (a carga da aba já desenha o painel dela).
  $('g-uso-ver').addEventListener('click', function () { var id = atual && atual.id; if (!id) return; irPara('nav-uso'); usoClinica = id; });
  $('cx-novo-abrir').addEventListener('click', function () { abrirNovoSistema(null); });
  $('cx-novo-cancelar').addEventListener('click', function () { $('dlg-cx-novo').close(); });
  $('cx-n-nome').addEventListener('input', previaArtigo);
  $('cx-n-artigo').addEventListener('change', previaArtigo);
  $('cx-busca').addEventListener('input', function () { cxBusca = $('cx-busca').value; desenharConectores(); });
  ligarSeg('cx-filtro', function (f) { cxFiltro = f; desenharConectores(); });
  ligarSeg('cx-ped-filtro', function (f) { pedFiltro = f; desenharPedidos(); });
  $('f-cx-dados').addEventListener('submit', salvarDadosConector);
  $('f-cx-config').addEventListener('submit', salvarConfigConector);
  // Formulário guiado ↔ JSON.
  $('cxg').addEventListener('input', function (ev) { if (ev.target.type !== 'radio' && ev.target.type !== 'checkbox' && ev.target.tagName !== 'SELECT') guiadoMudou(); });
  $('cxg').addEventListener('change', function (ev) { if (ev.target.type === 'radio' || ev.target.type === 'checkbox' || ev.target.tagName === 'SELECT') guiadoMudou(); });
  $('cxg-campo-add').addEventListener('click', function () {
    var vazio = $('cxg-campos').querySelector('.cxg-vazio');
    if (vazio) vazio.remove();
    var li = linhaCampo({ tipo: 'texto' });
    $('cxg-campos').appendChild(li);
    guiadoMudou();
    li.querySelector('input').focus();
  });
  $('cx-config').addEventListener('input', function () { preencherGuiado(); });
  $('f-cx-doc').addEventListener('submit', anexarDoc);
  $('f-cx-teste').addEventListener('submit', testarConector);
  $('f-fin').addEventListener('submit', salvarFinanceiro);
  $('f-conf').addEventListener('submit', salvarConfirmacao);
  $('c-canal').addEventListener('change', canal);
  $('f-conf').addEventListener('input', agendarPrevia);
  $('f-conf').addEventListener('change', agendarPrevia);
  $('c-params').addEventListener('click', agendarPrevia);
  $('c-param-add').addEventListener('click', agendarPrevia);
  $('c-param-add').addEventListener('click', function () { params.push({ campo: 'nome' }); desenharParams(); });
  $('f-disparo').addEventListener('submit', salvarDisparo);
  $('b-rotacionar').addEventListener('click', rotacionar);
  $('b-automacao').addEventListener('click', chaveAutomacao);
  $('f-desligar').addEventListener('submit', desligar);
  $('f-historico').addEventListener('submit', apagarHistorico);
  /* ---------- uso das clínicas ---------- */
  // Visão geral (totais, gráfico, alertas e cartões das clínicas) e painel de cada clínica. Nada de paciente: só contagens.
  var usoDias = 30, usoDatas = null, usoSeq = 0, usoDados = null; // usoDatas = {inicio, fim} do período escolhido
  var NOMES_FUNCAO = { agenda: 'Marcar', presenca: 'Presença', espera: 'Tempo de espera', cobranca: 'Cobrança', confirmacao: 'Confirmação D-1', confirmacao_manual: 'Confirmação manual', busca: 'Busca de paciente', cadastro: 'Cadastro de paciente' };

  function num(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function reais(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function pctDe(n, d) { return d ? Math.round((n / d) * 100) + '%' : '—'; }

  /* ---------- período e exportação (CSV) da aba Uso ---------- */
  function hojeIso() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  function somaDiasIso(iso, n) { var p = iso.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
  function dataBr(iso) { var p = String(iso).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function textoPeriodo(p) {
    if (!usoDatas) return 'nos últimos ' + p.dias + ' dias';
    return p.inicio === p.fim ? 'em ' + dataBr(p.inicio) : 'de ' + dataBr(p.inicio) + ' a ' + dataBr(p.fim) + ' (' + p.dias + ' dias)';
  }
  // CSV para o Excel em português: ponto e vírgula, vírgula decimal e BOM (para os acentos).
  function celula(v) {
    if (v == null) return '';
    var t = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function csvDe(linhas) { return '﻿' + linhas.map(function (l) { return l.map(celula).join(';'); }).join('\r\n') + '\r\n'; }
  function dataHora(v) {
    if (!v) return '';
    var d = new Date(v);
    return isNaN(d) ? '' : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d).replace(',', '');
  }
  function csvClinicas(d) {
    var cab = ['Clínica', 'Saúde', 'Situação', 'Sistema', 'Usos', 'Usos no período anterior', 'Marcações', 'Remarcações', 'Cancelamentos', 'Confirmações na agenda', 'Faltas',
      'Ações a conferir', 'Cobranças', 'Valor cobrado (R$)', 'Atendimentos com espera', 'Confirmações D-1 enviadas', 'Respondidas', 'Confirmadas', 'Não entregues',
      'Atendentes', 'Buscas de paciente', 'Chamadas ao sistema (ERP)', 'Falhas do sistema (ERP)', 'Versão da extensão', 'Último uso', 'Alertas'];
    var linhas = d.clinicas.map(function (c) {
      var a = c.acoes || {}, cf = c.confirmacoes || {}, ee = c.erros_erp || {};
      return [c.nome, c.saude.texto, c.situacao.texto, nomeConector(c.erp), c.volume, c.volume_anterior, a.criar || 0, a.remarcar || 0, a.cancelar || 0, a.confirmar || 0, a.ausente || 0,
        c.incertos, c.cobrancas.n, Math.round(c.cobrancas.valor * 100) / 100, c.espera.atendimentos, cf.enviadas || 0, cf.respondidas || 0, cf.confirmadas || 0, cf.falharam || 0,
        c.usuarios, (c.eventos && c.eventos.busca_paciente) || 0, ee.chamadas || 0, ee.total || 0, (c.versao && c.versao.extensao) || '', dataHora(c.ultimo_uso_em),
        c.alertas.map(function (x) { return x.texto; }).join(' | ')];
    });
    return csvDe([cab].concat(linhas));
  }
  // Uma linha por dia: o total e cada clínica (a mesma conta do gráfico "Uso por dia").
  function csvDias(d) {
    var cab = ['Dia', 'Todas as clínicas'].concat(d.clinicas.map(function (c) { return c.nome; }));
    var linhas = d.serie.map(function (s, i) {
      return [dataBr(s.dia), s.n].concat(d.clinicas.map(function (c) { return (c.spark && c.spark[i]) || 0; }));
    });
    return csvDe([cab].concat(linhas));
  }
  function baixarCsv(nome, p, conteudo) {
    var url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
    var a = el('a');
    a.href = url;
    a.download = 'clinfy-' + nome + '_' + p.inicio + '_a_' + p.fim + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function carregarUso() {
    var s = ++usoSeq;
    msg('m-uso', null, 'Carregando…');
    $('uso-lista').setAttribute('aria-busy', 'true');
    var q = usoDatas ? 'inicio=' + usoDatas.inicio + '&fim=' + usoDatas.fim : 'dias=' + usoDias;
    return chamar('GET', '/admin/uso?' + q).then(function (r) {
      if (s !== usoSeq) return;
      $('uso-lista').removeAttribute('aria-busy');
      if (r.status !== 200 || !r.body) {
        usoDados = null;
        $('uso-lista').textContent = '';
        $('uso-kpis').textContent = '';
        $('uso-exportar').hidden = true;
        falhou('m-uso', r.body && r.body.erro === 'PERIODO_INVALIDO' ? 'Período inválido: escolha datas até hoje, de no máximo ' + r.body.max_dias + ' dias atrás.' : erroDe(r), carregarUso);
        return;
      }
      usoDados = r.body;
      $('uso-exportar').hidden = !r.body.clinicas.length;
      desenharUso();
      msg('m-uso', null, r.body.clinicas.length ? '' : 'Nenhuma clínica cadastrada.');
    });
  }

  // ----- painel de uso: visão geral e painel de cada clínica -----
  var usoClinica = null;                 // clínica aberta no painel; null mostra a visão geral
  var usoFiltro = 'todas', usoOrdem = 'atencao', usoBusca = '';
  var TITULO_ALERTA = {
    parada: 'Parada', nunca_usou: 'Nunca usou', sem_credencial: 'Sem credencial do sistema',
    incertos_altos: 'Muitas ações a conferir', confirmacao_falhando: 'Confirmação D-1 falhando',
    confirmacao_parada: 'Confirmação D-1 sem envio', queda_uso: 'Uso em queda',
    erp_erro_alto: 'Falhas do sistema (ERP)', versao_antiga: 'Extensão desatualizada', sem_uso_expediente: 'Sem uso hoje'
  };
  var NOMES_EVENTO = { abertura: 'Aberturas do ClinFy', busca_paciente: 'Buscas de paciente', agenda_dia: 'Dias da agenda', horarios: 'Consultas de horários', painel: 'Painéis', cadastro_paciente: 'Cadastros de paciente' };

  // Variação contra o período anterior de mesmo tamanho. Seta e texto dizem; a cor só reforça.
  function delta(atual, anterior) {
    var s = el('span', 'delta');
    if (!anterior) {
      if (atual) { s.textContent = 'novo'; s.title = 'Sem uso no período anterior'; }
      return s;
    }
    var v = Math.round(((atual - anterior) / anterior) * 100);
    s.textContent = (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '= ') + Math.abs(v) + '%';
    s.setAttribute('data-tom', v >= 0 ? 'ok' : v <= -50 ? 'err' : 'warn');
    s.title = 'Período anterior: ' + num(anterior);
    return s;
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

  var SVG = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    var n = document.createElementNS(SVG, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function texto(x, y, t, cls, ancora) {
    var n = svg('text', { x: x, y: y, class: cls, 'text-anchor': ancora || 'middle' });
    n.textContent = t;
    return n;
  }

  // Gráfico de área (série única, cor da marca) com eixo, cursor e dica. Mouse ou setas do teclado.
  // Mede a largura da caixa para que o texto do eixo saia no tamanho certo; redesenha ao redimensionar.
  function grafArea(caixa, serie, unidade, titulo) {
    caixa.textContent = '';
    var W = Math.max(280, Math.round(caixa.clientWidth || 640)), H = 230;
    var m = { t: 14, r: 14, b: 28, l: 40 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var max = 0;
    serie.forEach(function (x) { if (x.n > max) max = x.n; });
    var topo = 1;
    if (max) {
      var p10 = Math.pow(10, Math.floor(Math.log(max) / Math.LN10));
      topo = [1, 2, 4, 5, 10].map(function (f) { return f * p10; }).filter(function (v) { return v >= max; })[0];
    }
    var n = serie.length, passo = n > 1 ? iw / (n - 1) : 0;
    function X(i) { return m.l + i * passo; }
    function Y(v) { return m.t + ih - (v / topo) * ih; }
    var resumo = titulo + ': ' + resumoSerie(serie, unidade);
    var g = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': resumo + '. Use as setas para ver cada dia.', tabindex: '0' });
    var marcas = topo % 2 === 0 ? [0, topo / 2, topo] : [0, topo];
    marcas.forEach(function (v) {
      g.appendChild(svg('line', { class: 'graf__grade', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }));
      g.appendChild(texto(m.l - 8, Y(v) + 4, num(v), 'graf__eixo', 'end'));
    });
    var qtd = Math.min(n, W < 520 ? 3 : 6);
    for (var k = 0; k < qtd; k++) {
      var i = qtd > 1 ? Math.round((k * (n - 1)) / (qtd - 1)) : 0;
      g.appendChild(texto(X(i), H - 8, dataCurta(serie[i].dia), 'graf__eixo', k === 0 ? 'start' : k === qtd - 1 ? 'end' : 'middle'));
    }
    if (max) {
      var pts = serie.map(function (x, j) { return X(j).toFixed(1) + ',' + Y(x.n).toFixed(1); }).join(' ');
      g.appendChild(svg('polygon', { class: 'graf__area', points: m.l + ',' + Y(0) + ' ' + pts + ' ' + X(n - 1) + ',' + Y(0) }));
      g.appendChild(svg('polyline', { class: 'graf__linha', points: pts }));
    } else {
      g.appendChild(texto(m.l + iw / 2, m.t + ih / 2, 'Nenhum uso nos últimos ' + n + ' dias', 'graf__vazio'));
    }
    var cursor = svg('line', { class: 'graf__cursor', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
    var ponto = svg('circle', { class: 'graf__ponto', r: 4, visibility: 'hidden' });
    g.appendChild(cursor);
    g.appendChild(ponto);
    var dica = el('div', 'graf-tip');
    dica.hidden = true;
    dica.setAttribute('aria-hidden', 'true');
    var atual = -1;
    function mostrar(j) {
      atual = Math.max(0, Math.min(n - 1, j));
      var x = X(atual), y = Y(serie[atual].n), esc = caixa.clientWidth / W || 1;
      cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); cursor.setAttribute('visibility', 'visible');
      ponto.setAttribute('cx', x); ponto.setAttribute('cy', y); ponto.setAttribute('visibility', 'visible');
      dica.textContent = dataCurta(serie[atual].dia) + ' · ' + num(serie[atual].n) + ' ' + unidade;
      dica.hidden = false;
      dica.style.left = Math.min(Math.max(x * esc, 60), caixa.clientWidth - 60) + 'px';
      dica.style.top = Math.max(0, y * esc - 10) + 'px';
    }
    function esconder() { atual = -1; cursor.setAttribute('visibility', 'hidden'); ponto.setAttribute('visibility', 'hidden'); dica.hidden = true; }
    g.addEventListener('mousemove', function (e) {
      var r = g.getBoundingClientRect();
      if (!r.width || !passo) return;
      mostrar(Math.round(((e.clientX - r.left) * (W / r.width) - m.l) / passo));
    });
    g.addEventListener('mouseleave', esconder);
    g.addEventListener('blur', esconder);
    g.addEventListener('keydown', function (e) {
      var j = atual < 0 ? n - 1 : atual;
      if (e.key === 'ArrowLeft') j--;
      else if (e.key === 'ArrowRight') j++;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = n - 1;
      else if (e.key === 'Escape') { esconder(); return; }
      else return;
      e.preventDefault();
      mostrar(j);
    });
    caixa.appendChild(g);
    caixa.appendChild(dica);
    var vivo = el('p', 'sr');
    vivo.setAttribute('aria-live', 'polite');
    caixa.appendChild(vivo);
    g.addEventListener('keyup', function () { vivo.textContent = atual >= 0 ? dica.textContent : ''; });
  }

  // Barrinhas de um dia cada (decorativas: o texto ao lado já diz o número).
  function miniBarras(serie, cls) {
    var n = serie.length, max = 0;
    serie.forEach(function (x) { if (x.n > max) max = x.n; });
    var g = svg('svg', { class: 'mini-barras' + (cls ? ' ' + cls : ''), viewBox: '0 0 ' + n * 3 + ' 36', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
    serie.forEach(function (x, i) {
      var h = max && x.n ? Math.max(3, (x.n / max) * 36) : 1;
      g.appendChild(svg('rect', { x: i * 3, y: 36 - h, width: 2, height: h, class: x.n ? '' : 'mini-barras__zero' }));
    });
    return g;
  }

  // Barras horizontais de uma cor, com rótulo e valor escritos.
  function barrasH(itens, max) {
    if (max == null) max = itens.reduce(function (s, x) { return Math.max(s, x.n); }, 0);
    var ul = el('ul', 'barras-h');
    itens.forEach(function (x) {
      var li = el('li', 'barras-h__linha');
      li.appendChild(el('span', 'barras-h__rot', x.rot));
      var trilho = el('span', 'barras-h__trilho'), b = el('span', 'barras-h__barra');
      b.style.width = max && x.n ? Math.max(2, (x.n / max) * 100) + '%' : '0';
      trilho.appendChild(b);
      li.appendChild(trilho);
      var v = el('span', 'barras-h__val', num(x.n));
      if (x.extra) v.appendChild(el('span', 'barras-h__extra', ' ' + x.extra));
      li.appendChild(v);
      ul.appendChild(li);
    });
    return ul;
  }

  function kpi2(pai, rotulo, valor, sub, d, serie) {
    var c = el('div', 'kpi2');
    c.appendChild(el('div', 'kpi2__rot', rotulo));
    var linha = el('div', 'kpi2__linha');
    linha.appendChild(el('span', 'kpi2__num', valor));
    if (d && d.textContent) linha.appendChild(d);
    c.appendChild(linha);
    if (sub) c.appendChild(el('div', 'kpi2__sub', sub));
    if (serie) c.appendChild(miniBarras(serie, 'kpi2__graf'));
    pai.appendChild(c);
  }

  function painel(titulo, sub, cls) {
    var s = el('section', 'cartao painel-uso' + (cls ? ' ' + cls : ''));
    s.appendChild(el('h3', null, titulo));
    if (sub) s.appendChild(el('p', 'painel-uso__sub', sub));
    return s;
  }
  function vazio(t) { return el('p', 'uso-vazio', t); }

  function desenharUso() {
    var d = usoDados;
    if (!d) return;
    var c = usoClinica && d.clinicas.filter(function (x) { return x.id === usoClinica; })[0];
    if (!c) usoClinica = null;
    $('uso-geral').hidden = !!c;
    $('uso-clinica').hidden = !c;
    $('uso-voltar').hidden = !c;
    $('uso-como').hidden = !!c;
    $('uso-selo').textContent = '';
    if (c) desenharClinica(c, d);
    else desenharGeral(d);
  }

  function abrirClinicaUso(id) {
    usoClinica = id;
    desenharUso();
    window.scrollTo(0, 0);
    $('h-uso').focus();
  }
  function voltarUso() {
    var id = usoClinica;
    usoClinica = null;
    desenharUso();
    var volta = document.querySelector('#uso-lista [data-clinica="' + id + '"]');
    if (volta) volta.focus();
  }

  // ----- visão geral -----
  function desenharGeral(d) {
    var t = d.totais, ta = d.totais_anterior || null, serie = d.serie || [];
    $('h-uso').textContent = 'Uso das clínicas';
    $('uso-sub').textContent = 'O que cada clínica fez pelo ClinFy ' + textoPeriodo(d.periodo) + '. Clique numa clínica para ver o painel dela.';

    var k = $('uso-kpis');
    k.textContent = '';
    var volume = serie.reduce(function (s, x) { return s + x.n; }, 0);
    kpi2(k, 'Uso total', num(volume), 'ações na agenda, cobranças e espera', ta && delta(volume, ta.volume), serie.length ? serie : null);
    kpi2(k, 'Clínicas em uso', num(t.usaram_7d) + ' de ' + num(t.ativas), 'ativas que usaram nos últimos 7 dias');
    kpi2(k, 'Ações na agenda', num(t.acoes), 'marcar, remarcar, cancelar, presença e falta', ta && delta(t.acoes, ta.acoes));
    kpi2(k, 'Cobranças', num(t.cobrancas.n), reais(t.cobrancas.valor), ta && delta(t.cobrancas.n, ta.cobrancas));
    kpi2(k, 'Confirmações D-1', num(t.confirmacoes), 'enviadas no período');
    kpi2(k, 'Buscas de paciente', num(t.buscas), 'por CPF ou telefone');

    $('uso-serie-sub').textContent = resumoSerie(serie, 'usos') + '.';
    grafArea($('uso-serie'), serie, 'usos', 'Uso por dia, todas as clínicas');
    desenharAtencao(d);
    desenharClinicas(d);
  }

  function desenharAtencao(d) {
    var box = $('uso-atencao');
    box.textContent = '';
    var grupos = {}, lista = [];
    d.clinicas.forEach(function (c) {
      c.alertas.forEach(function (a) {
        var g = grupos[a.tipo];
        if (!g) { g = grupos[a.tipo] = { tipo: a.tipo, nivel: a.nivel, itens: [] }; lista.push(g); }
        if (a.nivel === 'critico') g.nivel = 'critico';
        g.itens.push({ c: c, texto: a.texto });
      });
    });
    if (!lista.length) { box.appendChild(el('p', 'pendencias__ok', 'Nada precisa de atenção agora.')); return; }
    lista.sort(function (a, b) { return (b.nivel === 'critico') - (a.nivel === 'critico') || b.itens.length - a.itens.length; });
    var ul = el('ul', 'pendencias atencao');
    lista.forEach(function (g) {
      var li = el('li', 'pendencias__item atencao__item' + (g.nivel === 'critico' ? ' pendencias__item--grave' : ''));
      li.appendChild(el('span', 'sr', g.nivel === 'critico' ? 'Crítico: ' : 'Aviso: '));
      li.appendChild(el('strong', null, TITULO_ALERTA[g.tipo] || 'Alerta'));
      li.appendChild(document.createTextNode(' · ' + g.itens.length + (g.itens.length === 1 ? ' clínica' : ' clínicas')));
      var nomes = el('div', 'atencao__nomes');
      g.itens.forEach(function (x) {
        var b = el('button', 'link-clinica', x.c.nome);
        b.type = 'button';
        b.title = x.texto;
        b.setAttribute('aria-label', x.c.nome + ': ' + x.texto);
        b.addEventListener('click', function () { abrirClinicaUso(x.c.id); });
        nomes.appendChild(b);
      });
      li.appendChild(nomes);
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  var FILTROS_USO = {
    todas: function () { return true; },
    alerta: function (c) { return c.alertas.length > 0; },
    sem_uso: function (c) { return c.ativo && !c.volume; },
    desligadas: function (c) { return !c.ativo; }
  };

  function desenharClinicas(d) {
    Object.keys(FILTROS_USO).forEach(function (f) {
      var n = d.clinicas.filter(FILTROS_USO[f]).length, s = document.querySelector('#uso-filtros [data-n="' + f + '"]');
      if (s) s.textContent = n;
    });
    var busca = dobrado(usoBusca.trim());
    var lista = d.clinicas.filter(FILTROS_USO[usoFiltro]).filter(function (c) { return !busca || dobrado(c.nome).indexOf(busca) >= 0; });
    if (usoOrdem === 'uso') lista = lista.slice().sort(function (a, b) { return b.volume - a.volume || a.nome.localeCompare(b.nome); });
    if (usoOrdem === 'nome') lista = lista.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome); });
    $('uso-contagem').textContent = lista.length === d.clinicas.length ? num(lista.length) + (lista.length === 1 ? ' clínica' : ' clínicas') : num(lista.length) + ' de ' + num(d.clinicas.length);
    var grade = $('uso-lista');
    grade.textContent = '';
    if (!lista.length) { grade.appendChild(vazio(d.clinicas.length ? 'Nenhuma clínica com esse filtro.' : 'Nenhuma clínica cadastrada.')); return; }
    lista.forEach(function (c) { grade.appendChild(cartaoClinica(c, d.periodo)); });
  }

  function cartaoClinica(c, p) {
    var grave = c.alertas.some(function (a) { return a.nivel === 'critico'; });
    var b = el('button', 'cartao-clinica' + (grave ? ' cartao-clinica--critico' : c.alertas.length ? ' cartao-clinica--aviso' : ''));
    b.type = 'button';
    b.setAttribute('data-clinica', c.id);
    var topo = el('div', 'cartao-clinica__topo');
    topo.appendChild(el('span', 'cartao-clinica__nome', c.nome));
    topo.appendChild(selo(c.saude.tom, c.saude.texto));
    b.appendChild(topo);
    var linha = el('div', 'cartao-clinica__linha');
    linha.appendChild(el('span', 'cartao-clinica__num', num(c.volume)));
    linha.appendChild(el('span', 'cartao-clinica__un', c.volume === 1 ? 'uso' : 'usos'));
    var dl = delta(c.volume, c.volume_anterior);
    if (dl.textContent) linha.appendChild(dl);
    b.appendChild(linha);
    if (c.volume) b.appendChild(miniBarras(serieDe(c, p)));
    else b.appendChild(el('div', 'cartao-clinica__vazio', c.ativo ? 'Sem uso no período' : 'Desligada'));
    if (c.alertas.length) {
      var a = c.alertas[0];
      b.appendChild(el('div', 'cartao-clinica__motivo' + (a.nivel === 'critico' ? ' cartao-clinica__motivo--critico' : ''),
        (TITULO_ALERTA[a.tipo] || 'Alerta') + (c.alertas.length > 1 ? ' e mais ' + (c.alertas.length - 1) : '')));
    }
    var pe = el('div', 'cartao-clinica__pe');
    var fns = c.funcoes.map(function (f) { return NOMES_FUNCAO[f] || f; });
    pe.appendChild(el('span', null, fns.length ? fns.slice(0, 2).join(' · ') + (fns.length > 2 ? ' +' + (fns.length - 2) : '') : 'Nenhuma função usada'));
    pe.appendChild(el('span', null, c.ultima_acao_em ? 'Última ação ' + dataHora(c.ultima_acao_em).split(',')[0] : 'Sem ação gravada'));
    b.appendChild(pe);
    b.setAttribute('aria-label', c.nome + ', ' + c.saude.texto + ', ' + num(c.volume) + ' usos no período'
      + (c.alertas.length ? '. ' + c.alertas.map(function (x) { return x.texto; }).join(' ') : '') + '. Abrir painel da clínica.');
    b.addEventListener('click', function () { abrirClinicaUso(c.id); });
    return b;
  }

  // ----- painel de uma clínica -----
  function desenharClinica(c, d) {
    var p = d.periodo, a = c.acoes, cf = c.confirmacoes, ant = c.anterior || {};
    $('h-uso').textContent = c.nome;
    $('uso-selo').appendChild(selo(c.saude.tom, c.saude.texto));
    var vs = c.versao || {};
    $('uso-sub').textContent = 'Sistema: ' + nomeConector(c.erp)
      + ' · Extensão ' + (vs.extensao ? 'v' + vs.extensao : 'sem versão informada')
      + ' · Último acesso ' + dataHora(c.ultimo_uso_em) + ' · Últimos ' + p.dias + ' dias';

    var box = $('uso-clinica');
    box.textContent = '';

    if (c.alertas.length) {
      var ul = el('ul', 'pendencias');
      c.alertas.slice().sort(function (x, y) { return (y.nivel === 'critico') - (x.nivel === 'critico'); }).forEach(function (x) {
        var li = el('li', 'pendencias__item' + (x.nivel === 'critico' ? ' pendencias__item--grave' : ''));
        var s = el('span');
        s.appendChild(el('strong', null, (x.nivel === 'critico' ? 'Crítico' : 'Aviso') + ': '));
        s.appendChild(document.createTextNode(x.texto));
        li.appendChild(s);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    var k = el('div', 'kpis2');
    var totalAcoes = a.criar + a.remarcar + a.cancelar + a.confirmar + a.ausente;
    var serie = serieDe(c, p);
    kpi2(k, 'Uso total', num(c.volume), 'agenda, cobranças e espera', delta(c.volume, c.volume_anterior), serie);
    kpi2(k, 'Ações na agenda', num(totalAcoes), c.incertos ? num(c.incertos) + ' a conferir' : 'marcar, remarcar, cancelar, presença e falta', ant.acoes != null ? delta(totalAcoes, ant.acoes) : null);
    kpi2(k, 'Cobranças', num(c.cobrancas.n), c.cobrancas.n ? reais(c.cobrancas.valor) : (c.configuradas.indexOf('cobranca') >= 0 ? 'ligada, sem uso' : 'desligada'), ant.cobrancas != null ? delta(c.cobrancas.n, ant.cobrancas) : null);
    kpi2(k, 'Tempo de espera', num(c.espera.atendimentos), 'atendimentos medidos', ant.espera != null ? delta(c.espera.atendimentos, ant.espera) : null);
    kpi2(k, 'Confirmações D-1', num(cf.enviadas), cf.enviadas ? pctDe(cf.respondidas, cf.enviadas) + ' responderam' : (c.configuradas.indexOf('confirmacao') >= 0 ? 'ligada, sem envio' : 'desligada'));
    kpi2(k, 'Atendentes', num(c.usuarios), 'com ação gravada');
    box.appendChild(k);

    var l1 = el('div', 'uso-linha uso-linha--8-4');
    var pDia = painel('Uso por dia', 'Ações na agenda, cobranças e atendimentos com espera.');
    var caixa = el('div', 'graf-area');
    pDia.appendChild(caixa);
    l1.appendChild(pDia);
    var pTipo = painel('Ações na agenda por tipo');
    var tipos = [
      { rot: 'Marcadas', n: a.criar }, { rot: 'Remarcadas', n: a.remarcar }, { rot: 'Canceladas', n: a.cancelar },
      { rot: 'Presenças', n: a.confirmar }, { rot: 'Faltas', n: a.ausente }
    ].sort(function (x, y) { return y.n - x.n; });
    pTipo.appendChild(totalAcoes ? barrasH(tipos) : vazio('Nenhuma ação na agenda no período.'));
    if (c.incertos) pTipo.appendChild(el('p', 'painel-uso__sub', num(c.incertos) + ' ações ficaram a conferir (o sistema não confirmou se gravou).'));
    l1.appendChild(pTipo);
    box.appendChild(l1);

    var l2 = el('div', 'uso-linha uso-linha--3');
    var pConf = painel('Confirmação D-1', 'Do envio à resposta do paciente.');
    if (cf.enviadas) {
      pConf.appendChild(barrasH([
        { rot: 'Enviadas', n: cf.enviadas },
        { rot: 'Responderam', n: cf.respondidas, extra: pctDe(cf.respondidas, cf.enviadas) },
        { rot: 'Confirmaram', n: cf.confirmadas, extra: pctDe(cf.confirmadas, cf.enviadas) }
      ], cf.enviadas));
      pConf.appendChild(el('p', 'painel-uso__sub', num(cf.manuais) + ' pelo botão · ' + num(cf.falharam) + ' não entregues'));
    } else {
      pConf.appendChild(vazio(cf.falharam ? num(cf.falharam) + ' não entregues e nenhuma enviada.' : c.configuradas.indexOf('confirmacao') >= 0 ? 'Ligada, mas sem envio no período.' : 'Confirmação D-1 desligada.'));
    }
    l2.appendChild(pConf);

    var pPres = painel('Presença e falta');
    var marcadas = a.confirmar + a.ausente;
    if (marcadas) {
      pPres.appendChild(el('p', 'uso-destaque', pctDe(a.ausente, marcadas) + ' de faltas'));
      pPres.appendChild(barrasH([{ rot: 'Presenças', n: a.confirmar }, { rot: 'Faltas', n: a.ausente }], marcadas));
      pPres.appendChild(el('p', 'painel-uso__sub', num(c.espera.atendimentos) + ' atendimentos com tempo de espera medido.'));
    } else pPres.appendChild(vazio('Nenhuma presença ou falta marcada no período.'));
    l2.appendChild(pPres);

    var pTelas = painel('Telas e buscas');
    var ev = c.eventos || {};
    var telas = Object.keys(NOMES_EVENTO).map(function (e) { return { rot: NOMES_EVENTO[e], n: ev[e] || 0 }; })
      .filter(function (x) { return x.n; }).sort(function (x, y) { return y.n - x.n; });
    pTelas.appendChild(telas.length ? barrasH(telas) : vazio('Nenhuma tela registrada no período (contadas desde a versão 0.35.0).'));
    l2.appendChild(pTelas);
    box.appendChild(l2);

    var pTec = painel('Saúde técnica');
    var dl = el('dl', 'resumo');
    function linha(r, v) { dl.appendChild(el('dt', null, r)); var dd = el('dd'); if (typeof v === 'string') dd.textContent = v; else dd.appendChild(v); dl.appendChild(dd); }
    var ee = c.erros_erp;
    linha('Falhas do sistema (ERP)', ee && ee.chamadas
      ? (ee.total ? num(ee.total) + ' em ' + num(ee.chamadas) + ' chamadas (' + pctDe(ee.total, ee.chamadas) + ')' + (ee.principais.length ? ': ' + ee.principais.map(function (x) { return x.erro + ' ' + num(x.n); }).join(', ') : '') : 'nenhuma em ' + num(ee.chamadas) + ' chamadas')
      : 'sem chamadas registradas');
    var ver = el('span');
    ver.appendChild(document.createTextNode(vs.extensao ? 'v' + vs.extensao + (vs.atual ? ' (atual: v' + vs.atual + ')' : '') + (vs.em ? ' · vista em ' + dataHora(vs.em) : '') + ' ' : 'ainda não informada'));
    if (vs.antiga) ver.appendChild(selo('warn', 'Desatualizada'));
    linha('Versão da extensão', ver);
    if (c.incertos || c.cobrancas.incertas) linha('A conferir', num(c.incertos) + ' ações na agenda · ' + num(c.cobrancas.incertas) + ' cobranças');
    var paradas = c.configuradas.filter(function (f) { return c.funcoes.indexOf(f) < 0; });
    linha('Funções usadas', c.funcoes.length ? c.funcoes.map(function (f) { return NOMES_FUNCAO[f] || f; }).join(', ') : 'nenhuma no período');
    if (paradas.length) linha('Ligadas sem uso', paradas.map(function (f) { return NOMES_FUNCAO[f] || f; }).join(', '));
    linha('Cliente desde', dataHora(c.criado_em));
    pTec.appendChild(dl);
    box.appendChild(pTec);

    grafArea(caixa, serie, 'usos', 'Uso por dia de ' + c.nome);
  }

  $('uso-voltar').addEventListener('click', voltarUso);
  $('uso-busca').addEventListener('input', function () { usoBusca = this.value; if (usoDados) desenharClinicas(usoDados); });
  $('uso-ordem').addEventListener('change', function () { usoOrdem = this.value; if (usoDados) desenharClinicas(usoDados); });
  Array.prototype.forEach.call(document.querySelectorAll('#uso-filtros .seg__btn'), function (b) {
    b.addEventListener('click', function () {
      usoFiltro = b.getAttribute('data-filtro');
      Array.prototype.forEach.call(document.querySelectorAll('#uso-filtros .seg__btn'), function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
      if (usoDados) desenharClinicas(usoDados);
    });
  });
  // Os gráficos medem a largura: ao redimensionar a janela, desenha de novo (só com a aba Uso aberta).
  var usoRedim = null;
  window.addEventListener('resize', function () {
    clearTimeout(usoRedim);
    usoRedim = setTimeout(function () { if (!$('v-uso').hidden && usoDados) desenharUso(); }, 150);
  });

  function marcarPeriodo(b) {
    Array.prototype.forEach.call(document.querySelectorAll('#uso-periodo .seg__btn'), function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('#uso-periodo .seg__btn[data-dias]'), function (b) {
    b.addEventListener('click', function () {
      usoDias = Number(b.getAttribute('data-dias'));
      usoDatas = null;
      marcarPeriodo(b);
      $('f-uso-periodo').hidden = true;
      $('uso-p-abrir').setAttribute('aria-expanded', 'false');
      carregarUso();
    });
  });
  // Escolher datas: abre o formulário com o período que está na tela.
  $('uso-p-abrir').addEventListener('click', function () {
    var f = $('f-uso-periodo'), abrir = f.hidden;
    f.hidden = !abrir;
    this.setAttribute('aria-expanded', String(abrir));
    if (!abrir) return;
    var p = usoDados && usoDados.periodo, hoje = hojeIso();
    $('uso-p-inicio').value = p ? p.inicio : somaDiasIso(hoje, -29);
    $('uso-p-fim').value = p ? p.fim : hoje;
    $('uso-p-inicio').min = $('uso-p-fim').min = somaDiasIso(hoje, -399);
    $('uso-p-inicio').max = $('uso-p-fim').max = hoje;
    $('uso-p-inicio').focus();
  });
  $('f-uso-periodo').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var i = $('uso-p-inicio').value, f = $('uso-p-fim').value;
    if (!i || !f) return;
    if (i > f) { var t = i; i = f; f = t; $('uso-p-inicio').value = i; $('uso-p-fim').value = f; }
    usoDatas = { inicio: i, fim: f };
    marcarPeriodo($('uso-p-abrir'));
    carregarUso();
  });
  $('uso-csv-clinicas').addEventListener('click', function () { if (usoDados) baixarCsv('uso-clinicas', usoDados.periodo, csvClinicas(usoDados)); });
  $('uso-csv-dias').addEventListener('click', function () { if (usoDados) baixarCsv('uso-por-dia', usoDados.periodo, csvDias(usoDados)); });
  $('uso-atualizar').addEventListener('click', carregarUso);

  conferirSessao();
})();
