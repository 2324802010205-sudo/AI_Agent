// Shared helpers for native WebView2 checks: isolated profile, loopback-only DevTools
// port, sidecar readiness, normal close and complete process-tree cleanup.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const terminal = ['completed', 'failed', 'blocked', 'cancelled'];

function allProcesses() {
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(output);
}
export function descendants(pid) {
  const all = allProcesses();
  const found = [];
  const queue = [pid];
  while (queue.length) {
    const parent = queue.shift();
    for (const p of all)
      if (p.ParentProcessId === parent && !found.some((f) => f.ProcessId === p.ProcessId)) {
        found.push(p);
        queue.push(p.ProcessId);
      }
  }
  return found;
}
const alive = (ids) =>
  allProcesses()
    .filter((p) => ids.includes(p.ProcessId))
    .map((p) => `${p.Name}:${p.ProcessId}`);

export async function launch({
  executable,
  dataDir,
  cdpPort,
  root,
  profileDir = path.join(dataDir, 'webview2'),
}) {
  const native = spawn(executable, [], {
    cwd: root,
    env: {
      ...process.env,
      AGENTSCOPE_DATA_DIR: dataDir,
      // Never share (or conflict with) the user's running WebView2 profile.
      WEBVIEW2_USER_DATA_FOLDER: profileDir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort} --remote-debugging-address=127.0.0.1`,
    },
    windowsHide: false,
    stdio: 'ignore',
  });
  let backend;
  for (let retry = 0; retry < 100 && !backend; retry++) {
    if (native.exitCode !== null) throw new Error(`Native app exited: ${native.exitCode}`);
    const launcher = descendants(native.pid).find((p) => /--port\s+\d+/.test(p.CommandLine || ''));
    const port = launcher && /--port\s+(\d+)/.exec(launcher.CommandLine)[1];
    if (port) {
      try {
        const token = (await readFile(path.join(dataDir, 'session-token'), 'utf8')).trim();
        const base = `http://127.0.0.1:${port}`;
        const ok = await fetch(`${base}/api/health`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(1000),
        });
        if (ok.ok)
          backend = { base, token, health: await ok.json(), executable: launcher.ExecutablePath };
      } catch {}
    }
    if (!backend) await pause(300);
  }
  assert(backend, 'Native sidecar did not become ready');
  let browser;
  for (let retry = 0; retry < 50 && !browser; retry++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    } catch {
      await pause(300);
    }
  }
  assert(browser, 'WebView2 DevTools endpoint not reachable');
  const page = browser.contexts()[0].pages()[0];
  await page.waitForLoadState('domcontentloaded');
  const api = async (route) => {
    const response = await fetch(`${backend.base}/api${route}`, {
      headers: { Authorization: `Bearer ${backend.token}` },
      signal: AbortSignal.timeout(10000),
    });
    assert(response.ok, `${route}: HTTP ${response.status}`);
    return response.json();
  };
  return { native, browser, page, api, backend };
}

export async function waitFor(check, timeout, label) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await pause(400);
  }
  throw new Error(`Timed out: ${label}`);
}

export async function closeNormally(app, report = {}) {
  const owned = descendants(app.native.pid).map((p) => p.ProcessId);
  report.ownedProcessesAtClose = owned.length;
  await app.page
    .getByRole('button', { name: 'Đóng ứng dụng' })
    .click({ noWaitAfter: true })
    .catch(() => {});
  await app.browser.close().catch(() => {});
  await waitFor(() => app.native.exitCode !== null, 20000, 'native exit');
  await waitFor(() => alive(owned).length === 0, 20000, `process cleanup ${alive(owned)}`);
}
