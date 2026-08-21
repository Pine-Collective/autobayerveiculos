/**
 * Site público num navegador real: renderização, modal, deep links.
 * As asserções de CSS computado são o que o jsdom não consegue verificar.
 */
import { test, expect } from '@playwright/test';

test.describe('Site público', () => {
  test('página carrega com CSS aplicado e catálogo visível', async ({ page }) => {
    await page.goto('/');

    // Fundo escuro do tema = a folha de estilo realmente carregou.
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(9, 10, 12)');

    await expect(page.locator('.vehicle-card')).toHaveCount(6);
    await expect(page.locator('.vehicle-card').first()).toBeVisible();
    await expect(page.locator('#emptyState')).toBeHidden();
  });

  test('card abre o modal e Esc fecha', async ({ page }) => {
    await page.goto('/');

    await page.locator('.vehicle-link').first().click();
    await expect(page.locator('#vehicleModal')).toBeVisible();
    await expect(page.locator('#modalTitle')).toBeVisible();
    await expect(page).toHaveURL(/\?veiculo=/);

    await page.keyboard.press('Escape');
    await expect(page.locator('#vehicleModal')).toBeHidden();
  });

  test('deep link abre o veículo direto', async ({ page }) => {
    await page.goto('/?veiculo=toyota-corolla-xei-2021');
    await expect(page.locator('#vehicleModal')).toBeVisible();
    await expect(page.locator('#modalTitle')).toContainText('Corolla');
  });

  test('deep link de carro inexistente mostra o aviso, não silêncio', async ({ page }) => {
    await page.goto('/?veiculo=carro-que-ja-era');
    await expect(page.locator('#linkAviso')).toBeVisible();
    await expect(page.locator('#vehicleModal')).toBeHidden();
    await expect(page.locator('.vehicle-card').first()).toBeVisible();
  });

  test('modal mostra itens do veículo e preço na troca', async ({ page }) => {
    await page.goto('/?veiculo=toyota-corolla-xei-2021');
    await expect(page.locator('#vehicleModal')).toBeVisible();

    await expect(page.locator('.modal-features li').first()).toBeVisible();
    await expect(page.locator('.modal-features')).toContainText('Ar condicionado');
    await expect(page.locator('.modal-price .price-troca')).toBeVisible();
    await expect(page.locator('.modal-price .price-troca')).toContainText('Na troca');
  });

  test('filtro de preço e estado vazio', async ({ page }) => {
    await page.goto('/');
    await page.locator('#priceFilter').selectOption('80000');
    await expect(page.locator('.vehicle-card')).toHaveCount(0);
    await expect(page.locator('#emptyState')).toBeVisible();
  });
});
