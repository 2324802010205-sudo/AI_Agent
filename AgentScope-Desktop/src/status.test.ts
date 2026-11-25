import { describe, expect, it } from 'vitest';
import { runtimeStatus } from './status';
import type { Settings } from './types';

const base: Settings = {
  provider: 'antigravity',
  model: 'gemini-3.8-flash-high',
  has_key: true,
  mode: 'real',
  workspace: 'w',
  network_approval: true,
  antigravity: { installed: true, ready: false, message: '' },
};

describe('runtimeStatus', () => {
  it('never reports a reachable backend alone as a working AI', () => {
    expect(runtimeStatus(true, false, 'real', base)).toEqual({
      label: 'AI chưa xác minh',
      verified: false,
    });
    const ready = { ...base, antigravity: { ...base.antigravity!, ready: true } };
    expect(runtimeStatus(true, false, 'real', ready).verified).toBe(false);
  });
  it('reports an observed model response and errors accurately', () => {
    const ok = { ...base, antigravity: { ...base.antigravity!, ready: true, authenticated: true } };
    expect(runtimeStatus(true, false, 'real', ok)).toEqual({
      label: 'AI đã phản hồi',
      verified: true,
    });
    const failed = { ...base, antigravity: { ...base.antigravity!, connection_status: 'error' } };
    expect(runtimeStatus(true, false, 'real', failed).label).toBe('AI lỗi kết nối');
    expect(runtimeStatus(false, false, 'real', ok).label).toBe('Backend chưa kết nối');
  });
  it('labels explicit Demo mode', () => {
    expect(runtimeStatus(true, false, 'demo', base).label).toBe('Demo · không gọi AI');
  });
});
