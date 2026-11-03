# Implantação em vários clientes

Aberto em **30/10/2026** como tema a desenhar; construído em **03/11/2026** (0.19.0, aguardando deploy). A extensão nasceu na instância `apresentacao`, e o objetivo é instalá-la para **todos os clientes** da Kentro. Um Conector atende todas as clínicas; cada clínica é uma linha em `tenants`.

## Página de implantação

`https://asa-integracao-samuels.kentro.com.br/implantacao`

- Pede a **chave de administrador** do Conector (`ADMIN_KEY`). A chave fica só numa variável da aba: não vai para o armazenamento do navegador e some ao fechar a aba ou clicar em *Sair*.
- A página não tem segredo: tudo o que ela mostra vem de `/admin/*`, que confere a chave a cada chamada.
- Proteções: `Cache-Control: no-store`, CSP `default-src 'self'; frame-ancestors 'none'` (sem script de fora nem iframe), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- O que dá para fazer:
  - ver os clientes: situação, credencial (origem e data), instituição da Asa, instância e instalação da Kentro, último uso;
  - criar cliente (a chave da instalação aparece **uma vez**, com botão de copiar);
  - editar o vínculo (instância, id da instalação, instituição) e a observação;
  - gravar ou trocar o token da Asa;
  - configurar o **financeiro** e a **confirmação de véspera** (só por aqui desde a 0.19.0);
  - gerar nova chave da instalação ou da automação (aparecem uma vez);
  - cadastrar a URL de disparo (captura de webhook da Kentro);
  - desligar o cliente e, depois, apagar o histórico (os dois pedem o nome digitado).

## Roteiro de implantação

1. **Criar o cliente** na página: nome, instância da Kentro (ex.: `clinicadagente.atenderbem.com`) e instituição da Asa (o número antes dos dois-pontos no token decodificado; a clínica ou a Asa informam).
   - Copie a **chave da instalação** (`asa_…`). Ela não aparece de novo; se perder, gere outra.
   - Com a instituição preenchida, o Conector recusa token de outra instituição (`INSTITUICAO_DIVERGENTE`), antes de chamar a Asa.
2. **Instalar a extensão na Kentro da clínica** pela URL do manifest: `https://asa-integracao-samuels.kentro.com.br/extensao/manifest.json`.
   - Na instalação: cole a chave em `apiKey` e preencha `queueIds` (filas atendidas).
   - **Restrinja o público** da instalação a quem vai testar.
3. Anote na página o **id da instalação** (Editar vínculo). Uma instalação só pode estar ligada a um cliente.
4. A **clínica cola o próprio token da Asa** em *Configurar Asa Saúde* (menu superior da Kentro, só administradores). Depois de gravado, só a implantação troca.
5. **Conferir na página**: credencial ok, origem "pela clínica", e último uso preenchido (marcado no máximo uma vez por hora).
6. Se a clínica for usar: configurar **financeiro** e **confirmação** na página (e, para a confirmação, a chave da automação e a URL de disparo).
7. **Abrir o público** da instalação para toda a equipe.

## O que o Conector guarda (e o que não)

| Onde | Guarda | Não guarda |
|---|---|---|
| `tenants` | nome; hash da chave da instalação e da chave da automação; token da Asa cifrado (AES-256-GCM com `ASA_CRED_KEY`); instância e id da instalação da Kentro; instituição da Asa; quem implantou; datas (criação, credencial, último uso, desligamento); observação; configuração do financeiro e da confirmação; URL de disparo | as chaves em claro, o token em claro |
| `agendamentos` | tipo e situação do pedido, usuário da Kentro (id e nome), prestador, data, horário, id do paciente e da consulta na Asa, resposta da Asa (para a idempotência), diagnóstico | nome, CPF, telefone e nascimento do paciente |
| `confirmacoes` | consulta (id, data, hora, profissional), telefone para onde o lembrete sai, primeiro nome e procedimento (envio manual), quem pediu, estado, resposta do paciente, atendimento da Kentro | CPF, nome completo |
| `cobrancas` | chave, situação, usuário, id do paciente e da consulta, valor, forma, vencimento, mensagem da Asa | nome, CPF, telefone |

O log de requisição não leva a query string (onde vão CPF e telefone da busca).

## Retenção de 90 dias

- Todo dia (e uma vez ao subir o Conector, depois das migrações), `retencao.ts` apaga os dados pessoais de linhas com mais de **90 dias** (contados no calendário de São Paulo):
  - `confirmacoes` (pela data da consulta): telefone, primeiro nome, procedimento, profissional, quem pediu e o atendimento da Kentro;
  - `agendamentos` (pela data do pedido): usuário, id do paciente e a resposta guardada;
  - `cobrancas` (pela data do lançamento): usuário, id do paciente e a mensagem da Asa (migração 010 deixou `paciente_id` opcional).
- A linha fica, com estado, tipo, valor, forma e datas: os números do Painel Asa (até 90 dias) não mudam. A limpeza não mexe em `atualizado_em`, que o painel usa para contar.
- Efeito visível: a lista "contas lançadas" do paciente no painel deixa de mostrar cobranças com mais de 90 dias.

## Saída de um cliente

1. **Desligar** na página. Numa única gravação: `ativo = false`, marca a data, apaga o token da Asa, a chave da automação e a URL de disparo, e troca a chave da instalação por uma que ninguém conhece. A extensão da clínica para de funcionar na hora.
2. Remover a instalação da extensão na Kentro da clínica (e o fluxo de confirmação, se houver).
3. **Apagar o histórico** (só com o cliente desligado): apaga numa transação as linhas da clínica em `agendamentos`, `confirmacoes` e `cobrancas`. A linha em `tenants` fica, desligada, como registro.

Religar um cliente desligado (editar *ativo*) exige gerar uma chave da instalação nova e gravar o token da Asa de novo.

## Limitações conhecidas

- **"Quem pode lançar" cobrança é regra só da tela.** O Conector não sabe quem é o usuário da Kentro (`usuario` vem da extensão, só para a trilha). O controle de verdade é que só a implantação liga o financeiro.
- **A chave da instalação chega a todo atendente** (é configuração da instalação, entregue ao painel). Quem sai da equipe da clínica leva a possibilidade de usar a chave: **gere uma chave nova** na página e cole na instalação. Pelo mesmo motivo, financeiro e confirmação deixaram de ser gravados com essa chave (0.19.0).
- **A checagem de host (421) não identifica a clínica.** Ela só confere o cabeçalho `Host` dos pedidos ao próprio Conector, para recusar acesso direto por IP:porta (HTTP sem TLS). Não confere de qual instância da Kentro o pedido veio: quem tem a chave usa de qualquer lugar. O vínculo instância/instalação no tenant é registro para a implantação, não barreira.
- O Painel Asa é restrito a administradores e supervisores pela visibilidade do menu na Kentro; a rota aceita qualquer chave da instalação.

## Limites contra abuso

- Busca de paciente (`/v1/paciente`): até 300 por minuto por clínica (o painel busca ao abrir cada conversa); acima disso, 429 `MUITAS_BUSCAS`.
- Admin key errada: depois de 20 falhas em 10 minutos do mesmo IP, o IP recebe 429 `MUITAS_TENTATIVAS` antes de qualquer conferência. **Só no `/admin`:** as chaves das clínicas (instalação e automação) chegam pelo proxy da Kentro, com o mesmo IP para todas, e uma chave velha em uso bloquearia clínicas inteiras. Essas chaves têm 192 bits e não dão para adivinhar. **Só funciona com `TRUST_PROXY`** (número de proxies na frente; no Doca, `1`): sem ele, o Conector vê o IP do proxy, e o bloqueio pegaria todas as clínicas juntas, então fica desligado.
- Os limites são em memória, por processo; reiniciar zera.

## Configuração do Conector

- `ADMIN_KEY` com **pelo menos 32 caracteres**, ou vazia (desliga o `/admin` e a página). Mais curta, o Conector sobe, mas o `/admin` (e a página) fica fechado e o log diz o motivo.
- `TRUST_PROXY=1` no Doca, depois de conferir que o proxy manda `X-Forwarded-For`.

## Em aberto

1. **Automatizar pela API de configuração da Kentro** (`extension_installs_install` e `_update`): a chave seria gerada e gravada direto na instalação, sem passar por mãos. Vale quando houver vários clientes por semana.
2. **Uma clínica com várias unidades ou várias credenciais da Asa.** Hoje é 1 tenant = 1 token = 1 instituição.
3. **Versão por cliente.** Todos usam o mesmo manifest, então um deploy atualiza todos ao mesmo tempo. Avaliar um canal "beta" (manifest separado).
4. **Limites e custo.** Todos os clientes dividem o mesmo Conector (512 MB e 0,5 CPU) e o mesmo banco. A semana e o lado a lado fazem até 14 chamadas à Asa por tela aberta.
