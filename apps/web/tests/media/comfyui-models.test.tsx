// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComfyImageModels } from '../../src/media/comfyui-models';
import { findMediaModel } from '../../src/media/models';
import { isMediaModelPickerReady } from '../../src/media/provider-readiness';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ComfyUI image picker discovery', () => {
  it('does not read the catalog for non-image surfaces', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useComfyImageModels(false));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('exposes only versioned ComfyUI image choices from the local catalog', async () => {
    const model = { id: 'comfyui/workflow@1', label: 'Krea fixture · v1', provider: 'comfyui', hint: 'Saved workflow', caps: ['t2i'] };
    const fetchMock = vi.fn(async () => Response.json({ image: [model,
      { ...model, id: 'comfyui' }, { ...model, provider: 'openai', id: 'other' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(useComfyImageModels);
    await waitFor(() => expect(result.current).toEqual([model]));
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(findMediaModel(model.id)?.provider).toBe('comfyui');
    expect(isMediaModelPickerReady(model.id, {})).toBe(true);
  });

  it('keeps an unavailable catalog empty without guessing a workflow or a server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 503 })));
    const { result } = renderHook(useComfyImageModels);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
