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

  it('keeps the Back bridge when a motion preview also installs its playback lifecycle', () => {
    const source = '<!doctype html><html><head><meta name="od-motion-output" content="video"><script>history.pushState({}, "", "#next")</script></head><body><main data-composition-id="main" data-duration="15"></main></body></html>';
    const live = buildSrcdoc(source, { previewHistory: true, motionPreview: true });
    expect(live).toContain('data-od-preview-history');
    expect(live.indexOf('data-od-preview-history')).toBeLessThan(live.indexOf('history.pushState({},'));
    expect(live).toContain('window.__odMotionPreview=true');
    expect(live).toContain('data-od-motion-source-player');
  });
});
