import { test, expect } from '@playwright/test';

test.describe('Candlestick Chart Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="chart-container"]', { state: 'attached', timeout: 30000 });
    
    const loadingLocator = page.locator('text=Cargando datos...');
    try {
      await loadingLocator.waitFor({ state: 'hidden', timeout: 30000 });
    } catch (e) {
    }
    
    await page.waitForTimeout(1000);
  });

  test('should load chart without runtime errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.waitForTimeout(2000);
    
    expect(errors.filter(e => e.includes('setMarkers')).length).toBe(0);
  });

  test('should display current BTC price', async ({ page }) => {
    const priceLocator = page.locator('text=BTC Price:');
    await expect(priceLocator).toBeVisible();
  });

  test('should place trade entry marker on chart click', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    const chartContainer = page.locator('[data-testid="chart-container"]');
    await expect(chartContainer).toBeVisible();
    
    const boundingBox = await chartContainer.boundingBox();
    if (!boundingBox) throw new Error('Chart container not found');

    await chartContainer.click({
      position: { x: boundingBox.width / 2, y: boundingBox.height / 2 }
    });

    await page.waitForTimeout(1500);

    const entryStatus = page.locator('text=Entrada colocada');
    await expect(entryStatus).toBeVisible();

    expect(errors.filter(e => e.includes('setMarkers')).length).toBe(0);
  });

  test('should place trade exit marker after entry', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    const chartContainer = page.locator('[data-testid="chart-container"]');
    await expect(chartContainer).toBeVisible();
    
    const boundingBox = await chartContainer.boundingBox();
    if (!boundingBox) throw new Error('Chart container not found');

    await chartContainer.click({
      position: { x: boundingBox.width / 3, y: boundingBox.height / 2 }
    });

    await page.waitForTimeout(1000);

    await chartContainer.click({
      position: { x: (boundingBox.width / 3) * 2, y: boundingBox.height / 2 }
    });

    await page.waitForTimeout(1500);

    const exitStatus = page.locator('text=Trade cerrado');
    await expect(exitStatus).toBeVisible();

    expect(errors.filter(e => e.includes('setMarkers')).length).toBe(0);
  });

  test('should display P&L percentage after entry', async ({ page }) => {
    const chartContainer = page.locator('[data-testid="chart-container"]');
    await expect(chartContainer).toBeVisible();
    
    const boundingBox = await chartContainer.boundingBox();
    if (!boundingBox) throw new Error('Chart container not found');

    await chartContainer.click({
      position: { x: boundingBox.width / 2, y: boundingBox.height / 2 }
    });

    const pnlElement = page.locator('text=P&L (%)');
    await expect(pnlElement).toBeVisible({ timeout: 5000 });
  });

  test('should show entry price after placing entry', async ({ page }) => {
    const chartContainer = page.locator('[data-testid="chart-container"]');
    await expect(chartContainer).toBeVisible();
    
    const boundingBox = await chartContainer.boundingBox();
    if (!boundingBox) throw new Error('Chart container not found');

    await chartContainer.click({
      position: { x: boundingBox.width / 2, y: boundingBox.height / 2 }
    });

    const entryPriceElement = page.locator('text=Precio de Entrada');
    await expect(entryPriceElement).toBeVisible({ timeout: 5000 });
  });

  test('should show exit price after placing exit', async ({ page }) => {
    const chartContainer = page.locator('[data-testid="chart-container"]');
    await expect(chartContainer).toBeVisible();
    
    const boundingBox = await chartContainer.boundingBox();
    if (!boundingBox) throw new Error('Chart container not found');

    await chartContainer.click({
      position: { x: boundingBox.width / 3, y: boundingBox.height / 2 }
    });

    await page.waitForTimeout(1000);

    await chartContainer.click({
      position: { x: (boundingBox.width / 3) * 2, y: boundingBox.height / 2 }
    });

    const exitPriceElement = page.locator('text=Precio de Salida');
    await expect(exitPriceElement).toBeVisible({ timeout: 5000 });
  });

  test('should reset trade and clear markers', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    const chartContainer = page.locator('[data-testid="chart-container"]');
    await expect(chartContainer).toBeVisible();
    
    const boundingBox = await chartContainer.boundingBox();
    if (!boundingBox) throw new Error('Chart container not found');

    await chartContainer.click({
      position: { x: boundingBox.width / 2, y: boundingBox.height / 2 }
    });

    await page.waitForTimeout(1000);

    await chartContainer.click({
      position: { x: (boundingBox.width / 2) + 50, y: boundingBox.height / 2 }
    });

    await page.waitForTimeout(1000);

    const resetButton = page.locator('text=Resetear Trade');
    await resetButton.click();

    await page.waitForTimeout(1000);

    const idleStatus = page.locator('text=Esperando entrada...');
    await expect(idleStatus).toBeVisible();

    expect(errors.filter(e => e.includes('setMarkers')).length).toBe(0);
  });

  test('should handle multiple entry/exit cycles', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    const chartContainer = page.locator('[data-testid="chart-container"]');
    const boundingBox = await chartContainer.boundingBox();
    if (!boundingBox) throw new Error('Chart container not found');

    for (let i = 0; i < 3; i++) {
      await chartContainer.click({
        position: { x: boundingBox.width / 3, y: boundingBox.height / 2 }
      });

      await page.waitForTimeout(1000);

      await chartContainer.click({
        position: { x: (boundingBox.width / 3) * 2, y: boundingBox.height / 2 }
      });

      await page.waitForTimeout(1000);

      const resetButton = page.locator('text=Resetear Trade');
      await resetButton.click();

      await page.waitForTimeout(1000);
    }

    const idleStatus = page.locator('text=Esperando entrada...');
    await expect(idleStatus).toBeVisible();

    expect(errors.filter(e => e.includes('setMarkers')).length).toBe(0);
  });

  test('should track P&L on crosshair move', async ({ page }) => {
    const chartContainer = page.locator('[data-testid="chart-container"]');
    await expect(chartContainer).toBeVisible();
    
    const boundingBox = await chartContainer.boundingBox();
    if (!boundingBox) throw new Error('Chart container not found');

    await chartContainer.click({
      position: { x: boundingBox.width / 3, y: boundingBox.height / 2 }
    });

    await page.waitForTimeout(1000);

    await chartContainer.hover({
      position: { x: (boundingBox.width / 3) + 100, y: boundingBox.height / 2 }
    });

    await page.waitForTimeout(1000);

    const pnlElement = page.locator('text=Porcentaje Puntero');
    await expect(pnlElement).toBeVisible({ timeout: 5000 });
  });

  test('should maintain marker state during chart resize', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    const chartContainer = page.locator('[data-testid="chart-container"]');
    await expect(chartContainer).toBeVisible();
    
    const boundingBox = await chartContainer.boundingBox();
    if (!boundingBox) throw new Error('Chart container not found');

    await chartContainer.click({
      position: { x: boundingBox.width / 2, y: boundingBox.height / 2 }
    });

    await page.waitForTimeout(1000);

    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(1000);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(1000);

    const entryStatus = page.locator('text=Entrada colocada');
    await expect(entryStatus).toBeVisible();

    expect(errors.filter(e => e.includes('setMarkers')).length).toBe(0);
  });

  test('should not crash when clicking outside chart', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    const sidebar = page.locator('text=Instrucciones');
    await expect(sidebar).toBeVisible();
    
    await sidebar.click();

    await page.waitForTimeout(1000);

    expect(errors.length).toBe(0);
  });

  test('should have no setMarkers runtime errors during full workflow', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    const chartContainer = page.locator('[data-testid="chart-container"]');
    const boundingBox = await chartContainer.boundingBox();
    if (!boundingBox) throw new Error('Chart container not found');

    await chartContainer.click({
      position: { x: boundingBox.width / 2, y: boundingBox.height / 2 }
    });

    await page.waitForTimeout(1000);

    await chartContainer.click({
      position: { x: (boundingBox.width / 2) + 100, y: boundingBox.height / 2 }
    });

    await page.waitForTimeout(1000);

    const resetButton = page.locator('text=Resetear Trade');
    await resetButton.click();

    await page.waitForTimeout(1000);

    const setMarkersErrors = errors.filter(e => e.includes('setMarkers') || e.includes('is not a function'));
    expect(setMarkersErrors.length).toBe(0);
  });
});
