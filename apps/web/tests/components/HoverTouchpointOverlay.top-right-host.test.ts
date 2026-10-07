import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const entryShellSource = readFileSync(
  resolve(process.cwd(), 'src/components/EntryShell.tsx'),
  'utf8',
);
const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const overlayStyles = readFileSync(
  resolve(process.cwd(), 'src/components/HoverTouchpointOverlay.module.css'),
  'utf8',
);

describe('detached production touchpoint host', () => {
  it('does not mount the hover or badge production offer in either shell', () => {
    const topRightSlot = entryShellSource.indexOf('topRightSlot=');
    expect(topRightSlot).toBeGreaterThanOrEqual(0);
    expect(entryShellSource).not.toContain('<ProductionCampaignHover');
    expect(entryShellSource).not.toContain('<ProductionCampaignBadge');
    expect(appSource).not.toContain('<ProductionCampaignHover');
    expect(appSource).not.toContain('<ProductionCampaignModal');
  });

  it('keeps the dormant hover control scoped rather than floating over the app', () => {
    const entryRuleStart = overlayStyles.indexOf('.entry {');
    const entryRuleEnd = overlayStyles.indexOf('}', entryRuleStart);
    const entryRule = overlayStyles.slice(entryRuleStart, entryRuleEnd);
    expect(entryRule).toContain('position: relative');
    expect(entryRule).not.toContain('bottom:');
    expect(entryRule).not.toContain('right:');
    expect(entryRule).not.toContain('position: fixed');
  });
});
