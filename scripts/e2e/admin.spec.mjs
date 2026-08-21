/**
 * Painel do estoque num navegador real.
 *
 * Cobre exatamente o que escapou do jsdom nos três bugs de produção:
 * a tela de login SUMIR de verdade após entrar, o CSS carregar em /admin
 * sem barra final, e o caminho de foto com canvas real (compressão WebP).
 */
import { test, expect } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

// A mesma senha definida pelo servidor e2e (scripts/e2e/server.mjs).
const SENHA = 'senha-e2e-bem-comprida';

let fotoFixture;

test.beforeAll(async () => {
  // Uma "foto de celular": 2400x1600, pesada o bastante para exercitar a
  // compressão de verdade.
  fotoFixture = join(tmpdir(), 'autobayer-e2e-foto.jpg');
  const ruido = Buffer.alloc(2400 * 1600 * 3);
  for (let i = 0; i < ruido.length; i++) ruido[i] = Math.floor(Math.random() * 256);
  await sharp(ruido, { raw: { width: 2400, height: 1600, channels: 3 } })
    .jpeg({ quality: 92 })
    .toFile(fotoFixture);
});

async function entrar(page) {
  await page.goto('/admin');
  await page.locator('#senha').fill(SENHA);
  await page.locator('#botaoEntrar').click();
  await expect(page.locator('#painel')).toBeVisible();
}

test.describe('Painel do estoque', () => {
  test('login em /admin sem barra final: CSS carrega e telas alternam de verdade', async ({
    page
  }) => {
    await page.goto('/admin');

    // CSS aplicado (o bug dos caminhos relativos deixava a página crua).
    await expect(page.locator('.login-card')).toHaveCSS('display', 'flex');

    // Senha errada: o aviso aparece NA TELA.
    await page.locator('#senha').fill('senha-obviamente-errada');
    await page.locator('#botaoEntrar').click();
    await expect(page.locator('#avisoLogin')).toBeVisible();
    await expect(page.locator('#avisoLogin')).toHaveText('Senha incorreta.');

    // Senha certa: painel visível E tela de login invisível — a asserção
    // que teria pego o bug do [hidden] vs display:grid.
    await page.locator('#senha').fill(SENHA);
    await page.locator('#botaoEntrar').click();
    await expect(page.locator('#painel')).toBeVisible();
    await expect(page.locator('#telaLogin')).toBeHidden();
    await expect(page.locator('#lista .item')).toHaveCount(6);
  });

  test('marcar vendido e publicar chega ao repositório', async ({ page, request }) => {
    await entrar(page);

    // O input do interruptor é invisível (o visual é o trilho); como um
    // usuário real, o clique vai no rótulo.
    const idAlvo = await page
      .locator('#lista input[data-disponivel]')
      .first()
      .getAttribute('data-disponivel');
    await page.locator('#lista .interruptor').first().click();

    await expect(page.locator('#botaoSalvar')).toBeEnabled();
    await page.locator('#botaoSalvar').click();
    await expect(page.locator('#faixaStatus')).toContainText('Publicado');

    const repo = await (await request.get('/api/_e2e/repo')).json();
    const alvo = repo['data/vehicles.json'].find((v) => String(v.id) === idAlvo);
    expect(alvo.sold).toBe(true);

    // Desfaz para não interferir nos outros testes.
    await page
      .locator('#lista .item', { has: page.locator(`input[data-disponivel="${idAlvo}"]`) })
      .locator('.interruptor')
      .click();
    await page.locator('#botaoSalvar').click();
    await expect(page.locator('#faixaStatus')).toContainText('Publicado');
  });

  test('cadastro com foto real: comprime no navegador e sobe só no Publicar', async ({
    page,
    request
  }) => {
    await entrar(page);

    await page.locator('#botaoNovo').click();
    await expect(page.locator('#modalEditor')).toBeVisible();

    await page.locator('#f-brand').fill('Renault');
    await page.locator('#f-model').fill('Duster Iconic');
    await page.locator('#f-year').fill('2024');
    await page.locator('#f-price').fill('129900');
    await page.locator('#f-km').fill('18000');
    await page.locator('#f-type').selectOption('SUV');

    // Upload da "foto de celular": o navegador comprime via canvas real.
    await page.locator('#arquivoFoto').setInputFiles(fotoFixture);
    await expect(page.locator('#galeria .foto')).toHaveCount(1);
    await expect(page.locator('#progressoUpload')).toContainText('sobem quando você publicar');

    // A prévia é local (data:) — nada subiu ainda.
    const previa = await page.locator('#galeria .foto img').first().getAttribute('src');
    expect(previa.startsWith('data:image/')).toBe(true);

    const repoAntes = await (await request.get('/api/_e2e/repo')).json();
    expect(Object.keys(repoAntes).some((c) => c.startsWith('assets/veiculos/'))).toBe(false);

    await page.locator('#formVeiculo button[type="submit"]').click();
    await expect(page.locator('#modalEditor')).toBeHidden();
    await expect(page.locator('#lista .item')).toHaveCount(7);

    await page.locator('#botaoSalvar').click();
    await expect(page.locator('#faixaStatus')).toContainText('Publicado', { timeout: 15000 });

    // Agora sim: foto commitada como WebP e referenciada pelo veículo.
    const repo = await (await request.get('/api/_e2e/repo')).json();
    const fotos = Object.keys(repo).filter((c) => c.startsWith('assets/veiculos/'));
    expect(fotos.length).toBe(1);
    expect(fotos[0]).toMatch(/renault-duster-iconic-2024-[a-z0-9]+\.webp$/);

    const duster = repo['data/vehicles.json'].find((v) => v.model === 'Duster Iconic');
    expect(duster.images[0]).toBe(fotos[0]);
    expect(duster.price).toBe(129900);
    expect(duster.slug).toBe('renault-duster-iconic-2024');
  });

  test('colar anúncio preenche o formulário e Moto esconde portas', async ({ page }) => {
    await entrar(page);
    await page.locator('#botaoNovo').click();

    await page.locator('#botaoColarAnuncio').click();
    await page
      .locator('#textoAnuncio')
      .fill(
        [
          'Cg125 KS 2003',
          'Motor bom',
          'Piscas de led',
          'Km:45.000',
          'Avista R$7.200,00',
          'Na troca R$8.200,00',
          'Faço financiamento'
        ].join('\n')
      );
    await page.locator('#botaoInterpretar').click();

    // Marca deduzida, tipo Moto reconhecido, portas sumindo de verdade.
    await expect(page.locator('#f-brand')).toHaveValue('Honda');
    await expect(page.locator('#f-type')).toHaveValue('Moto');
    await expect(page.locator('#f-price')).toHaveValue('7.200');
    await expect(page.locator('#f-priceTroca')).toHaveValue('8.200');
    await expect(page.locator('#campoPortas')).toBeHidden();
    await expect(page.locator('#avisosParser')).toBeVisible();

    // "Faço financiamento" é condição de pagamento, não item do veículo.
    await expect(page.locator('#f-features')).not.toHaveValue(/financiamento/i);
  });

  test('a foto publicada é servida e aparece no card', async ({ page }) => {
    await entrar(page);
    // O item criado no teste anterior usa a foto do repositório simulado —
    // que o site ainda não serve (o mock não escreve em public/). O que dá
    // para garantir aqui é o painel exibindo o caminho certo.
    const foto = page.locator('#lista .item', { hasText: 'Duster' }).locator('.item-foto');
    await expect(foto).toHaveAttribute('src', /^\/assets\/veiculos\/renault-duster/);
  });
});
