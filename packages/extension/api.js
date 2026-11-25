/* Cliente do Conector. Usa omni.http.request (proxy do host), então não depende de CORS. */
(function (root) {
  'use strict';

  var DEFAULT_URL = 'https://asa-integracao-samuels.kentro.com.br';
  // Versão da extensão (o ?v= deste script): vai em cada chamada, para a implantação ver quem está desatualizado.
  var VERSAO = (function () {
    var s = root.document && root.document.currentScript;
    var m = s && /[?&]v=(\d+\.\d+\.\d+)/.exec(s.src || '');
    return m ? m[1] : '';
  })();

  // O host pode entregar o segredo mascarado ("********") a quem não deve vê-lo.
  function usable(v) { return typeof v === 'string' && v.trim() !== '' && !/^\*+$/.test(v); }

  // Respostas que mudam pouco ficam guardadas na página por alguns minutos, e pedidos iguais em andamento
  // viram um só (na tela única, Agenda, Painel e Configurar pediam as mesmas coisas ao mesmo tempo).
  // Só guarda resposta boa: erro ou recusa é pedido de novo na próxima vez.
  var memo = {};
  var MIN = 60000;
  function shared(id, ttl, fn, keep, force) {
    var m = memo[id], now = Date.now();
    if (!force && m && (m.pending || now - m.at < ttl)) return m.p;
    var e = { at: now, pending: true };
    e.p = fn().then(function (r) {
      e.pending = false;
      e.at = Date.now();
      if (!(keep ? keep(r) : r.status === 200) && memo[id] === e) delete memo[id];
      return r;
    });
    memo[id] = e;
    return e.p;
  }
  // Freio de chamadas. O proxy da Kentro (omni.http.request) aceita 30 chamadas por minuto por instalação;
  // acima disso recusa e mostra um aviso de erro na tela. A extensão se segura antes: leituras esperam a vez
  // quando a janela de 1 minuto passa de TETO; gravações passam sempre (e contam). Depois de uma recusa por
  // limite, as leituras param PAUSA ms. A janela fica no localStorage quando dá (várias telas e conversas
  // abertas no mesmo navegador somam); sem ele, vale só esta página.
  var JANELA = 60000, TETO = 24, PAUSA = 20000;
  var CH_ENVIOS = 'clinfy:envios', CH_PAUSA = 'clinfy:pausa';
  var envios = [], pausaLocal = 0;
  function lerLS(k) { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function gravarLS(k, v) { try { if (root.localStorage) { root.localStorage.setItem(k, v); return true; } } catch (e) { /* sem acesso */ } return false; }
  function marcas(agora) {
    var v = null;
    try { v = JSON.parse(lerLS(CH_ENVIOS) || 'null'); } catch (e) { v = null; }
    var l = Array.isArray(v) ? v : envios;
    return l.filter(function (t) { return typeof t === 'number' && agora - t < JANELA && t <= agora + 1000; });
  }
  function registrar(agora) {
    var l = marcas(agora);
    l.push(agora);
    envios = l;
    gravarLS(CH_ENVIOS, JSON.stringify(l.slice(-60)));
  }
  function pausaAte() { return Math.max(pausaLocal, Number(lerLS(CH_PAUSA)) || 0); }
  function pausar(agora) { pausaLocal = agora + PAUSA; gravarLS(CH_PAUSA, String(pausaLocal)); }
  // Quanto esta leitura ainda precisa esperar (0 = pode ir).
  function espera(agora) {
    var p = pausaAte() - agora;
    if (p > 0) return p;
    var l = marcas(agora).sort(function (x, y) { return x - y; });
    return l.length < TETO ? 0 : l[l.length - TETO] + JANELA - agora + 50;
  }
  function vez(leitura) {
    return new Promise(function (ok) {
      (function tentar() {
        var agora = Date.now(), w = leitura ? espera(agora) : 0;
        if (w <= 0) { registrar(agora); ok(); return; }
        root.setTimeout(tentar, Math.min(w, 5000));
      })();
    });
  }
  // O proxy recusou por limite? Vem como rejeição com texto ("limite de 30 requisições por minuto
  // excedido") ou, em outra versão do host, como 429 sem um código nosso.
  var NOSSOS_429 = /^(MUITAS_BUSCAS|MUITAS_TENTATIVAS|MUITOS_CADASTROS|MUITOS_PEDIDOS)$/;
  function limiteDoHost(texto) { return /limite|excedid|rate.?limit|too many|429/i.test(String(texto || '')); }

  // Conexão só fica guardada se estiver ok: credencial ausente ou ERP fora do ar é verificado de novo.
  function connected(r) { return r.status === 200 && r.body && r.body.tenant && (r.body.conexao || r.body.asa) === 'ok'; }

  function create(cfg, key) {
    var base = String(cfg.apiUrl || DEFAULT_URL).replace(/\/+$/, '');
    var configured = !!(base && usable(key));
    var ns = base + '|' + (configured ? key.trim() : '') + '|';

    function request(method, path, body, timeout) {
      if (!configured) return Promise.resolve({ status: -1, body: null });
      var leitura = method === 'GET';
      return vez(leitura).then(function () { return enviar(method, path, body, timeout); }).then(function (r) {
        if (!r.limite) return r;
        pausar(Date.now());
        // Leitura recusada pelo limite: espera a pausa e tenta uma vez mais. Gravação nunca é repetida aqui.
        return leitura ? vez(true).then(function () { return enviar(method, path, body, timeout); }) : r;
      });
    }
    var LIMITE = { erro: 'LIMITE_KENTRO' };
    function enviar(method, path, body, timeout) {
      return root.omni.http.request({
        url: base + path,
        method: method,
        timeout: timeout || 15000,
        headers: VERSAO
          ? { 'content-type': 'application/json', 'x-install-key': key.trim(), 'x-clinfy-versao': VERSAO }
          : { 'content-type': 'application/json', 'x-install-key': key.trim() },
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) {
        var data = null;
        try { data = typeof r.body === 'string' ? JSON.parse(r.body) : r.body; } catch (e) { /* corpo inválido */ }
        if (r.status === 429 && !(data && NOSSOS_429.test(String(data.erro || '')))) return { status: 0, body: LIMITE, limite: true };
        return { status: r.status, body: data };
      }, function (e) {
        var texto = e && (e.message || e.error || e.statusText || (typeof e === 'string' ? e : ''));
        if (limiteDoHost(texto) || (e && e.status === 429)) return { status: 0, body: LIMITE, limite: true };
        return { status: 0, body: null };
      });
    }

    // Dias da agenda: guardados DIA_TTL na página (trocar Dia/Semana/Lado a lado ou voltar à mesma semana
    // não pede de novo) e pedidos em lote, até 8 colunas por chamada. Qualquer gravação esquece os dias.
    var DIA_TTL = 20000, POR_LOTE = 8, semLote = false;
    function chaveDia(it) { return ns + 'dia|' + it.prest + '|' + it.day; }
    function esquecerDias() { Object.keys(memo).forEach(function (k) { if (k.indexOf(ns + 'dia|') === 0) delete memo[k]; }); }
    function gravou(r) { esquecerDias(); return r; }
    function umDia(it) { return request('GET', '/v1/agenda/dia' + query({ prestador_id: it.prest, data: it.day })); }
    function lote(list) {
      if (semLote || list.length === 1) return Promise.all(list.map(umDia));
      var itens = list.map(function (it) { return it.prest + ':' + it.day; }).join(',');
      return request('GET', '/v1/agenda/colunas' + query({ itens: itens }), null, 45000).then(function (r) {
        // Conector antigo, sem a rota em lote (404, com ou sem {erro:"NAO_ENCONTRADO"}; a rota em si nunca
        // responde 404): um dia por chamada (o freio segura o ritmo).
        if (r.status === 404) { semLote = true; return Promise.all(list.map(umDia)); }
        if (!(r.status === 200 && r.body && Array.isArray(r.body.colunas) && r.body.colunas.length === list.length)) {
          return list.map(function () { return r; });
        }
        return r.body.colunas.map(function (c) {
          var b = {};
          Object.keys(c).forEach(function (k) { if (k !== 'status' && k !== 'prestador_id') b[k] = c[k]; });
          return { status: c.status, body: b };
        });
      });
    }
    // items = [{prest, day}] → [{status, body}] na mesma ordem. force = buscar agora (botão Atualizar, atualização automática).
    function columns(items, force) {
      var out = new Array(items.length), falta = [], agora = Date.now();
      items.forEach(function (it, i) {
        var m = !force && memo[chaveDia(it)];
        if (m && m.dia && agora - m.at < DIA_TTL) out[i] = m.dia; else falta.push(i);
      });
      if (!falta.length) return Promise.resolve(out);
      var lotes = [];
      for (var k = 0; k < falta.length; k += POR_LOTE) lotes.push(falta.slice(k, k + POR_LOTE));
      return Promise.all(lotes.map(function (idx) {
        return lote(idx.map(function (i) { return items[i]; })).then(function (rs) {
          idx.forEach(function (i, j) {
            out[i] = rs[j];
            if (rs[j].status === 200 && rs[j].body) memo[chaveDia(items[i])] = { at: Date.now(), dia: rs[j] };
          });
        });
      })).then(function () { return out; });
    }

    function query(params) {
      var parts = Object.keys(params).filter(function (k) { return params[k]; }).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      });
      return parts.length ? '?' + parts.join('&') : '';
    }

    var api = {
      // force = verificar agora (botão "Tentar de novo", credencial recém-salva).
      testConnection: function (force) {
        return shared(ns + 'conexao', 5 * MIN, function () { return request('GET', '/v1/tenant/conexao/teste'); }, connected, force);
      },
      capabilities: function () { return shared(ns + 'capacidades', 10 * MIN, function () { return request('GET', '/v1/capacidades', null, 8000); }); },
      connectors: function () { return request('GET', '/v1/conectores'); },
      connect: function (erp, credencial) {
        return request('POST', '/v1/conectores/ligar', { erp: erp, credencial: credencial }, 45000).then(function (r) { forget(); return r; });
      },
      requestSystem: function (payload) { return request('POST', '/v1/conectores/pedido', payload); },
      // Grava no ERP. payload = {chave, paciente: {nome, cpf, nascimento, telefone}, usuario}
      createPatient: function (payload) { return request('POST', '/v1/pacientes', payload, 40000); },
      patient: function (by) { return request('GET', '/v1/paciente' + query({ telefone: by.telefone, cpf: by.cpf })); },
      schedule: function () { return shared(ns + 'agenda', 5 * MIN, function () { return request('GET', '/v1/agenda'); }); },
      days: function (providerId) { return request('GET', '/v1/agenda/dias' + query({ prestador_id: providerId })); },
      day: function (providerId, day, force) { return columns([{ prest: providerId, day: day }], force).then(function (r) { return r[0]; }); },
      columns: columns,
      // payload = {chave, status: confirmado|ausente|cancelado, prestador_id, data, usuario}
      setStatus: function (id, payload) { return request('POST', '/v1/agendamentos/' + encodeURIComponent(id) + '/status', payload).then(gravou); },
      // Tempo de espera (só no Conector, não vai ao ERP). payload = {acao: chegada|chamada|fim|desfazer|ajustar,
      // etapa?, hora? (HH:MM, só no ajuste), prestador_id, data, hora_marcada, usuario}
      attendance: function (id, payload) { return request('POST', '/v1/atendimentos/' + encodeURIComponent(id), payload, 10000).then(gravou); },
      exams: function () { return shared(ns + 'exames', 30 * MIN, function () { return request('GET', '/v1/exames'); }); },
      examGroups: function () { return shared(ns + 'grupos', 30 * MIN, function () { return request('GET', '/v1/exames/grupos'); }); },
      examGroup: function (groupId) { return request('GET', '/v1/exames/grupos/' + encodeURIComponent(groupId)); },
      examInsurances: function (examId) { return request('GET', '/v1/exames/' + encodeURIComponent(examId) + '/convenios'); },
      examProviders: function (examId, insuranceId) { return request('GET', '/v1/exames/' + encodeURIComponent(examId) + '/prestadores' + query({ convenio_id: insuranceId })); },
      slots: function (providerId, day) { return request('GET', '/v1/agenda/horarios' + query({ prestador_id: providerId, data: day })); },
      // slot = {prestador_id, data, horario, agenda_id}
      insurances: function (slot) { return request('GET', '/v1/agenda/convenios' + query(slot)); },
      procedures: function (slot, insuranceId) {
        return request('GET', '/v1/agenda/procedimentos' + query(Object.assign({ convenio_id: insuranceId }, slot)));
      },
      // ÚNICA chamada que grava na Asa. `chave` torna o pedido idempotente.
      // A Asa pode levar até 40 s para gravar, e o Conector ainda confere a agenda se ela não responder.
      book: function (payload) { return request('POST', '/v1/agendamentos', payload, 60000).then(gravou); },
      // payload = {chave, busca: {telefone|cpf}, usuario}; a busca prova que a consulta é do paciente.
      cancel: function (id, payload) { return request('POST', '/v1/agendamentos/' + encodeURIComponent(id) + '/cancelar', payload, 60000).then(gravou); },
      financeConfig: function () { return shared(ns + 'financeiro', 5 * MIN, function () { return request('GET', '/v1/tenant/financeiro'); }); },
      charges: function (patientId) { return request('GET', '/v1/cobrancas' + query({ paciente_id: patientId })); },
      // Grava na Asa SEM VOLTA (conta a receber). payload = {chave, paciente_id, busca, valor, forma, vencimento?, agendamento?, usuario}
      charge: function (payload) { return request('POST', '/v1/cobrancas', payload, 60000); },
      reminderConfig: function () { return request('GET', '/v1/tenant/confirmacao'); },
      // payload = {agendamento_id, busca: {telefone|cpf}, usuario}: põe na fila e aciona o envio da confirmação.
      sendConfirmation: function (payload) { return request('POST', '/v1/confirmacao/enviar', payload, 30000).then(gravou); },
      // Números do painel do administrador nos últimos `dias` dias (1, 7, 15, 30 ou 90).
      dashboard: function (dias) { return request('GET', '/v1/painel/resumo' + query({ dias: String(dias) }), null, 20000); },
      previewReminder: function (config) { return request('POST', '/v1/tenant/confirmacao/previa', { config: config }); },
      saveCredential: function (token) {
        return request('PUT', '/v1/tenant/credencial', { token: token }).then(function (r) { forget(); return r; });
      },
      // Credencial ou sistema trocado: tudo o que foi guardado desta clínica é pedido de novo.
      forget: forget
    };
    function forget() {
      Object.keys(memo).forEach(function (k) { if (k.indexOf(ns) === 0) delete memo[k]; });
    }
    return api;
  }

  // A chave vem só da configuração da instalação (campo secret, igual para todos os usuários).
  // omni.storage não serve: é por usuário e por navegador.
  // Também busca o ERP da clínica (nome nas frases e o que ele suporta) antes de entregar a api: as telas
  // já abrem falando "na Asa" ou "no Feegow". Sem resposta, segue com "o sistema da clínica" e nada extra.
  // Na tela única as quatro telas chamam load juntas: a mesma configuração recebe a mesma api (e um só
  // /v1/capacidades). fresh = montar de novo (a chave pode ter sido cadastrada depois que a tela abriu).
  var loaded = {};
  function load(omni, cfg, fresh) {
    var id = String(cfg.apiUrl || '') + '|' + (usable(cfg.apiKey) ? cfg.apiKey.trim() : '');
    if (!fresh && loaded[id]) return loaded[id];
    var p = loaded[id] = build(omni, cfg, fresh);
    // Sem resposta do Conector, a próxima tela que abrir tenta de novo.
    p.then(function (api) { if (!api.loadedOk && loaded[id] === p) delete loaded[id]; });
    return p;
  }

  function build(omni, cfg, fresh) {
    var api = create(cfg, usable(cfg.apiKey) ? cfg.apiKey : null);
    if (fresh) api.forget();
    api.capacidades = { financeiro: false, confirmacao: false, grupos_exames: false, cadastro_paciente: false };
    api.erp = null;
    if (!usable(cfg.apiKey)) return Promise.resolve(api);
    return api.capabilities().then(function (r) {
      var C = root.AsaCore;
      if (r.status === 200 && r.body) {
        api.loadedOk = true;
        api.erp = r.body.erp || null;
        if (r.body.capacidades) api.capacidades = r.body.capacidades;
        if (C) C.setSistema(r.body.sistema);
      }
      if (C && root.document) C.applySistema(root.document);
      return api;
    });
  }

  root.AsaApi = { create: create, load: load };
})(this);
