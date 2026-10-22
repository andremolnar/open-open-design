import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectPreviewHover, PREVIEW_HOVER_DELAY_MS, PREVIEW_LEAVE_GRACE_MS } from '../../src/runtime/project-preview-hover';

afterEach(() => vi.useRealTimers());

describe('project preview hover budget', () => {
  it('ignores a mouse swiping across 30 cards', () => {
    vi.useFakeTimers();
    const controller = createProjectPreviewHover();
    const activated = vi.fn();
    for (let i = 0; i < 30; i += 1) {
      const card = controller.register(activated);
      card.enter();
      vi.advanceTimersByTime(30);
      card.leave();
      card.dispose();
    }
    vi.runAllTimers();
    expect(activated).not.toHaveBeenCalled();
  });

  it('requires dwell, preserves a brief leave, then actually unloads', () => {
    vi.useFakeTimers();
    const controller = createProjectPreviewHover();
    const changed = vi.fn();
    const card = controller.register(changed);
    card.enter();
    vi.advanceTimersByTime(PREVIEW_HOVER_DELAY_MS - 1);
    expect(changed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(changed).toHaveBeenLastCalledWith(true);
    card.leave();
    vi.advanceTimersByTime(PREVIEW_LEAVE_GRACE_MS - 1);
    card.enter();
    vi.advanceTimersByTime(PREVIEW_LEAVE_GRACE_MS);
    expect(changed).toHaveBeenCalledTimes(1);
    card.leave();
    vi.advanceTimersByTime(PREVIEW_LEAVE_GRACE_MS);
    expect(changed).toHaveBeenLastCalledWith(false);
    card.dispose();
  });

  it('unloads the prior frame before activating a different card', () => {
    vi.useFakeTimers();
    const controller = createProjectPreviewHover();
    const events: string[] = [];
    const a = controller.register(active => events.push(`a:${active}`));
    const b = controller.register(active => events.push(`b:${active}`));
    a.enter();
    vi.advanceTimersByTime(PREVIEW_HOVER_DELAY_MS);
    a.leave();
    b.enter();
    vi.advanceTimersByTime(PREVIEW_HOVER_DELAY_MS);
    expect(events).toEqual(['a:true', 'a:false', 'b:true']);
    a.dispose(); b.dispose();
  });

  it('cancels pending callbacks and live frames on hide, navigation or disposal', () => {
    vi.useFakeTimers();
    const controller = createProjectPreviewHover();
    const changed = vi.fn();
    const card = controller.register(changed);
    card.enter();
    controller.suspend();
    vi.runAllTimers();
    expect(changed).not.toHaveBeenCalled();
    card.enter();
    vi.advanceTimersByTime(PREVIEW_HOVER_DELAY_MS);
    card.leave();
    card.dispose();
    vi.runAllTimers();
    expect(changed.mock.calls).toEqual([[true], [false]]);
  });
});
