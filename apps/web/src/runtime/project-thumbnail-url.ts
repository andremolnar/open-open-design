/** Convert only known project-owned preview URLs. Never turn an arbitrary URL
 * into a background renderer request. Preserve workspace navigation authority. */
export function projectThumbnailUrl(source: string): string | null {
  if (!source.startsWith('/api/')) return null;
  const url = new URL(source, 'http://open-design.local');
  const file = url.pathname.match(/^\/api\/projects\/([^/]+)\/(?:raw|files)\/(.+)$/);
  const live = url.pathname.match(/^\/api\/live-artifacts\/([^/]+)\/preview$/);
  const params = new URLSearchParams();
  let projectId: string;
  if (file) {
    projectId = file[1]!;
    params.set('fileName', decodeURIComponent(file[2]!));
  } else if (live && url.searchParams.get('projectId')) {
    projectId = encodeURIComponent(url.searchParams.get('projectId')!);
    params.set('liveArtifactId', decodeURIComponent(live[1]!));
  } else return null;
  for (const key of ['workspaceId', 'workspaceMemberId', 'v']) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  return `/api/projects/${projectId}/thumbnail?${params}`;
}
