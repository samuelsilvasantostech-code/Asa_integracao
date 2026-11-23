/* Ponte com o host: tema e altura do painel lateral. */
(function (root) {
  'use strict';

  function applyTheme(t) {
    var mode = t && typeof t === 'object' ? t.mode : t;
    if (typeof mode !== 'string' || !mode) {
      // O host não disse o tema (tela aberta fora da Kentro): segue o do sistema operacional.
      var mq = root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)');
      mode = mq && mq.matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
  }

  // O host monta o chatPanel sem altura; omni.ui.resize(px) é o mecanismo oficial. O painel se
  // estica, mede quanto o host deixa visível e pede exatamente isso.
  var fit = { busy: false, force: true, probe: null, timer: null, key: '' };
  function measureVisible() {
    return new Promise(function (resolve) {
      var probe = fit.probe || (fit.probe = Object.assign(document.createElement('div'), { style: 'position:absolute;left:0;top:0;width:1px;height:100%;pointer-events:none' }));
      if (!probe.parentNode) document.body.appendChild(probe);
      var done = false;
      var io = new IntersectionObserver(function (entries) {
        if (done) return; done = true; io.disconnect();
        resolve(entries[0] && entries[0].isIntersecting ? entries[0].intersectionRect.height : 0);
      });
      io.observe(probe);
      setTimeout(function () { if (!done) { done = true; io.disconnect(); resolve(0); } }, 700);
    });
  }

  // omni.ui.resize sem resposta não pode travar o ajuste para sempre.
  function resize(omni, h) {
    return Promise.race([
      Promise.resolve(omni.ui.resize(h)),
      new Promise(function (r) { setTimeout(r, 3000); })
    ]);
  }

  // A medida depende só da área que o host deixa visível, não do conteúdo. Por isso as telas podem chamar
  // fitHeight à vontade: as chamadas em sequência viram uma só, e a medida só é refeita quando a área pode
  // ter mudado (largura da janela ou da tela diferente) ou quando o painel é aberto de novo (force).
  // Medir estica o painel e encolhe de volta: refazer por tempo fazia o painel pular a cada clique.
  function viewportKey() { return [root.innerWidth, screen.availWidth, screen.availHeight].join('x'); }

  function runFit() {
    var omni = root.omni;
    if (!omni || !omni.ui || !omni.ui.resize) return;
    if (fit.busy) return; // ao terminar, mede de novo se algum pedido forçado chegou no meio
    if (!fit.force && fit.key === viewportKey()) return;
    fit.force = false;
    fit.busy = true;
    resize(omni, 2400)
      .then(function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); })
      .then(measureVisible)
      .then(function (visible) {
        var h = Math.floor(visible) - 10; // borda/padding do slot do host
        if (h < 320) h = Math.max(420, Math.round((screen.availHeight || 800) * 0.62));
        return resize(omni, h);
      })
      .catch(function () { /* host sem resize: fica o que o host der */ })
      .then(function () {
        fit.busy = false;
        fit.key = viewportKey();
        // O host pode ainda estar montando o painel na primeira medida: confere uma vez, logo depois.
        if (!fit.checked) { fit.checked = true; setTimeout(function () { fitHeight(true); }, 4000); }
        if (fit.force) schedule();
      });
  }

  function schedule() {
    clearTimeout(fit.timer);
    fit.timer = setTimeout(runFit, 120);
  }

  function fitHeight(force) {
    if (force === true) fit.force = true;
    schedule();
    return Promise.resolve();
  }

  // A janela mudou de largura (o host redimensionou o painel): a próxima chamada mede de novo.
  root.addEventListener && root.addEventListener('resize', function () {
    if (fit.key !== viewportKey()) schedule();
  });

  root.AsaBridge = { applyTheme: applyTheme, fitHeight: fitHeight };
})(this);
