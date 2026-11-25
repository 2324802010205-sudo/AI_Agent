import type { Mode, Settings } from './types';

export interface RuntimeStatus {
  label: string;
  verified: boolean;
}

// Reachability of the local FastAPI service is not AI connectivity. Only an observed
// model response (or an explicit Demo selection) is reported as a working runtime.
export function runtimeStatus(
  connected: boolean,
  connecting: boolean,
  mode: Mode,
  settings: Settings | undefined,
): RuntimeStatus {
  if (connecting) return { label: 'Đang kết nối…', verified: false };
  if (!connected) return { label: 'Backend chưa kết nối', verified: false };
  if (mode === 'demo') return { label: 'Demo · không gọi AI', verified: true };
  if (settings?.provider === 'antigravity') {
    const acp = settings.antigravity;
    if (!acp?.installed) return { label: 'Chưa cài Antigravity CLI', verified: false };
    if (acp.connection_status === 'error') return { label: 'AI lỗi kết nối', verified: false };
    if (acp.authenticated) return { label: 'AI đã phản hồi', verified: true };
    if (acp.ready) return { label: 'ACP sẵn sàng · chưa có phản hồi AI', verified: false };
    return { label: 'AI chưa xác minh', verified: false };
  }
  return settings?.has_key
    ? { label: 'Đã lưu API key · chưa xác minh', verified: false }
    : { label: 'Chưa cấu hình AI', verified: false };
}
