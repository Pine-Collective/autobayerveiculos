/**
 * Site público num navegador real: renderização, páginas individuais e deep links.
 *
 * O que o jsdom não vê e por isso vive aqui: quantos cards cabem lado a lado
 * no celular, se o painel de filtros recolhido some de verdade e se o botão
 * flutuante do WhatsApp fica visível sem cobrir o conteúdo.
 */
import { test, expect } from '@playwright/test';

const CELULAR = { width: 390, height: 844 };

test.describe('Home', () => {
  test('página carrega com CSS aplicado e vitrine de destaques visível', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(9, 10, 12)');
    await expect(page.locator('.vehicle-card')).toHaveCount(5);
    await expect(page.locator('.vehicle-card').first()).toBeVisible();
    await expect(page.locator('#emptyState')).toBeHidden();
  });

  test('home não tem a barra de filtros — ela mora na página de estoque', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#searchInput')).toHaveCount(0);
    await expect(page.locator('#categoryRow')).toHaveCount(0);
    await expect(page.locator('.showcase-cta .btn')).toBeVisible();
  });

  test('card da home leva para a ficha na página de estoque', async ({ page }) => {
    await page.goto('/');
    await page.locator('.vehicle-link').first().click();
    await expect(page).toHaveURL(/veiculos\.html\?veiculo=/);
    await expect(page.locator('#vehiclePage')).toBeVisible();
    await expect(page.locator('#vehiclePage h1')).toBeVisible();
  });
});

test.describe('Página de estoque', () => {
  test('lista o estoque inteiro com filtros visíveis no desktop', async ({ page }) => {
    await page.goto('/veiculos.html');
    await expect(page.locator('.vehicle-card')).toHaveCount(5);
    await expect(page.locator('#filters')).toBeVisible();
    await expect(page.locator('#filtersToggle')).toBeHidden();
  });

  test('card abre uma página individual sem recarregar', async ({ page }) => {
    await page.goto('/veiculos.html');
    await page.locator('.vehicle-link').first().click();
    await expect(page.locator('#vehiclePage')).toBeVisible();
    await expect(page.locator('#vehiclePage h1')).toBeVisible();
    await expect(page).toHaveURL(/\?veiculo=/);
  });

  test('deep link abre o veículo direto', async ({ page }) => {
    await page.goto('/veiculos.html?veiculo=chevrolet-corsa-classic-1-0-vhc-2003');
    await expect(page.locator('#vehiclePage')).toBeVisible();
    await expect(page.locator('#vehiclePage h1')).toContainText('Corsa Classic');
  });

  test('deep link de carro inexistente mostra o aviso, não silêncio', async ({ page }) => {
    await page.goto('/veiculos.html?veiculo=carro-que-ja-era');
    await expect(page.locator('#linkAviso')).toBeVisible();
    await expect(page.locator('#vehiclePage')).toBeHidden();
    await expect(page.locator('.vehicle-card').first()).toBeVisible();
  });

  test('página mostra itens do veículo e preço na troca', async ({ page }) => {
    await page.goto('/veiculos.html?veiculo=chevrolet-corsa-classic-1-0-vhc-2003');
    await expect(page.locator('#vehiclePage')).toBeVisible();
    await expect(page.locator('.vehicle-page-features li').first()).toBeVisible();
    await expect(page.locator('.vehicle-page-features')).toContainText('Desembaçador');
    await expect(page.locator('.vehicle-page-price small')).toBeVisible();
    await expect(page.locator('.vehicle-page-price small')).toContainText('Na troca');
  });

  test('filtro de preço e estado vazio', async ({ page }) => {
    await page.goto('/veiculos.html');
    await page.locator('#priceFilter').selectOption('8000');
    await expect(page.locator('.vehicle-card')).toHaveCount(0);
    await expect(page.locator('#emptyState')).toBeVisible();
  });
});

test.describe('Celular', () => {
  test.use({ viewport: CELULAR });

  test('cards ficam dois por linha, não um gigante por tela', async ({ page }) => {
    await page.goto('/veiculos.html');

    const caixas = await page.locator('.vehicle-card').evaluateAll((cards) =>
      cards.map((card) => {
        const { top, height, width } = card.getBoundingClientRect();
        return { top: Math.round(top), height, width };
      })
    );

    expect(caixas.length).toBe(5);

    // Dois por linha: os dois primeiros começam na mesma altura.
    expect(Math.abs(caixas[0].top - caixas[1].top)).toBeLessThan(2);
    // E cada um ocupa cerca de metade da largura útil.
    expect(caixas[0].width).toBeLessThan(CELULAR.width / 2);

    // O card inteiro tem que caber com folga na tela — era isto que estava
    // quebrado: com a foto em retrato, um card só passava da altura do visor.
    expect(caixas[0].height).toBeLessThan(CELULAR.height * 0.55);
  });

  test('filtros ficam recolhidos atrás do botão e abrem no clique', async ({ page }) => {
    await page.goto('/veiculos.html');
    await expect(page.locator('#filtersToggle')).toBeVisible();
    await expect(page.locator('#filters')).toBeHidden();

    await page.locator('#filtersToggle').click();
    await expect(page.locator('#filters')).toBeVisible();

    await page.locator('#filtersToggle').click();
    await expect(page.locator('#filters')).toBeHidden();
  });

  test('contador avisa que há filtro ativo com o painel fechado', async ({ page }) => {
    await page.goto('/veiculos.html');
    await expect(page.locator('#filtersCount')).toBeHidden();

    await page.locator('#filtersToggle').click();
    await page.locator('#priceFilter').selectOption('150000');
    await page.locator('#filtersToggle').click();

    await expect(page.locator('#filters')).toBeHidden();
    await expect(page.locator('#filtersCount')).toBeVisible();
    await expect(page.locator('#filtersCount')).toHaveText('1');
  });

  test('o primeiro card aparece sem precisar rolar muito', async ({ page }) => {
    await page.goto('/veiculos.html');
    const topo = await page
      .locator('.vehicle-card')
      .first()
      .evaluate((card) => card.getBoundingClientRect().top);
    // Antes a barra de filtros inteira vinha antes do primeiro carro.
    expect(topo).toBeLessThan(CELULAR.height);
  });
});

test.describe('Botão flutuante do WhatsApp', () => {
  for (const [nome, url] of [
    ['home', '/'],
    ['estoque', '/veiculos.html']
  ]) {
    test(`fica visível no desktop na ${nome}`, async ({ page }) => {
      await page.goto(url);
      const botao = page.locator('.whatsapp-float');
      await expect(botao).toBeVisible();
      await expect(botao).toHaveAttribute('href', /^https:\/\/wa\.me\/554699226135\?text=/);
    });

    test(`fica visível no celular na ${nome}`, async ({ page }) => {
      await page.setViewportSize(CELULAR);
      await page.goto(url);
      const botao = page.locator('.whatsapp-float');
      await expect(botao).toBeVisible();

      // Redondo e dentro da tela — sem rótulo, que cobriria o conteúdo.
      const caixa = await botao.boundingBox();
      expect(caixa.width).toBeLessThan(70);
      expect(caixa.x + caixa.width).toBeLessThanOrEqual(CELULAR.width);
      expect(caixa.y + caixa.height).toBeLessThanOrEqual(CELULAR.height);
      await expect(page.locator('.whatsapp-float-label')).toBeHidden();
    });
  }
});

test.describe('Rolagem ao trocar de tela', () => {
  // A ficha entra no lugar do catálogo sem recarregar a página, então a
  // rolagem não é trocada junto: quem clicava num card do fim da lista caía
  // no meio da ficha. O navegador faria isto sozinho numa navegação real.
  test('a ficha abre no topo, mesmo vindo do fim da lista', async ({ page }) => {
    await page.setViewportSize(CELULAR);
    await page.goto('/veiculos.html');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);

    await page.locator('.vehicle-card').last().locator('.vehicle-link').click();
    await expect(page.locator('#vehiclePage')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('voltar devolve a lista onde ela estava', async ({ page }) => {
    await page.setViewportSize(CELULAR);
    await page.goto('/veiculos.html');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const antes = await page.evaluate(() => window.scrollY);

    await page.locator('.vehicle-card').last().locator('.vehicle-link').click();
    await expect(page.locator('#vehiclePage')).toBeVisible();

    await page.goBack();
    await expect(page.locator('#catalogMain')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(antes);
  });

  test('deep link direto na ficha também começa no topo', async ({ page }) => {
    await page.setViewportSize(CELULAR);
    await page.goto('/veiculos.html?veiculo=honda-cg125-ks-2008');
    await expect(page.locator('#vehiclePage')).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test.describe('Links antigos já compartilhados', () => {
  // A ficha mudou de endereço (de /?veiculo= para /veiculos.html?veiculo=),
  // mas os links de antes já estão em conversas de WhatsApp. A home continua
  // abrindo a ficha, e a canonical aponta para o endereço novo.
  test('/?veiculo= ainda abre a ficha na home', async ({ page }) => {
    await page.goto('/?veiculo=honda-cg125-ks-2008');
    await expect(page.locator('#vehiclePage')).toBeVisible();
    await expect(page.locator('#vehiclePage h1')).toContainText('CG125');
    await expect(page.locator('#catalogMain')).toBeHidden();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/veiculos\.html\?veiculo=honda-cg125-ks-2008$/
    );
  });

  test('voltar da ficha leva para a página de estoque', async ({ page }) => {
    await page.goto('/?veiculo=honda-cg125-ks-2008');
    await page.locator('.vehicle-page-back').click();
    await expect(page).toHaveURL(/veiculos\.html$/);
    await expect(page.locator('#searchInput')).toBeVisible();
  });

  test('link antigo de carro fora do estoque avisa em vez de silenciar', async ({ page }) => {
    await page.goto('/?veiculo=carro-que-ja-era');
    await expect(page.locator('#linkAviso')).toBeVisible();
    await expect(page.locator('.vehicle-card').first()).toBeVisible();
  });
});
