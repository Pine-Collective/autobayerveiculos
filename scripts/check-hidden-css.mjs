/**
 * Verifica a interação entre o atributo `hidden` e o CSS.
 *
 * Por que este arquivo existe: `[hidden] { display: none }` vem da folha de
 * estilo do navegador, que tem prioridade MENOR que a do autor. Então
 * qualquer `.classe { display: ... }` anula o atributo hidden, e o elemento
 * que o JavaScript "escondeu" continua na tela.
 *
 * Isso derrubou o login em produção: `.login { display: grid }` fazia a tela
 * de login nunca sumir, e o painel renderizava fora da área visível.
 *
 * O jsdom não reproduz o problema (ele dá prioridade ao hidden), por isso a
 * checagem é feita no texto do CSS e do HTML em vez de num DOM simulado.
 *
 *   npm run check:css
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const PARES = [
  { html: 'admin/index.html', css: 'admin/admin.css', js: ['admin/admin.js'] },
  { html: 'index.html', css: 'css/styles.css', js: ['js/app.js'] }
];

/** Dado um id, devolve as classes daquele elemento no HTML. */
function classesDoId(html, id) {
  const tag = html.match(new RegExp(`<[a-z][^>]*\\sid="${id}"[^>]*>`, 'i'));
  if (!tag) return [];
  const classes = tag[0].match(/\sclass="([^"]*)"/i);
  return classes ? classes[1].split(/\s+/).filter(Boolean) : [];
}

/**
 * Classes e ids que ficam escondidos via atributo `hidden` — tanto os que já
 * vêm marcados no HTML quanto os que o JavaScript esconde depois.
 *
 * A segunda parte é essencial: a tela de login não tem `hidden` no HTML, ela
 * é escondida por `$('#telaLogin').hidden = true`. Sem varrer o JS, o bug
 * que quebrou o login passaria despercebido de novo.
 */
function seletoresEscondidos(html, fontesJs) {
  const seletores = new Set();
  const registrar = (id, classes) => {
    if (id) seletores.add(`#${id}`);
    classes.forEach((c) => seletores.add(`.${c}`));
  };

  for (const tag of html.match(/<[a-z][^>]*\shidden(\s|>|\/)/gi) || []) {
    const classes = tag.match(/\sclass="([^"]*)"/i);
    const id = tag.match(/\sid="([^"]*)"/i);
    registrar(id?.[1], classes ? classes[1].split(/\s+/).filter(Boolean) : []);
  }

  for (const js of fontesJs) {
    // Captura $('#x').hidden, q('#x').hidden, querySelector('#x').hidden
    for (const uso of js.matchAll(/\(\s*['"]#([\w-]+)['"]\s*\)\s*\.hidden\s*=/g)) {
      registrar(uso[1], classesDoId(html, uso[1]));
    }
  }

  return seletores;
}

/** Regras que declaram `display`, com os seletores de cada uma. */
function regrasComDisplay(css) {
  const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const regras = [];

  for (const bloco of semComentarios.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const seletor = bloco[1].trim();
    const corpo = bloco[2];
    if (/(^|[;\s])display\s*:/.test(corpo)) {
      regras.push({ seletor, display: corpo.match(/display\s*:\s*([^;]+)/)[1].trim() });
    }
  }
  return regras;
}

const temProtecaoGlobal = (css) =>
  /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(css.replace(/\/\*[\s\S]*?\*\//g, ''));

let problemas = 0;

for (const par of PARES) {
  const html = await readFile(join(root, par.html), 'utf8');
  const css = await readFile(join(root, par.css), 'utf8');
  const fontesJs = await Promise.all(
    par.js.map((caminho) => readFile(join(root, caminho), 'utf8'))
  );

  const escondidos = seletoresEscondidos(html, fontesJs);
  const protegido = temProtecaoGlobal(css);

  // Regras de display que colidem com algum elemento escondido via hidden.
  const conflitos = regrasComDisplay(css).filter((regra) =>
    [...escondidos].some((seletor) =>
      regra.seletor
        .split(',')
        .map((s) => s.trim())
        .some((s) => s === seletor || s.startsWith(`${seletor}:`) || s.startsWith(`${seletor} `))
    )
  );

  console.log(`\n${par.html} + ${par.css}`);
  console.log(
    `  elementos com hidden : ${escondidos.size ? [...escondidos].join(', ') : 'nenhum'}`
  );
  console.log(`  regra [hidden] global: ${protegido ? 'presente' : 'AUSENTE'}`);

  if (conflitos.length) {
    console.log(`  seletores com display que também usam hidden:`);
    conflitos.forEach((c) => console.log(`    · ${c.seletor} { display: ${c.display} }`));
  }

  if (!protegido && conflitos.length) {
    console.log(
      `  FALHA: sem "[hidden] { display: none !important }", estes elementos\n` +
        `         continuam visíveis mesmo com o atributo hidden.`
    );
    problemas++;
  } else if (!protegido) {
    console.log(`  FALHA: adicione "[hidden] { display: none !important }" por segurança.`);
    problemas++;
  } else {
    console.log('  ok');
  }
}

console.log(`\n${'─'.repeat(56)}`);
if (problemas) {
  console.log(`${problemas} arquivo(s) com problema de hidden/display.`);
  process.exitCode = 1;
} else {
  console.log('hidden e display estão consistentes.');
}
