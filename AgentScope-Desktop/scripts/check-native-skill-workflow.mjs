// Exercise Skill import, reporting and removal through the native window and a fresh data directory.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { closeNormally, launch, terminal, waitFor } from './native-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = path.resolve(root, '../AgentScope-Backend');
const executable =
  process.env.AGENTSCOPE_NATIVE_EXE ||
  path.join(root, 'src-tauri/target/release/agentscope-desktop.exe');
const skillZip =
  process.env.AGENTSCOPE_SKILL_PACKAGE || path.join(backendRoot, 'samples/sales-report-helper.zip');
const workbook =
  process.env.AGENTSCOPE_SAMPLE_XLSX ||
  path.join(backendRoot, 'samples/AgentScope_DuLieuBanHang_Test.xlsx');
const dataDir = path.join(root, 'artifacts', `native-skill-workflow-${randomUUID()}`);
const cdpPort = Number(process.env.AGENTSCOPE_CDP_PORT || 9341);
const workflow = ['read_spreadsheet', 'analyze_spreadsheet', 'generate_report'];
const report = { executable, dataDir, skillZip, workbook };

const openLibrary = (page) =>
  page
    .locator('nav')
    .getByRole('button', { name: /Skills/ })
    .click();
const skillCard = (page, name) =>
  page.locator('.skill-card').filter({ has: page.getByRole('heading', { name, exact: true }) });

async function importSkill(app, file) {
  const { page, api } = app;
  const before = new Set((await api('/skills')).map((skill) => skill.id));
  await openLibrary(page);
  await page.locator('input[type=file][accept=".md,.zip"]').setInputFiles(file);
  const skill = await waitFor(
    async () => (await api('/skills')).find((item) => !before.has(item.id)),
    10000,
    'Skill import',
  );
  await page.locator('.skill-card').filter({ hasText: skill.name }).first().waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(skill.status, 'enabled');
  return skill;
}

async function analyze(app, prompt) {
  const { page, api } = app;
  const before = new Set((await api('/tasks')).map((t) => t.id));
  await page.locator('nav').getByRole('button', { name: 'Chat', exact: true }).click();
  await page.locator('.new-chat').click();
  await page.locator('input[type=file][accept=".csv,.xlsx,.xls"]').setInputFiles(workbook);
  await page.getByText(path.basename(workbook), { exact: true }).first().waitFor();
  await page.getByLabel('Tin nhắn cho AI Assistant').fill(prompt);
  await page.getByRole('button', { name: 'Gửi tin nhắn' }).click();
  const task = await waitFor(
    async () => {
      const t = (await api('/tasks')).find((r) => !before.has(r.id));
      return t && terminal.includes(t.status) ? t : null;
    },
    30000,
    'spreadsheet task',
  );
  const events = await api(`/tasks/${task.id}/events`);
  return { task, events };
}

let app;
try {
  await mkdir(dataDir, { recursive: true });
  // The user's original package: standard name/description, no capabilities.
  const valid = await readFile(
    path.join(backendRoot, 'samples/sales-report-helper/SKILL.md'),
    'utf8',
  );
  const instructionsOnly = path.join(dataDir, 'instructions-only', 'SKILL.md');
  await mkdir(path.dirname(instructionsOnly), { recursive: true });
  await writeFile(instructionsOnly, valid.replace(/capabilities:\n(  - \w+\n)+/, ''));

  app = await launch({ executable, dataDir, cdpPort, root });
  const { page, api, backend } = app;
  report.backendVersion = backend.health.version;
  report.backendExecutable = backend.executable;
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(report.backendVersion, version);
  assert.equal(
    path.normalize(backend.executable).toLowerCase(),
    path.join(path.dirname(executable), 'agentscope-backend.exe').toLowerCase(),
  );
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).first().click();
  await page.getByLabel('Dịch vụ AI').selectOption('antigravity');
  await page.getByRole('button', { name: /Lưu cấu hình/ }).click();
  await waitFor(
    async () => (await api('/settings')).provider === 'antigravity',
    10000,
    'ACP provider setting',
  );
  await page.getByRole('button', { name: 'Thực thi thực tế', exact: false }).click();
  await waitFor(
    async () => (await api('/settings')).mode === 'real',
    10000,
    'real execution setting',
  );
  report.footer = await page.locator('small', { hasText: 'AgentScope v' }).first().innerText();
  assert.equal(report.footer, `AgentScope v${backend.health.version}`);

  const instructions = await importSkill(app, instructionsOnly);
  assert.deepEqual(instructions.capabilities, []);
  await skillCard(page, instructions.name).getByText('Đã quét bảo mật', { exact: false }).waitFor();
  await page.screenshot({ path: path.join(dataDir, 'minimal-skill-import.png') });
  const reimported = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/skills/import') && response.request().method() === 'POST',
  );
  await page.locator('input[type=file][accept=".md,.zip"]').setInputFiles(instructionsOnly);
  const repeated = await (await reimported).json();
  assert.equal(repeated.id, instructions.id);
  assert.equal(repeated.package_sha256, instructions.package_sha256);
  assert.equal(repeated.reused_installation, true);
  await page.getByText('Gói Skill này đã được cài đặt. Đã dùng lại bản hiện có.').waitFor();
  assert.equal(await skillCard(page, instructions.name).count(), 1);
  report.identicalReimport = { id: repeated.id, packageSha256: repeated.package_sha256, cards: 1 };
  await page.screenshot({ path: path.join(dataDir, 'identical-reimport.png') });

  const suspiciousName = 'inspection-fixture';
  const suspiciousFolder = path.join(dataDir, suspiciousName);
  await mkdir(path.join(suspiciousFolder, 'scripts'), { recursive: true });
  await writeFile(
    path.join(suspiciousFolder, 'SKILL.md'),
    '---\nname: inspection-fixture\ndescription: A synthetic Skill package for static executable inspection.\n---\nReview only the package contents.\n',
  );
  await writeFile(
    path.join(suspiciousFolder, 'scripts', 'fixture.py'),
    '# Inert executable-file fixture for static inspection.\n',
  );
  await page.locator('input[webkitdirectory]').setInputFiles(suspiciousFolder);
  const suspiciousCard = skillCard(page, suspiciousName);
  await suspiciousCard.getByText('Cách ly', { exact: true }).waitFor();
  const suspicious = (await api('/skills')).find((skill) => skill.name === suspiciousName);
  assert.equal(suspicious.status, 'quarantine');
  await suspiciousCard.getByRole('button', { name: 'Chi tiết và bảo mật' }).click();
  const suspiciousDetails = page.getByRole('dialog', { name: 'Thông tin Skill' });
  await suspiciousDetails.getByText(/Mã thực thi chưa được tin cậy.*fixture\.py/).waitFor();
  await suspiciousDetails.getByRole('button', { name: 'Chạy kiểm tra cục bộ' }).click();
  await suspiciousDetails
    .getByTestId('local-skill-test-result')
    .getByText('Bản cài đặt bị chặn khỏi lựa chọn trong chế độ thường')
    .waitFor();
  await page.screenshot({ path: path.join(dataDir, 'quarantined-skill-findings.png') });
  await suspiciousDetails.getByRole('button', { name: 'Đóng', exact: true }).click();
  report.quarantine = {
    status: suspicious.status,
    executableFiles: suspicious.security.executable_files,
  };
  const first = await analyze(app, 'Phân tích doanh thu và lợi nhuận, tạo báo cáo Excel');
  report.instructionsOnly = { status: first.task.status, skillId: first.task.skill_id };
  assert.equal(first.task.status, 'completed');
  assert.equal(first.task.skill_id, instructions.id);

  const imported = await importSkill(app, skillZip);
  assert.notEqual(imported.package_sha256, instructions.package_sha256);
  await page.screenshot({ path: path.join(dataDir, 'skill-library.png') });
  const skills = await api('/skills');
  report.skills = skills.map((s) => ({
    name: s.name,
    status: s.status,
    capabilities: s.capabilities,
  }));
  const { task, events } = await analyze(
    app,
    'Phân tích tệp bán hàng đính kèm: tổng số đơn, tổng doanh thu, tổng lợi nhuận, và tạo báo cáo Excel.',
  );
  const tools = events.filter((e) => e.event_type === 'tool.completed');
  const permissions = events.filter((e) => e.event_type === 'permission.evaluated');
  const stats = tools.find((e) => e.tool_name === 'analyze_spreadsheet')?.result;
  const sums = Object.fromEntries((stats?.numeric_columns || []).map((c) => [c.column, c.sum]));
  const messages = await api(`/conversations/${task.conversation_id}/messages`);
  const reply = messages.filter((m) => m.role === 'assistant' && m.task_id === task.id).at(-1);
  report.validSkill = {
    status: task.status,
    error: task.error || null,
    provider: task.provider,
    model: task.model,
    events: events.map((e) => e.event_type),
    tools: tools.map((e) => e.tool_name),
    permissions: permissions.map((e) => ({
      decision: e.permission_decision,
      capability: e.arguments?.capability,
      skill: e.arguments?.skill,
      operation: e.arguments?.operation,
    })),
    rows: stats?.row_count,
    revenue: sums.Doanh_thu_VND,
    profit: sums.Loi_nhuan_VND,
    reply: reply?.content,
  };
  assert.equal(task.status, 'completed', JSON.stringify(report.validSkill));
  assert.equal(task.skill_id, imported.id);
  assert.equal(task.execution_engine, 'local_deterministic');
  assert.deepEqual(report.validSkill.tools, workflow);
  assert.deepEqual(
    report.validSkill.permissions.map((p) => [p.decision, p.capability]),
    workflow.map((c) => ['allow', c]),
  );
  assert.equal(stats.row_count, 48);
  assert.equal(sums.Doanh_thu_VND, 344740000);
  assert.equal(sums.Loi_nhuan_VND, 95980000);
  await page
    .locator('.timeline')
    .getByText('Đã tạo tệp báo cáo Excel', { exact: true })
    .first()
    .waitFor({ timeout: 15000 });
  const download = await fetch(`${backend.base}/api/files/${task.result.file_id}/download`, {
    headers: { Authorization: `Bearer ${backend.token}` },
  });
  assert(download.ok, `download HTTP ${download.status}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  report.reportFile = path.join(dataDir, 'downloaded-report.xlsx');
  await writeFile(report.reportFile, bytes);
  await page.screenshot({ path: path.join(dataDir, 'skill-workflow.png') });
  await page
    .locator('nav')
    .getByRole('button', { name: /Skills/ })
    .click();
  const card = page
    .locator('.skill-card')
    .filter({ hasText: imported.name })
    .filter({ hasText: 'Đang bật' });
  await card.getByRole('button', { name: 'Chi tiết và bảo mật' }).click();
  const details = page.getByRole('dialog', { name: 'Thông tin Skill' });
  await details.getByText(/sha-256/i).waitFor();
  const eventsBeforeRemoval = await api(`/tasks/${task.id}/events`);
  await page.screenshot({ path: path.join(dataDir, 'skill-details.png') });
  await details.getByRole('button', { name: 'Gỡ Skill' }).waitFor();
  await details.getByRole('button', { name: 'Đóng', exact: true }).click();
  await card.getByRole('button', { name: 'Gỡ Skill' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Gỡ Skill' });
  assert((await confirmation.innerText()).includes(imported.name));
  await page.screenshot({ path: path.join(dataDir, 'remove-confirmation.png') });
  await confirmation.getByRole('button', { name: 'Xác nhận gỡ Skill' }).click();
  await waitFor(
    async () => !(await api('/skills')).some((item) => item.id === imported.id),
    10000,
    'Skill removal',
  );
  assert.deepEqual((await api(`/skills/${imported.id}/evidence`)).hashes, imported.hashes);
  await card.waitFor({ state: 'hidden' });
  await page.locator('nav').getByRole('button', { name: 'Chat', exact: true }).click();
  await page.locator('.run-meta').getByText(imported.name, { exact: true }).waitFor();
  report.removalVerified = true;
  await closeNormally(app, report);
  app = await launch({ executable, dataDir, cdpPort, root });
  const afterRestart = await app.api('/skills');
  assert(!afterRestart.some((skill) => skill.id === imported.id));
  assert(afterRestart.some((skill) => skill.id === instructions.id));
  assert.deepEqual((await app.api(`/skills/${imported.id}/evidence`)).hashes, imported.hashes);
  assert.deepEqual(await app.api(`/tasks/${task.id}/events`), eventsBeforeRemoval);
  await openLibrary(app.page);
  await skillCard(app.page, instructions.name).waitFor();
  assert.equal(await skillCard(app.page, instructions.name).count(), 1);
  await app.page.screenshot({ path: path.join(dataDir, 'library-after-restart.png') });
  report.restart = { removalPersisted: true, snapshotIntact: true, runEventsIntact: true };

  const restarted = app.page;
  await skillCard(restarted, instructions.name)
    .getByRole('button', { name: 'Chi tiết và bảo mật' })
    .click();
  const remainingSkill = restarted.getByRole('dialog', { name: 'Thông tin Skill' });
  await remainingSkill.getByRole('button', { name: 'Bật Skill' }).click();
  await waitFor(
    async () =>
      (await app.api('/skills')).some(
        (item) => item.id === instructions.id && item.status === 'enabled',
      ),
    10000,
    'reactivating the remaining text Skill',
  );
  await remainingSkill.getByRole('button', { name: 'Đóng', exact: true }).click();
  const prior = new Set((await app.api('/tasks')).map((item) => item.id));
  await restarted.locator('nav').getByRole('button', { name: 'Chat', exact: true }).click();
  await restarted.locator('.new-chat').click();
  await restarted
    .getByLabel('Tin nhắn cho AI Assistant')
    .fill(`Thử dùng Skill ${instructions.name}.`);
  await restarted.getByRole('button', { name: 'Gửi tin nhắn' }).click();
  const blocked = await waitFor(
    async () => {
      const latest = (await app.api('/tasks')).find((item) => !prior.has(item.id));
      return latest && [...terminal, 'awaiting_approval'].includes(latest.status) ? latest : null;
    },
    15000,
    'text-only Skill in production ACP',
  );
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.skill_id, instructions.id);
  const blockedEvents = await app.api(`/tasks/${blocked.id}/events`);
  const restriction = blockedEvents.find(
    (event) => event.event_type === 'security.execution_restricted',
  );
  assert.equal(restriction.result.scope, 'skill_delivery_to_acp');
  assert.equal(restriction.result.skill_delivered, false);
  assert(!blockedEvents.some((event) => event.event_type === 'prompt.composed'));
  const openLab = restarted.getByRole('button', { name: 'Chạy thử trong Lab PI cô lập' });
  await openLab.waitFor();
  await restarted.screenshot({ path: path.join(dataDir, 'blocked-chat-lab-action.png') });
  await restarted.getByRole('button', { name: 'Kiểm tra Skill cục bộ' }).click();
  const localDialog = restarted.getByRole('dialog', { name: 'Thông tin Skill' });
  await localDialog.getByLabel('Tác vụ thử').fill(`Thử dùng Skill ${instructions.name}.`);
  const localResponse = restarted.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/skills/${instructions.id}/local-test`) &&
      response.request().method() === 'POST',
  );
  await localDialog.getByRole('button', { name: 'Chạy kiểm tra cục bộ' }).click();
  const local = await (await localResponse).json();
  assert.equal(local.skill_id, instructions.id);
  assert.equal(local.package_sha256, instructions.package_sha256);
  assert(local.available && local.matches_task);
  await localDialog
    .getByTestId('local-skill-test-result')
    .getByText('Phù hợp tác vụ thử', { exact: true })
    .waitFor();
  assert.deepEqual(await app.api('/isolated-lab/trials'), []);
  await assert.rejects(
    readFile(path.join(dataDir, 'isolated-injection-lab', 'last-check.json')),
    { code: 'ENOENT' },
  );
  await restarted.screenshot({ path: path.join(dataDir, 'local-skill-test.png') });
  report.localTest = {
    skillId: local.skill_id,
    packageSha256: local.package_sha256,
    matchesTask: local.matches_task,
    appContainerPreflightRan: false,
    isolatedTrials: 0,
  };
  await localDialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  await openLab.click();
  const localInspection = restarted.getByRole('region', { name: 'Kiểm tra gói Skill cục bộ' });
  await localInspection.getByText(/sha-256/i).waitFor();
  assert.equal(
    await localInspection.locator(':scope > .lab-form select').inputValue(),
    instructions.id,
  );
  await restarted.getByRole('button', { name: 'Chạy thử Skill mẫu', exact: true }).waitFor();
  report.blockedChat = { status: blocked.status, skillDelivered: false, inspectionOpened: true };
  await closeNormally(app, report);
  report.cleanup = true;
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  if (app?.native.exitCode === null) app.native.kill();
  await writeFile(
    path.join(dataDir, 'skill-workflow-results.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
