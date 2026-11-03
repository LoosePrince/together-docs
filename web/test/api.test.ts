import assert from 'node:assert/strict';
import test from 'node:test';

test('无请求体的请求不设置 JSON Content-Type', async () => {
  const originalFetch = globalThis.fetch;
  let captured: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init };
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { api, post } = await import('../src/api');
    await api('/test', { method: 'POST' });
    assert.equal(captured!.init?.headers.has('Content-Type'), false);
    await post('/test');
    assert.equal(captured!.init?.headers.has('Content-Type'), false);
    await post('/test', {});
    assert.equal(captured!.init?.headers.get('Content-Type'), 'application/json');
    await api('/upload', { method: 'POST', body: new FormData() });
    assert.equal(captured!.init?.headers.has('Content-Type'), false);
  } finally { globalThis.fetch = originalFetch; }
});
