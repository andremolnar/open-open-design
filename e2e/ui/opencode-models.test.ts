import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';
import {
  captureVisual,
  configureVisualPage,
  gotoVisualHome,
  gotoVisualWorkspace,
  prepareVisualSettingsDialog,
  waitForVisualFonts,
} from '@/playwright/visual';

test('[P2] shows provider-scoped OpenCode models with spaces in Settings', async ({ page }) => {
  test.setTimeout(T.xlong);
  const model = 'local/Example 35B Q8';
  await configureVisualPage(page, {
    agents: [{
      id: 'opencode', name: 'OpenCode', bin: 'opencode', available: true,
      version: '2.0.0-test', modelsSource: 'live',
      models: [
        { id: 'default', label: 'Default' },
        { id: model, label: model },
        { id: 'router/~vendor/example-latest', label: 'router/~vendor/example-latest' },
      ],
    }],
    config: { agentId: 'opencode', agentModels: { opencode: { model } } },
  });
  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await route.fulfill({ json: { config: route.request().postDataJSON() } });
  });
  await gotoVisualHome(page);
  await gotoVisualWorkspace(page);
  const settings = await prepareVisualSettingsDialog(page);
  await settings.getByRole('tab', { name: /Local CLI/i }).click();
  const card = settings.getByTestId('settings-agent-card-opencode');
  await expect(card).toHaveClass(/active/);
  const picker = card.getByRole('combobox', { name: 'Model', exact: true });
  await expect(picker).toContainText(model);
  await expect(settings.locator('.settings-autosave')).not.toHaveClass(/is-(saving|pending|error)/);
  await waitForVisualFonts(page);
  await captureVisual(page, 'opencode-models-entry');

  await picker.click();
  const popover = page.getByTestId('settings-agent-model-popover-opencode');
  await expect(popover.getByRole('option', { name: model, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(popover.getByRole('option', { name: 'router/~vendor/example-latest', exact: true }))
    .toContainText('router/~vendor/example-latest');
  await captureVisual(page, 'opencode-models-picker');
});
