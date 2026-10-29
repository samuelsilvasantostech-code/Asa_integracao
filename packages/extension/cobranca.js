/* Lançar cobrança (conta a receber na Asa) — o mesmo formulário no painel do atendimento e na Agenda
 * em tela cheia. A Asa não deixa ler, editar nem apagar a conta: por isso revisar antes, chave de
 * idempotência e o histórico vindo do Conector. */
(function (root) {
  'use strict';

  var C = root.AsaCore;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function option(value, text) { var o = el('option', null, text); o.value = value; return o; }
  function button(text, cls, onClick) {
    var b = el('button', 'btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function field(label, input) {
    var l = el('label', 'field');
    l.appendChild(el('span', null, label));
    l.appendChild(input);
    return l;
  }
  function fact(dl, label, value) {
    var d = el('div');
    d.appendChild(el('dt', null, label));
    d.appendChild(el('dd', null, value || '—'));
    dl.appendChild(d);
  }
  function msg(p, text, tone) {
    if (tone) p.setAttribute('data-tone', tone); else p.removeAttribute('data-tone');
    p.textContent = text || '';
  }
  function money(v) { return C.formatMoney(Number(v)); }

  var FORMAS = ['pix', 'cartao_credito', 'cartao_debito', 'dinheiro', 'boleto'];

  /* opts = {
   *   api, user (texto da trilha), patient {id, nome}, busca {telefone|cpf},
   *   appointments [{id, label, prestador_id?, data?}], preselect (id da consulta),
   *   onDone(res), onClose(), fit()
   * } */
  function mount(box, opts) {
    var key = C.newKey(), pending = null;
    var fit = opts.fit || function () {};
    box.textContent = '';

    /* ---------- formulário ---------- */
    var form = el('form', 'booking');
    form.setAttribute('autocomplete', 'off');
    form.appendChild(el('div', 'card__label', 'Lançar cobrança'));
    form.appendChild(el('p', 'booking__who', opts.patient.nome));

    var valor = el('input');
    valor.inputMode = 'decimal';
    valor.placeholder = '0,00';
    valor.maxLength = 12;
    form.appendChild(field('Valor (R$)', valor));

    var forma = el('select');
    forma.appendChild(option('', 'Escolha…'));
    FORMAS.forEach(function (f) { forma.appendChild(option(f, C.paymentLabel(f))); });
    form.appendChild(field('Forma de pagamento', forma));

    var venc = el('input');
    venc.type = 'date';
    venc.min = C.todayIso();
    form.appendChild(field('Vencimento (vazio = amanhã)', venc));

    var vinc = el('select');
    vinc.appendChild(option('', 'Sem consulta vinculada'));
    (opts.appointments || []).forEach(function (a) { vinc.appendChild(option(a.id, a.label)); });
    if (opts.preselect) vinc.value = opts.preselect;
    if ((opts.appointments || []).length) form.appendChild(field('Consulta', vinc));

    var actions = el('div', 'booking__actions');
    var go = el('button', 'btn btn--primary', 'Revisar');
    go.type = 'submit';
    actions.appendChild(go);
    if (opts.onClose) actions.appendChild(button('Fechar', null, opts.onClose));
    form.appendChild(actions);
    var formMsg = el('p', 'muted');
    form.appendChild(formMsg);

    /* ---------- revisão ---------- */
    var rev = el('div', 'booking booking--review');
    rev.hidden = true;
    rev.appendChild(el('div', 'card__label', 'Confirme a cobrança'));
    var sum = el('dl', 'facts');
    rev.appendChild(sum);
    rev.appendChild(el('p', 'hint', 'Ao confirmar, a conta a receber é criada no financeiro da clínica na Asa. Pela Kentro não dá para editar nem excluir depois: correções são feitas direto na Asa.'));
    var revActions = el('div', 'booking__actions');
    var confirm = button('Confirmar cobrança', 'btn--primary', send);
    var back = button('Voltar', null, function () { rev.hidden = true; form.hidden = false; fit(); });
    revActions.appendChild(confirm);
    revActions.appendChild(back);
    rev.appendChild(revActions);
    var revMsg = el('p', 'muted');
    revMsg.setAttribute('role', 'status');
    rev.appendChild(revMsg);

    /* ---------- concluído ---------- */
    var done = el('div', 'booking booking--done');
    done.hidden = true;

    box.appendChild(form);
    box.appendChild(rev);
    box.appendChild(done);

    function appt(id) { return (opts.appointments || []).filter(function (a) { return a.id === id; })[0]; }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = C.parseMoney(valor.value);
      if (!v) { msg(formMsg, 'Informe um valor maior que zero, como 150,00.', 'err'); return; }
      if (!forma.value) { msg(formMsg, 'Escolha a forma de pagamento.', 'err'); return; }
      if (venc.value && venc.value < C.todayIso()) { msg(formMsg, 'O vencimento não pode ser no passado.', 'err'); return; }
      var a = appt(vinc.value);
      pending = { valor: v, forma: forma.value, vencimento: venc.value || undefined, appt: a };
      sum.textContent = '';
      fact(sum, 'Paciente', opts.patient.nome);
      fact(sum, 'Valor', money(v));
      fact(sum, 'Forma', C.paymentLabel(forma.value));
      fact(sum, 'Vencimento', venc.value ? C.formatDay(venc.value, true) : 'Amanhã (padrão da Asa)');
      fact(sum, 'Consulta', a ? a.label : 'Sem vínculo');
      msg(formMsg, '');
      msg(revMsg, '');
      confirm.disabled = false;
      form.hidden = true;
      rev.hidden = false;
      fit();
    });

    function send() {
      if (!pending) return;
      var p = pending;
      confirm.disabled = true;
      back.disabled = true;
      msg(revMsg, 'Lançando na Asa…');
      opts.api.charge({
        chave: key,
        paciente_id: opts.patient.id,
        busca: opts.busca,
        valor: p.valor,
        forma: p.forma,
        vencimento: p.vencimento,
        agendamento: p.appt ? { id: p.appt.id, prestador_id: p.appt.prestador_id, data: p.appt.data } : undefined,
        usuario: opts.user || undefined
      }).then(function (r) {
        back.disabled = false;
        if (r.status === 200 && r.body && r.body.ok) { finish(p, r.body); return; }
        var erro = r.body && r.body.erro;
        msg(revMsg, C.chargeError(r.status, r.body), 'err');
        // Recusa definitiva: um novo pedido precisa de chave nova. Incerta ou em andamento: mantém.
        if (erro !== 'COBRANCA_INCERTA' && erro !== 'COBRANCA_EM_ANDAMENTO') key = C.newKey();
        confirm.disabled = erro === 'COBRANCA_INCERTA';
        fit();
      });
    }

    function finish(p, res) {
      rev.hidden = true;
      done.textContent = '';
      done.appendChild(el('div', 'card__label', 'Cobrança lançada'));
      var dl = el('dl', 'facts');
      fact(dl, 'Valor', money(p.valor));
      fact(dl, 'Forma', C.paymentLabel(p.forma));
      fact(dl, 'Vencimento', p.vencimento ? C.formatDay(p.vencimento, true) : 'Amanhã');
      if (p.appt) fact(dl, 'Consulta', p.appt.label);
      if (res.msg) fact(dl, 'Asa', res.msg);
      done.appendChild(dl);
      if (opts.onClose) done.appendChild(button('Fechar', null, opts.onClose));
      done.hidden = false;
      if (opts.onDone) opts.onDone(res);
      fit();
    }

    fit();
    valor.focus();
  }

  // Histórico das contas lançadas pela Kentro para o paciente (a Asa não devolve as contas).
  function history(list, api, patientId, fit) {
    list.textContent = '';
    var wait = el('li', 'muted', 'Carregando as cobranças…');
    list.appendChild(wait);
    return api.charges(patientId).then(function (r) {
      list.textContent = '';
      if (r.status !== 200 || !r.body) { list.appendChild(el('li', 'muted', C.readError(r.status, r.body))); (fit || function () {})(); return; }
      var items = r.body.cobrancas || [];
      if (!items.length) list.appendChild(el('li', 'muted', 'Nenhuma cobrança lançada pela Kentro para este paciente.'));
      items.forEach(function (c) {
        var li = el('li', 'item charge');
        var top = el('div', 'item__when', money(c.valor) + ' · ' + C.paymentLabel(c.forma));
        if (c.situacao === 'incerto') {
          var s = el('span', 'seal', 'Conferir na Asa');
          s.setAttribute('data-tone', 'warn');
          top.appendChild(s);
        }
        li.appendChild(top);
        var when = new Date(c.criado_em);
        var info = 'Lançada em ' + (isNaN(when) ? '—' : when.toLocaleDateString('pt-BR') + ' ' + when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
        if (c.vencimento) info += ' · vence ' + C.formatDay(c.vencimento, true);
        li.appendChild(el('div', 'item__proc', info));
        var by = [c.agendamento_id ? 'consulta nº ' + c.agendamento_id : '', c.usuario ? 'por ' + String(c.usuario).replace(/^\d+\s+/, '') : ''].filter(Boolean).join(' · ');
        if (by) li.appendChild(el('div', 'item__who', by));
        list.appendChild(li);
      });
      (fit || function () {})();
    });
  }

  root.AsaCharge = { mount: mount, history: history };
})(this);
