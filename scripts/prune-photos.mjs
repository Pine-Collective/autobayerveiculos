/**
 * Lista (e, com --apagar, remove) fotos de assets/veiculos/ que nenhum
 * veículo de data/vehicles.json referencia mais.
 *
 * Órfãs podem existir por dois motivos: uploads feitos antes do fluxo
 * adiado (quando a foto subia na escolha, não no Publicar) e veículos
 * excluídos depois de publicados.
 *
 * Uso (local, com o repositório atualizado — dê git pull antes):
 *   node scripts/prune-photos.mjs           # só lista
 *   node scripts/prune-photos.mjs --apagar  # apaga; commite depois
 */
import { readFile, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pasta = join(root, 'assets/veiculos');
const apagar = process.argv.includes('--apagar');

const vehicles = JSON.parse(await readFile(join(root, 'data/vehicles.json'), 'utf8'));
const referenciadas = new Set(
  vehicles.flatMap((v) => v.images).map((img) => img.replace(/^\/+/, ''))
);

let arquivos = [];
try {
  arquivos = await readdir(pasta);
} catch {
  console.log('assets/veiculos/ não existe localmente — nada a limpar. (Deu git pull?)');
  process.exit(0);
}

const orfas = arquivos.filter((nome) => !referenciadas.has(`assets/veiculos/${nome}`));

if (orfas.length === 0) {
  console.log(`Nenhuma foto órfã entre ${arquivos.length} arquivo(s). Tudo limpo.`);
  process.exit(0);
}

console.log(`${orfas.length} foto(s) órfã(s) de ${arquivos.length}:`);
for (const nome of orfas) console.log(`  · assets/veiculos/${nome}`);

if (apagar) {
  for (const nome of orfas) await unlink(join(pasta, nome));
  console.log('\nApagadas. Agora commite: git add -A && git commit -m "chore: remove fotos órfãs"');
} else {
  console.log('\nNada foi apagado. Rode com --apagar para remover.');
}
