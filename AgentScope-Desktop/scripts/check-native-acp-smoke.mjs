// Opt-in authenticated end-to-end ACP smoke test through the real native window (uses AI quota).
// Desktop UI -> sidecar Backend -> `agy acp` (installed Antigravity CLI) -> Gemini -> Backend -> UI.
// Isolated data profile and WebView2 folder; the user's running app and data are untouched.
// Evidence: UI-typed prompt, backend task/events, the live `agy.exe acp` process in the
// Desktop's own process tree, the ACP session id, and the reply rendered in the DOM.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { closeNormally, descendants, launch, terminal, waitFor } from './native-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable =
  process.env.AGENTSCOPE_NATIVE_EXE ||
  path.join(root, 'src-tauri/target/release/agentscope-desktop.exe');
const wantedModel = process.env.AGENTSCOPE_LIVE_MODEL || 'gemini-3.8-flash-high';
const dataDir = path.join(root, 'artifacts', `native-acp-smoke-${randomUUID()}`);
const cdpPort = Number(process.env.AGENTSCOPE_CDP_PORT || 9343);
const MESSAGE =
  'Hello from AgentScope Desktop. Please calculate 25 + 17 and reply with the result and the exact text ACP_CONNECTION_VERIFIED.';
const report = { executable, dataDir, model: wantedModel, message: MESSAGE };

let app;
try {
  await mkdir(dataDir, { recursive: true });
  app = await launch({ executable, dataDir, cdpPort, root });
  const { page, api, backend } = app;
  report.backend = { base: backend.base, version: backend.health.version };

  // 1. Configure through the UI exactly as a user would.
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).first().click();
  await page.getByLabel('Dịch vụ AI').selectOption('antigravity');
  await page.getByTitle('Khám phá lại models từ Antigravity ACP').click();
  const modelSelect = page.locator('label:has-text("Model ID") select');
  await waitFor(
    async () => (await modelSelect.locator(`option[value="${wantedModel}"]`).count()) > 0,
    120000,
    'model discovery over ACP',
  );
  report.discoveredModels = await modelSelect
    .locator('option')
    .evaluateAll((o) => o.map((x) => x.value).filter(Boolean));
  await modelSelect.selectOption(wantedModel);
  await page.getByRole('button', { name: /Real AI/ }).click();
  await page.getByRole('button', { name: /Lưu cấu hình/ }).click();
  await waitFor(
    async () => {
      const s = await api('/settings');
      return s.provider === 'antigravity' && s.model === wantedModel && s.mode === 'real';
    },
    10000,
    'settings saved',
  );
  await page.getByRole('button', { name: 'Kiểm tra Antigravity' }).click();
  const status = await waitFor(
    async () => {
      const s = (await api('/settings')).antigravity;
      return s.authenticated || s.connection_status === 'error' ? s : null;
    },
    180000,
    'connection test',
  );
  report.connectionTest = {
    authenticated: status.authenticated,
    connection_status: status.connection_status,
    cli_version: status.version,
    cli_path: status.path,
    message: status.message,
  };
  assert(status.authenticated, `Connection test failed: ${status.message}`);

  // 2. Send the smoke message from the chat box.
  await page.getByRole('button', { name: 'Chat', exact: true }).first().click();
  await page.locator('.new-chat').click();
  const before = new Set((await api('/tasks')).map((t) => t.id));
  await page.getByLabel('Tin nhắn cho AI Assistant').fill(MESSAGE);
  await page.getByRole('button', { name: 'Gửi tin nhắn' }).click();
  let acpProcesses = [];
  const task = await waitFor(
    async () => {
      // Sample the Desktop's own process tree while the turn is in flight.
      const live = descendants(app.native.pid).filter(
        (p) => /agy\.exe$/i.test(p.Name) && /\sacp(\s|$)/.test(p.CommandLine || ''),
      );
      if (live.length) acpProcesses = live;
      const t = (await api('/tasks')).find((r) => !before.has(r.id));
      return t && terminal.includes(t.status) ? t : null;
    },
    240000,
    'smoke reply',
  );
  const tree = descendants(app.native.pid);
  report.desktopProcessTree = tree.map((p) => ({
    pid: p.ProcessId,
    parent: p.ParentProcessId,
    name: p.Name,
    command: (p.CommandLine || '').replace(/--data-dir\s+\S+/, '--data-dir <isolated>'),
  }));
  const acpNow = tree.filter((p) => /agy\.exe$/i.test(p.Name));
  report.agyAcpProcess = (acpNow.length ? acpNow : acpProcesses).map((p) => ({
    pid: p.ProcessId,
    parent: p.ParentProcessId,
    command: p.CommandLine,
  }));
  const messages = await api(`/conversations/${task.conversation_id}/messages`);
  const reply = messages.filter((m) => m.role === 'assistant' && m.task_id === task.id).at(-1);
  const events = await api(`/tasks/${task.id}/events`);
  const pick = (type) => events.filter((e) => e.event_type === type);
  report.task = {
    id: task.id,
    status: task.status,
    mode: task.mode,
    provider: task.provider,
    model: task.model,
    acp_session_id: task.session_id,
    acp_execution_mode: task.acp_execution_mode,
    error: task.error || null,
  };
  report.reply = reply?.content ?? null;
  report.events = events.map((e) => ({
    type: e.event_type,
    status: e.status,
    source: e.source,
    title: e.title,
  }));
  report.acpEvidence = {
    agentInfo: pick('provider.connected')[0]?.result?.agent,
    sessionCreated: pick('session.created')[0]?.result?.session_id,
    sessionMode: pick('session.mode')[0]?.result,
    trustedWorkspaceWarning: pick('security.boundary')[0]?.result ?? null,
    promptComposed: pick('prompt.composed')[0]?.result ?? null,
    streamingSnapshots: pick('provider.response.streaming').length,
    permissionEvents: pick('permission.evaluated').length,
    unmediatedToolEvents: events.filter((e) => /unmediated|acp\.tool/.test(e.event_type)).length,
  };
  assert.equal(task.status, 'completed', JSON.stringify(report.task));
  assert.equal(task.provider, 'antigravity');
  assert.equal(task.mode, 'real');
  assert.equal(task.model, wantedModel);
  assert(task.session_id, 'No ACP session id on the task');
  assert.equal(report.acpEvidence.sessionCreated, task.session_id, 'Session id mismatch');
  assert(report.agyAcpProcess.length, 'No agy.exe acp process in the Desktop process tree');
  assert(/\b42\b/.test(report.reply || ''), 'Reply lacks 42');
  assert((report.reply || '').includes('ACP_CONNECTION_VERIFIED'), 'Reply lacks marker');
  for (const kind of [
    'provider.connected',
    'session.created',
    'prompt.started',
    'prompt.completed',
    'message.created',
  ])
    assert(
      events.some((e) => e.event_type === kind),
      `missing ${kind}`,
    );

  // 3. The reply must be rendered in the Desktop conversation, not just stored.
  await page
    .locator('.messages')
    .getByText('ACP_CONNECTION_VERIFIED', { exact: false })
    .last()
    .waitFor({ timeout: 15000 });
  report.renderedInDesktop = await page.locator('.messages').evaluate((el) => {
    const text = el.innerText;
    const at = text.lastIndexOf('ACP_CONNECTION_VERIFIED');
    return text.slice(Math.max(0, at - 200), at + 60);
  });
  report.executionCenter = await page
    .locator('.timeline')
    .innerText()
    .then((t) => t.slice(0, 1500))
    .catch(() => null);
  await page.screenshot({ path: path.join(dataDir, 'acp-smoke.png') });
  await closeNormally(app, report);
  report.cleanup = 'all Desktop-owned processes exited';
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  if (app?.native.exitCode === null) app.native.kill();
  await writeFile(path.join(dataDir, 'acp-smoke-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
