/**
 * Teste de fumaça: carrega index.html num DOM real (jsdom), executa os scripts
 * do site e verifica os fluxos principais do catálogo.
 *
 *   npm test          testa os fontes na raiz
 *   npm run test:build  testa a pasta public/ que vai para produção
 */
import jsdom from 'jsdom';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Aceita um diretório como argumento para validar também o build gerado.
const root = process.argv[2] ? resolve(process.argv[2]) : projectRoot;
console.log(`Testando: ${root}`);

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Espera a fila de microtasks/timers esvaziar. */
const tick = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Sobe o DOM                                                          */
/* ------------------------------------------------------------------ */

const virtualConsole = new VirtualConsole();
const consoleErrors = [];

// Fontes e imagens externas são bloqueadas de propósito (ver interceptor
// abaixo), então os avisos de carregamento delas não contam como falha.
const isBlockedExternal = (message) =>
  /fonts\.googleapis\.com|fonts\.gstatic\.com|images\.unsplash\.com|googletagmanager\.com/.test(
    message
  );

const recordError = (message) => {
  if (!isBlockedExternal(message)) consoleErrors.push(message);
};

virtualConsole.on('jsdomError', (error) => recordError(error.message));
virtualConsole.on('error', (...args) => recordError(args.join(' ')));

const ORIGIN = 'https://www.autobayerveiculos.com.br';

const MIME = {
  js: 'text/javascript',
  css: 'text/css',
  svg: 'image/svg+xml',
  json: 'application/json'
};

/**
 * Serve os arquivos do próprio site a partir do disco e bloqueia qualquer
 * acesso à rede (Google Fonts, Unsplash), para o teste ser determinístico
 * e rodar offline.
 */
const localFilesOnly = requestInterceptor(async (request) => {
  if (!request.url.startsWith(`${ORIGIN}/`)) {
    return new Response('', { status: 204 });
  }
  const relativePath = new URL(request.url).pathname.replace(/^\//, '');
  try {
    const body = await readFile(join(root, relativePath));
    const extension = relativePath.split('.').pop();
    return new Response(body, {
      headers: { 'Content-Type': MIME[extension] || 'application/octet-stream' }
    });
  } catch {
    return new Response('', { status: 404 });
  }
});

const html = await readFile(join(root, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
  url: `${ORIGIN}/`,
  runScripts: 'dangerously',
  resources: { interceptors: [localFilesOnly] },
  pretendToBeVisual: true,
  virtualConsole
});

const { window } = dom;
const { document } = window;

await new Promise((resolve) => {
  if (document.readyState === 'complete') resolve();
  else window.addEventListener('load', resolve);
});
await tick(50);

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const cards = () => $$('.vehicle-card');
const VEHICLES = window.AUTOBAYER_VEHICLES;

/* ------------------------------------------------------------------ */
console.log('\n1. Regressão: catálogo renderiza no carregamento');
/* ------------------------------------------------------------------ */

check(
  `todos os ${VEHICLES.length} veículos aparecem (bug do filtro de preço)`,
  cards().length === VEHICLES.length,
  `renderizou ${cards().length}`
);
check('estado vazio está escondido', $('#emptyState').hidden);
check(
  'região aria-live anuncia a contagem',
  /6 veículos encontrados/.test($('#resultCount').textContent),
  JSON.stringify($('#resultCount').textContent)
);
check(
  'nenhum erro de script no carregamento',
  consoleErrors.length === 0,
  consoleErrors.join(' | ')
);

/* ------------------------------------------------------------------ */
console.log('\n2. Filtro de preço');
/* ------------------------------------------------------------------ */

function setSelect(selector, value) {
  const el = $(selector);
  el.value = value;
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

setSelect('#priceFilter', '80000');
check('"Até R$ 80 mil" retorna nada (mais barato é 82.900)', cards().length === 0);
check('estado vazio aparece', $('#emptyState').hidden === false);

setSelect('#priceFilter', '150000');
const expectedUnder150 = VEHICLES.filter((v) => v.price <= 150000).length;
check(
  `"Até R$ 150 mil" retorna ${expectedUnder150}`,
  cards().length === expectedUnder150,
  `retornou ${cards().length}`
);

setSelect('#priceFilter', 'all');
check('"Qualquer preço" volta a mostrar todos', cards().length === VEHICLES.length);

/* ------------------------------------------------------------------ */
console.log('\n3. Abas de tipo, marca e contadores automáticos');
/* ------------------------------------------------------------------ */

const tabs = $$('#categoryRow .category');
check(
  '5 abas geradas a partir dos dados (Todos + 4 tipos)',
  tabs.length === 5,
  `${tabs.length} abas`
);

const suvTab = tabs.find((t) => t.dataset.category === 'SUV');
check('contador de SUV calculado dos dados', suvTab.querySelector('small').textContent === '02');
check('contador de Todos calculado dos dados', tabs[0].querySelector('small').textContent === '06');

suvTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('clicar em SUV filtra para 2', cards().length === 2, `${cards().length} cards`);
check('aba SUV marcada como pressionada', suvTab.getAttribute('aria-pressed') === 'true');
check('aba Todos desmarcada', tabs[0].getAttribute('aria-pressed') === 'false');

const brandOptions = $$('#brandFilter option');
check(
  'marcas geradas dos dados (6 + "todas")',
  brandOptions.length === 7,
  `${brandOptions.length}`
);

setSelect('#brandFilter', 'Jeep');
check('SUV + Jeep = 1 veículo (filtros combinam)', cards().length === 1, `${cards().length}`);

/* ------------------------------------------------------------------ */
console.log('\n4. Limpar filtros');
/* ------------------------------------------------------------------ */

$('#clearFilters').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('volta a mostrar todos', cards().length === VEHICLES.length, `${cards().length}`);
check('aba Todos reativada', tabs[0].classList.contains('active'));
check('select de marca resetado', $('#brandFilter').value === 'all');

/* ------------------------------------------------------------------ */
console.log('\n5. Busca');
/* ------------------------------------------------------------------ */

const search = $('#searchInput');
search.value = 'corolla';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await tick();
check('busca por "corolla" retorna 1', cards().length === 1, `${cards().length}`);

search.value = 'RANGER';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await tick();
check('busca é case-insensitive', cards().length === 1);

search.value = 'ferrari';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await tick();
check('busca sem resultado mostra estado vazio', cards().length === 0 && !$('#emptyState').hidden);

search.value = '';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await tick();

/* ------------------------------------------------------------------ */
console.log('\n6. Ordenação');
/* ------------------------------------------------------------------ */

const pricesShown = () =>
  cards().map((card) => VEHICLES.find((v) => v.id === Number(card.dataset.id)).price);

setSelect('#sortFilter', 'lower');
const asc = pricesShown();
check(
  'menor preço ordena crescente',
  asc.every((p, i) => i === 0 || asc[i - 1] <= p),
  asc.join(', ')
);

setSelect('#sortFilter', 'higher');
const desc = pricesShown();
check(
  'maior preço ordena decrescente',
  desc.every((p, i) => i === 0 || desc[i - 1] >= p),
  desc.join(', ')
);

setSelect('#sortFilter', 'featured');
const firstCardId = Number(cards()[0].dataset.id);
check(
  '"Destaques" coloca um veículo featured primeiro',
  VEHICLES.find((v) => v.id === firstCardId).featured === true,
  `primeiro id=${firstCardId}`
);

/* ------------------------------------------------------------------ */
console.log('\n7. Formatação pt-BR');
/* ------------------------------------------------------------------ */

const cardText = cards()[0].textContent.replace(/\s+/g, ' ');
check(
  'preço formatado como moeda BRL',
  /R\$\s?154\.900/.test(cardText),
  cardText.match(/R\$[^·]*/)?.[0]
);
check('quilometragem com separador de milhar', /42\.300 km/.test(cardText));

/* ------------------------------------------------------------------ */
console.log('\n8. Favoritos persistentes');
/* ------------------------------------------------------------------ */

const heart = $('[data-heart="1"]');
check('coração começa não pressionado', heart.getAttribute('aria-pressed') === 'false');

heart.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(
  'favoritar grava no localStorage',
  window.localStorage.getItem('autobayer:favoritos') === '[1]',
  window.localStorage.getItem('autobayer:favoritos')
);
check(
  'coração continua marcado após o re-render',
  $('[data-heart="1"]').getAttribute('aria-pressed') === 'true'
);
check(
  'aria-label do coração se inverte',
  /Remover/.test(
    $('[data-heart="1"]').ariaLabel || $('[data-heart="1"]').getAttribute('aria-label')
  )
);
check(
  'botão de favoritos aparece com contagem',
  !$('#favToggle').hidden && $('#favCount').textContent === '(1)'
);

$('#favToggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('filtro "só favoritos" mostra apenas 1', cards().length === 1, `${cards().length}`);
$('#favToggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

check('clicar no coração não abre o modal', !$('#modalBackdrop').classList.contains('open'));

/* ------------------------------------------------------------------ */
console.log('\n9. Modal, deep link e foco');
/* ------------------------------------------------------------------ */

const targetCard = cards().find((c) => Number(c.dataset.id) === 2);
targetCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

check('modal abre', $('#modalBackdrop').classList.contains('open'));
check(
  'URL recebe o deep link do veículo',
  window.location.search === '?veiculo=toyota-corolla-xei-2021',
  window.location.search
);
check('foco vai para o botão de fechar', document.activeElement === $('#modalClose'));
check('título do modal preenchido', /Corolla/.test($('#modalTitle').textContent));
check('rolagem do body travada', document.body.style.overflow === 'hidden');

const waHref = $('[data-cta="whatsapp-modal"]').getAttribute('href');
check(
  'CTA do WhatsApp cita o veículo e o preço',
  waHref.includes('Corolla') && waHref.includes('119.900'),
  decodeURIComponent(waHref)
);
check('ficha técnica usa dl/dt/dd', $$('.detail-list dt').length === 6);

// Esc fecha
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('Esc fecha o modal', !$('#modalBackdrop').classList.contains('open'));
check('URL volta ao normal', window.location.search === '', window.location.search);
check('rolagem do body liberada', document.body.style.overflow === '');

/* ------------------------------------------------------------------ */
console.log('\n10. Acessibilidade por teclado');
/* ------------------------------------------------------------------ */

const kbCard = cards()[0];
check('cards são focáveis', kbCard.getAttribute('tabindex') === '0');
check('cards têm papel de botão', kbCard.getAttribute('role') === 'button');

kbCard.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
check('Enter abre o modal', $('#modalBackdrop').classList.contains('open'));
$('#modalClose').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

cards()[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
check('Espaço abre o modal', $('#modalBackdrop').classList.contains('open'));
$('#modalClose').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

check(
  'todos os selects têm label associado',
  ['searchInput', 'brandFilter', 'priceFilter', 'sortFilter'].every(
    (id) => !!document.querySelector(`label[for="${id}"]`)
  )
);
check('skip link presente', !!$('.skip-link'));

/* ------------------------------------------------------------------ */
console.log('\n11. Menu mobile');
/* ------------------------------------------------------------------ */

const toggle = $('#menuToggle');
const nav = $('#mainNav');
check('menu começa fechado', toggle.getAttribute('aria-expanded') === 'false');
toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('clique abre o menu', nav.classList.contains('open'));
check('aria-expanded atualiza', toggle.getAttribute('aria-expanded') === 'true');
nav.querySelector('a').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('clicar num link fecha o menu', !nav.classList.contains('open'));

/* ------------------------------------------------------------------ */
console.log('\n12. SEO e dados estruturados');
/* ------------------------------------------------------------------ */

const ldScripts = $$('script[type="application/ld+json"]');
check('2 blocos de JSON-LD (negócio + estoque)', ldScripts.length === 2, `${ldScripts.length}`);

const parsed = ldScripts.map((s) => JSON.parse(s.textContent));
check(
  'JSON-LD é válido e traz AutoDealer + ItemList',
  parsed.some((p) => p['@type'] === 'AutoDealer') && parsed.some((p) => p['@type'] === 'ItemList')
);

const itemList = parsed.find((p) => p['@type'] === 'ItemList');
check(
  `ItemList lista os ${VEHICLES.length} carros com preço`,
  itemList.itemListElement.length === VEHICLES.length &&
    itemList.itemListElement.every((i) => i.item.offers.price > 0)
);

check('og:image definida', !!$('meta[property="og:image"]'));
check('og:title definida', !!$('meta[property="og:title"]'));
check('canonical definida', !!$('link[rel="canonical"]'));
check('favicon definido', !!$('link[rel="icon"]'));

/* ------------------------------------------------------------------ */
console.log('\n13. Higiene geral');
/* ------------------------------------------------------------------ */

check(
  'todas as imagens de card têm width/height (evita CLS)',
  cards().every((c) => {
    const img = c.querySelector('img');
    return img.getAttribute('width') && img.getAttribute('height');
  })
);
check(
  'imagens de card têm loading=lazy',
  cards().every((c) => c.querySelector('img').getAttribute('loading') === 'lazy')
);
check(
  'ano do rodapé é dinâmico',
  $('[data-year]').textContent === String(new Date().getFullYear())
);
check(
  'links do WhatsApp montados a partir do config',
  $$('[data-wa-link]').every((a) => a.href.startsWith('https://wa.me/5511999990000?text='))
);
check(
  'links externos usam rel=noopener',
  $$('a[target="_blank"]').every((a) => (a.getAttribute('rel') || '').includes('noopener'))
);
check('eventos de analytics registrados no dataLayer', (window.dataLayer || []).length > 0);

/* ------------------------------------------------------------------ */
console.log('\n14. Veículo vendido');
/* ------------------------------------------------------------------ */

// Marca o Onix (mais barato) como vendido e confere o comportamento.
VEHICLES.find((v) => v.id === 5).sold = true;
setSelect('#sortFilter', 'lower');

const soldCard = cards().find((c) => Number(c.dataset.id) === 5);
check('card vendido recebe a classe is-sold', soldCard.classList.contains('is-sold'));
check('selo mostra "Vendido"', soldCard.querySelector('.badge').textContent.trim() === 'Vendido');
check(
  'vendido vai para o fim mesmo sendo o mais barato',
  Number(cards()[cards().length - 1].dataset.id) === 5,
  `último id=${cards()[cards().length - 1].dataset.id}`
);
check(
  'contador da aba ignora vendidos (06 -> 05)',
  $$('#categoryRow .category')[0].querySelector('small').textContent === '05'
);

soldCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(
  'CTA do vendido oferece similares',
  /Ver similares/.test($('[data-cta="whatsapp-modal"]').textContent)
);
check(
  'mensagem do WhatsApp pede algo parecido',
  /parecido/.test(decodeURIComponent($('[data-cta="whatsapp-modal"]').getAttribute('href')))
);
$('#modalClose').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

VEHICLES.find((v) => v.id === 5).sold = false;
setSelect('#sortFilter', 'featured');

/* ------------------------------------------------------------------ */
console.log('\n15. Escape de HTML (proteção XSS futura)');
/* ------------------------------------------------------------------ */

window.AUTOBAYER_VEHICLES.push({
  id: 999,
  slug: 'teste-xss',
  brand: '<img src=x onerror="window.__hacked=true">',
  model: 'Teste',
  year: 2024,
  type: 'SUV',
  km: 1000,
  price: 99000,
  images: ['assets/favicon.svg'],
  badge: '',
  featured: false,
  sold: false,
  fuel: 'Flex',
  gear: 'Manual',
  color: 'Preto',
  doors: 4
});
$('#clearFilters').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('marca maliciosa não injeta elemento', !window.__hacked);
check(
  'conteúdo hostil é escapado como texto',
  $$('.vehicle-card h3').some((h) => h.textContent.includes('<img src=x'))
);

/* ------------------------------------------------------------------ */

console.log(`\n${'─'.repeat(56)}\n${passed} verificações passaram, ${failures.length} falharam.`);
if (failures.length) {
  console.log('\nFalhas:');
  failures.forEach((f) => console.log(`  · ${f}`));
  process.exitCode = 1;
}
dom.window.close();
