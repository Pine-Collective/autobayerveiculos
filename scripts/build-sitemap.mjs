/**
 * Gera o sitemap.xml a partir de js/config.js + data/vehicles.json.
 *
 * Roda dentro de npm run build; para gerar manualmente:  npm run sitemap
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { carregarConfig, raizDoProjeto as root } from './lib/load-config.mjs';

const config = carregarConfig();
const vehicles = JSON.parse(readFileSync(join(root, 'data/vehicles.json'), 'utf8'));

const baseUrl = config.siteUrl.replace(/\/$/, '');

/*
 * lastmod: usa a data do último commit que tocou o estoque — informação
 * verdadeira. Antes o campo era carimbado com "hoje" a cada build, o que
 * mentia para o Google. Sem git disponível (ou clone raso sem o histórico),
 * o campo é simplesmente omitido, que é o comportamento correto.
 */
let lastmod = '';
try {
  lastmod = execSync('git log -1 --format=%cs -- data/vehicles.json', {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .toString()
    .trim();
} catch {
  /* sem git: omite lastmod */
}

const urls = [
  { loc: `${baseUrl}/`, priority: '1.0', changefreq: 'daily' },
  { loc: `${baseUrl}/veiculos.html`, priority: '0.9', changefreq: 'daily' },
  // A ficha de cada veículo mora na página de estoque — é a URL canônica
  // que o app.js publica quando a ficha está aberta.
  ...vehicles
    .filter((vehicle) => !vehicle.sold)
    .map((vehicle) => ({
      loc: `${baseUrl}/veiculos.html?veiculo=${encodeURIComponent(vehicle.slug)}`,
      priority: '0.8',
      changefreq: 'weekly'
    }))
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(({ loc, priority, changefreq }) =>
    [
      '  <url>',
      `    <loc>${loc}</loc>`,
      lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
      `    <changefreq>${changefreq}</changefreq>`,
      `    <priority>${priority}</priority>`,
      '  </url>'
    ]
      .filter(Boolean)
      .join('\n')
  )
  .join('\n')}
</urlset>
`;

writeFileSync(join(root, 'sitemap.xml'), xml, 'utf8');
console.log(
  `sitemap.xml gerado com ${urls.length} URLs${lastmod ? ` (lastmod ${lastmod})` : ' (sem lastmod: git indisponível)'}.`
);
