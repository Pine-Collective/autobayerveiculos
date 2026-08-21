/**
 * Teste de fumaça: carrega as páginas do site num DOM real (jsdom), executa
 * os scripts e verifica os fluxos principais.
 *
 * São duas páginas: veiculos.html (o catálogo com busca e filtros, onde
 * também mora a ficha de cada veículo) e index.html (a home, que mostra só
 * uma vitrine de destaques e manda o resto para o catálogo).
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
 *
 * `substituicoes` troca o conteúdo de um arquivo por outro — é assim que a
 * vitrine da home é testada com mais carros do que o estoque real tem hoje.
 */
const criarInterceptador = (substituicoes) =>
  requestInterceptor(async (request) => {
    if (!request.url.startsWith(`${ORIGIN}/`)) {
      return new Response('', { status: 204 });
    }
    const relativePath = new URL(request.url).pathname.replace(/^\//, '');
    const extension = relativePath.split('.').pop();

    if (substituicoes && substituicoes[relativePath] !== undefined) {
      return new Response(substituicoes[relativePath], {
        headers: { 'Content-Type': MIME[extension] || 'application/octet-stream' }
      });
    }

    try {
      const body = await readFile(join(root, relativePath));
      return new Response(body, {
        headers: { 'Content-Type': MIME[extension] || 'application/octet-stream' }
      });
    } catch {
      return new Response('', { status: 404 });
    }
  });

const localFilesOnly = criarInterceptador();

/** Sobe uma página do site e espera os scripts terminarem. */
async function abrirPagina(arquivo, opcoes = {}) {
  const fonte = await readFile(join(root, arquivo), 'utf8');
  const pagina = new JSDOM(fonte, {
    url: opcoes.url || `${ORIGIN}/${arquivo}`,
    runScripts: 'dangerously',
    resources: {
      interceptors: [
        opcoes.substituicoes ? criarInterceptador(opcoes.substituicoes) : localFilesOnly
      ]
    },
    pretendToBeVisual: true,
    virtualConsole
  });

  await new Promise((resolve) => {
    if (pagina.window.document.readyState === 'complete') resolve();
    else pagina.window.addEventListener('load', resolve);
  });
  await tick(50);
  return { dom: pagina, fonte };
}

// A página principal dos testes é o catálogo: é ela que tem busca, filtros,
// abas e a ficha do veículo.
const { dom, fonte: htmlEstoque } = await abrirPagina('veiculos.html');

const { window } = dom;
const { document } = window;

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
  new RegExp(`${VEHICLES.length} veículos encontrados`).test($('#resultCount').textContent),
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

setSelect('#priceFilter', '8000');
check('"Até R$ 8 mil" retorna nada (mais barato é 8.900)', cards().length === 0);
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
check(
  'contador de SUV calculado dos dados',
  suvTab.querySelector('small').textContent ===
    String(VEHICLES.filter((v) => v.type === 'SUV').length).padStart(2, '0')
);
check(
  'contador de Todos calculado dos dados',
  tabs[0].querySelector('small').textContent === String(VEHICLES.length).padStart(2, '0')
);

suvTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(
  'clicar em SUV filtra para 1',
  cards().length === VEHICLES.filter((v) => v.type === 'SUV').length,
  `${cards().length} cards`
);
check('aba SUV marcada como pressionada', suvTab.getAttribute('aria-pressed') === 'true');
check('aba Todos desmarcada', tabs[0].getAttribute('aria-pressed') === 'false');

const brandOptions = $$('#brandFilter option');
check(
  'marcas geradas dos dados',
  brandOptions.length === new Set(VEHICLES.map((v) => v.brand)).size + 1,
  `${brandOptions.length}`
);

setSelect('#brandFilter', VEHICLES.find((v) => v.type === 'SUV').brand);
check('SUV + marca combinam', cards().length === 1, `${cards().length}`);

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
search.value = VEHICLES[0].model.split(' ')[0].toLowerCase();
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await tick();
check('busca por modelo retorna 1', cards().length === 1, `${cards().length}`);

search.value = VEHICLES[0].brand.toUpperCase();
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await tick();
check(
  'busca é case-insensitive',
  cards().length === VEHICLES.filter((v) => v.brand === VEHICLES[0].brand).length
);

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
  !VEHICLES.some((v) => v.featured) || VEHICLES.find((v) => v.id === firstCardId).featured === true,
  `primeiro id=${firstCardId}`
);

/* ------------------------------------------------------------------ */
console.log('\n7. Formatação pt-BR');
/* ------------------------------------------------------------------ */

const cardText = cards()[0]
  .textContent.replace(/\s+/g, ' ')
  .replace(/\u00a0/g, ' ');
const primeiroExibido = VEHICLES.find((v) => v.id === Number(cards()[0].dataset.id));
check(
  'preço formatado como moeda BRL',
  cardText.includes(
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
      .format(primeiroExibido.price)
      .replace(/\u00a0/g, ' ')
  ),
  cardText.match(/R\$[^·]*/)?.[0]
);
check(
  'quilometragem com separador de milhar',
  cardText.includes(
    primeiroExibido.km
      ? new Intl.NumberFormat('pt-BR').format(primeiroExibido.km) + ' km'
      : 'Km não informado'
  )
);

/* ------------------------------------------------------------------ */
console.log('\n7b. Dois preços e lista de itens');
/* ------------------------------------------------------------------ */

// Todo anúncio da loja tem "à vista" e "na troca" — o card mostra os dois.
const comTroca = VEHICLES.find((v) => v.priceTroca);
const cardComTroca = cards().find((c) => Number(c.dataset.id) === comTroca.id);
check('card rotula o preço como "À vista"', /À vista/.test(cardComTroca.textContent));
check(
  'card mostra o preço na troca',
  cardComTroca.querySelector('.price-troca') !== null &&
    /na troca/i.test(cardComTroca.querySelector('.price-troca').textContent)
);

check(
  'todos os anúncios mostram preço na troca',
  VEHICLES.every((v) => v.priceTroca > 0)
);

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

check('clicar no coração não abre a ficha do veículo', $('#vehiclePage').hidden);

/* ------------------------------------------------------------------ */
console.log('\n9. Página individual, deep link e fotos');
/* ------------------------------------------------------------------ */

const targetCard = cards().find((c) => Number(c.dataset.id) === 2);
const targetVehicle = VEHICLES.find((v) => v.id === 2);
targetCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

check('página individual abre', !$('#vehiclePage').hidden);
check(
  'URL recebe o deep link do veículo',
  window.location.search === `?veiculo=${targetVehicle.slug}`,
  window.location.search
);
check(
  'título da página preenchido',
  $('#vehiclePage h1').textContent.includes(targetVehicle.model)
);
check('catálogo fica separado da página individual', $('#catalogMain').hidden);

const waHref = $('[data-cta="whatsapp-page"]').getAttribute('href');
check(
  'CTA do WhatsApp cita o veículo e o preço',
  decodeURIComponent(waHref).includes(targetVehicle.model) &&
    decodeURIComponent(waHref).includes(
      new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: 0
      }).format(targetVehicle.price)
    ),
  decodeURIComponent(waHref)
);
check('ficha técnica usa dl/dt/dd', $$('#vehiclePage .detail-list dt').length === 5);
check(
  'canonical passa a apontar para a ficha, não para a página de estoque',
  $('link[rel="canonical"]')
    .getAttribute('href')
    .endsWith(`/veiculos.html?veiculo=${targetVehicle.slug}`),
  $('link[rel="canonical"]').getAttribute('href')
);

const itensPagina = $$('#vehiclePage .vehicle-page-features li');
check('página lista os itens do veículo', itensPagina.length > 0, `${itensPagina.length}`);
check('itens batem com os dados', itensPagina.length === targetVehicle.features.length);
check('página mostra o preço na troca', $('#vehiclePage .vehicle-page-price small') !== null);

window.history.pushState({}, '', '/veiculos.html');
window.dispatchEvent(new window.PopStateEvent('popstate'));
check('URL volta ao normal', window.location.search === '', window.location.search);
check('voltar mostra o catálogo', !$('#catalogMain').hidden && $('#vehiclePage').hidden);
check(
  'canonical volta para a da página de estoque',
  $('link[rel="canonical"]').getAttribute('href').endsWith('/veiculos.html'),
  $('link[rel="canonical"]').getAttribute('href')
);

/* ------------------------------------------------------------------ */
console.log('\n10. Acessibilidade e links reais nos cards');
/* ------------------------------------------------------------------ */

// O card usa um <a> "esticado" no título — teclado, leitor de tela e clique
// do meio de graça, sem o erro de ARIA de botão dentro de role="button".
const kbLink = cards()[0].querySelector('a.vehicle-link');
check('card tem link real no título', Boolean(kbLink));
check(
  'href do link aponta para o deep link do veículo',
  /^\?veiculo=[a-z0-9-]+$/.test(kbLink.getAttribute('href')),
  kbLink.getAttribute('href')
);
check(
  'nenhum card usa role="button" (ARIA inválida com o ♡ dentro)',
  cards().every((c) => !c.getAttribute('role'))
);

kbLink.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
check('clicar no link abre a página individual', !$('#vehiclePage').hidden);
window.history.pushState({}, '', '/veiculos.html');
window.dispatchEvent(new window.PopStateEvent('popstate'));

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
console.log('\n11b. Painel de filtros recolhido (celular)');
/* ------------------------------------------------------------------ */

// No celular os selects ficam atrás de um botão; o número ao lado dele é a
// única pista de que a lista está filtrada por algo fora da tela.
const filtersToggle = $('#filtersToggle');
const filtersPanel = $('#filters');
check('botão de filtros existe', Boolean(filtersToggle));
check('painel de filtros começa fechado', !filtersPanel.classList.contains('aberto'));
check('aria-expanded começa em false', filtersToggle.getAttribute('aria-expanded') === 'false');

filtersToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('clique abre o painel', filtersPanel.classList.contains('aberto'));
check('aria-expanded acompanha', filtersToggle.getAttribute('aria-expanded') === 'true');
filtersToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('clique de novo fecha', !filtersPanel.classList.contains('aberto'));

check('contador de filtros escondido sem filtro ativo', $('#filtersCount').hidden);
setSelect('#priceFilter', '150000');
check('contador aparece com 1 filtro ativo', !$('#filtersCount').hidden);
check('contador mostra quantos', $('#filtersCount').textContent === '1');
setSelect('#brandFilter', VEHICLES[0].brand);
check('dois filtros somam 2', $('#filtersCount').textContent === '2');
$('#clearFilters').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('limpar filtros zera o contador', $('#filtersCount').hidden);

/* ------------------------------------------------------------------ */
console.log('\n12. SEO e dados estruturados');
/* ------------------------------------------------------------------ */

// O fonte tem placeholders (__SITE_URL__, marcador do schema) que o build
// resolve ao montar public/ — então as expectativas mudam conforme o alvo.
const testandoBuild = root !== projectRoot;

const parsed = $$('script[type="application/ld+json"]').map((tag) => JSON.parse(tag.textContent));

if (testandoBuild) {
  check('nenhum placeholder __SITE_URL__ sobrou no build', !htmlEstoque.includes('__SITE_URL__'));
  check(
    'canonical resolvida para o domínio do config',
    /^https:\/\//.test($('link[rel="canonical"]').getAttribute('href')),
    $('link[rel="canonical"]').getAttribute('href')
  );

  const itemList = parsed.find((p) => p['@type'] === 'ItemList');
  check('build injeta o JSON-LD do estoque na página de veículos', Boolean(itemList));
  check(
    'ItemList lista os carros disponíveis com preço',
    itemList &&
      itemList.itemListElement.length === VEHICLES.filter((v) => !v.sold).length &&
      itemList.itemListElement.every((i) => i.item.offers.price > 0)
  );
  check(
    'URLs do schema apontam para a ficha em veiculos.html',
    itemList &&
      itemList.itemListElement.every((i) => i.item.url.includes('/veiculos.html?veiculo='))
  );
} else {
  check(
    'fonte mantém o marcador para o build injetar o schema do estoque',
    htmlEstoque.includes('__SCHEMA_ESTOQUE__')
  );
  check('fonte usa o placeholder de domínio', htmlEstoque.includes('__SITE_URL__'));
}

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
  $$('[data-wa-link]').every((a) => a.href.startsWith('https://wa.me/554699226135?text='))
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
  'contador da aba ignora vendidos',
  $$('#categoryRow .category')[0].querySelector('small').textContent ===
    String(VEHICLES.filter((v) => !v.sold).length).padStart(2, '0')
);

soldCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check(
  'CTA do vendido oferece similares',
  /Ver veículos parecidos/.test($('[data-cta="whatsapp-page"]').textContent)
);
check(
  'mensagem do WhatsApp pede algo parecido',
  /parecido/.test(decodeURIComponent($('[data-cta="whatsapp-page"]').getAttribute('href')))
);
window.history.pushState({}, '', '/veiculos.html');
window.dispatchEvent(new window.PopStateEvent('popstate'));

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
console.log('\n16. Deep link para veículo que saiu do estoque');
/* ------------------------------------------------------------------ */

// Nova página aberta direto num link compartilhado de carro removido:
// o site precisa avisar, não ficar em silêncio.
const { dom: domLinkMorto } = await abrirPagina('veiculos.html', {
  url: `${ORIGIN}/veiculos.html?veiculo=carro-que-nao-existe`
});

const qMorto = (sel) => domLinkMorto.window.document.querySelector(sel);
check('aviso de link morto aparece', qMorto('#linkAviso') && !qMorto('#linkAviso').hidden);
check('página individual NÃO abre para slug inexistente', qMorto('#vehiclePage').hidden);
check(
  'catálogo continua renderizado por trás do aviso',
  domLinkMorto.window.document.querySelectorAll('.vehicle-card').length > 0
);
domLinkMorto.window.close();

/* ------------------------------------------------------------------ */
console.log('\n17. Home: vitrine de destaques');
/* ------------------------------------------------------------------ */

// O jsdom já reclamou de coisas que só ele não implementa (navegação de
// verdade ao clicar num link do menu, scrollIntoView). O que importa aqui é
// que a HOME não acrescente nenhum erro novo ao rodar sem barra de filtros.
const errosAntesDaHome = consoleErrors.length;

const { dom: domHome, fonte: htmlHome } = await abrirPagina('index.html', {
  url: `${ORIGIN}/`
});
const home = domHome.window.document;
const qHome = (sel) => home.querySelector(sel);
const qqHome = (sel) => Array.from(home.querySelectorAll(sel));
const cardsHome = () => qqHome('.vehicle-card');
// Do array da própria home: o do catálogo já foi mexido pelos testes de
// veículo vendido e de XSS lá em cima.
const disponiveis = domHome.window.AUTOBAYER_VEHICLES.filter((v) => !v.sold).length;

check('home tem grid de veículos', Boolean(qHome('#vehicleGrid')));
check(
  'grid da home declara o limite da vitrine',
  qHome('#vehicleGrid').dataset.limit === '6',
  qHome('#vehicleGrid').dataset.limit
);
check(
  `home mostra os ${Math.min(6, disponiveis)} destaques, não o estoque inteiro`,
  cardsHome().length === Math.min(6, disponiveis),
  `${cardsHome().length} cards`
);
check(
  'cards da home levam para a ficha em veiculos.html',
  cardsHome().every((c) =>
    /^veiculos\.html\?veiculo=[a-z0-9-]+$/.test(
      c.querySelector('a.vehicle-link').getAttribute('href')
    )
  ),
  cardsHome()[0].querySelector('a.vehicle-link').getAttribute('href')
);
check('home não carrega a barra de filtros', qHome('#searchInput') === null);
check('home não carrega as abas de tipo', qHome('#categoryRow') === null);
check(
  'home tem chamada para o estoque completo',
  qqHome('a[href="veiculos.html"]').length >= 2,
  `${qqHome('a[href="veiculos.html"]').length} links`
);
check(
  'JSON-LD do negócio (AutoDealer) fica na home',
  qqHome('script[type="application/ld+json"]')
    .map((tag) => JSON.parse(tag.textContent))
    .some((dado) => dado['@type'] === 'AutoDealer')
);
check(
  'home não quebra sem a barra de filtros',
  consoleErrors.length === errosAntesDaHome,
  consoleErrors.slice(errosAntesDaHome).join(' | ')
);

/* ------------------------------------------------------------------ */
console.log('\n17b. Corte da vitrine com estoque grande');
/* ------------------------------------------------------------------ */

// O estoque real tem 5 carros, então o corte em 6 nunca apareceria. Aqui a
// home é aberta com um estoque inventado de 12 — que é o cenário que motivou
// a mudança: "quando tiver mais carros, vai ficar um scroll gigantesco".
const estoqueGrande = Array.from({ length: 12 }, (_, i) => ({
  id: 100 + i,
  slug: `carro-de-teste-${i}`,
  brand: 'Marca',
  model: `Modelo ${i}`,
  year: 2000 + i,
  type: 'SUV',
  km: 1000,
  price: 50000,
  priceTroca: 51000,
  images: ['assets/favicon.svg'],
  features: [],
  badge: '',
  featured: i === 11,
  sold: i === 0,
  fuel: 'Flex',
  gear: 'Manual',
  color: 'Preto',
  doors: 4
}));

const { dom: domCheia } = await abrirPagina('index.html', {
  url: `${ORIGIN}/`,
  substituicoes: {
    'js/vehicles.js': `window.AUTOBAYER_VEHICLES = ${JSON.stringify(estoqueGrande)};`
  }
});
const cardsCheia = Array.from(domCheia.window.document.querySelectorAll('.vehicle-card'));

check(
  'vitrine corta em 6 mesmo com 12 no estoque',
  cardsCheia.length === 6,
  `${cardsCheia.length}`
);
check(
  'vitrine não mostra vendidos',
  !cardsCheia.some((c) => Number(c.dataset.id) === 100),
  cardsCheia.map((c) => c.dataset.id).join(', ')
);
check(
  'o marcado como destaque vem primeiro',
  Number(cardsCheia[0].dataset.id) === 111,
  `primeiro id=${cardsCheia[0].dataset.id}`
);
domCheia.window.close();

/* ------------------------------------------------------------------ */
console.log('\n18. Botão flutuante do WhatsApp');
/* ------------------------------------------------------------------ */

// Existe para quem não quer navegar o catálogo: abre a conversa direto.
for (const [nome, doc] of [
  ['home', home],
  ['estoque', document]
]) {
  const flutuante = doc.querySelector('.whatsapp-float');
  check(`botão flutuante presente na ${nome}`, Boolean(flutuante));
  check(
    `botão flutuante da ${nome} aponta para o WhatsApp do config`,
    flutuante && flutuante.href.startsWith('https://wa.me/554699226135?text='),
    flutuante && flutuante.href
  );
  check(
    `botão flutuante da ${nome} é rastreado no analytics`,
    flutuante && flutuante.dataset.cta === 'whatsapp-flutuante'
  );
  check(
    `botão flutuante da ${nome} tem nome acessível`,
    flutuante && Boolean(flutuante.getAttribute('aria-label'))
  );
  check(
    `botão flutuante da ${nome} abre em nova aba com rel=noopener`,
    flutuante && (flutuante.getAttribute('rel') || '').includes('noopener')
  );
}

/* ------------------------------------------------------------------ */
console.log('\n19. Topo e rodapé iguais nas duas páginas');
/* ------------------------------------------------------------------ */

// As duas páginas repetem o mesmo cabeçalho/rodapé no HTML (o site não tem
// motor de templates). Estas verificações existem para o dia em que alguém
// mudar o telefone só num dos dois arquivos.
const recorte = (fonte, inicio, fim) => {
  const i = fonte.indexOf(inicio);
  const j = fonte.indexOf(fim, i);
  return i === -1 || j === -1 ? null : fonte.slice(i, j + fim.length);
};

for (const [nome, inicio, fim] of [
  ['topbar', '<div class="topbar">', '</div>\n    </div>'],
  ['rodapé', '<footer>', '</footer>'],
  ['botão flutuante', '<a\n      class="whatsapp-float"', '</a>']
]) {
  const naHome = recorte(htmlHome, inicio, fim);
  const noEstoque = recorte(htmlEstoque, inicio, fim);
  check(
    `${nome} idêntico nas duas páginas`,
    Boolean(naHome) && naHome === noEstoque,
    naHome === noEstoque ? 'ausente em uma delas' : 'divergiram'
  );
}

check(
  'as duas páginas carregam os mesmos três scripts',
  ['js/config.js', 'js/vehicles.js', 'js/app.js'].every(
    (src) => htmlHome.includes(src) && htmlEstoque.includes(src)
  )
);

domHome.window.close();

/* ------------------------------------------------------------------ */

console.log(`\n${'─'.repeat(56)}\n${passed} verificações passaram, ${failures.length} falharam.`);
if (failures.length) {
  console.log('\nFalhas:');
  failures.forEach((f) => console.log(`  · ${f}`));
  process.exitCode = 1;
}
dom.window.close();
