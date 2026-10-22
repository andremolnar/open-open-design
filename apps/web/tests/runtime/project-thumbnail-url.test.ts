import { describe, expect, it } from 'vitest';
import { projectThumbnailUrl } from '../../src/runtime/project-thumbnail-url';

describe('project thumbnail source URLs', () => {
  it('preserves file identity and workspace navigation authority', () => {
    expect(projectThumbnailUrl('/api/projects/project/raw/nested/my%20page.html?workspaceId=ws&workspaceMemberId=member&v=10&odMotionPreview=1'))
      .toBe('/api/projects/project/thumbnail?fileName=nested%2Fmy+page.html&workspaceId=ws&workspaceMemberId=member&v=10');
  });
  it('uses the live-artifact source rather than inventing a file', () => {
    expect(projectThumbnailUrl('/api/live-artifacts/artifact/preview?projectId=project&workspaceId=ws&workspaceMemberId=member'))
      .toBe('/api/projects/project/thumbnail?liveArtifactId=artifact&workspaceId=ws&workspaceMemberId=member');
  });
  it('never asks the renderer to navigate to an arbitrary URL', () => {
    for (const url of ['https://example.test/api/projects/p/raw/index.html', '//evil.test/api/projects/p/raw/index.html', '/other.html', 'data:text/html,private']) {
      expect(projectThumbnailUrl(url)).toBeNull();
    }
  });
});
