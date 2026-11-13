# Implantação ClinFy na Vercel

Este projeto da Vercel é **só um proxy**. Ele não tem cópia da página.

- `/implantacao`, `/admin/*` e `/extensao/*` são repassados ao Conector no Doca (`asa-integracao-samuels.kentro.com.br`).
- A página mostrada é sempre a que está no ar no Doca. Mudou a página: faça o deploy no Doca. Não precisa redeploy aqui.
- `/` redireciona para `/implantacao`.

A chave de administrador passa pela Vercel no caminho até o Conector. Nada fica gravado aqui.

Deploy: o projeto está ligado ao GitHub, então cada push na `main` publica sozinho. A **pasta raiz** do projeto na Vercel é `deploy/vercel-implantacao`. Se ela voltar para a raiz do repositório, o proxy para de funcionar e os arquivos do repositório ficam expostos.

Domínio próprio, depois: Vercel → projeto `clinfy-implantacao` → Settings → Domains. Adicione o domínio e crie no DNS o registro que a Vercel indicar.
