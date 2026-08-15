/**
 * Monta a pasta public/ com o que vai para produção.
 *
 * "public" é o diretório de saída padrão do Vercel, Netlify e Cloudflare
 * Pages, então nenhuma configuração extra é necessária no painel.
 *
 * Fica de fora de propósito: node_modules, scripts/, package.json, README
 * e arquivos de configuração — nada disso precisa ser servido ao público.
 *
 * Rode via:  npm run build
 */
import { cp, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public');

/** Tudo que compõe o site publicado. */
const ENTRIES = ['index.html', 'robots.txt', 'sitemap.xml', 'css', 'js', 'assets', 'admin'];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const entry of ENTRIES) {
  await cp(join(root, entry), join(outDir, entry), { recursive: true });
}

/** Soma recursiva do tamanho de um diretório. */
async function directorySize(path) {
  const info = await stat(path);
  if (info.isFile()) return info.size;

  const entries = await readdir(path, { withFileTypes: true });
  const sizes = await Promise.all(entries.map((e) => directorySize(join(path, e.name))));
  return sizes.reduce((total, size) => total + size, 0);
}

const totalKb = ((await directorySize(outDir)) / 1024).toFixed(1);
console.log(`public/ montado com ${ENTRIES.length} entradas — ${totalKb} KB no total.`);
