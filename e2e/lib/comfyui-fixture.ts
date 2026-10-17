import { createServer } from 'node:http';

/** Protocol fixture, not a real ComfyUI graph or proof of GPU generation. */
export const comfyGraph = {
  '1': { class_type: 'FixtureImage', inputs: { prompt: 'original' } },
  '9': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'opendesign-test' } },
};
export const comfyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export async function startComfyFixture(options: { holdHistory?: boolean } = {}) {
  const submissions: unknown[] = [];
  let historyReady = !options.holdHistory;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.test');
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/object_info') {
      response.end(JSON.stringify({
        FixtureImage: { input: { required: { prompt: ['STRING', {}] } }, output: ['IMAGE'] },
        SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING', {}] } }, output: [], output_node: true },
      }));
    } else if (url.pathname === '/prompt' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      submissions.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.end(JSON.stringify({ prompt_id: 'fixture-owned-prompt', node_errors: {} }));
    } else if (url.pathname === '/history/fixture-owned-prompt') {
      if (!historyReady) { response.end('{}'); return; }
      response.end(JSON.stringify({ 'fixture-owned-prompt': {
        status: { completed: true, status_str: 'success' },
        outputs: { '9': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } },
      } }));
    } else if (url.pathname === '/view' && url.searchParams.get('filename') === 'result.png') {
      response.setHeader('Content-Type', 'image/png'); response.end(comfyPng);
    } else { response.statusCode = 404; response.end('{}'); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
  return {
    url: `http://127.0.0.1:${address.port}`, submissions,
    releaseHistory: () => { historyReady = true; },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
