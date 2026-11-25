import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable =
  process.env.AGENTSCOPE_NATIVE_EXE ||
  path.join(root, 'src-tauri/target/release/agentscope-desktop.exe');
const dataDir =
  process.env.AGENTSCOPE_NATIVE_DATA_DIR ||
  path.join(root, 'artifacts', `native-check-${randomUUID()}`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function processes() {
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='agentscope-backend.exe' OR Name='python.exe' OR Name='agy.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress",
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (!output.trim()) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}
const native = spawn(executable, [], {
  cwd: root,
  env: { ...process.env, AGENTSCOPE_DATA_DIR: dataDir },
  windowsHide: true,
  stdio: 'ignore',
});
let owned = [];
try {
  let base, token, observedBackend;
  for (let retry = 0; retry < 60; retry++) {
    if (native.exitCode !== null)
      throw new Error(`Native app exited before readiness: ${native.exitCode}`);
    const all = processes();
    const launcher = all.find((p) => p.ParentProcessId === native.pid);
    if (launcher) {
      observedBackend = launcher.ExecutablePath;
      owned = all
        .filter(
          (p) => p.ProcessId === launcher.ProcessId || p.ParentProcessId === launcher.ProcessId,
        )
        .map((p) => p.ProcessId);
      const port = /--port\s+(\d+)/.exec(launcher.CommandLine)?.[1];
      if (port) {
        try {
          token = (await readFile(path.join(dataDir, 'session-token'), 'utf8')).trim();
          base = `http://127.0.0.1:${port}`;
          const response = await fetch(`${base}/api/health`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok) break;
        } catch {}
      }
    }
    await pause(300);
  }
  assert(base && token, 'Native sidecar did not become ready');
  if (process.env.AGENTSCOPE_EXPECT_BACKEND_ROOT)
    assert(
      observedBackend
        .toLowerCase()
        .startsWith(process.env.AGENTSCOPE_EXPECT_BACKEND_ROOT.toLowerCase()),
    );
  async function api(route, body, method = 'POST') {
    const headers = { Authorization: `Bearer ${token}` };
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}/api${route}`, {
      method,
      headers,
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    assert(response.ok, `API ${route}: HTTP ${response.status} ${await response.clone().text()}`);
    return response;
  }
  // Exercise the deterministic Python spreadsheet workflow explicitly.
  await api('/settings', { provider: 'openai', model: '', mode: 'real' });
  const existingConversations = await (await api('/conversations', undefined, 'GET')).json();
  const skillForm = new FormData();
  skillForm.append(
    'files',
    new File(
      [await readFile(path.join(root, 'e2e/fixtures/spreadsheet-analysis/SKILL.md'))],
      'SKILL.md',
    ),
  );
  const skill = await (await api('/skills/import', skillForm)).json();
  assert.equal(skill.status, 'enabled');
  const fileForm = new FormData();
  fileForm.append(
    'file',
    new File([await readFile(path.join(root, 'public/samples/doanh-thu.csv'))], 'doanh-thu.csv'),
  );
  const file = await (await api('/files', fileForm)).json();
  const conversation = await (await api('/conversations')).json();
  const { run } = await (
    await api(`/conversations/${conversation.id}/messages`, {
      content: 'Analyze sample revenue and generate an Excel report',
      attachment_ids: [file.id],
      mode: 'real',
    })
  ).json();
  let task;
  for (let retry = 0; retry < 100; retry++) {
    task = (await (await api('/tasks', undefined, 'GET')).json()).find((r) => r.id === run.id);
    if (['completed', 'failed', 'blocked', 'cancelled'].includes(task.status)) break;
    await pause(100);
  }
  assert.equal(task.status, 'completed', JSON.stringify(task));
  assert.equal(task.result.rows, 9);
  const events = await (await api(`/tasks/${run.id}/events`, undefined, 'GET')).json();
  assert.deepEqual(
    events.filter((e) => e.event_type === 'tool.completed').map((e) => e.tool_name),
    ['read_spreadsheet', 'analyze_spreadsheet', 'generate_report'],
  );
  const report = Buffer.from(
    await (await api(`/files/${task.result.file_id}/download`, undefined, 'GET')).arrayBuffer(),
  );
  assert.equal(report.subarray(0, 2).toString(), 'PK');
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, 'verified-report.xlsx'), report);
  const finalConversations = await (await api('/conversations', undefined, 'GET')).json();
  assert.equal(finalConversations.length, existingConversations.length + 1);
  assert(
    existingConversations.every((old) =>
      finalConversations.some((current) => current.id === old.id),
    ),
  );
  // Simulate a shell crash: the Windows Job Object must reap the complete frozen process tree.
  native.kill();
  for (let retry = 0; retry < 30; retry++) {
    if (!processes().some((p) => owned.includes(p.ProcessId))) break;
    await pause(100);
  }
  assert(
    !processes().some((p) => owned.includes(p.ProcessId)),
    'Orphaned backend process after shell crash',
  );
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        native: true,
        sidecarReady: true,
        backendExecutable: observedBackend,
        rows: task.result.rows,
        events: events.length,
        excelDownloaded: true,
        conversationsBefore: existingConversations.length,
        conversationsAfter: finalConversations.length,
        executable,
        processTreeReaped: true,
        artifactDirectory: dataDir,
      },
      null,
      2,
    ),
  );
} finally {
  if (native.exitCode === null) native.kill();
  const survivors = processes().filter((p) => owned.includes(p.ProcessId));
  if (survivors.length)
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Stop-Process -Id ${survivors.map((p) => p.ProcessId).join(',')} -Force -ErrorAction SilentlyContinue`,
      ],
      { windowsHide: true },
    );
}
