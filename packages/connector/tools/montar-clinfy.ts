// Monta a tela única do administrador (packages/extension/clinfy.html) a partir das telas de sempre:
// agenda.html, painel.html, config.html e confirmacao.html. Cada tela entra como uma seção, com os ids que se
// repetem entre telas prefixados (o mapa igual está em hub.js). Assim a página única nunca é editada à mão:
// mudou uma tela, rode de novo.
//
//   npx tsx tools/montar-clinfy.ts
//
// O teste test/clinfy.test.ts falha se o clinfy.html estiver desatualizado.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPETIDOS = ["pill", "pill-text", "conn-text"];
const TELAS = [
  { arquivo: "agenda.html", prefixo: "ag-" },
  { arquivo: "painel.html", prefixo: "pn-" },
  { arquivo: "config.html", prefixo: "cf-" },
  { arquivo: "confirmacao.html", prefixo: "cc-" },
] as const;
const SCRIPTS = ["core.js", "api.js", "bridge.js", "cobranca.js", "hub.js", "agenda.js", "painel.js", "config.js", "confirmacao.js"];

export const DIR_EXTENSAO = resolve(dirname(fileURLToPath(import.meta.url)), "../../extension");

// O conteúdo do <body> antes dos <script>, a classe do body e a versão usada nos ?v=.
function lerTela(dir: string, arquivo: string, prefixo: string) {
  const html = readFileSync(resolve(dir, arquivo), "utf8").replace(/\r\n/g, "\n");
  const body = /<body class="([^"]+)">\n([\s\S]*?)\n<script /.exec(html);
  if (!body) throw new Error(`${arquivo}: não achei <body class="…"> seguido dos <script>`);
  let conteudo = body[2];
  for (const id of REPETIDOS) conteudo = conteudo.split(`id="${id}"`).join(`id="${prefixo}${id}"`);
  const versao = /\?v=([\d.]+)/.exec(html)?.[1];
  if (!versao) throw new Error(`${arquivo}: sem ?v= nos recursos`);
  return { classe: body[1], conteudo, versao };
}

export function montarClinfy(dir = DIR_EXTENSAO): string {
  const [agenda, painel, config, confirmacao] = TELAS.map((t) => lerTela(dir, t.arquivo, t.prefixo));
  const v = agenda.versao;
  for (const t of [painel, config, confirmacao]) if (t.versao !== v) throw new Error(`versões diferentes entre as telas: ${v} e ${t.versao}`);
  const aba = (id: string, rotulo: string) =>
    `    <button type="button" class="hub__tab" role="tab" id="tab-${id}" aria-controls="sec-${id}" aria-selected="false" tabindex="-1">${rotulo}</button>`;
  return `<!doctype html>
<html lang="pt-BR" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ClinFy</title>
<link rel="stylesheet" href="styles.css?v=${v}">
</head>
<body class="page-hub">
<!-- Gerado por packages/connector/tools/montar-clinfy.ts a partir de agenda, painel, config e confirmacao. Não editar à mão. -->
<header class="hub__bar">
  <div class="hd__brand">
    <span class="hd__logo" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg></span>
    <div class="hd__title">ClinFy</div>
  </div>
  <nav class="hub__tabs" role="tablist" aria-label="Seções do ClinFy">
${aba("agenda", "Agenda")}
${aba("painel", "Painel")}
${aba("configurar", "Configurar")}
  </nav>
</header>
<section class="hub__sec ${agenda.classe}" id="sec-agenda" role="tabpanel" aria-labelledby="tab-agenda" hidden>
${agenda.conteudo}
</section>
<section class="hub__sec ${painel.classe}" id="sec-painel" role="tabpanel" aria-labelledby="tab-painel" hidden>
${painel.conteudo}
</section>
<section class="hub__sec hub__cfg" id="sec-configurar" role="tabpanel" aria-labelledby="tab-configurar" hidden>
<div class="${config.classe}">
${config.conteudo}
</div>
<div class="${confirmacao.classe}">
${confirmacao.conteudo}
</div>
</section>
${SCRIPTS.map((s) => `<script src="${s}?v=${v}"></script>`).join("\n")}
</body>
</html>
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const saida = resolve(DIR_EXTENSAO, "clinfy.html");
  writeFileSync(saida, montarClinfy(), "utf8");
  console.log(`montado: ${saida}`);
}
