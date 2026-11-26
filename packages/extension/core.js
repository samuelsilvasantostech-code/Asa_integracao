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
      // O nome do sistema vem na própria resposta (Conector 0.22.0+); a Asa cadastra o token pela tela.
      if (body.sistema) setSistema(body.sistema);
      var asa = !body.erp || body.erp === 'asa';
      switch (body.conexao || body.asa) {
        case 'ok': return { tone: 'ok', pill: 'Conectado', text: nome + ': conectado ' + sis('ao') + (body.instituicao_id ? ' (instituição ' + body.instituicao_id + ')' : '') + '.', retry: false };
        case 'credencial_ausente': return { tone: 'warn', pill: 'Sem credencial', text: nome + ': a credencial ' + sis('da') + ' ainda não foi cadastrada. ' + (asa ? 'Um administrador cadastra em ClinFy → Configurar.' : 'Fale com a implantação.'), retry: true };
        case 'credencial_invalida': return { tone: 'err', pill: 'Credencial recusada', text: nome + ': ' + sis('a') + ' recusou a credencial cadastrada. Fale com a implantação para trocar a credencial.', retry: true };
        default: return { tone: 'err', pill: 'Sistema fora do ar', text: nome + ': ' + sis('a') + ' não respondeu agora.', retry: true };
      }
    }
    if (body && body.erro === 'LIMITE_KENTRO') return { tone: 'warn', pill: 'Aguarde', text: LIMITE_TEXTO, retry: true };
    if (status === 401) return { tone: 'err', pill: 'Chave inválida', text: 'A chave da instalação não foi reconhecida. Fale com a implantação.', retry: false };
    if (status === -1) return { tone: 'warn', pill: 'Sem chave', text: 'A chave da instalação ainda não foi cadastrada. Um superusuário cadastra em Administração de extensões, no campo "Chave da instalação".', retry: true };
    return { tone: 'err', pill: 'Fora do ar', text: serverDown(status), retry: true };
  }

  // Resposta de PUT /v1/tenant/credencial → mensagem da tela de configuração.
  function credentialSaveState(status, body) {
    if (status === 200 && body && body.ok) return { tone: 'ok', text: ('Credencial validada e salva. ' + sis('A') + ' listou ') + body.prestadores + ' prestador(es) com agenda online.' };
    var erro = body && body.erro;
    if (erro === 'ASA_CREDENCIAL_INVALIDA') return { tone: 'err', text: (sis('A') + ' recusou esse token. Confira se foi copiado inteiro, sem espaços.') };
    if (erro === 'DADOS_INVALIDOS') return { tone: 'err', text: ('Cole o token ' + sis('da') + ' (sem espaços ou quebras de linha).') };
    if (erro === 'CREDENCIAL_JA_CADASTRADA') return { tone: 'err', text: 'Esta clínica já tem um token cadastrado. Para trocar, fale com a implantação.' };
    if (erro === 'INSTITUICAO_DIVERGENTE') return { tone: 'err', text: ('Este token é de outra instituição ' + sis('da') + '. Confira com a implantação.') };
    if (erro === 'CIFRA_NAO_CONFIGURADA') return { tone: 'err', text: 'O servidor do ClinFy ainda não está pronto para guardar credenciais. Fale com a implantação.' };
    if (status === 401) return { tone: 'err', text: 'A chave da instalação não foi reconhecida. Fale com a implantação.' };
    return { tone: 'err', text: readError(status, body) };
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
    var t = todayIso(today).split('-').map(Number);
    var a = t[0] - Number(m[1]);
    if (t[1] < Number(m[2]) || (t[1] === Number(m[2]) && t[2] < Number(m[3]))) a--;
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

  // A Kentro limita as chamadas de cada instalação por minuto; a extensão já espera a vez, mas várias telas
  // ou atendentes juntos ainda podem passar do limite.
  var LIMITE_TEXTO = 'Muitas consultas ao ClinFy em pouco tempo (limite da Kentro). Aguarde alguns segundos e clique em Atualizar.';

  // Sem resposta do servidor do ClinFy (rede, proxy do host) ou falha dele.
  function serverDown(status) {
    return !(status > 0)
      ? 'Não foi possível falar com o servidor do ClinFy. Confira a internet e tente de novo.'
      : 'O servidor do ClinFy teve um problema agora. Tente de novo em instantes.';
  }

  // Pedido recusado por dado fora do formato: em geral, tela aberta há muito tempo ou dado que mudou.
  var PEDIDO_INVALIDO = /^(PARAMETROS_INVALIDOS|DATA_INVALIDA|ID_INVALIDO|VAGA_INVALIDA|EXAME_INVALIDO|GRUPO_INVALIDO|PRESTADOR_INVALIDO|OBSERVACAO_INVALIDA|CHAVE_IDEMPOTENCIA_INVALIDA|CONFIG_INVALIDA)$/;

  // Resposta de leitura do Conector → texto de erro para o atendente. Sem códigos HTTP nem nomes internos.
  function readError(status, body) {
    var erro = body && body.erro;
    if ((erro === 'ASA_RECUSOU' || erro === 'ERP_RECUSOU') && body.msg) return sis('A') + ' respondeu: ' + body.msg;
    if (erro === 'ASA_LIMITE' || erro === 'ERP_LIMITE') return sis('A') + ' pediu um intervalo: foram muitos pedidos seguidos. Aguarde alguns segundos e clique em Atualizar.';
    if (erro === 'CREDENCIAL_AUSENTE') return 'A credencial ' + sis('da') + ' ainda não foi cadastrada. Fale com a implantação.';
    if (erro === 'ASA_CREDENCIAL_INVALIDA' || erro === 'ERP_CREDENCIAL_INVALIDA') return sis('A') + ' recusou a credencial cadastrada. Fale com a implantação.';
    if (erro === 'ERP_SEM_CONFIRMACAO') return 'A confirmação pelo WhatsApp não está disponível com ' + sis('a') + '.';
    if (erro === 'ERP_SEM_FINANCEIRO') return 'O lançamento de cobrança não está disponível com ' + sis('a') + '.';
    if (erro === 'ASA_BLOQUEIO_CLOUDFLARE') return sis('A') + ' bloqueou o acesso do ClinFy (proteção do site ' + sis('da') + '). Fale com a implantação.';
    if (erro === 'ASA_ROTA_INEXISTENTE' || erro === 'ERP_ROTA_INEXISTENTE') return 'Esta função não está disponível com ' + sis('a') + '. Fale com a implantação.';
    if (erro === 'ASA_RESPOSTA_INVALIDA' || erro === 'ERP_RESPOSTA_INVALIDA') return sis('A') + ' respondeu de um jeito inesperado. Tente de novo; se continuar, fale com a implantação.';
    if (typeof erro === 'string' && (erro.indexOf('ERP_') === 0 || erro.indexOf('ASA_') === 0)) return sis('A') + ' não respondeu agora. Tente de novo em instantes.';
    if (erro === 'TELEFONE_INVALIDO') return ('O telefone do contato não está num formato que ' + sis('a') + ' aceite.');
    if (erro === 'CPF_INVALIDO') return 'Informe um CPF com 11 dígitos.';
    if (erro === 'MUITAS_BUSCAS') return 'Muitas buscas de paciente em pouco tempo. Aguarde um minuto e tente de novo.';
    if (erro === 'LIMITE_KENTRO') return LIMITE_TEXTO;
    if (typeof erro === 'string' && PEDIDO_INVALIDO.test(erro)) return 'O pedido saiu com algum dado fora do formato. Atualize a tela e tente de novo.';
    if (erro === 'CHAVE_AUSENTE' || erro === 'CHAVE_INVALIDA' || status === 401) return 'A chave da instalação não foi reconhecida. Fale com a implantação.';
    if (erro === 'HOST_NAO_PERMITIDO') return 'O endereço do servidor do ClinFy está errado nesta instalação. Fale com a implantação.';
    if (status === 429 || erro === 'MUITAS_TENTATIVAS') return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.';
    if (status === 404) return 'Esta função ainda não está disponível no servidor do ClinFy. Fale com a implantação.';
    if (status >= 400 && status < 500) return 'O pedido não foi aceito. Atualize a tela e tente de novo.';
    return serverDown(status);
  }

  function formatMoney(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '';
    var p = Math.abs(v).toFixed(2).split('.');
    return (v < 0 ? '-' : '') + 'R$ ' + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + p[1];
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

  // 11 dígitos → "000.000.000-00" (outro valor volta como veio).
  function formatCpf(d) { return String(d || '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'); }

  // Resposta de POST /v1/pacientes (cadastro sem consulta) → mensagem para o atendente.
  function newPatientError(st, body) {
    var erro = body && body.erro;
    if (erro === 'PACIENTE_INVALIDO') return 'Confira os dados: nome completo, CPF com 11 dígitos, nascimento e telefone com DDD.';
    if (erro === 'CADASTRO_NAO_SUPORTADO') return 'O cadastro sem consulta não está disponível para ' + sis('a') + '. Cadastre junto com o agendamento.';
    if (erro === 'MUITOS_CADASTROS') return 'Muitos cadastros seguidos. Aguarde um minuto e tente de novo.';
    if (st === 0 || erro === 'ERP_FORA_DO_AR') return 'Sem resposta ' + sis('da') + '. Antes de tentar de novo, busque pelo CPF: o cadastro pode ter sido gravado.';
    return readError(st, body);
  }

  // Resposta de POST /v1/agendamentos → mensagem para o atendente.
  // Andamento da confirmação (véspera ou botão do atendente) → selo. null = nada a mostrar.
  var CONFIRMATION = {
    confirmar: ['Confirmada pelo paciente', 'ok'],
    remarcar: ['Pediu para remarcar', 'warn'],
    cancelar: ['Cancelada pelo paciente', 'err']
  };
  function confirmationState(cf) {
    if (!cf) return null;
    if (cf.estado === 'respondido' && CONFIRMATION[cf.resposta]) return { label: CONFIRMATION[cf.resposta][0], tone: CONFIRMATION[cf.resposta][1], waiting: false, answered: true };
    if (cf.estado === 'enviado') return { label: 'Aguardando resposta', tone: 'idle', waiting: true, answered: false };
    if (cf.estado === 'fila') return { label: 'Confirmação na fila', tone: 'idle', waiting: true, answered: false };
    if (cf.estado === 'falhou') return { label: 'Confirmação não entregue', tone: 'err', waiting: false, answered: false };
    return null;
  }

  function confirmationError(status, body) {
    var erro = body && body.erro;
    if (erro === 'MODO_TESTE') return 'A confirmação está em modo teste e o telefone deste paciente não está na lista de teste (ClinFy → Configurar, na parte da confirmação).';
    if (erro === 'SEM_TELEFONE') return ('O cadastro do paciente ' + sis('na') + ' está sem um celular válido para receber a mensagem.');
    if (erro === 'JA_RESPONDIDA') return 'O paciente já respondeu a confirmação desta consulta.';
    if (erro === 'EM_ENVIO') return 'A confirmação desta consulta está saindo agora. Aguarde um instante.';
    if (erro === 'CONSULTA_PASSADA') return 'Só é possível pedir confirmação de consulta futura.';
    if (erro === 'CONSULTA_NAO_ENCONTRADA') return ('Essa consulta não está mais na lista do paciente ' + sis('na') + '.');
    return readError(status, body);
  }

  // Resultado do pedido de confirmação → texto para o atendente.
  function confirmationSent(body) {
    var d = body && body.disparo;
    if (d === 'imediato') return 'Confirmação enviada ao paciente. A resposta aparece aqui quando ele tocar num dos botões.';
    if (d === 'falhou') return 'Confirmação na fila. O envio imediato não respondeu; ela sai na próxima rodada da automação.';
    return 'Confirmação na fila. Ela sai na próxima rodada da automação.';
  }

  // Gravação sem resposta clara: tempo esgotado (0), falha do servidor ou do proxy sem código nosso (5xx),
  // ou 200 sem o "ok". O sistema pode ter gravado, então a chave fica a mesma e o botão só confere.
  function uncertain(status, body) {
    if (body && body.erro) return false;
    return status === 0 || status >= 500 || status === 200;
  }

  function bookingError(status, body) {
    var erro = body && body.erro;
    if (erro === 'HORARIO_INDISPONIVEL') return 'Esse horário acabou de ser ocupado. Escolha outro.';
    if (erro === 'AGENDAMENTO_INCERTO') return (sis('A') + ' não confirmou e a consulta ainda não aparece na agenda do profissional. Ela pode ser gravada nos próximos instantes: aguarde um pouco e clique em "Conferir ' + sis('na') + '". Isso só confere, não marca de novo.') + (body.detalhe ? ' Diagnóstico: ' + body.detalhe + '.' : '');
    if (uncertain(status, body)) return ('A resposta não chegou a tempo e a consulta pode ter sido gravada. Clique em "Conferir ' + sis('na') + '": isso só confere, não marca de novo.');
    if (erro === 'AGENDAMENTO_SEM_NUMERO') return (sis('A') + ' respondeu sem o número da consulta') + (body.msg ? ' ("' + body.msg + '")' : '') + ', então não dá para garantir que foi marcada. Confira na agenda do profissional antes de tentar de novo.';
    if (erro === 'PACIENTE_INCOMPLETO') return ('O cadastro do paciente ' + sis('na') + ' está sem ') + ((body.faltam || []).join(' e ') || 'dados obrigatórios') + (', que ' + sis('a') + ' exige para marcar. Complete o cadastro ' + sis('na') + ' e tente de novo.');
    if (erro === 'PACIENTE_NAO_CONFERE') return ('O paciente escolhido não confere com o cadastro ' + sis('da') + '. Busque o paciente de novo e tente outra vez.');
    if (erro === 'BUSCA_AUSENTE') return 'Busque o paciente de novo (por CPF ou telefone) antes de marcar.';
    if (erro === 'AGENDAMENTO_EM_ANDAMENTO') return 'Este agendamento já está sendo gravado. Aguarde alguns segundos.';
    if (erro === 'PACIENTE_INVALIDO') return 'Confira nome, CPF, nascimento e telefone do paciente.';
    if (erro === 'DADOS_INVALIDOS') return 'Faltam dados do agendamento. Escolha de novo convênio e procedimento.';
    return readError(status, body);
  }


  /* ---------- agenda em tela cheia ---------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  // "Hoje" da clínica (São Paulo), não o do computador: com o relógio em outro fuso, a virada do dia
  // mudava a agenda, o vencimento da cobrança e a idade antes ou depois da hora certa.
  var FUSO = 'America/Sao_Paulo', diaFmt = null;
  function todayIso(now) {
    var d = now || new Date();
    try {
      diaFmt = diaFmt || new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });
      var iso = diaFmt.format(d);
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    } catch (e) { /* navegador sem fusos: usa o do computador */ }
    return isoOf(d);
  }
  // Hora "HH:MM" de agora no fuso da clínica.
  function nowClock(now) { return clockOf((now || new Date()).toISOString()); }
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

  // Tela Início: o dia de todos os profissionais (colunas de /v1/agenda/colunas) → números e próximos pacientes.
  // cols = [{ prestador, agendados }]; now = relógio do Conector (ms). Próximos = ainda não chegou, não foi
  // atendido nem faltou, com hora de agora (menos 30 min de tolerância para atraso) em diante.
  var PROXIMOS_TOLERANCIA = 30, PROXIMOS_MAX = 8;
  function minutesOf(hhmm) { var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  function todayOverview(cols, now) {
    var t = { consultas: 0, confirmadas: 0, aguardando: 0, em_consulta: 0, atendidas: 0, proximos: [] };
    var agora = minutesOf(nowClock(new Date(now)));
    (cols || []).forEach(function (c) {
      (c.agendados || []).forEach(function (a) {
        var i = statusInfo(a.status);
        if (!i.active) return;
        t.consultas++;
        var cf = a.confirmacao, porMensagem = cf && cf.estado === 'respondido' && cf.resposta === 'confirmar';
        if (i.key === 'confirmado' || (porMensagem && i.key === 'agendado')) t.confirmadas++;
        var st = attendanceState(a.atendimento, now);
        if (st && st.stage === 'chegada') t.aguardando++;
        else if (st && st.stage === 'chamada') t.em_consulta++;
        if (i.key === 'atendido' || (st && st.stage === 'fim')) { t.atendidas++; return; }
        if (st || i.key === 'ausente') return;
        var h = minutesOf(a.hora);
        if (h == null || agora == null || h < agora - PROXIMOS_TOLERANCIA) return;
        var conf = confirmationState(cf);
        t.proximos.push({
          hora: a.hora, nome: (a.paciente && a.paciente.nome) || 'Paciente sem nome', prestador: c.prestador || '',
          atrasado: h < agora,
          selo: i.key === 'agendado' && conf ? { label: conf.label, tone: conf.tone } : { label: i.label, tone: i.tone }
        });
      });
    });
    t.proximos.sort(function (x, y) { return x.hora < y.hora ? -1 : x.hora > y.hora ? 1 : 0; });
    t.mais = Math.max(0, t.proximos.length - PROXIMOS_MAX);
    t.proximos = t.proximos.slice(0, PROXIMOS_MAX);
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

  // Resposta de POST /v1/agendamentos/:id/cancelar → mensagem para o atendente.
  function cancelError(status, body) {
    var erro = body && body.erro;
    if (erro === 'CONSULTA_NAO_ENCONTRADA') return ('Essa consulta não está mais na lista do paciente ' + sis('na') + '. Atualize.');
    if (erro === 'AGENDAMENTO_INCERTO' || uncertain(status, body)) return ('A resposta não chegou a tempo e a consulta pode ter sido cancelada. Atualize a lista antes de tentar de novo.');
    if (erro === 'AGENDAMENTO_EM_ANDAMENTO') return 'Este cancelamento já está sendo gravado. Aguarde alguns segundos.';
    return readError(status, body);
  }

  // Resposta de POST /v1/cobrancas → mensagem para o atendente.
  function chargeError(status, body) {
    var erro = body && body.erro;
    if (erro === 'COBRANCA_INCERTA') return (sis('A') + ' não confirmou a tempo e a conta pode ter sido lançada. Confira no financeiro ' + sis('da') + ' antes de lançar de novo.');
    if (erro === 'COBRANCA_EM_ANDAMENTO') return 'Esta cobrança já está sendo lançada. Aguarde alguns segundos.';
    if (uncertain(status, body)) return ('A resposta não chegou a tempo e a conta pode ter sido lançada. Confira no financeiro ' + sis('da') + ' antes de lançar de novo; "Conferir" repete o mesmo pedido, sem lançar outra conta.');
    if (erro === 'FINANCEIRO_DESLIGADO') return 'O lançamento de cobrança está desligado para esta clínica.';
    if (erro === 'PACIENTE_NAO_CONFERE') return ('O paciente não conferiu ' + sis('na') + '. Busque o paciente de novo.');
    if (erro === 'CONSULTA_NAO_ENCONTRADA') return 'A consulta vinculada não foi encontrada para este paciente. Lance sem vínculo ou escolha outra.';
    if (erro === 'DADOS_INVALIDOS') return 'Confira o valor, a forma de pagamento e o vencimento.';
    return readError(status, body);
  }

  /* ---------- tempo de espera: chegada → chamada → fim (marcados pela recepção na Agenda) ---------- */
  var ESPERA_ATENCAO = 15, ESPERA_ATRASO = 30; // minutos: cronômetro âmbar e vermelho

  // Hora "HH:MM" de um instante ISO, no fuso da clínica (o navegador pode estar em outro).
  function clockOf(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    try { return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }); }
    catch (e) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  }

  function duration(ms) {
    var m = Math.max(0, Math.floor(ms / 60000));
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad2(m % 60);
  }

  // Tempos de uma consulta ({chegada, chamada, fim} em ISO) → etapa, rótulo e tom do cronômetro.
  // now = relógio do Conector (ms). null = o paciente ainda não chegou.
  function attendanceState(at, now) {
    if (!at || !at.chegada) return null;
    var ch = Date.parse(at.chegada), cm = at.chamada ? Date.parse(at.chamada) : null, fm = at.fim ? Date.parse(at.fim) : null;
    if (fm && cm) return { stage: 'fim', open: false, tone: 'done', since: fm, wait: cm - ch, consult: fm - cm, label: 'Atendido · esperou ' + duration(cm - ch) };
    if (cm) return { stage: 'chamada', open: true, tone: 'brand', since: cm, wait: cm - ch, consult: now - cm, label: 'Em consulta · ' + duration(now - cm) };
    var w = now - ch, min = w / 60000;
    // O texto muda junto com a cor: quem não distingue âmbar de vermelho lê a diferença.
    var tone = min >= ESPERA_ATRASO ? 'err' : min >= ESPERA_ATENCAO ? 'warn' : 'wait';
    var rotulo = tone === 'err' ? 'Atrasado · ' : tone === 'warn' ? 'Espera longa · ' : 'Aguardando · ';
    return { stage: 'chegada', open: true, tone: tone, since: ch, wait: w, label: rotulo + duration(w) };
  }

  // Próximo botão da recepção para a etapa atual (null = paciente ainda não chegou).
  var NEXT_STAGE = { '': ['chegada', 'Confirmar chegada'], chegada: ['chamada', 'Chamar para consulta'], chamada: ['fim', 'Finalizar consulta'] };
  function attendanceNext(st) { var n = NEXT_STAGE[st ? st.stage : '']; return n ? { acao: n[0], label: n[1] } : null; }
  var STAGE_NAME = { chegada: 'chegada', chamada: 'chamada para a consulta', fim: 'fim da consulta' };
  function stageName(e) { return STAGE_NAME[e] || ''; }

  function attendanceDone(acao, etapa) {
    if (acao === 'chegada') return 'Chegada registrada. O tempo de espera está contando.';
    if (acao === 'chamada') return 'Paciente chamado. O tempo de consulta está contando.';
    if (acao === 'fim') return 'Consulta finalizada.';
    if (acao === 'desfazer') return 'Desfeito: ' + stageName(etapa) + '.';
    return 'Hora ajustada.';
  }

  function attendanceError(status, body) {
    var erro = body && body.erro;
    if (erro === 'SO_HOJE') return 'A chegada só pode ser marcada em consulta de hoje.';
    if (erro === 'ETAPA_FORA_DE_ORDEM') return 'Outra pessoa já mudou esta consulta. A tela foi atualizada.';
    if (erro === 'HORA_INVALIDA') return 'Hora inválida: ela precisa ficar entre a etapa anterior e a seguinte, e não pode ser no futuro.';
    if (erro === 'NADA_A_DESFAZER') return 'Não há etapa para desfazer.';
    if (erro === 'AGENDAMENTO_DESCONHECIDO') return 'Esta consulta não está mais na agenda de hoje. Atualize a agenda.';
    return readError(status, body);
  }

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  /* ---------- nome do sistema (ERP) da clínica nas frases ---------- */
  // Vem de /v1/capacidades ("Asa", artigo "a"). Até lá, e sem nome cadastrado: "o sistema da clínica".
  var SISTEMA_PADRAO = 'sistema da clínica';
  var sistema = { nome: SISTEMA_PADRAO, artigo: 'o' };
  function setSistema(s) {
    if (s && typeof s.nome === 'string' && s.nome.trim()) sistema = { nome: s.nome.trim(), artigo: s.artigo === 'a' ? 'a' : 'o' };
  }
  // sis('na') vira "na Asa" ou "no Feegow". Formas: na, da, ao (à/ao), pela, a (a/o), A (A/O), nome, Nome, marca.
  function sis(forma) {
    var f = sistema.artigo === 'a', n = sistema.nome;
    switch (forma) {
      case 'na': return (f ? 'na ' : 'no ') + n;
      case 'da': return (f ? 'da ' : 'do ') + n;
      case 'ao': return (f ? 'à ' : 'ao ') + n;
      case 'pela': return (f ? 'pela ' : 'pelo ') + n;
      case 'a': return (f ? 'a ' : 'o ') + n;
      case 'A': return (f ? 'A ' : 'O ') + n;
      case 'Nome': return n.charAt(0).toUpperCase() + n.slice(1);
      // Ao lado do "ClinFy" no título: "ClinFy + Luna". Sem sistema conhecido, nada.
      case 'marca': return n === SISTEMA_PADRAO ? '' : ' + ' + n.charAt(0).toUpperCase() + n.slice(1);
      default: return n;
    }
  }
  // Trechos fixos do HTML marcados com data-sis="na" (etc.) recebem a forma certa.
  function applySistema(doc) {
    if (!doc || !doc.querySelectorAll) return;
    var els = doc.querySelectorAll('[data-sis]');
    for (var i = 0; i < els.length; i++) els[i].textContent = sis(els[i].getAttribute('data-sis'));
  }

  /* ---------- DOM: ajudantes usados por todas as telas ---------- */
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
  function fact(dl, label, value) {
    var d = el('div');
    d.appendChild(el('dt', null, label));
    d.appendChild(el('dd', null, value || '—'));
    dl.appendChild(d);
  }

  var api = { el: el, option: option, button: button, fact: fact, setSistema: setSistema, sis: sis, applySistema: applySistema, queueList: queueList, formatMoney: formatMoney, newKey: newKey, newPatient: newPatient, newPatientError: newPatientError, formatCpf: formatCpf,bookingError: bookingError, confirmationState: confirmationState, confirmationError: confirmationError, confirmationSent: confirmationSent, initials: initials, contactPhone: contactPhone, formatPhone: formatPhone, connectionState: connectionState, credentialSaveState: credentialSaveState,
    formatDay: formatDay, formatBirth: formatBirth, age: age, maskCpf: maskCpf, cpfDigits: cpfDigits, readError: readError,
    todayIso: todayIso, shiftDay: shiftDay, longDay: longDay, weekDays: weekDays, weekLabel: weekLabel, statusInfo: statusInfo, dayRows: dayRows, daySummary: daySummary, todayOverview: todayOverview, lookupsFrom: lookupsFrom,
    clockOf: clockOf, nowClock: nowClock, duration: duration, attendanceState: attendanceState, attendanceNext: attendanceNext, attendanceDone: attendanceDone, attendanceError: attendanceError, stageName: stageName,
    fold: fold, paymentLabel: paymentLabel, parseMoney: parseMoney, userType: userType, canCharge: canCharge, chargeError: chargeError, uncertain: uncertain, cancelError: cancelError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AsaCore = api;
})(this);
