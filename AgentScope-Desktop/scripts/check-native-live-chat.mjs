// Opt-in authenticated end-to-end check of the real native window (uses AI quota).
// Drives the WebView2 UI over a loopback-only DevTools port with an isolated profile:
// Settings -> Antigravity + model -> Real -> save -> test, then chat "chào" and a
// context follow-up, verifies the observed trace, restart persistence and cleanup.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { closeNormally as close, launch as start, terminal, waitFor } from './native-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable =
  process.env.AGENTSCOPE_NATIVE_EXE ||
  path.join(root, 'src-tauri/target/release/agentscope-desktop.exe');
const wantedModel = process.env.AGENTSCOPE_LIVE_MODEL || 'gemini-3.8-flash-high';
const dataDir =
  process.env.AGENTSCOPE_NATIVE_DATA_DIR ||
  path.join(root, 'artifacts', `native-live-chat-${randomUUID()}`);
const cdpPort = Number(process.env.AGENTSCOPE_CDP_PORT || 9339);
const report = { executable, dataDir, model: wantedModel, turns: [] };
const launch = () => start({ executable, dataDir, cdpPort, root });
const closeNormally = (app) => close(app, report);


async function chat(app, text) {
  const before = new Set((await app.api('/tasks')).map((t) => t.id));
  const box = app.page.getByLabel('Tin nhắn cho AI Assistant');
  await box.fill(text);
  await app.page.getByRole('button', { name: 'Gửi tin nhắn' }).click();
  const task = await waitFor(
    async () => {
      const t = (await app.api('/tasks')).find((r) => !before.has(r.id));
      return t && terminal.includes(t.status) ? t : null;
    },
    180000,
    `reply to ${text}`,
  );
  const messages = await app.api(`/conversations/${task.conversation_id}/messages`);
  const reply = messages.filter((m) => m.role === 'assistant' && m.task_id === task.id).at(-1);
  const events = await app.api(`/tasks/${task.id}/events`);
  const visible = (reply?.content || '')
    .replace(/[*_`#>]/g, '')
    .split('\n')[0]
    .slice(0, 24);
  if (visible.trim())
    await app.page
      .locator('.messages')
      .getByText(visible.trim(), { exact: false })
      .first()
      .waitFor({ timeout: 15000 });
  const turn = {
    prompt: text,
    status: task.status,
    mode: task.mode,
    provider: task.provider,
    model: task.model,
    session_id: task.session_id,
    error: task.error || null,
    reply: reply?.content || null,
    events: events.map((e) => e.event_type),
    stream_snapshots: events.filter((e) => e.event_type === 'provider.response.streaming').length,
  };
  report.turns.push(turn);
  assert.equal(task.status, 'completed', JSON.stringify(turn));
  assert.equal(task.mode, 'real');
  assert.equal(task.provider, 'antigravity');
  assert.equal(task.model, wantedModel);
  assert(reply?.content && !reply.content.includes('DEMO'), 'No genuine reply');
  assert(events.every((e) => e.mode === 'real'));
  for (const kind of ['prompt.started', 'prompt.completed', 'message.created'])
    assert(turn.events.includes(kind), `missing ${kind}`);
  assert(!turn.events.some((k) => /^(tool|report|skill)\./.test(k)), 'Unexpected tool events');
  return { task, reply };
}


let app;
try {
  await mkdir(dataDir, { recursive: true });
  app = await launch();
  report.backendVersion = app.backend.health.version;
  const { page } = app;
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).first().click();
  await page.getByLabel('Dịch vụ AI').selectOption('antigravity');
  await page.getByTitle('Khám phá lại models từ Antigravity ACP').click();
  const modelSelect = page.locator('label:has-text("Model ID") select');
  await waitFor(
    async () => (await modelSelect.locator(`option[value="${wantedModel}"]`).count()) > 0,
    120000,
    'model discovery',
  );
  report.discoveredModels = await modelSelect
    .locator('option')
    .evaluateAll((o) => o.map((x) => x.value).filter(Boolean));
  await modelSelect.selectOption(wantedModel);
  await page.getByRole('button', { name: /Real AI/ }).click();
  await page.getByRole('button', { name: /Lưu cấu hình/ }).click();
  await waitFor(
    async () => {
      const s = await app.api('/settings');
      return s.provider === 'antigravity' && s.model === wantedModel && s.mode === 'real';
    },
    10000,
    'settings saved',
  );
  await page.getByRole('button', { name: 'Kiểm tra Antigravity' }).click();
  const status = await waitFor(
    async () => {
      const s = (await app.api('/settings')).antigravity;
      return s.authenticated || s.connection_status === 'error' ? s : null;
    },
    180000,
    'connection test',
  );
  report.connectionTest = { authenticated: status.authenticated, message: status.message };
  assert(status.authenticated, `Connection test failed: ${status.message}`);
  report.settingsStatus = await page.locator('.antigravity-info-box').innerText();
  await page.getByRole('button', { name: 'Chat', exact: true }).first().click();
  await page.locator('.new-chat').click();
  const first = await chat(app, 'chào');
  const second = await chat(
    app,
    'Tin nhắn đầu tiên tôi gửi cho bạn trong cuộc trò chuyện này là gì? Trích nguyên văn.',
  );
  assert.equal(first.task.conversation_id, second.task.conversation_id);
  assert.equal(first.task.session_id, second.task.session_id, 'ACP session not reused');
  assert(/chào/i.test(second.reply.content), 'Follow-up did not preserve context');
  report.titleStatus = await page.locator('.title-status').innerText();
  assert(!/Demo/i.test(report.titleStatus));
  report.pageHasDemoPlan = (await page.locator('body').innerText()).includes(
    'Dữ liệu sự kiện tổng hợp',
  );
  assert(!report.pageHasDemoPlan);
  await page.screenshot({ path: path.join(dataDir, 'live-chat.png') });
  await closeNormally(app);
  report.firstCloseCleanup = true;

  // Restart with the same profile: saved routing persists and context survives.
  app = await launch();
  const saved = await app.api('/settings');
  report.persistedAfterRestart = { provider: saved.provider, model: saved.model, mode: saved.mode };
  assert.deepEqual(report.persistedAfterRestart, {
    provider: 'antigravity',
    model: wantedModel,
    mode: 'real',
  });
  await app.page.locator('.recent-chats button', { hasText: 'chào' }).first().click();
  await app.page
    .locator('.messages')
    .getByText(
      first.reply.content
        .replace(/[*_`#>]/g, '')
        .split('\n')[0]
        .slice(0, 20)
        .trim(),
    )
    .first()
    .waitFor({ timeout: 15000 });
  const third = await chat(app, 'Nhắc lại ngắn gọn: lúc đầu tôi đã chào bạn bằng từ nào?');
  assert.equal(third.task.conversation_id, first.task.conversation_id);
  assert(/chào/i.test(third.reply.content), 'Context lost after restart');
  report.restartEvents = report.turns.at(-1).events.filter((e) => e.startsWith('session.'));
  await closeNormally(app);
  report.secondCloseCleanup = true;
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  if (app?.native.exitCode === null) app.native.kill();
  await writeFile(path.join(dataDir, 'live-chat-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
