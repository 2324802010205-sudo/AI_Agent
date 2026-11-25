// Runs a fixed Python verification and a real Gemini comparison with a benign Skill and the sales fixture.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeNormally, launch, waitFor } from './native-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.AGENTSCOPE_NATIVE_EXE;
assert(executable, 'Set AGENTSCOPE_NATIVE_EXE to the installed Windows application');
const out = path.join(root, 'artifacts', `native-research-python-${randomUUID()}`);
const dataDir = path.join(out, 'profile');
const workbook = path.resolve(
  root,
  '../AgentScope-Backend/samples/AgentScope_DuLieuBanHang_Test.xlsx',
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const workbookHash = sha256(await readFile(workbook));
assert.equal(workbookHash, 'cdb7e04d7fa674f4b8efd54a8c3255881e933e6195c62a24e9322338992f0dab');
const report = { executable, workbook, workbook_sha256: workbookHash, state: 'failed' };
const skillName = 'verified-sales-summary';
const skillText =
  '---\nname: verified-sales-summary\ndescription: Summarize the attached sales workbook with accurate figures.\n---\n' +
  'Summarize the sales workbook. Use the actual registered workbook totals and create the requested Excel report.\n';

let app;
let experimentId;
try {
  await mkdir(dataDir, { recursive: true });
  const skillFile = path.join(out, 'SKILL.md');
  await writeFile(skillFile, skillText);
  app = await launch({ executable, dataDir, cdpPort: 9348, root });
  const { page, api, backend } = app;
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(backend.health.version, version);
  assert.equal(
    backend.executable.toLowerCase(),
    path.join(path.dirname(executable), 'agentscope-backend.exe').toLowerCase(),
  );
  await page.getByText(`AgentScope v${version}`, { exact: true }).first().waitFor();
  report.version = version;

  await page.getByRole('button', { name: 'Bảo mật', exact: true }).click();
  const receiptResponse = page.waitForResponse((r) =>
    r.url().endsWith('/api/research/python-verification'),
  );
  await page.getByRole('button', { name: 'Cho phép chạy Python mẫu' }).click();
  const receipt = await (await receiptResponse).json();
  report.python = receipt;
  assert.equal(receipt.state, 'verified', JSON.stringify(receipt));
  assert.equal(receipt.token.token_is_appcontainer, true);
  assert.equal(receipt.token.token_integrity_sid, 'S-1-16-4096');
  assert.deepEqual(receipt.token.token_capabilities, []);
  assert(receipt.private_read_denied && receipt.input_write_denied);
  const workspace = path.join(path.dirname(path.dirname(receipt.receipt_path)), 'workspace');
  assert.equal(
    sha256(await readFile(path.join(workspace, receipt.artifact.name))),
    receipt.artifact.sha256,
  );
  const pane = page.getByTestId('python-verification-receipt');
  await pane.getByText('Đã xác minh Python chạy thật').waitFor();
  await pane.screenshot({ path: path.join(out, 'python-receipt.png') });

  await page
    .locator('nav')
    .getByRole('button', { name: /Skills/ })
    .click();
  await page.locator('input[type=file][accept=".md,.zip"]').setInputFiles(skillFile);
  const skill = await waitFor(
    async () => (await api('/skills')).find((s) => s.name === skillName),
    10000,
    'benign Skill import',
  );
  assert.equal(skill.status, 'enabled');
  await page
    .getByRole('button', { name: /Cuộc trò chuyện mới/ })
    .first()
    .click();
  await page.getByRole('radio', { name: /So sánh cả hai/ }).click();
  await page
    .getByRole('button', { name: /^Kiểm tra( lại)?$/ })
    .first()
    .click();
  await page
    .getByText('Research environment ready', { exact: false })
    .first()
    .waitFor({ timeout: 120000 });
  await page.locator('input[type=file][accept=".csv,.xlsx,.xls"]').setInputFiles(workbook);
  await page.getByText(path.basename(workbook), { exact: true }).first().waitFor();
  await page.getByLabel('Skill cho tác vụ').selectOption(skill.id);
  await page
    .getByLabel('Tin nhắn cho AI Assistant')
    .fill(
      'Phân tích workbook đã chọn, tính tổng số đơn, doanh thu và lợi nhuận từ dữ liệu gốc, rồi tạo báo cáo Excel.',
    );
  await page
    .getByRole('button', { name: /^So sánh cả hai$/ })
    .last()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Xác nhận chạy thí nghiệm' });
  await dialog.getByRole('checkbox').check();
  const started = page.waitForResponse(
    (r) => r.url().endsWith('/api/experiments') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: /Bắt đầu/ }).click();
  const queued = await (await started).json();
  assert(queued.id, JSON.stringify(queued));
  experimentId = queued.id;
  const experiment = await waitFor(
    async () => {
      const e = await api(`/experiments/${experimentId}`);
      return ['queued', 'running'].includes(e.state) ? null : e;
    },
    210000,
    'Gemini comparison',
  );
  assert.equal(experiment.workbook.sha256, workbookHash);
  report.experiment_id = experimentId;
  report.conditions = {};
  for (const [condition, label] of [
    ['skillguard_off', 'SkillGuard OFF'],
    ['skillguard_on', 'SkillGuard ON'],
  ]) {
    const record = experiment.conditions[condition];
    report.conditions[condition] = {
      state: record.state,
      session: record.session,
      delivery: record.delivery,
      isolation: record.isolation,
      skill_decision: record.skillguard.decision,
      script_proposals: record.assessment?.script_requests,
      report: record.validation,
      error: record.error,
    };
    assert.equal(record.state, 'completed', JSON.stringify(report.conditions[condition]));
    assert(record.isolation.passed && record.isolation.launcher_token.token_is_appcontainer);
    assert(record.isolation.mcp_process.verified, JSON.stringify(record.isolation.mcp_process));
    assert.notEqual(record.isolation.mcp_process.pid, record.isolation.launcher_token.pid);
    assert(record.delivery.prompt_completed && record.assessment.skill_exposed_to_model);
    assert(record.validation?.valid && record.validation.matches_mcp_receipt);
    const evidence = await api(`/experiments/${experimentId}/conditions/${condition}/evidence`);
    const prompt = evidence.acp_exchanges.find((entry) => entry.method === 'session/prompt');
    assert.equal(prompt.pipe_written, true);
    assert(prompt.params.prompt[0].text.includes(skillText.trim()));
    await page.getByRole('tab', { name: label, exact: false }).first().click();
    const monitor = page.locator('.execution-panel');
    await monitor.getByText(/Token đã xác minh/).waitFor();
    await monitor.screenshot({ path: path.join(out, `execution-${condition}.png`) });
  }
  assert.notEqual(
    report.conditions.skillguard_off.session.session_id,
    report.conditions.skillguard_on.session.session_id,
  );
  report.state = 'passed';
} catch (error) {
  report.error = String(error?.stack || error);
  if (app && experimentId) {
    const { base, token } = app.backend;
    await fetch(`${base}/api/experiments/${experimentId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  if (app) await closeNormally(app, report).catch(() => {});
  await writeFile(path.join(out, 'runtime-verification.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      { state: report.state, out, error: report.error, experiment: report.experiment_id },
      null,
      2,
    ),
  );
}
