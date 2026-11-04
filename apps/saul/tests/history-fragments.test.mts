import { expect, it } from 'vitest';
import { Fragments, packets } from '../native/fragments.mts';
import { encodeNative, nativeDecoder } from '../native/transport.mts';
it('preserves large Unicode requests and results through real native frame encoding', () => {
  const value = { id: 'history', event: { type: 'result', value: '你好😀'.repeat(400_000) } };
  const fragments = new Fragments();
  let result: unknown;
  const decode = nativeDecoder((packet) => {
    const completed = fragments.accept(packet);
    if (completed !== undefined) result = completed;
  });
  const frames = packets(value).map(encodeNative);
  expect(frames.length).toBeGreaterThan(1);
  for (const frame of frames) {
    expect(frame.length).toBeLessThan(1024 * 1024);
    decode(frame.subarray(0, 37));
    decode(frame.subarray(37));
  }
  expect(result).toEqual(value);
});
it('rejects malformed fragments instead of accepting a partial history reply', () => {
  const fragments = new Fragments();
  expect(fragments.accept({ fragment: '{"value":', last: false })).toBeUndefined();
  expect(() => fragments.accept({ fragment: 'invalid}', last: true })).toThrow();
  expect(() => new Fragments().accept({ fragment: 'x', last: 'yes' })).toThrow();
});
