// Verify the packaged Desktop and sidecar with an isolated, restartable profile.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { closeNormally, launch, terminal, waitFor } from './native-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = process.env.AGENTSCOPE_BACKEND_DIR || path.join(root, '../AgentScope-Backend');
const executable =
  process.env.AGENTSCOPE_NATIVE_EXE ||
  path.join(root, 'src-tauri/target/release/agentscope-desktop.exe');
const output =
  process.env.AGENTSCOPE_NATIVE_OUTPUT || path.join(root, 'artifacts', `workspace-${randomUUID()}`);
const dataDir = path.join(output, 'profile');
const cdpPort = Number(process.env.AGENTSCOPE_CDP_PORT || 9351);
const title = 'So sánh doanh thu hai bảng tính';
const report = { executable, screenshots: [], checks: {} };
const pageErrors = [];

const files = [
  ['hanoi.xlsx', path.join(root, 'e2e/fixtures/research-sales.xlsx')],
  ['danang.xlsx', path.join(backendRoot, 'agentscope/lab/containment/synthetic_sales.xlsx')],
  ['SKILL.md', path.join(root, 'e2e/fixtures/spreadsheet-analysis/SKILL.md')],
  ['sales-report-helper.zip', path.join(backendRoot, 'samples/sales-report-helper.zip')],
];

async function dropFiles(page) {
  const sources = await Promise.all(
    files.map(async ([name, source]) => ({
      name,
      bytes: (await readFile(source)).toString('base64'),
    })),
  );
  const dataTransfer = await page.evaluateHandle((payload) => {
    const transfer = new DataTransfer();
    for (const { name, bytes } of payload) {
      const data = Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0));
      transfer.items.add(new File([data], name));
    }
    return transfer;
  }, sources);
  try {
    await page.locator('.composer').dispatchEvent('drop', { dataTransfer });
  } finally {
    await dataTransfer.dispose();
  }
}

async function capture(page, filename, width, height) {
  await page.setViewportSize({ width, height });
  await page.screenshot({ path: path.join(output, filename), animations: 'disabled' });
  report.screenshots.push({ filename, width, height });
}

async function send(app, content) {
  const before = new Set((await app.api('/tasks')).map((task) => task.id));
  await app.page.getByLabel('Tin nhắn cho AI Assistant').fill(content);
  await app.page.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
  const task = await waitFor(
    async () => {
      const started = (await app.api('/tasks')).find((item) => !before.has(item.id));
      return started && terminal.includes(started.status) ? started : null;
    },
    45000,
    'workbook task completion',
  );
  assert.equal(task.status, 'completed', JSON.stringify(task));
  assert.equal(task.execution_engine, 'local_deterministic');
  return task;
}

async function start() {
  const instance = await launch({ executable, dataDir, cdpPort, root });
  instance.page.on('pageerror', (error) => pageErrors.push(error.message));
  assert.equal(
    path.dirname(instance.backend.executable).toLowerCase(),
    path.dirname(executable).toLowerCase(),
  );
  report.backendVersion = instance.backend.health.version;
  report.backendExecutable = instance.backend.executable;
  return instance;
}

let app;
await mkdir(output, { recursive: true });
try {
  app = await start();
  const { page } = app;
  await page.getByRole('heading', { name: 'Hôm nay, mình có thể giúp gì?' }).waitFor();
  await expect(page.locator('.title-status')).not.toContainText('Đang kết nối');
  await capture(page, '01-chat-1480.png', 1480, 960);
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).first().click();
  await page.getByLabel('Dịch vụ AI').selectOption('openai');
  await page.getByRole('button', { name: /Lưu cấu hình/ }).click();
  await waitFor(
    async () => (await app.api('/settings')).provider === 'openai',
    8000,
    'local workflow settings',
  );
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await dropFiles(page);

  const composer = page.locator('.composer');
  await expect(composer.getByRole('button', { name: 'hanoi.xlsx', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(composer.getByRole('button', { name: 'danang.xlsx', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(composer.getByRole('button', { name: /spreadsheet-analysis/ })).toBeVisible();
  await expect(composer.getByRole('button', { name: /sales-report-helper/ })).toBeVisible();
  const installed = await app.api('/skills');
  const skill = installed.find((item) => item.name === 'spreadsheet-analysis');
  assert(skill, 'SKILL.md import missing');
  assert(
    installed.some((item) => item.name === 'sales-report-helper'),
    'ZIP import missing',
  );
  await composer.getByLabel('Skill cho tác vụ').selectOption(skill.id);
  report.checks.importedSkills = installed.map((item) => ({
    name: item.name,
    status: item.status,
    assessment: item.security.assessment,
  }));

  const run = await send(app, title);
  const base = `/conversations/${run.conversation_id}`;
  const selection = await app.api(`${base}/attachments`);
  assert.deepEqual(run.attachment_ids, selection.selected_ids);
  assert.deepEqual(
    run.reports.map((item) => item.source_name),
    ['hanoi.xlsx', 'danang.xlsx'],
  );
  const events = await app.api(`/tasks/${run.id}/events`);
  assert.equal(
    events.filter(
      (event) =>
        event.result.validation?.status === 'verified' && event.event_type === 'report.created',
    ).length,
    2,
  );
  const activity = page.locator('.run-activity').last();
  await expect(activity.locator('.result-card')).toHaveCount(2);
  const thread = activity.locator('.activity-thread');
  if ((await thread.getAttribute('open')) === null)
    await thread.locator(':scope > summary').click();
  const read = activity
    .locator('details.activity-step')
    .filter({ has: page.locator('summary').getByText('read_spreadsheet', { exact: true }) })
    .first();
  await read.locator('summary').click();
  await expect(read.getByText('Tham số').first()).toBeVisible();
  await read.getByRole('button', { name: /Đã đọc dữ liệu bảng tính/ }).click();
  await expect(page.getByRole('heading', { name: 'Chi tiết sự kiện' })).toBeVisible();
  const timeline = page.getByLabel('Dòng thời gian', { exact: true });
  const expanded = timeline.locator('.timeline-event[open]').first();
  const reportEvent = timeline
    .locator('.timeline-event')
    .filter({
      has: page.locator('summary').getByText('Đã tạo tệp báo cáo Excel', { exact: true }),
    })
    .first();
  await reportEvent.locator(':scope > summary').click();
  await expect(expanded).toHaveAttribute('open', '');
  await expect(reportEvent).toHaveAttribute('open', '');
  assert(await timeline.evaluate((node) => node.scrollHeight > node.clientHeight));
  report.checks.independentTimelineExpansion = true;
  await capture(page, '02-hoat-dong-1480.png', 1480, 960);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    activity.locator('.result-card').first().click(),
  ]);
  assert.equal(download.suggestedFilename(), run.reports[0].name);
  const saved = path.join(output, 'verified-report.xlsx');
  await download.saveAs(saved);
  assert.equal((await readFile(saved)).subarray(0, 2).toString(), 'PK');
  report.checks.download = download.suggestedFilename();

  for (const label of [
    'Unprotected Model Test',
    'Protected Test',
    'So sánh cả hai',
    'Chat thường',
  ]) {
    const option = page.getByRole('radio', { name: label, exact: true });
    await option.click();
    await expect(option).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.messages')).toContainText(title);
  }
  report.checks.fourModes = true;
  await composer.getByRole('button', { name: 'hanoi.xlsx', exact: true }).click();
  const followup = await send(app, 'Chỉ phân tích bảng Đà Nẵng');
  assert.deepEqual(followup.attachment_ids, [selection.files[1].id]);
  await closeNormally(app);
  app = await start();
  await app.page.locator('.recent-chats').getByRole('button', { name: title, exact: true }).click();
  await expect(app.page.locator('.messages')).toContainText('Chỉ phân tích bảng Đà Nẵng');
  await expect(
    app.page.locator('.composer').getByRole('button', { name: 'danang.xlsx' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const resumed = await send(app, 'Kiểm tra lại bảng đã chọn');
  assert.deepEqual(resumed.attachment_ids, followup.attachment_ids);
  assert.equal((await app.api('/skills')).length, installed.length);
  await expect(app.page.locator('.result-card')).toHaveCount(4);
  await app.page.getByRole('button', { name: 'Ẩn bảng thực thi' }).click();
  await capture(app.page, '03-tiep-tuc-1080.png', 1080, 700);
  report.checks.persisted = {
    conversation: run.conversation_id,
    attachmentIds: run.attachment_ids,
    reports: 4,
  };
  await closeNormally(app);
  app = undefined;
  assert.deepEqual(pageErrors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error);
  if (app) {
    await app.page
      .screenshot({ path: path.join(output, 'verification-error.png') })
      .catch(() => {});
    await closeNormally(app).catch(() => app.native.kill());
  }
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'native-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
