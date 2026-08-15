/**
 * Carrega js/config.js (arquivo de navegador que escreve em `window`) dentro
 * do Node, para os scripts de build lerem siteUrl, telefone etc. de uma única
 * fonte. Compartilhado por build-site e build-sitemap.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function carregarConfig() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(root, 'js/config.js'), 'utf8'), sandbox, {
    filename: 'js/config.js'
  });
  return sandbox.window.AUTOBAYER_CONFIG;
}

export { root as raizDoProjeto };
