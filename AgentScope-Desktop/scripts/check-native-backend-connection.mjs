// Regression check for managed sidecar health, recovery and data persistence.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { closeNormally, descendants, launch, waitFor } from './native-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable =
  process.env.AGENTSCOPE_NATIVE_EXE ||
  path.join(root, 'src-tauri/target/release/agentscope-desktop.exe');
const dataDir =
  process.env.AGENTSCOPE_NATIVE_DATA_DIR ||
  path.join(root, 'artifacts', `backend-reconnect-${randomUUID()}`);
const app = await launch({ root, executable, dataDir, cdpPort: 9365 });

const launcher = () =>
  descendants(app.native.pid).find(
    (process) =>
      path.basename(process.ExecutablePath || '').toLowerCase() === 'agentscope-backend.exe' &&
      process.ParentProcessId === app.native.pid,
  );
const post = (connection, route, body) =>
  fetch(`${connection.base}/api${route}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });

try {
  const { page, backend } = app;
  const protectedMode = page.getByRole('radio', { name: /^Protected Test/ });
  await protectedMode.click();
  await expect(protectedMode).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
  const service = page.locator('.settings-card').filter({
    has: page.getByRole('heading', { name: 'Dịch vụ cục bộ' }),
  });
  await expect(service.getByText('Đã kết nối', { exact: true })).toBeVisible();
  await expect(service.getByLabel('Mã phiên phát triển')).toHaveCount(0);
  const previous = launcher();
  assert(previous, 'Desktop-owned sidecar launcher not found');
  await service.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
  await expect(service.getByText('Đã kết nối', { exact: true })).toBeVisible();
  assert.equal(launcher().ProcessId, previous.ProcessId, 'Health check replaced a running sidecar');

  assert((await post(backend, '/settings', { provider: 'openai', model: '' })).ok);
  const created = await post(backend, '/conversations', {});
  assert(created.ok);
  const { id } = await created.json();
  assert((await post(backend, '/shutdown', {})).ok);
  await waitFor(() => !launcher(), 20000, 'managed sidecar shutdown');

  await service.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
  await expect(service.getByText('Đã kết nối', { exact: true })).toBeVisible({ timeout: 30000 });
  const restarted = launcher();
  assert(restarted && restarted.ProcessId !== previous.ProcessId, 'No new sidecar was started');
  const port = /--port\s+(\d+)/.exec(restarted.CommandLine)?.[1];
  assert(port, 'Restarted sidecar did not advertise a loopback port');
  const token = (await readFile(path.join(dataDir, 'session-token'), 'utf8')).trim();
  assert(token && token !== backend.token, 'Restart did not create a fresh session');
  const response = await fetch(`http://127.0.0.1:${port}/api/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  assert(response.ok && (await response.json()).some((item) => item.id === id));
  await page.screenshot({
    path: path.join(dataDir, 'backend-reconnected.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Về Chat thường' }).click();
  await expect(page.getByRole('radio', { name: 'Chat thường' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  console.log(
    'PASS: managed port, in-place health check, sidecar restart, restored conversation, and return to normal chat',
  );
} finally {
  await closeNormally(app);
}
