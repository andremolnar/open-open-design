import { createServer } from 'node:http';

/** Protocol fixture, not a real ComfyUI graph or proof of GPU generation. */
export const comfyGraph = {
  '1': { class_type: 'FixtureImage', inputs: { prompt: 'original', width: ['20', 0], height: ['20', 1], seed: 123 } },
  '5': { class_type: 'PreviewImage', inputs: { images: ['1', 0] } },
  '9': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'opendesign-test' } },
  '20': { class_type: 'FixtureDimensions', inputs: { width: 512, height: 512, preset: 'standard' } },
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
        FixtureImage: { input: { required: { prompt: ['STRING', {}], width: ['INT'], height: ['INT'], seed: ['INT', { min: 0 }] } }, output: ['IMAGE'] },
        FixtureDimensions: { input: { required: { width: ['INT', { min: 1 }], height: ['INT', { min: 1 }], preset: [['standard', 'large']] } }, output: ['INT', 'INT'] },
        PreviewImage: { input: { required: { images: ['IMAGE'] } }, output: [], output_node: true },
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
        outputs: { '5': { images: [{ filename: 'result.png', subfolder: '', type: 'temp' }] },
          '9': { images: [{ filename: 'unselected.png', subfolder: '', type: 'output' }] } },
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
