/**
 * Gera js/vehicles.js a partir de data/vehicles.json.
 *
 * Por que existe: o admin grava JSON puro (formato limpo, fácil de versionar
 * e de validar), mas o site carrega os dados por <script> em vez de fetch —
 * assim o index.html continua funcionando aberto direto do disco, sem servidor.
 *
 * js/vehicles.js é gerado e fica fora do Git. Edite data/vehicles.json.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validarEstoque } from '../lib/vehicle-schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const raw = await readFile(join(root, 'data/vehicles.json'), 'utf8');

let vehicles;
try {
  vehicles = JSON.parse(raw);
} catch (error) {
  console.error(`data/vehicles.json não é um JSON válido: ${error.message}`);
  process.exit(1);
}

// Mesma validação que a API do admin aplica. Melhor quebrar o build do que
// publicar um estoque inconsistente.
const problemas = validarEstoque(vehicles);
if (problemas.length) {
  console.error('Estoque inválido:');
  problemas.forEach((problema) => console.error(`  · ${problema}`));
  process.exit(1);
}

const output = `/**
 * ARQUIVO GERADO — não edite à mão.
 *
 * Fonte: data/vehicles.json
 * Gere novamente com: npm run data
 */
window.AUTOBAYER_VEHICLES = ${JSON.stringify(vehicles, null, 2)};
`;

await writeFile(join(root, 'js/vehicles.js'), output, 'utf8');

const disponiveis = vehicles.filter((v) => !v.sold).length;
console.log(
  `js/vehicles.js gerado — ${vehicles.length} veículos ` +
    `(${disponiveis} disponíveis, ${vehicles.length - disponiveis} vendidos).`
);
