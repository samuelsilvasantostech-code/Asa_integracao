/* Lógica pura do painel (sem DOM, sem SDK). Script clássico: o iframe do host tem origem
 * opaca, então nada de módulos. Nos testes é carregado via require(). */
(function (root) {
  'use strict';

  function queueList(raw) {
    return String(raw || '').split(/[\s,;]+/).map(Number).filter(function (n) { return n > 0; });
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  // O nome do campo de telefone no contato ainda não está documentado: tenta os usuais.
  function contactPhone(ct) {
    if (!ct) return '';
    var v = ct.phone || ct.phoneNumber || ct.number || ct.mobile || ct.whatsapp || '';
    if (!v && Array.isArray(ct.phones) && ct.phones.length) v = ct.phones[0].number || ct.phones[0];
    return String(v || '');
  }

  function formatPhone(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (d.length >= 12 && d.indexOf('55') === 0) d = d.slice(2);
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return raw ? String(raw) : '';
  }

  // Resposta do Conector → estado da pílula e do cartão de conexão.
  // status -1 = extensão sem endereço/chave; 0 = rede ou proxy do host.
  function connectionState(status, body) {
    if (status === 200 && body && body.tenant) {
      var nome = body.tenant.nome;
      switch (body.asa) {
        case 'ok': return { tone: 'ok', pill: 'Conectado', text: nome + ': conectado à Asa' + (body.instituicao_id ? ' (instituição ' + body.instituicao_id + ')' : '') + '.', retry: false };
        case 'credencial_ausente': return { tone: 'warn', pill: 'Sem credencial', text: nome + ': a credencial da Asa ainda não foi cadastrada. Um administrador cadastra em "Configurar Asa Saúde".', retry: true };
        case 'credencial_invalida': return { tone: 'err', pill: 'Credencial recusada', text: nome + ': a Asa recusou a credencial cadastrada. Fale com a implantação para trocar o token.', retry: true };
        default: return { tone: 'err', pill: 'Asa fora do ar', text: nome + ': a Asa não respondeu agora.', retry: true };
      }
    }
    if (status === 401) return { tone: 'err', pill: 'Chave inválida', text: 'A chave da instalação não foi reconhecida pelo Conector.', retry: false };
    if (status === -1) return { tone: 'warn', pill: 'Sem chave', text: 'A chave da instalação ainda não foi cadastrada. Um superusuário cadastra em Administração de extensões, no campo "Chave da instalação".', retry: true };
    return { tone: 'err', pill: 'Fora do ar', text: 'Não foi possível falar com o Conector' + (status ? ' (HTTP ' + status + ').' : '.'), retry: true };
  }

  // Resposta de PUT /v1/tenant/credencial → mensagem da tela de configuração.
  function credentialSaveState(status, body) {
    if (status === 200 && body && body.ok) return { tone: 'ok', text: 'Credencial validada e salva. A Asa listou ' + body.prestadores + ' prestador(es) com agenda online.' };
    var erro = body && body.erro;
    if (erro === 'ASA_CREDENCIAL_INVALIDA') return { tone: 'err', text: 'A Asa recusou esse token. Confira se foi copiado inteiro, sem espaços.' };
    if (erro === 'DADOS_INVALIDOS') return { tone: 'err', text: 'Cole o token da Asa (sem espaços ou quebras de linha).' };
    if (erro === 'CREDENCIAL_JA_CADASTRADA') return { tone: 'err', text: 'Esta clínica já tem um token cadastrado. Para trocar, fale com a implantação.' };
    if (erro === 'CIFRA_NAO_CONFIGURADA') return { tone: 'err', text: 'O Conector ainda não está pronto para guardar credenciais (falta a chave de cifra).' };
    if (status === 401) return { tone: 'err', text: 'A chave da instalação não foi reconhecida pelo Conector.' };
    return { tone: 'err', text: 'Não foi possível validar agora' + (status > 0 ? ' (HTTP ' + status + ')' : '') + '. Tente de novo.' };
  }

  var WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  // YYYY-MM-DD → "qua, 29/10" (ou "29/10/2027" fora do ano corrente com withYear).
  function formatDay(iso, withYear) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var s = WEEKDAYS[d.getDay()] + ', ' + m[3] + '/' + m[2];
    return withYear ? s + '/' + m[1] : s;
  }

  function formatBirth(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }

  function age(iso, today) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    var t = today || new Date();
    var a = t.getFullYear() - Number(m[1]);
    if (t.getMonth() + 1 < Number(m[2]) || (t.getMonth() + 1 === Number(m[2]) && t.getDate() < Number(m[3]))) a--;
    return a >= 0 && a < 130 ? a : null;
  }

  // Mostra só o meio do CPF: o atendente confere sem o número inteiro ficar na tela.
  function maskCpf(cpf) {
    var d = String(cpf || '').replace(/\D/g, '');
    return d.length === 11 ? '***.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-**' : '';
  }

  function cpfDigits(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    return d.length === 11 ? d : null;
  }

  // Resposta de leitura do Conector → texto de erro para o atendente.
  function readError(status, body) {
    var erro = body && body.erro;
    if (erro === 'ASA_RECUSOU' && body.msg) return 'A Asa respondeu: ' + body.msg;
    if (erro === 'CREDENCIAL_AUSENTE') return 'A credencial da Asa ainda não foi cadastrada.';
    if (erro === 'ASA_CREDENCIAL_INVALIDA') return 'A Asa recusou a credencial cadastrada.';
    if (erro === 'TELEFONE_INVALIDO') return 'O telefone do contato não está num formato que a Asa aceite.';
    if (erro === 'CPF_INVALIDO') return 'Informe um CPF com 11 dígitos.';
    if (status === 401) return 'A chave da instalação não foi reconhecida pelo Conector.';
    return 'A Asa não respondeu agora' + (status > 0 ? ' (HTTP ' + status + ')' : '') + '.';
  }

  function formatMoney(v) {
    return typeof v === 'number' && isFinite(v) ? 'R$ ' + v.toFixed(2).replace('.', ',') : '';
  }

  // Chave de idempotência do agendamento. O iframe do host tem origem opaca: randomUUID pode faltar.
  function newKey(rand) {
    var bytes = new Uint8Array(16);
    (rand || function (b) { return (root.crypto || globalThis.crypto).getRandomValues(b); })(bytes);
    return Array.prototype.map.call(bytes, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }

  // Dados do paciente novo, como o Conector espera. Devolve {ok, value} ou {ok:false, error}.
  function newPatient(f) {
    var nome = String(f.nome || '').trim().replace(/\s+/g, ' ');
    var cpf = cpfDigits(f.cpf);
    var tel = String(f.telefone || '').replace(/\D/g, '');
    if (nome.split(' ').length < 2) return { ok: false, error: 'Informe o nome completo do paciente.' };
    if (!cpf) return { ok: false, error: 'Informe um CPF com 11 dígitos.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.nascimento || ''))) return { ok: false, error: 'Informe a data de nascimento.' };
    if (tel.length < 10) return { ok: false, error: 'Informe o telefone com DDD.' };
    return { ok: true, value: { nome: nome, cpf: cpf, nascimento: f.nascimento, telefone: tel } };
  }

  // Resposta de POST /v1/agendamentos → mensagem para o atendente.
  function bookingError(status, body) {
    var erro = body && body.erro;
    if (erro === 'HORARIO_INDISPONIVEL') return 'Esse horário acabou de ser ocupado. Escolha outro.';
    if (erro === 'AGENDAMENTO_INCERTO') return 'A Asa não confirmou e a consulta ainda não aparece na agenda do profissional. Ela pode ser gravada nos próximos instantes: aguarde um pouco e toque em "Conferir na Asa". Isso só confere, não marca de novo.' + (body.detalhe ? ' Diagnóstico: ' + body.detalhe + '.' : '');
    if (status === 0 && !erro) return 'O Conector não respondeu a tempo e a consulta pode ter sido gravada. Toque em "Conferir na Asa": isso só confere, não marca de novo.';
    if (erro === 'AGENDAMENTO_SEM_NUMERO') return 'A Asa respondeu sem o número da consulta' + (body.msg ? ' ("' + body.msg + '")' : '') + ', então não dá para garantir que foi marcada. Confira na agenda do profissional antes de tentar de novo.';
    if (erro === 'PACIENTE_INCOMPLETO') return 'O cadastro do paciente na Asa está sem ' + ((body.faltam || []).join(' e ') || 'dados obrigatórios') + ', que a Asa exige para marcar. Complete o cadastro na Asa e tente de novo.';
    if (erro === 'PACIENTE_NAO_CONFERE') return 'O paciente escolhido não confere com o cadastro da Asa. Busque o paciente de novo e tente outra vez.';
    if (erro === 'BUSCA_AUSENTE') return 'Busque o paciente de novo (por CPF ou telefone) antes de marcar.';
    if (erro === 'AGENDAMENTO_EM_ANDAMENTO') return 'Este agendamento já está sendo gravado. Aguarde alguns segundos.';
    if (erro === 'PACIENTE_INVALIDO') return 'Confira nome, CPF, nascimento e telefone do paciente.';
    if (erro === 'DADOS_INVALIDOS') return 'Faltam dados do agendamento. Escolha de novo convênio e procedimento.';
    return readError(status, body);
  }


  /* ---------- agenda em tela cheia ---------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayIso(now) { return isoOf(now || new Date()); }
  function shiftDay(iso, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return iso;
    return isoOf(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  }

  var WEEKDAYS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  var MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  // YYYY-MM-DD → {weekday: "quinta-feira", date: "30 de outubro"}
  function longDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return { weekday: '', date: '' };
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return { weekday: WEEKDAYS_LONG[d.getDay()], date: Number(m[3]) + ' de ' + MONTHS_LONG[d.getMonth()] };
  }

  // Semana (segunda a domingo) que contém o dia → 7 datas YYYY-MM-DD.
  function weekDays(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return [];
    var wd = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
    var monday = shiftDay(iso, wd === 0 ? -6 : 1 - wd), out = [];
    for (var i = 0; i < 7; i++) out.push(shiftDay(monday, i));
    return out;
  }

  // ["2026-10-26", …, "2026-11-01"] → "26 de outubro a 1 de novembro"
  function weekLabel(days) {
    if (!days || !days.length) return '';
    var a = longDay(days[0]).date, b = longDay(days[days.length - 1]).date;
    var ma = a.split(' de ')[1], mb = b.split(' de ')[1];
    return (ma === mb ? a.split(' de ')[0] : a) + ' a ' + b;
  }

  // Status da Asa (texto livre, minúsculo) → rótulo e tom. "ativa" = ainda conta como consulta do dia.
  function statusInfo(st) {
    var s = String(st || '').toLowerCase();
    if (/cancel/.test(s)) return { key: 'cancelado', label: 'Cancelada', tone: 'err', active: false };
    if (/desist/.test(s)) return { key: 'desistencia', label: 'Desistência', tone: 'err', active: false };
    if (/ausen|falt/.test(s)) return { key: 'ausente', label: 'Faltou', tone: 'warn', active: true };
    if (/remarc/.test(s)) return { key: 'remarcar', label: 'Pediu para remarcar', tone: 'warn', active: true };
    if (/atendid|finaliz|conclu/.test(s)) return { key: 'atendido', label: 'Atendida', tone: 'done', active: true };
    if (/confirm/.test(s)) return { key: 'confirmado', label: 'Confirmada', tone: 'ok', active: true };
    return { key: 'agendado', label: 'Agendada', tone: 'idle', active: true };
  }

  // Consultas marcadas + horários livres → linhas da grade, em ordem de hora.
  function dayRows(agendados, livres) {
    var rows = (agendados || []).map(function (a) { return { kind: 'appt', hora: a.hora || '', appt: a }; })
      .concat((livres || []).map(function (h) { return { kind: 'free', hora: h.horario, slot: h }; }));
    return rows.sort(function (x, y) { return x.hora === y.hora ? (x.kind === 'appt' ? -1 : 1) : x.hora < y.hora ? -1 : 1; });
  }

  function daySummary(agendados, livres) {
    var t = { consultas: 0, confirmadas: 0, atendidas: 0, faltas: 0, canceladas: 0, livres: (livres || []).length };
    (agendados || []).forEach(function (a) {
      var i = statusInfo(a.status);
      if (!i.active) { t.canceladas++; return; }
      t.consultas++;
      if (i.key === 'confirmado') t.confirmadas++;
      if (i.key === 'atendido') t.atendidas++;
      if (i.key === 'ausente') t.faltas++;
    });
    return t;
  }

  // Busca digitada (CPF ou telefone) → buscas a tentar, em ordem. 11 dígitos podem ser os dois:
  // com pontuação de CPF é CPF; com cara de celular (DDD + 9) tenta telefone e depois CPF.
  function lookupsFrom(raw) {
    var txt = String(raw || ''), d = txt.replace(/\D/g, '');
    if (d.length >= 12 && d.indexOf('55') === 0) d = d.slice(2);
    if (d.length === 10) return [{ telefone: d }];
    if (d.length !== 11) return [];
    if (/\d{3}\.\d{3}/.test(txt) || !/^[1-9]{2}9/.test(d)) return [{ cpf: d }];
    return [{ telefone: d }, { cpf: d }];
  }


  /* ---------- financeiro ---------- */

  var PAYMENT_LABELS = { pix: 'Pix', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito', dinheiro: 'Dinheiro', boleto: 'Boleto' };
  function paymentLabel(k) { return PAYMENT_LABELS[k] || String(k || ''); }

  // Valor digitado ("350", "1.234,56", "R$ 89,90") → "350.00", como o Conector espera. null se inválido.
  function parseMoney(raw) {
    var s = String(raw == null ? '' : raw).replace(/R\$|\s/g, '');
    if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
    var n = Number(s);
    return n > 0 && n <= 100000 ? n.toFixed(2) : null;
  }

  // Perfil do usuário do Kentro (0 = administrador). O nome do campo não está documentado no SDK:
  // tenta os usuais. null = não deu para saber.
  function userType(u) {
    if (!u) return null;
    var v = [u.type, u.userType, u.usertype, u.tipo].filter(function (x) { return x != null && x !== ''; })[0];
    if (v == null) return null;
    var n = Number(v);
    return isNaN(n) ? (/admin/i.test(String(v)) ? 0 : null) : n;
  }

  // Pode lançar cobrança? fin = configuração do Conector ({ativo, quem}); type = userType().
  function canCharge(fin, type) {
    if (!fin || !fin.ativo) return false;
    return fin.quem === 'todos' || type === 0;
  }

  // Resposta de POST /v1/cobrancas → mensagem para o atendente.
  function chargeError(status, body) {
    var erro = body && body.erro;
    if (erro === 'COBRANCA_INCERTA') return 'A Asa não confirmou a tempo e a conta pode ter sido lançada. Confira no financeiro da Asa antes de lançar de novo.';
    if (erro === 'COBRANCA_EM_ANDAMENTO') return 'Esta cobrança já está sendo lançada. Aguarde alguns segundos.';
    if (erro === 'FINANCEIRO_DESLIGADO') return 'O lançamento de cobrança está desligado para esta clínica.';
    if (erro === 'PACIENTE_NAO_CONFERE') return 'O paciente não conferiu na Asa. Busque o paciente de novo.';
    if (erro === 'CONSULTA_NAO_ENCONTRADA') return 'A consulta vinculada não foi encontrada para este paciente. Lance sem vínculo ou escolha outra.';
    if (erro === 'DADOS_INVALIDOS') return 'Confira o valor, a forma de pagamento e o vencimento.';
    return readError(status, body);
  }

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  var api = { queueList: queueList, formatMoney: formatMoney, newKey: newKey, newPatient: newPatient, bookingError: bookingError, initials: initials, contactPhone: contactPhone, formatPhone: formatPhone, connectionState: connectionState, credentialSaveState: credentialSaveState,
    formatDay: formatDay, formatBirth: formatBirth, age: age, maskCpf: maskCpf, cpfDigits: cpfDigits, readError: readError,
    todayIso: todayIso, shiftDay: shiftDay, longDay: longDay, weekDays: weekDays, weekLabel: weekLabel, statusInfo: statusInfo, dayRows: dayRows, daySummary: daySummary, lookupsFrom: lookupsFrom,
    fold: fold, paymentLabel: paymentLabel, parseMoney: parseMoney, userType: userType, canCharge: canCharge, chargeError: chargeError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AsaCore = api;
})(this);
