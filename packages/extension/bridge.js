/* Ponte com o host: tema e altura do painel lateral. */
(function (root) {
  'use strict';

  function applyTheme(t) {
    var mode = t && typeof t === 'object' ? t.mode : t;
    document.documentElement.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
  }

  // O host monta o chatPanel sem altura; omni.ui.resize(px) é o mecanismo oficial. O painel se
  // estica, mede quanto o host deixa visível e pede exatamente isso.
  var fit = { busy: false, probe: null };
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

  function fitHeight() {
    var omni = root.omni;
    if (fit.busy || !omni || !omni.ui || !omni.ui.resize) return Promise.resolve();
    fit.busy = true;
    return Promise.resolve(omni.ui.resize(2400))
      .then(function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); })
      .then(measureVisible)
      .then(function (visible) {
        var h = Math.floor(visible) - 10; // borda/padding do slot do host
        if (h < 320) h = Math.max(420, Math.round((screen.availHeight || 800) * 0.62));
        return omni.ui.resize(h);
      })
      .catch(function () { /* host sem resize: fica o que o host der */ })
      .then(function () { fit.busy = false; });
  }

  root.AsaBridge = { applyTheme: applyTheme, fitHeight: fitHeight };
})(this);
