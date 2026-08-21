/**
 * Site público num navegador real: renderização, páginas individuais e deep links.
 */
import { test, expect } from '@playwright/test';

test.describe('Site público', () => {
  test('página carrega com CSS aplicado e catálogo visível', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(9, 10, 12)');
    await expect(page.locator('.vehicle-card')).toHaveCount(5);
    await expect(page.locator('.vehicle-card').first()).toBeVisible();
    await expect(page.locator('#emptyState')).toBeHidden();
  });

  test('card abre uma página individual', async ({ page }) => {
    await page.goto('/');
    await page.locator('.vehicle-link').first().click();
    await expect(page.locator('#vehiclePage')).toBeVisible();
    await expect(page.locator('#vehiclePage h1')).toBeVisible();
    await expect(page).toHaveURL(/\?veiculo=/);
  });

  test('deep link abre o veículo direto', async ({ page }) => {
    await page.goto('/?veiculo=chevrolet-corsa-classic-1-0-vhc-2003');
    await expect(page.locator('#vehiclePage')).toBeVisible();
    await expect(page.locator('#vehiclePage h1')).toContainText('Corsa Classic');
  });

  test('deep link de carro inexistente mostra o aviso, não silêncio', async ({ page }) => {
    await page.goto('/?veiculo=carro-que-ja-era');
    await expect(page.locator('#linkAviso')).toBeVisible();
    await expect(page.locator('#vehiclePage')).toBeHidden();
    await expect(page.locator('.vehicle-card').first()).toBeVisible();
  });

  test('página mostra itens do veículo e preço na troca', async ({ page }) => {
    await page.goto('/?veiculo=chevrolet-corsa-classic-1-0-vhc-2003');
    await expect(page.locator('#vehiclePage')).toBeVisible();
    await expect(page.locator('.vehicle-page-features li').first()).toBeVisible();
    await expect(page.locator('.vehicle-page-features')).toContainText('Desembaçador');
    await expect(page.locator('.vehicle-page-price small')).toBeVisible();
    await expect(page.locator('.vehicle-page-price small')).toContainText('Na troca');
  });

  test('filtro de preço e estado vazio', async ({ page }) => {
    await page.goto('/');
    await page.locator('#priceFilter').selectOption('8000');
    await expect(page.locator('.vehicle-card')).toHaveCount(0);
    await expect(page.locator('#emptyState')).toBeVisible();
  });
});
