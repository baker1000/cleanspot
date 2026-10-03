import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  const summary = violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}×)`);
  expect(summary).toEqual([]);
}

test('landing → app → profile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'CleanSpot' })).toBeVisible();
  await page.getByRole('link', { name: 'App öffnen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Karte' })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await nav.getByRole('link', { name: 'Profil' }).click();
  await expect(page).toHaveURL(/\/app\/profile$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible();
});

test('language switch to Arabic flips the layout and is remembered', async ({ page }) => {
  await page.goto('/app');
  await page.getByLabel('Sprache').selectOption('ar');
  await expect(page.getByRole('heading', { level: 1, name: 'الخريطة' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { level: 1, name: 'الخريطة' })).toBeVisible();
});

test.describe('browser language', () => {
  test.use({ locale: 'en-US' });
  test('an English browser gets the English UI', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: 'Map' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test('skip link is the first focusable element and moves focus to main', async ({ page }) => {
  await page.goto('/app');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Zum Inhalt springen' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

for (const lang of ['de', 'ar'] as const) {
  for (const path of ['/', '/app', '/app/profile']) {
    test(`no WCAG 2.1 AA violations: ${path} (${lang})`, async ({ page }) => {
      await page.addInitScript((l) => localStorage.setItem('cleanspot.lang', l), lang);
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expectNoA11yViolations(page);
    });
  }
}
