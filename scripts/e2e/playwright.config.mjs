/**
 * Configuração dos testes de navegador real.
 *
 * Por que eles existem: três bugs chegaram à produção passando por toda a
 * suíte jsdom — caminhos relativos em /admin, e duas variações de elemento
 * "hidden" que continuava visível. Todos eram invisíveis para o jsdom, que
 * não faz renderização. Estes testes rodam num Chromium de verdade contra o
 * MESMO public/ que vai para o ar.
 *
 * Rode com:  npm run test:e2e   (faz o build antes)
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 800 }
  },
  webServer: {
    command: 'node scripts/e2e/server.mjs',
    cwd: '../..',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  }
});
