# Implantação em vários clientes (tema em aberto)

Registrado em **30/10/2026**. A extensão nasceu na instância `apresentacao`, mas o objetivo é instalá-la para **todos os clientes** da Kentro. Este documento junta o que já existe e o que ainda precisa ser desenhado. Nada daqui foi construído ainda.

## O que já existe

- **Um Conector para todos.** Cada clínica é uma linha em `tenants` (migração 001), com:
  - nome;
  - hash da chave de instalação;
  - credencial da Asa, cifrada com AES-GCM;
  - hash da chave de automação;
  - configurações (financeiro, confirmação).
- **Chave de instalação por clínica.**
  - `POST /admin/tenants` cria o cliente e devolve a chave `asa_…` **uma única vez**. O banco guarda só o hash.
  - `POST /admin/tenants/:id/rotacionar-chave` troca a chave e invalida a anterior.
  - As duas rotas exigem `x-admin-key`.
- **Na Kentro, a chave fica na config `apiKey` (secret) da instalação.** Ela chega ao painel em `ctx.config` e vale para todos os usuários da instalação.
  - Hoje ela é preenchida à mão em *Administração de extensões* (`/base/config/extensioninstalls`), uma tela que exige superusuário.
- **O token da Asa** é cadastrado pelo administrador da clínica em *Configurar Asa Saúde*. Depois de gravado, só a implantação troca (pelo `/admin`).
- **O que muda por cliente já é configuração:**
  - filas atendidas (`queueIds` da instalação);
  - financeiro e confirmação D-1 (por tenant).

## O que falta desenhar

1. **Quem implanta e como.** Hoje cada cliente passa por quatro passos manuais:
   - criar o tenant pelo `/admin`;
   - instalar a extensão pela URL do manifest;
   - colar a chave na instalação;
   - cadastrar o token da Asa.

   Opções:
   - **(a)** um roteiro manual da implantação;
   - **(b)** uma tela de implantação no Conector (lista de clientes, criar, rotacionar e ver o estado), protegida pela admin key;
   - **(c)** automatizar pela API de configuração da Kentro (o MCP já faz `extension_installs_install` e `_update`). A chave seria gerada e gravada direto na instalação, sem passar por mãos.
2. **Ligação instância ↔ tenant.** Hoje a chave é o único vínculo. Vale guardar no tenant a instância da Kentro (ex.: `clinicadagente.atenderbem.com`) e o id da instalação, para:
   - conferir a origem dos pedidos (o Conector já devolve 421 fora do domínio);
   - ter um painel de quem está ativo.
3. **Uma clínica com várias unidades ou várias credenciais da Asa.** Hoje é 1 tenant = 1 token = 1 instituição.
4. **Versão por cliente.** Todos usam o mesmo manifest servido pelo Conector, então um deploy atualiza todos ao mesmo tempo. Avaliar um canal "beta" (manifest separado) para testar antes em poucos clientes.
5. **Limites e custo.** Cada cliente divide o mesmo Conector (512 MB e 0,5 CPU) e o mesmo banco. A semana e o lado a lado fazem até 14 chamadas à Asa por tela aberta.
6. **Sair de um cliente:** desativar o tenant, apagar a credencial e o que guardar dos históricos (`agendamentos`, `cobrancas`, `confirmacoes`).

Sugestão inicial: começar por **(b)** com o vínculo do item 2. Assim a implantação deixa de depender de `curl` e da admin key no terminal, e o caminho **(c)** fica para quando houver vários clientes por semana.
