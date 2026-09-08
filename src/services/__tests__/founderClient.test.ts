import { afterEach, expect, it, vi } from 'vitest';
import { fetchFounderSnapshot } from '../founderClient';

afterEach(() => vi.unstubAllGlobals());

it('retains same-origin deployment authentication without forwarding it to a remote backend', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(fetchFounderSnapshot(undefined, true)).rejects.toThrow('Founder readiness unavailable');
  expect(fetchMock).toHaveBeenLastCalledWith('/api/genesis/founder', expect.objectContaining({ credentials: 'same-origin' }));
  await expect(fetchFounderSnapshot()).rejects.toThrow('Founder readiness unavailable');
  expect(fetchMock).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ credentials: 'omit' }));
});
