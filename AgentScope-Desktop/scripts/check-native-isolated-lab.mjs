// Opt-in harmless end-to-end check of the Isolated Prompt Injection Research Lab through the
// real native window (uses lab Gemini quota). Runs a control or the fixed text sample.
// Imported Skills are inspected locally.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { closeNormally, descendants, launch, waitFor } from './native-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = path.resolve(root, '../AgentScope-Backend');
const executable =
  process.env.AGENTSCOPE_NATIVE_EXE ||
  path.join(root, 'src-tauri/target/release/agentscope-desktop.exe');
const dataDir = path.join(root, 'artifacts', `native-isolated-lab-${randomUUID()}`);
const cdpPort = Number(process.env.AGENTSCOPE_CDP_PORT || 9345);
const kind = process.argv.includes('--skill-sample') ? 'canary' : 'control';
const report = { executable, dataDir, kind };

let app;
try {
  await mkdir(dataDir, { recursive: true });
  app = await launch({ executable, dataDir, cdpPort, root });
  const { page, api, backend } = app;
  report.backendVersion = backend.health.version;

  await page
    .locator('nav')
    .getByRole('button', { name: /Skills/ })
    .click();
  await page
    .locator('input[type=file][accept=".md,.zip"]')
    .setInputFiles(path.join(backendRoot, 'samples/sales-report-helper.zip'));
  const skill = page.locator('.skill-card').filter({ hasText: 'sales-report-helper' });
  await skill.getByRole('button', { name: 'Kiểm tra trong lab' }).click();
  await page
    .getByRole('region', { name: 'Kiểm tra gói Skill cục bộ' })
    .getByText(/sha-256/i)
    .waitFor();
  await page.getByText(/ground truth Python/).waitFor({ timeout: 20000 });
  report.status = await api('/isolated-lab/status');

  // 1. Preflight + lab sign-in from the UI (no prompt).
  await page
    .getByRole('button', { name: 'Kiểm tra isolation và đăng nhập lab (không gửi prompt)' })
    .click();
  const checkBox = page.getByTestId('isolated-check');
  await checkBox.waitFor({ timeout: 180000 });
  report.checkUi = await checkBox.innerText();
  assert(/Preflight: ĐẠT/.test(report.checkUi), report.checkUi);
  assert(/Lab đăng nhập: có/.test(report.checkUi), report.checkUi);
  assert(/protected_\d+_session-token/.test(report.checkUi), 'session-token probe missing');

  // The imported package is available to local inspection only in this smoke test.
  await page.getByLabel(/Tôi chủ động chạy trial/).check();
  const injection = page.getByRole('button', { name: 'Chạy Injection · gửi SKILL.md thật' });
  assert(await injection.isDisabled(), 'Injection enabled without a Skill');
  report.injectionClicked = false;

  const runButton = kind === 'canary' ? 'Chạy thử Skill mẫu' : 'Chạy Control · không Skill';
  await page.getByRole('button', { name: runButton, exact: true }).click();
  const processSamples = new Set();
  const trial = await waitFor(
    async () => {
      for (const p of descendants(app.native.pid))
        if (/^(AcLaunch|agy)\.exe$/i.test(p.Name))
          processSamples.add(
            `${p.Name} ${p.ProcessId} <- ${p.ParentProcessId}: ${p.CommandLine?.split(' -- ')[0].slice(0, 160)}`,
          );
      const list = await api('/isolated-lab/trials');
      const t = list.find((x) => x.kind === kind);
      return t && ['completed', 'failed', 'blocked_isolation'].includes(t.state) ? t : null;
    },
    300000,
    'benign lab trial',
  );
  report.processSamples = [...processSamples];
  report.trial = {
    state: trial.state,
    model: trial.turn?.model,
    session_id: trial.turn?.session_id,
    mode: trial.turn?.mode?.current_mode_id,
    cli_agent: trial.turn?.cli_agent,
    container_token: trial.turn?.container_token,
    isolation_passed: trial.isolation?.passed,
    isolation_checks: trial.isolation?.checks?.map(
      (c) => `${c.passed ? 'PASS' : 'FAIL'} ${c.check}`,
    ),
    skill_included: trial.delivery.skill_included,
    prompt_submitted: trial.delivery.prompt_submitted,
    prompt_completed: trial.delivery.prompt_completed,
    skill_name: trial.skill?.name,
    raw_model_answer: trial.raw_model_answer,
    signals: trial.signals,
    permission_requests: trial.permission_requests,
    tool_calls: trial.tool_calls,
    security_events: trial.security_events.map((e) => e.type),
    processes_joined: trial.processes
      ?.filter((p) => p.event === 'process_joined')
      .map((p) => p.image),
    error: trial.error || null,
  };
  assert.equal(trial.state, 'completed', JSON.stringify(report.trial));
  assert.equal(trial.delivery.skill_included, kind === 'canary');
  if (kind === 'canary') {
    assert.equal(trial.skill.name, 'harmless-boundary-canary');
    assert.equal(trial.data_view, 'aggregates');
    assert(trial.delivery.prompt_submitted && trial.delivery.prompt_completed);
    await page
      .getByTestId('latest-text-skill-trial')
      .getByText('Trace ACP ghi nhận yêu cầu chứa Skill mẫu.')
      .waitFor();
  }
  assert(trial.isolation.passed);
  assert(trial.turn.session_id);
  assert.equal(trial.turn.container_token.token_is_appcontainer, true);
  assert.equal(trial.turn.container_token.token_integrity_sid, 'S-1-16-4096');
  assert(
    report.processSamples.some((p) => p.startsWith('AcLaunch.exe')),
    'AcLaunch not observed',
  );
  assert(trial.raw_model_answer, 'No model answer');

  // 4. The real answer and labels are rendered in the Desktop.
  const card = page.getByTestId(`isolated-trial-${kind}`).first();
  await card.getByText('Hoàn tất · phản hồi Gemini thật').waitFor({ timeout: 15000 });
  report.renderedCard = await card.innerText();
  const firstLine = trial.raw_model_answer.trim().split('\n')[0].slice(0, 30);
  assert(report.renderedCard.includes(firstLine), 'Raw answer not rendered');
  await page.screenshot({ path: path.join(dataDir, 'isolated-lab.png'), fullPage: true });
  await closeNormally(app, report);
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  if (app?.native.exitCode === null) app.native.kill();
  await writeFile(path.join(dataDir, 'isolated-lab-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
