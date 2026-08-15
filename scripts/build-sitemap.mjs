/**
 * Gera o sitemap.xml a partir de js/config.js + js/vehicles.js.
 *
 * Rode sempre que adicionar ou vender um carro:  npm run sitemap
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Executa um arquivo de browser (que escreve em `window`) e devolve o window. */
function loadBrowserGlobals(...files) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  for (const file of files) {
    vm.runInContext(readFileSync(join(root, file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox.window;
}

const { AUTOBAYER_CONFIG: config } = loadBrowserGlobals('js/config.js');

// O estoque vem do JSON (fonte da verdade), não do js/vehicles.js gerado.
const vehicles = JSON.parse(readFileSync(join(root, 'data/vehicles.json'), 'utf8'));

const baseUrl = config.siteUrl.replace(/\/$/, '');
const today = new Date().toISOString().slice(0, 10);

const urls = [
  { loc: `${baseUrl}/`, priority: '1.0', changefreq: 'daily' },
  ...vehicles
    .filter((vehicle) => !vehicle.sold)
    .map((vehicle) => ({
      loc: `${baseUrl}/?veiculo=${encodeURIComponent(vehicle.slug)}`,
      priority: '0.8',
      changefreq: 'weekly'
    }))
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ loc, priority, changefreq }) =>
      `  <url>\n` +
      `    <loc>${loc}</loc>\n` +
      `    <lastmod>${today}</lastmod>\n` +
      `    <changefreq>${changefreq}</changefreq>\n` +
      `    <priority>${priority}</priority>\n` +
      `  </url>`
  )
  .join('\n')}
</urlset>
`;

writeFileSync(join(root, 'sitemap.xml'), xml, 'utf8');
console.log(`sitemap.xml gerado com ${urls.length} URLs.`);
