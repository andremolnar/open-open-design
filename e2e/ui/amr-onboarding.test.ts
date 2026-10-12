import { expect, test } from '@/playwright/suite';
import { applyStandardMocks, routeSignedOutVelaStatus } from '@/playwright/mock-factory';
import { T } from '@/timeouts';

const STORAGE_KEY = 'open-design:config';

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
  await routeSignedOutVelaStatus(page);
  await page.addInitScript((key) => {
    const config = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    window.localStorage.setItem(key, JSON.stringify({ ...config, onboardingCompleted: false }));
  }, STORAGE_KEY);
  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: { config: { onboardingCompleted: false } } });
  });
});

test('[P0] @critical incomplete local setup and signed-out Cloud open Home without a welcome gate', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('home-hero-input')).toBeVisible({ timeout: T.long });
  await expect(page.locator('.entry-shell--onboarding, .entry-onboarding-modal')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Welcome to OpenDesign|欢迎使用 OpenDesign/i })).toHaveCount(0);
});

test('[P0] old onboarding bookmarks open Home rather than restoring the sign-in screen', async ({ page }) => {
  await page.goto('/onboarding', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('home-hero-input')).toBeVisible({ timeout: T.long });
  await expect(page.locator('.entry-shell--onboarding, .entry-onboarding-modal')).toHaveCount(0);
});
