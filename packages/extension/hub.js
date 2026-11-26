/* Tela única do administrador (clinfy.html): Início, Agenda, Painel e Configurar numa página só. As telas de sempre
   (inicio.js, agenda.js, painel.js, config.js, confirmacao.js) rodam aqui sem mudança; este arquivo, carregado antes
   delas, só diz a cada uma quais ids repetidos ela usa com prefixo, e troca as abas.
   A página é montada por packages/connector/tools/montar-clinfy.ts a partir das telas. */
(function (root) {
  'use strict';

  // Ids que mais de uma tela usa: na tela única, cada seção tem os seus com prefixo.
  var REPETIDOS = ['pill', 'pill-text', 'conn-text'];
  var PREFIXOS = { inicio: 'in-', agenda: 'ag-', painel: 'pn-', config: 'cf-', confirmacao: 'cc-' };
  var ids = {};
  Object.keys(PREFIXOS).forEach(function (tela) {
    ids[tela] = {};
    REPETIDOS.forEach(function (id) { ids[tela][id] = PREFIXOS[tela] + id; });
  });
  root.ClinFyIds = ids;

  var ABAS = ['inicio', 'agenda', 'painel', 'configurar'];

  // Cada tela só começa (e só faz os pedidos dela ao Conector) quando a aba dela aparece pela primeira vez.
  // Antes as quatro começavam juntas ao abrir a página, e Painel e Configurar disputavam a rede com a Agenda.
  // O host chama omni.ready uma vez para todas; o início de cada tela fica guardado até a aba abrir.
  var ABA_DO_SCRIPT = { 'inicio.js': 'inicio', 'agenda.js': 'agenda', 'painel.js': 'painel', 'config.js': 'configurar', 'confirmacao.js': 'configurar' };
  var aberta = {}, esperando = {};
  function abaDoScript() {
    var src = root.document && root.document.currentScript && root.document.currentScript.src;
    var nome = src ? src.split('?')[0].split('/').pop() : '';
    return ABA_DO_SCRIPT[nome] || null;
  }
  var omni = root.omni;
  if (omni && typeof omni.ready === 'function') {
    var ready = omni.ready.bind(omni);
    omni.ready = function (cb) {
      var aba = abaDoScript();
      return ready(function (ctx) {
        if (!aba || aberta[aba]) { cb(ctx); return; }
        (esperando[aba] = esperando[aba] || []).push(function () { cb(ctx); });
      });
    };
  }
  function abrirTela(aba) {
    aberta[aba] = true;
    var fila = esperando[aba] || [];
    esperando[aba] = [];
    fila.forEach(function (f) { f(); });
  }

  function mostrar(aba) {
    if (ABAS.indexOf(aba) < 0) aba = 'inicio';
    ABAS.forEach(function (a) {
      var sec = document.getElementById('sec-' + a);
      var btn = document.getElementById('tab-' + a);
      if (sec) sec.hidden = a !== aba;
      if (btn) btn.setAttribute('aria-selected', a === aba ? 'true' : 'false');
      if (btn) btn.tabIndex = a === aba ? 0 : -1;
    });
    abrirTela(aba);
    avisar('clinfy:aba', aba);
  }

  function avisar(nome, detalhe) {
    var ev;
    try { ev = new root.CustomEvent(nome, { detail: detalhe }); } catch (e) { return; }
    document.dispatchEvent(ev);
  }

  // Busca de paciente pedida no Início: a Agenda faz a busca assim que estiver conectada (tomarBusca).
  var buscaPendente = null;
  function buscar(texto) {
    buscaPendente = texto;
    mostrar('agenda');
    avisar('clinfy:buscar', texto);
  }
  function tomarBusca() { var t = buscaPendente; buscaPendente = null; return t; }
  root.ClinFyHub = { mostrar: mostrar, buscar: buscar, tomarBusca: tomarBusca };

  function iniciar() {
    ABAS.forEach(function (a, i) {
      var btn = document.getElementById('tab-' + a);
      if (!btn) return;
      btn.addEventListener('click', function () { mostrar(a); });
      // Setas trocam de aba (padrão de abas acessíveis).
      btn.addEventListener('keydown', function (ev) {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
        var prox = ABAS[(i + (ev.key === 'ArrowRight' ? 1 : ABAS.length - 1)) % ABAS.length];
        mostrar(prox);
        document.getElementById('tab-' + prox).focus();
      });
    });
    // O ClinFy sempre abre no Início (página de abertura), não na última aba usada.
    mostrar('inicio');
  }

  if (root.document && root.document.readyState !== 'loading') iniciar();
  else if (root.document) root.document.addEventListener('DOMContentLoaded', iniciar);
})(this);
