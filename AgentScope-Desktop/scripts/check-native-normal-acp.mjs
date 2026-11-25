// Opt-in live check. Sends only the repository's synthetic workbook and reporting Skill.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { closeNormally, launch, terminal, waitFor } from './native-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.AGENTSCOPE_NATIVE_EXE;
const dataDir = process.env.AGENTSCOPE_NATIVE_DATA_DIR;
assert(executable && dataDir, 'Set AGENTSCOPE_NATIVE_EXE and AGENTSCOPE_NATIVE_DATA_DIR');
const app = await launch({ root, executable, dataDir, cdpPort: 9368 });

async function request(route, { method = 'GET', body, timeout = 15000 } = {}) {
  const headers = { Authorization: `Bearer ${app.backend.token}` };
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  return fetch(`${app.backend.base}/api${route}`, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(timeout),
  });
}

try {
  const ready = await request('/research/readiness/check', { method: 'POST', timeout: 180000 });
  assert(ready.ok, `AppContainer preflight endpoint: HTTP ${ready.status}`);
  const readiness = await ready.json();
  assert.equal(readiness.state, 'ready', readiness.blocker);
  const model =
    readiness.flash_models.find((id) => id.endsWith('-high')) ?? readiness.flash_models[0];
  assert(model, 'No Gemini model advertised by the isolated session');
  const saved = await request('/settings', {
    method: 'POST',
    body: { provider: 'antigravity', model, mode: 'real' },
  });
  assert(saved.ok);
  const skillPath = path.resolve(
    root,
    '../AgentScope-Backend/samples/spreadsheet-analysis/SKILL.md',
  );
  const form = new FormData();
  form.append('files', new Blob([await readFile(skillPath)]), 'SKILL.md');
  const imported = await request('/skills/import', { method: 'POST', body: form });
  assert(imported.ok, `Skill import: HTTP ${imported.status}`);
  const skill = await imported.json();
  assert((await request(`/skills/${skill.id}/approve`, { method: 'POST' })).ok);

  const { page } = app;
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Chat thường' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByLabel('Skill cho tác vụ').selectOption(skill.id);
  await page
    .locator('input[type=file][accept=".csv,.xlsx,.xls"]')
    .setInputFiles(path.join(root, 'e2e/fixtures/research-sales.xlsx'));
  await expect(
    page.getByRole('button', { name: 'research-sales.xlsx', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Tin nhắn cho AI Assistant')
    .fill(
      'Tính tổng số đơn, doanh thu và lợi nhuận từ bảng bán hàng tổng hợp này. Dùng công cụ MCP của AgentScope để tính số và tạo báo cáo Excel.',
    );
  await page.getByRole('button', { name: 'Gửi tin nhắn' }).click();
  await page
    .getByRole('dialog', { name: 'Cho phép kết nối AI?' })
    .getByRole('button', { name: 'Cho phép một lần' })
    .click({ timeout: 30000 });
  console.log(`Normal Chat started a live, contained request with ${model}.`);

  const final = await waitFor(
    async () => {
      const [task] = await app.api('/tasks');
      return task && terminal.includes(task.status) ? task : null;
    },
    360000,
    'Normal Chat Gemini ACP result',
  );
  const events = await app.api(`/tasks/${final.id}/events`);
  assert.equal(final.status, 'completed', final.error);
  assert.equal(final.execution_engine, 'acp_appcontainer');
  assert(!events.some((event) => event.event_type === 'workflow.selected'));
  const resultOf = (type) => events.find((event) => event.event_type === type)?.result;
  const acp = resultOf('model.session_started')?.appcontainer_process;
  const attestation = resultOf('research.mcp_process_attested');
  const mcp = attestation?.appcontainer_process;
  assert(acp?.is_appcontainer && mcp?.is_appcontainer && attestation.verified);
  assert.equal(acp.appcontainer_sid, mcp.appcontainer_sid);
  assert.equal(acp.integrity_sid, 'S-1-16-4096');
  assert.equal(mcp.integrity_sid, 'S-1-16-4096');
  for (const process of [acp, mcp]) {
    assert(process.pid > 0 && /^S-1-5-/.test(process.user_sid));
    assert.equal(process.elevated, false);
    assert(['deny_only', 'disabled', 'absent'].includes(process.administrators_group));
    assert.deepEqual(process.capability_sids, ['S-1-15-3-1']);
  }
  assert.equal(acp.user_sid, mcp.user_sid);
  assert.notEqual(acp.pid, mcp.pid);
  const preflight = resultOf('research.isolation_verified')?.checks;
  assert(preflight?.length && preflight.every((check) => check.passed === true));
  for (const id of [
    'workspace_read',
    'workspace_write',
    'evidence_write',
    'host_loopback_connect',
    'internet_with_capability',
    'internet_without_capability',
  ]) {
    assert(
      preflight.some((check) => check.check === id),
      `Missing live check: ${id}`,
    );
  }
  assert(
    resultOf('prompt.submitted')?.skill_delivered,
    'Expected the approved Skill to reach Gemini',
  );
  assert(final.result.validation.valid && final.result.validation.matches_mcp_receipt);
  const download = await request(`/files/${final.result.file_id}/download`);
  assert(download.ok);
  const bytes = Buffer.from(await download.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest, final.result.validation.sha256);
  await writeFile(path.join(dataDir, 'verified-gemini-report.xlsx'), bytes);

  await expect(page.getByText(/Gemini ACP · research-sales\.xlsx/)).toBeVisible({ timeout: 20000 });
  const facts = page.locator('.execution-facts');
  await expect(facts.getByText('AppContainer ON', { exact: true })).toBeVisible({ timeout: 20000 });
  await facts.getByText('Bằng chứng thực thi', { exact: true }).click();
  await expect(facts.getByText('SID người dùng ACP', { exact: true })).toBeVisible();
  await expect(facts.getByText('SID người dùng MCP', { exact: true })).toBeVisible();
  await expect(facts.getByText('Kiểm tra quyền mạng', { exact: true })).toBeVisible();
  await page.screenshot({
    path: path.join(dataDir, 'normal-chat-acp.png'),
    animations: 'disabled',
  });
  await writeFile(
    path.join(dataDir, 'normal-chat-acp.json'),
    JSON.stringify(
      {
        model,
        taskId: final.id,
        sessionId: final.session_id,
        acp,
        mcp,
        preflight,
        reportSha256: digest,
        checks: final.result.validation.checks,
        events: events.map(({ event_type, source, status }) => ({ event_type, source, status })),
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: Normal Chat reached Gemini, ran a contained MCP report and published the independently verified XLSX.',
  );
} finally {
  await closeNormally(app);
}
