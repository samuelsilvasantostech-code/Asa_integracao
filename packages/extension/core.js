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
      return body.asa === 'credencial_cadastrada'
        ? { tone: 'ok', pill: 'Conectado', text: 'Conectado como ' + body.tenant.nome + '.', retry: false }
        : { tone: 'warn', pill: 'Sem credencial', text: body.tenant.nome + ': a credencial da Asa ainda não foi cadastrada no Conector.', retry: true };
    }
    if (status === 401) return { tone: 'err', pill: 'Chave inválida', text: 'A chave da instalação não foi reconhecida pelo Conector.', retry: false };
    if (status === -1) return { tone: 'err', pill: 'Sem chave', text: 'Preencha o endereço do Conector e a chave da instalação na configuração da extensão.', retry: false };
    return { tone: 'err', pill: 'Fora do ar', text: 'Não foi possível falar com o Conector' + (status ? ' (HTTP ' + status + ').' : '.'), retry: true };
  }

  var api = { queueList: queueList, initials: initials, contactPhone: contactPhone, formatPhone: formatPhone, connectionState: connectionState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AsaCore = api;
})(this);
