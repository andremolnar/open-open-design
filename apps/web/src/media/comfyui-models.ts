import { useEffect, useState } from 'react';
import { parseComfyWorkflowModelId } from '@open-design/contracts';
import type { MediaModel } from './models';

/** Saved workflow choices for image pickers; never probe the user's GPU servers. */
export function useComfyImageModels(enabled = true): MediaModel[] {
  const [models, setModels] = useState<MediaModel[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch('/api/media/models', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const catalog = await response.json() as { image?: MediaModel[] };
      if (!controller.signal.aborted && Array.isArray(catalog.image)) {
        setModels(catalog.image.filter((model) => model.provider === 'comfyui' && Boolean(parseComfyWorkflowModelId(model.id))));
      }
    }).catch(() => { /* Other provider pickers remain usable when the local daemon is unavailable. */ });
    return () => controller.abort();
  }, [enabled]);
  return models;
}
