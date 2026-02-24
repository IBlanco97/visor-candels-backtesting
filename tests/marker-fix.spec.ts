import { test, expect } from '@playwright/test';

test.describe('Candlestick Chart Marker Fix', () => {
  test('should not have setMarkers runtime error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    await page.waitForTimeout(5000);

    const setMarkersErrors = errors.filter(e => 
      e.includes('setMarkers') || 
      e.includes('is not a function') ||
      e.includes('Cannot read')
    );

    expect(setMarkersErrors.length).toBe(0);
  });

  test('chart should render without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.goto('/');

    await page.waitForSelector('[data-testid="chart-container"]', { state: 'attached' });

    await page.waitForTimeout(3000);

    const criticalErrors = errors.filter(e => 
      e.includes('setMarkers') || 
      e.includes('TypeError')
    );

    expect(criticalErrors.length).toBe(0);
  });
});
