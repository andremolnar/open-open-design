import { describe, expect, it } from 'vitest';
import { buildSrcdoc } from '../../src/runtime/srcdoc';

describe('live prototype preview history', () => {
  it('installs the back bridge before author scripts only for opted-in previews', () => {
    const source = '<!doctype html><html><head><script>history.pushState({}, "", "#next")</script></head><body></body></html>';
    const live = buildSrcdoc(source, { previewHistory: true });
    expect(live).toContain('data-od-preview-history');
    expect(live.indexOf('data-od-preview-history')).toBeLessThan(live.indexOf('history.pushState({},'));
    expect(buildSrcdoc(source)).not.toContain('data-od-preview-history');
  });
});
