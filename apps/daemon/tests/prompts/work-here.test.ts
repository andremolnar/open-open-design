import { describe, expect, it } from 'vitest';
import { composeWorkHereGuidance } from '../../src/prompts/work-here.js';
import { renderSlimCoreCharter } from '../../src/prompts/core-slim.js';

describe('work-here guidance boundary', () => {
  it('preserves canonical design expertise while making execution host-owned', () => {
    const result = composeWorkHereGuidance({ skillBody: 'Read reference.css before drawing.', skillName: 'Chosen skill',
      designSystemBody: 'Use original brand tokens.', designSystemTokensCss: ':root{--accent:#4f12ef}',
      craftBody: 'Canonical craft fixture', projectInstructions: 'Project-specific context' });
    expect(result.sections[0]).toMatchObject({ authority: 'host_contract' });
    expect(result.sections[0]!.content).toContain('repository rules take precedence');
    expect(result.sections[0]!.content).toContain('Do not call start_run');
    expect(result.sections.find((section) => section.id === 'design-charter')?.content).toBe(renderSlimCoreCharter('filesystem'));
    expect(result.sections.find((section) => section.id === 'skill')?.content).toBe('Read reference.css before drawing.');
    expect(result.sections.find((section) => section.id === 'design-system-tokens')?.content).toBe(':root{--accent:#4f12ef}');
    expect(result.sections.slice(1).every((section) => section.authority === 'design_reference')).toBe(true);
    expect(result.adaptations.map((adaptation) => adaptation.original).join('\n')).toContain('Standalone HTML');
    expect(result.adaptations.map((adaptation) => adaptation.host).join('\n')).toContain('repository native stack');
    expect(result.critique.join('\n')).toContain('not_run');
    expect(result.preflight.join('\n')).toContain('never claim pixel inspection that did not occur');
    expect(result.adaptations.map((entry) => entry.host).join('\n')).toContain('never claim generation that did not occur');
    expect(result.critique.join('\n')).toContain('label source-only assessment accurately');
    expect(result.critique.join('\n')).toContain('Keep operational diagnostics in tool output');
  });
});
