/**
 * Monta a pasta public/ com o que vai para produção.
 *
 * Além de copiar, o build faz duas injeções no HTML/robots copiados
 * (os FONTES ficam com placeholders):
 *
 *   __SITE_URL__        -> siteUrl de js/config.js (canonical, OG, robots).
 *                          Fonte única: registrou o domínio, muda uma linha.
 *   __SCHEMA_ESTOQUE__  -> JSON-LD com os veículos de data/vehicles.json,
 *                          para o Google ver o estoque sem executar JS.
 *                          Vai em veiculos.html, que é quem lista o estoque.
 *
 * "public" é o diretório de saída padrão do Vercel, Netlify e Cloudflare
 * Pages, então nenhuma configuração extra é necessária no painel.
 *
 * Rode via:  npm run build
 */
import { cp, rm, mkdir, readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { carregarConfig, raizDoProjeto as root } from './lib/load-config.mjs';

const outDir = join(root, 'public');

/** Tudo que compõe o site publicado. */
const ENTRIES = [
  'index.html',
  'veiculos.html',
  'robots.txt',
  'sitemap.xml',
  'css',
  'js',
  'assets',
  'admin'
];

const config = carregarConfig();
const siteUrl = config.siteUrl.replace(/\/$/, '');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const entry of ENTRIES) {
  await cp(join(root, entry), join(outDir, entry), { recursive: true });
}

/* ------------------------------------------------------------------ */
/* JSON-LD do estoque (schema.org ItemList de Car/Offer)               */
/* ------------------------------------------------------------------ */

const vehicles = JSON.parse(await readFile(join(root, 'data/vehicles.json'), 'utf8'));
const disponiveis = vehicles.filter((v) => !v.sold);

const schemaEstoque = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Estoque Autobayer Veículos',
  numberOfItems: disponiveis.length,
  itemListElement: disponiveis.map((vehicle, index) => {
    const item = {
      // schema.org tem tipo próprio para moto; usar "Car" para uma CG 125
      // seria dado errado para o Google.
      '@type': vehicle.type === 'Moto' ? 'Motorcycle' : 'Car',
      name: `${vehicle.brand} ${vehicle.model}${vehicle.year ? ` ${vehicle.year}` : ''}`,
      brand: { '@type': 'Brand', name: vehicle.brand },
      model: vehicle.model,
      bodyType: vehicle.type,
      color: vehicle.color,
      fuelType: vehicle.fuel,
      vehicleTransmission: vehicle.gear,
      image: vehicle.images.map((img) =>
        /^(https?:)?\/\//.test(img) ? img : `${siteUrl}/${img.replace(/^\/+/, '')}`
      ),
      url: `${siteUrl}/veiculos.html?veiculo=${encodeURIComponent(vehicle.slug)}`,
      offers: {
        '@type': 'Offer',
        price: vehicle.price, // sempre o à vista
        priceCurrency: 'BRL',
        availability: 'https://schema.org/InStock',
        seller: { '@type': 'AutoDealer', name: config.nome }
      }
    };

    if (vehicle.year) item.vehicleModelDate = String(vehicle.year);
    if (vehicle.km) {
      item.mileageFromOdometer = {
        '@type': 'QuantitativeValue',
        value: vehicle.km,
        unitCode: 'KMT'
      };
    }

    if (vehicle.doors) item.numberOfDoors = vehicle.doors;
    if (vehicle.features?.length) item.vehicleConfiguration = vehicle.features.join(', ');

    return { '@type': 'ListItem', position: index + 1, item };
  })
};

const blocoSchema = `<script type="application/ld+json">${JSON.stringify(schemaEstoque)}</script>`;

/* ------------------------------------------------------------------ */
/* Injeções nos arquivos copiados                                      */
/* ------------------------------------------------------------------ */

async function processar(caminho, transformar) {
  const arquivo = join(outDir, caminho);
  await writeFile(arquivo, transformar(await readFile(arquivo, 'utf8')), 'utf8');
}

await processar('index.html', (html) => html.replaceAll('__SITE_URL__', siteUrl));

// O JSON-LD do estoque vai só na página que lista os veículos.
await processar('veiculos.html', (html) =>
  html
    .replaceAll('__SITE_URL__', siteUrl)
    .replace(/<!-- __SCHEMA_ESTOQUE__[\s\S]*?-->/, blocoSchema)
);
await processar('robots.txt', (texto) => texto.replaceAll('__SITE_URL__', siteUrl));

/* ------------------------------------------------------------------ */
/* Resumo                                                              */
/* ------------------------------------------------------------------ */

async function directorySize(path) {
  const info = await stat(path);
  if (info.isFile()) return info.size;
  const entries = await readdir(path, { withFileTypes: true });
  const sizes = await Promise.all(entries.map((e) => directorySize(join(path, e.name))));
  return sizes.reduce((total, size) => total + size, 0);
}

const totalKb = ((await directorySize(outDir)) / 1024).toFixed(1);
console.log(
  `public/ montado com ${ENTRIES.length} entradas — ${totalKb} KB, ` +
    `domínio ${siteUrl}, schema com ${disponiveis.length} veículos.`
);
