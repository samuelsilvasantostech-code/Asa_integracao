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
    if (erro === 'AGENDAMENTO_INCERTO') return 'A Asa não confirmou a tempo e a consulta pode ter sido gravada. Confira na aba Consultas antes de tentar de novo.';
    if (erro === 'AGENDAMENTO_EM_ANDAMENTO') return 'Este agendamento já está sendo gravado. Aguarde alguns segundos.';
    if (erro === 'PACIENTE_INVALIDO') return 'Confira nome, CPF, nascimento e telefone do paciente.';
    if (erro === 'DADOS_INVALIDOS') return 'Faltam dados do agendamento. Escolha de novo convênio e procedimento.';
    return readError(status, body);
  }

  var api = { queueList: queueList, formatMoney: formatMoney, newKey: newKey, newPatient: newPatient, bookingError: bookingError, initials: initials, contactPhone: contactPhone, formatPhone: formatPhone, connectionState: connectionState, credentialSaveState: credentialSaveState,
    formatDay: formatDay, formatBirth: formatBirth, age: age, maskCpf: maskCpf, cpfDigits: cpfDigits, readError: readError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AsaCore = api;
})(this);
