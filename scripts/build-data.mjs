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
import {
  validarEstoque,
  gerarSlug,
  slugUnico,
  TIPOS,
  COMBUSTIVEIS,
  CAMBIOS,
  SELOS
} from '../lib/vehicle-schema.mjs';

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

/*
 * Também gera admin/schema.js: as listas de tipos/combustíveis/etc. e as
 * funções de slug que o painel usa no navegador. Antes elas eram copiadas à
 * mão no admin.js ("espelham a lib") — drift garantido. Gerar a partir da lib
 * mantém uma única fonte de verdade sem transformar o admin em ES module,
 * que o jsdom (usado nos testes) não executa.
 */
const schema = `/**
 * ARQUIVO GERADO — não edite à mão.
 *
 * Fonte: lib/vehicle-schema.mjs
 * Gere novamente com: npm run data
 */
window.AUTOBAYER_SCHEMA = {
  TIPOS: ${JSON.stringify(TIPOS)},
  COMBUSTIVEIS: ${JSON.stringify(COMBUSTIVEIS)},
  CAMBIOS: ${JSON.stringify(CAMBIOS)},
  SELOS: ${JSON.stringify(SELOS)},
  gerarSlug: ${gerarSlug.toString()},
  slugUnico: ${slugUnico.toString()}
};
`;
await writeFile(join(root, 'admin/schema.js'), schema, 'utf8');

/*
 * E gera admin/parser.js a partir de lib/parse-anuncio.mjs, pela mesma razão:
 * o painel precisa do interpretador de anúncios no navegador, e o importador
 * em lote precisa dele no Node. Um arquivo só, duas saídas.
 *
 * A transformação é deliberadamente burra — tira o import, tira os `export`
 * e amarra as dependências ao AUTOBAYER_SCHEMA já carregado. Se algum dia o
 * módulo ganhar sintaxe que isso não cubra, os testes do admin quebram na
 * hora (o painel não carrega sem o parser).
 */
const fonteParser = await readFile(join(root, 'lib/parse-anuncio.mjs'), 'utf8');
const corpoParser = fonteParser
  .replace(/^import\s+\{[^}]*\}\s+from\s+'\.\/vehicle-schema\.mjs';\s*$/m, '')
  .replace(/^export /gm, '');

const parser = `/**
 * ARQUIVO GERADO — não edite à mão.
 *
 * Fonte: lib/parse-anuncio.mjs
 * Gere novamente com: npm run data
 */
(function () {
  'use strict';
  const { TIPOS, COMBUSTIVEIS, gerarSlug } = window.AUTOBAYER_SCHEMA;

${corpoParser
  .split('\n')
  .map((linha) => (linha.trim() ? `  ${linha}` : linha))
  .join('\n')}

  window.AUTOBAYER_PARSER = { parseAnuncio, separarAnuncios, MODELOS_POR_MARCA };
})();
`;
await writeFile(join(root, 'admin/parser.js'), parser, 'utf8');

const disponiveis = vehicles.filter((v) => !v.sold).length;
console.log(
  `js/vehicles.js, admin/schema.js e admin/parser.js gerados — ` +
    `${vehicles.length} veículos ` +
    `(${disponiveis} disponíveis, ${vehicles.length - disponiveis} vendidos).`
);
