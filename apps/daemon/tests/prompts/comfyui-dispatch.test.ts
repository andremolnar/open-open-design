import { describe, expect, it } from 'vitest';
import { composeSystemPrompt } from '../../src/prompts/system.js';
import { MEDIA_USER_REPLY_CONTRACT } from '../../src/prompts/media-contract.js';

describe('ComfyUI host dispatch constraints', () => {
  for (const promptCoreVariant of ['classic', 'slim'] as const) {
    for (const kind of ['image', 'prototype'] as const) {
      it(`carries workflow-owned dimensions through ${promptCoreVariant} ${kind} runs`, () => {
        const prompt = composeSystemPrompt({ agentId: 'opencode', promptCoreVariant,
          metadata: { kind }, byokMediaDefaults: { imageModel: 'comfyui/workflow@1' }, mediaHintSignal: true });
        expect(prompt).toContain('## ComfyUI workflow dispatch');
        expect(prompt).toContain('Do not pass `--aspect`, `--quality`, `--resolution`, `--image`, or `--output`');
        expect(prompt).toContain('--workflow-inputs-file');
        expect(prompt).toContain('media comfyui discover --json');
        expect(prompt).toContain('--comfy-server <discovered-server-id>');
        expect(prompt).toContain('No automatic cross-server retry');
        expect(prompt).not.toContain('--aspect 16:9)');
      });
    }
  }
  it('does not enable generation in chat-only or media-disabled sessions', () => {
    for (const context of [{ sessionMode: 'chat' as const }, { mediaExecution: { mode: 'disabled' as const } }]) {
      expect(composeSystemPrompt({ agentId: 'opencode', metadata: { kind: 'image' }, ...context }))
        .not.toContain('## ComfyUI workflow dispatch');
    }
  });
  it('does not teach that every settings error means a missing API key', () => {
    expect(MEDIA_USER_REPLY_CONTRACT).not.toContain('The image model still needs its API key.');
    expect(MEDIA_USER_REPLY_CONTRACT).toContain('`revise-options`');
    expect(MEDIA_USER_REPLY_CONTRACT).toContain('before any provider submission');
  });
});
