// Opt-in live check of simultaneous multi-Skill management and use on the installed app.
// Sends only harmless, synthetic Skills and the repository's synthetic workbook to Gemini.
//
//   AGENTSCOPE_NATIVE_EXE=<installed exe> AGENTSCOPE_NATIVE_DATA_DIR=<empty dir> \
//     node scripts/check-native-multi-skill.mjs
//
// It imports 10 Skills, switches one off, runs a real Gemini ACP + MCP task, re-enables it,
// disables and deletes others, restarts the application on the same profile, confirms every
// state persisted and runs a second real task. For each task it compares the raw ACP trace
// with the AgentScope receipt, so "exposed" means "present in the prompt Gemini ACP received".
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { closeNormally, launch, terminal, waitFor } from './native-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.AGENTSCOPE_NATIVE_EXE;
const dataDir = process.env.AGENTSCOPE_NATIVE_DATA_DIR;
assert(executable && dataDir, 'Set AGENTSCOPE_NATIVE_EXE and AGENTSCOPE_NATIVE_DATA_DIR');
const evidence =
  process.env.AGENTSCOPE_NATIVE_EVIDENCE_DIR ||
  path.join(root, 'artifacts/multi-skill-20261123', `native-${Date.now()}`);
await mkdir(evidence, { recursive: true });

const sha = (value) => createHash('sha256').update(value).digest('hex');
const workbook = path.join(root, 'e2e/fixtures/research-sales.xlsx');
const workbookSha = sha(await readFile(workbook));
const taskText =
  'Tính tổng số đơn, doanh thu và lợi nhuận từ bảng bán hàng tổng hợp. Dùng MCP workbook của AgentScope để tính số và tạo báo cáo Excel.';

// Ten harmless Skills. #9 and #10 deliberately share one display name.
const SPECS = [
  ['currency-format', 'currency', 'write every currency amount with the unit VND'],
  ['section-headings', 'headings', 'give the answer short section headings'],
  ['order-count-first', 'order counts', 'mention the number of orders before revenue'],
  ['percent-rounding', 'percentages', 'round every percentage to one decimal place'],
  ['regional-split', 'regional breakdown', 'list a regional breakdown when a region column exists'],
  ['vietnamese-summary', 'language', 'finish with a one-sentence summary in Vietnamese'],
  ['margin-note', 'margins', 'state profit margin as profit divided by revenue'],
  ['cancelled-orders', 'cancelled orders', 'state how cancelled orders were treated'],
  ['regional-notes', 'data notes', 'add a short note about data quality'],
  ['regional-notes', 'assumptions', 'add a short note about the assumptions used'],
];
const salt = randomBytes(4).toString('hex');
const skills = SPECS.map(([name, topic, rule], index) => {
  const marker = `MSK${String(index + 1).padStart(2, '0')}-${salt}-${randomBytes(4).toString('hex')}`;
  const text =
    `---\nname: ${name}\ndescription: Short guidance about ${topic} for spreadsheet reports.\n---\n` +
    `# ${name}\n\nReference marker: ${marker}\n\nWhen the user asks for a spreadsheet report, ${rule}.\n`;
  return { index: index + 1, name, marker, text, sha256: sha(text), id: '' };
});
const quarantinedText =
  '---\nname: flagged-fixture\ndescription: Inert fixture that the static scan quarantines.\n---\n' +
  `Reference marker: MSQ-${salt}\n\n\`\`\`python\nkeyboard.Listener(\n`;
const quarantinedMarker = `MSQ-${salt}`;
const quarantinedScript = 'print("never executed by AgentScope")\n';

const notes = { startedAt: new Date().toISOString(), executable, workbookSha256: workbookSha };
const save = () =>
  writeFile(path.join(evidence, 'verification.json'), JSON.stringify(notes, null, 2));

function client(app) {
  return async (route, { method = 'GET', body, timeout = 20000 } = {}) => {
    const headers = { Authorization: `Bearer ${app.backend.token}` };
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const response = await fetch(`${app.backend.base}/api${route}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status} ${await response.text()}`);
    return response;
  };
}
const json = (request) => async (route, options) => (await request(route, options)).json();

async function importSkill(call, files) {
  const form = new FormData();
  for (const [name, content] of files) form.append('files', new Blob([content]), name);
  return call('/skills/import', { method: 'POST', body: form });
}
const stateOf = (library) =>
  Object.fromEntries(library.map((skill) => [skill.id, { name: skill.name, state: skill.state }]));
const activeLabel = (count) => `${count} Skills đang bật`;

async function goto(page, label) {
  await page.locator('nav').getByRole('button', { name: label }).click();
}
const card = (page, skill) => page.locator('.skill-card').filter({ hasText: skill.name });

async function runTask(app, call, label, expected, forbidden) {
  const { page } = app;
  await page.reload();
  await goto(page, 'Chat');
  await expect(page.getByRole('button', { name: activeLabel(expected.length) })).toBeVisible();
  await page.locator('input[type=file][accept=".csv,.xlsx,.xls"]').setInputFiles(workbook);
  await expect(
    page.getByRole('button', { name: 'research-sales.xlsx', exact: true }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Tin nhắn cho AI Assistant' }).fill(taskText);
  const tasks = () => json(call)('/tasks');
  const known = new Set((await tasks()).map((task) => task.id));
  await page.getByRole('button', { name: 'Gửi tin nhắn' }).click();
  await page
    .getByRole('dialog', { name: 'Cho phép kết nối AI?' })
    .getByRole('button', { name: 'Cho phép một lần' })
    .click({ timeout: 60000 });
  console.log(`${label}: approved a live Gemini request with ${expected.length} Skills`);
  const run = await waitFor(
    async () => {
      const latest = (await tasks()).find((task) => !known.has(task.id));
      return latest && terminal.includes(latest.status) && latest;
    },
    420000,
    label,
  );
  const events = await json(call)(`/tasks/${run.id}/events`);
  const pick = (type) => events.find((event) => event.event_type === type)?.result;
  const submitted = pick('prompt.submitted');
  const note = {
    label,
    runId: run.id,
    conversationId: run.conversation_id,
    status: run.status,
    error: run.error,
    executionEngine: run.execution_engine,
    sessionId: run.session_id,
    labRun: run.lab_run,
    model: run.model,
    snapshot: run.skill_snapshot,
    loadedSkills: run.loaded_skills,
    exposurePlan: run.skill_exposure_plan,
    submitted,
    acp: pick('model.session_started')?.appcontainer_process,
    mcp: pick('research.mcp_process_attested')?.appcontainer_process,
    validation: run.result?.validation,
    toolReceipts: events
      .filter(({ source }) => ['acp-policy', 'mcp'].includes(source))
      .map(({ timestamp, source, event_type, tool_name, status, permission_decision, result }) => ({
        timestamp,
        source,
        event_type,
        tool_name,
        status,
        permission_decision,
        stage: result.stage,
        sequence: result.sequence,
      })),
  };
  notes[label] = note;
  await save();
  assert.equal(run.status, 'completed', run.error);
  assert.equal(run.execution_engine, 'acp_appcontainer');
  assert(note.acp?.is_appcontainer && note.mcp?.is_appcontainer, 'AppContainer attestation');
  assert.equal(note.acp.appcontainer_sid, note.mcp.appcontainer_sid);
  assert.equal(note.acp.integrity_sid, 'S-1-16-4096');
  assert.equal(run.result.validation.valid, true);
  assert.equal(run.result.validation.matches_mcp_receipt, true);

  // Receipt: exactly the expected Skills, each located in the submitted prompt.
  assert.equal(submitted.skill_count, expected.length);
  assert.equal(submitted.skills_in_acp_prompt, expected.length);
  assert.equal(submitted.skill_exposure, 'acknowledged');
  const receipt = new Map(submitted.skills.map((entry) => [entry.skill_id, entry]));
  assert.deepEqual(
    [...receipt.values()]
      .filter((entry) => entry.exposed)
      .map((entry) => entry.skill_id)
      .sort(),
    expected.map((skill) => skill.id).sort(),
  );
  assert.deepEqual(
    new Set(run.skill_snapshot.skills.map((entry) => entry.id)),
    new Set(expected.map((skill) => skill.id)),
  );
  for (const skill of expected) {
    const entry = receipt.get(skill.id);
    assert.equal(entry.sha256, skill.sha256);
    assert(entry.in_acp_prompt && entry.skill_exposure === 'acknowledged');
    assert.equal(entry.bundled_files_executed, false);
  }

  // Raw ACP trace: the prompt that Gemini ACP actually received.
  const trace = path.join(
    process.env.USERPROFILE,
    'AgentScopeLab',
    'runs',
    run.lab_run,
    'evidence',
  );
  const raw = (await readFile(path.join(trace, 'experiment.acp.jsonl'), 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map(JSON.parse);
  const prompt = raw.find(({ method, result }) => method === 'session/prompt' && result).params
    .prompt[0].text;
  assert.equal(sha(prompt), submitted.prompt_sha256);
  assert(prompt.includes(taskText));
  const perSkill = [];
  for (const skill of expected) {
    const entry = receipt.get(skill.id);
    const begin = `<untrusted_skill index="`;
    const start = prompt.indexOf(`id="${skill.id}" name="${skill.name}" sha256="${skill.sha256}">`);
    assert(start > prompt.lastIndexOf(begin, start) && start >= 0, `block for ${skill.id}`);
    const open = prompt.lastIndexOf(begin, start);
    const close = prompt.indexOf('</untrusted_skill>', start) + '</untrusted_skill>'.length;
    assert.equal(sha(prompt.slice(open, close)), entry.block_sha256);
    assert(prompt.slice(open, close).includes(skill.text.trimEnd()), 'full SKILL.md text');
    assert(prompt.includes(skill.marker));
    perSkill.push({
      id: skill.id,
      name: skill.name,
      skillMdSha256: skill.sha256,
      blockSha256: entry.block_sha256,
      markerInRawAcpPrompt: true,
    });
  }
  for (const skill of forbidden) {
    assert(!prompt.includes(skill.marker), `${skill.name} must not be exposed`);
    assert(!prompt.includes(skill.id), `${skill.name} id must not be exposed`);
  }
  assert(!prompt.includes(quarantinedMarker), 'quarantined Skill must not be exposed');
  assert(!prompt.includes('never executed by AgentScope'), 'bundled script must not be sent');
  note.rawAcp = {
    path: path.join(trace, 'experiment.acp.jsonl'),
    mcpJournal: path.join(trace, 'workbook-mcp.jsonl'),
    promptSha256: sha(prompt),
    promptChars: prompt.length,
    exposed: perSkill,
    notExposed: forbidden.map((skill) => ({ id: skill.id, name: skill.name })),
    quarantinedExposed: false,
  };
  const artifact = await (await call(`/files/${run.result.file_id}/download`)).arrayBuffer();
  const bytes = Buffer.from(artifact);
  assert.equal(sha(bytes), run.result.validation.sha256);
  await writeFile(path.join(evidence, `${label}.xlsx`), bytes);
  note.reportSha256 = sha(bytes);
  const messages = await json(call)(`/conversations/${run.conversation_id}/messages`);
  note.assistantAnswer = messages.filter((m) => m.role === 'assistant').map((m) => m.content);
  await page.screenshot({ path: path.join(evidence, `${label}.png`) });
  await save();
  console.log(
    `${label}: ${expected.length} Skills verified in the raw ACP prompt; MCP report ${note.reportSha256.slice(0, 12)}`,
  );
  return note;
}

let app = await launch({ root, executable, dataDir, cdpPort: 9391 });
try {
  let call = client(app);
  const data = json(call);
  notes.firstLaunch = { backend: app.backend.health, backendExecutable: app.backend.executable };
  const ready = await data('/research/readiness/check', { method: 'POST', timeout: 180000 });
  assert.equal(ready.state, 'ready', ready.blocker);
  const model = ready.flash_models.find((id) => id.endsWith('-high')) ?? ready.flash_models[0];
  assert(model, 'No Gemini model advertised by the isolated session');
  await data('/settings', {
    method: 'POST',
    body: { provider: 'antigravity', model, mode: 'real' },
  });
  notes.model = model;

  // Import: ten approved Skills, one quarantined with a bundled script.
  for (const skill of skills) {
    const imported = await importSkill(data, [['SKILL.md', skill.text]]);
    assert.equal(imported.security.assessment, 'no_significant_findings');
    assert.equal(imported.status, 'enabled', `${skill.name} is enabled by default`);
    assert.equal(imported.hashes['SKILL.md'], skill.sha256);
    skill.id = imported.id;
  }
  assert.equal(new Set(skills.map((skill) => skill.id)).size, 10);
  const quarantined = await importSkill(data, [
    ['SKILL.md', quarantinedText],
    ['scripts/probe.py', quarantinedScript],
  ]);
  assert.equal(quarantined.status, 'quarantine');
  assert.equal(quarantined.state, 'quarantined');
  const [one, two, three, , five, , seven, , nine, ten] = skills;
  assert.equal(nine.name, ten.name);
  notes.skills = skills.map(({ index, id, name, marker, sha256 }) => ({
    index,
    id,
    name,
    marker,
    sha256,
  }));
  notes.quarantined = { id: quarantined.id, state: quarantined.state, files: quarantined.files };

  const { page } = app;
  await page.reload();
  let library = await data('/skills');
  assert.equal(library.length, 11);
  assert.equal(library.filter((skill) => skill.state === 'enabled').length, 10);
  notes.afterImport = stateOf(library);
  // 1-2. All ten enabled by default, shown as such in the UI, all offered to the runtime.
  await goto(page, /^Skills/);
  for (const skill of skills) {
    await expect(card(page, skill).first().getByText('Đang bật', { exact: true })).toBeVisible();
  }
  await goto(page, 'Chat');
  await expect(page.getByRole('button', { name: activeLabel(10) })).toBeVisible();
  const summary = await data('/skills/runtime-summary');
  assert.equal(summary.enabled, 10);
  assert.equal(summary.quarantined, 1);
  assert.deepEqual(
    summary.exposure.exposed.map((entry) => entry.id).sort(),
    skills.map((skill) => skill.id).sort(),
  );
  notes.runtimeSummaryAllEnabled = summary;
  await page.screenshot({ path: path.join(evidence, 'ui-10-enabled.png') });

  // 3. Disable Skill #3 from the Skills page; the other nine stay enabled.
  await goto(page, /^Skills/);
  await card(page, three)
    .getByRole('switch', { name: new RegExp(`^Tắt Skill ${three.name}`) })
    .click();
  await expect(card(page, three).getByText('Đã tắt bởi bạn', { exact: true })).toBeVisible();
  library = await data('/skills');
  const afterDisable = stateOf(library);
  assert.equal(afterDisable[three.id].state, 'disabled');
  for (const skill of skills.filter((item) => item !== three))
    assert.equal(afterDisable[skill.id].state, 'enabled', skill.name);
  notes.afterDisableThird = afterDisable;
  await goto(page, 'Chat');
  await expect(page.getByRole('button', { name: activeLabel(9) })).toBeVisible();
  await page.getByRole('button', { name: activeLabel(9) }).click();
  await page.screenshot({ path: path.join(evidence, 'ui-9-enabled-manager.png') });
  await page.getByRole('button', { name: activeLabel(9) }).click();

  // Real Gemini ACP + MCP task #1: nine Skills, #3 absent.
  const withoutThird = skills.filter((skill) => skill !== three);
  await runTask(app, call, 'task-1-nine-skills', withoutThird, [three]);

  // 4. Re-enable #3: same ID and hash, no reinstall.
  await goto(page, /^Skills/);
  await card(page, three)
    .getByRole('switch', { name: new RegExp(`^Bật Skill ${three.name}`) })
    .click();
  await expect(card(page, three).getByText('Đang bật', { exact: true })).toBeVisible();
  library = await data('/skills');
  assert.equal(library.length, 11, 'no reinstall');
  const restored = library.find((skill) => skill.id === three.id);
  assert.equal(restored.state, 'enabled');
  assert.equal(restored.hashes['SKILL.md'], three.sha256);
  assert.equal(library.filter((skill) => skill.state === 'enabled').length, 10);
  notes.afterReenableThird = stateOf(library);

  // 5-6. Disable #7, then delete #5. Everything else keeps its state.
  await card(page, seven)
    .getByRole('switch', { name: new RegExp(`^Tắt Skill ${seven.name}`) })
    .click();
  await expect(card(page, seven).getByText('Đã tắt bởi bạn', { exact: true })).toBeVisible();
  await card(page, five).getByRole('button', { name: 'Gỡ Skill' }).click();
  await page
    .getByRole('dialog', { name: 'Gỡ Skill' })
    .getByRole('button', { name: 'Xác nhận gỡ Skill' })
    .click();
  await expect(card(page, five)).toHaveCount(0);
  library = await data('/skills');
  const beforeRestart = stateOf(library);
  assert.equal(library.length, 10);
  assert(!(five.id in beforeRestart), 'deleted Skill is gone');
  assert.equal(beforeRestart[seven.id].state, 'disabled');
  assert.equal(beforeRestart[quarantined.id].state, 'quarantined');
  const expectedAfter = skills.filter((skill) => ![five, seven].includes(skill));
  for (const skill of expectedAfter)
    assert.equal(beforeRestart[skill.id].state, 'enabled', skill.name);
  notes.beforeRestart = beforeRestart;
  await page.screenshot({ path: path.join(evidence, 'ui-after-delete.png') });

  // 7. Restart AgentScope on the same profile; every state must be unchanged.
  await closeNormally(app, (notes.firstClose = {}));
  app = await launch({ root, executable, dataDir, cdpPort: 9392 });
  call = client(app);
  const again = json(call);
  notes.secondLaunch = { backend: app.backend.health, backendExecutable: app.backend.executable };
  library = await again('/skills');
  const afterRestart = stateOf(library);
  assert.deepEqual(afterRestart, beforeRestart, 'states persist across restart');
  notes.afterRestart = afterRestart;
  await app.page.reload();
  await goto(app.page, /^Skills/);
  await expect(card(app.page, five)).toHaveCount(0);
  await expect(card(app.page, seven).getByText('Đã tắt bởi bạn', { exact: true })).toBeVisible();
  await expect(card(app.page, quarantined).first()).toBeVisible();
  await goto(app.page, 'Chat');
  await expect(
    app.page.getByRole('button', { name: activeLabel(expectedAfter.length) }),
  ).toBeVisible();
  await app.page.screenshot({ path: path.join(evidence, 'ui-after-restart.png') });
  const readyAgain = await again('/research/readiness/check', { method: 'POST', timeout: 180000 });
  assert.equal(readyAgain.state, 'ready', readyAgain.blocker);
  await again('/settings', {
    method: 'POST',
    body: { provider: 'antigravity', model, mode: 'real' },
  });

  // Real Gemini ACP + MCP task #2 after the restart: #3 back, #5 deleted, #7 off.
  await runTask(app, call, 'task-2-after-restart', expectedAfter, [five, seven]);
  notes.finishedAt = new Date().toISOString();
  notes.result = 'PASS';
  await save();
  console.log(`Multi-Skill native verification passed. Evidence: ${evidence}`);
} catch (error) {
  notes.result = 'FAIL';
  notes.failure = String(error?.stack || error);
  await save();
  throw error;
} finally {
  await closeNormally(app, (notes.finalClose = {})).catch(() => {});
  await save();
}
