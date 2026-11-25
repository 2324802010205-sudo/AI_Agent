# AgentScope-Backend

The [Vietnamese Skill-boundary evaluation](docs/BOUNDARY_EVALUATION_VI_2026_11_18.md) records real contained Gemini Flash trials with marker and adjusted-revenue Skills, aggregate and raw-row grounding, preserved responses and independent workbook validation. Run `scripts/boundary-evaluation.py --data-dir .boundary-evaluation --data-view aggregates --run` with the existing authenticated AppContainer lab, then repeat with `--data-view raw_rows`. Each invocation starts nine fresh sessions. The isolated lab interface exports the Vietnamese report, evidence JSON and hash-verified Python-generated workbooks.

Version 0.1.6 adds a separate [answer-integrity evaluation and experimental VM research workflow](docs/SECURITY_EVALUATION_VI_0_1_6.md). The ordinary authenticated ACP control is available without a new API key. Adversarial Skill delivery on the physical host remains locked because a complete zero-tool ACP boundary is not verified. The allowlisted arithmetic broker also fails closed unless its live AppContainer checks pass; its Windows startup has not passed on this machine. See [VM provisioning requirements](docs/RESEARCH_VM_SETUP.md).

Independent Python FastAPI project for the AgentScope runtime. It runs/tests/builds without React, Node, Rust, Tauri or a Desktop checkout. The paired desktop consumes its HTTP/WebSocket API and compiled Windows sidecar artifact.

## Chat-integrated experiments (0.2.0)

`agentscope/experiments/` runs one legitimate task under separately isolated conditions (no-Skill baseline, SkillGuard OFF, SkillGuard ON) through the AppContainer lab with native MCP workbook tools, and records each condition as an ordinary task so its events stream to the Desktop. Routes: `GET/POST /api/research/readiness[/check|/signin]`, `GET /api/research/policy`, `GET/POST /api/experiments`, `GET /api/experiments/{id}`, `/cancel`, `/conditions/{c}/evidence`, `/conditions/{c}/report`, `/export`. Mandatory protections are identical in every condition; only optional SkillGuard defenses differ. See `docs/CHAT_RESEARCH_WORKFLOW_VI.md`.

## Security boundary in 0.1.5

ACP text chat is pinned to the CLI's reported Default Mode before prompting. Normal Chat with Antigravity and a sales workbook (`.xlsx` or `.csv`) uses the verified AppContainer and workbook MCP tools. The app requests permission before sending task data to Gemini and validates the generated XLSX against the original workbook and MCP receipt before publishing it. ACP errors appear in the conversation. The Python-only spreadsheet workflow remains available when using an unconfigured cloud provider, with local execution shown in the activity log. Cloud API Skills remain fenced user-role data under the typed tool policy. See [the Vietnamese engineering and research report](docs/AUTO_MODE_SECURITY_REPORT_VI.md) for historical evidence and compatibility changes.

## Architecture

- `agentscope/api.py`: authenticated loopback REST, one-time WebSocket tickets, replay and shutdown.
- `runtime.py`: task orchestration, conversation context, Skill discovery, typed tool calls, approval, pause/cancel and clearly labeled synthetic demo.
- `skills.py`: SKILL.md/YAML validation, archive/path checks, quarantine, approval, updates and SHA-256 integrity.
- `policy.py`: allow/deny/require-approval decisions; no arbitrary shell capability.
- `tools.py`: CSV/XLSX/XLS readers, bounded descriptive statistics and formatted Excel reports.
- `providers.py`: OpenAI/Claude/Gemini SSE adapters and OS-backed keyring; Codex explicitly unavailable.
- `storage.py`, `models.py`: SQLite/WAL persistence, normalized execution-event records and sanitization.
- `migrations.py`: optional non-destructive data relocation. Historical audit paths are preserved as observed.
- `tests/`: unit, integration, provider protocol, auth, denial, cancellation, WebSocket and migration tests.
- `samples/`: the revenue CSV, spreadsheet Skill and safe synthetic security-test Skill.

Production Skill HTTP handlers live in `agentscope/skill_routes.py`. They share import limits with `SkillRegistry`, which verifies the manifest and returns the exact bytes it hashed. The host Antigravity adapter keeps its existing Skill delivery restriction.

The isolated lab keeps its HTTP contract in `lab/isolated_routes.py`, trial scheduling and persistence in `lab/injection_lab.py`, native ACP orchestration in `lab/phase4.py`, ACP/MCP trace matching in `lab/native_evidence.py`, and independent Excel checks in `lab/report_validation.py`. The source-checkout runner `lab/skill_lifecycle.py` uses these modules and the existing AppContainer launcher. Its operator switches authorize the bundled reporting fixture and optionally one deferred, digest-pinned check. Each run writes its transcript and process evidence under `AgentScopeLab/runs`. The Desktop evidence panel reads a packaged archive summary. [Verified execution and operator commands](docs/SKILL_FORMAT_EXECUTION_VI_2026_11_18.md) · [Report-only comparison and optional-denial recovery](docs/OPTIONAL_FORMAT_PHASE9_VI.md)

## Setup and standalone development

Python 3.10+; Windows is required only for the Windows frozen executable/OS keyring target. From this project directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1
# If needed, pass -Python C:\path\to\python.exe
.\.venv\Scripts\python.exe -m agentscope --data-dir .agentscope --port 8765
```

Manual equivalent: `python -m venv .venv`, then `.\.venv\Scripts\python.exe -m pip install -e ".[dev]"`. The backend owns this virtual environment. `pyproject.toml` declares package dependencies; `requirements.lock.txt` records the verified Windows dependency versions (install those before `pip install -e . --no-deps` for an exact environment).

Every REST endpoint needs the ephemeral Bearer credential in `<data-dir>/session-token`. Browser development allows the configured Vite/Tauri origins only. Desktop development connects on port 8765 with the token entered in Settings. Native Tauri supplies its own random session/port and app-local data profile automatically. Keep secrets out of `.env`; `.env.example` contains configuration templates only. API keys are stored in Windows Credential Manager/another explicitly supported OS keyring, never SQLite.

## Tests and formatting

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
.\.venv\Scripts\python.exe -m black --check agentscope tests scripts
```

Tests use temporary SQLite/data directories and fake provider SSE responses; no paid API calls occur. No Desktop source, fixture path or environment is required. The initial standalone suite covers all prior runtime features; migration tests additionally verify metadata relocation without rewriting source data or historical audit evidence.

## Real spreadsheet workflow

Import `samples/spreadsheet-analysis/SKILL.md`, inspect its quarantined preview, approve it, then upload `samples/doanh-thu.csv` and send a real-mode task. Without cloud credentials/model configuration the backend explicitly uses a deterministic Python workflow: read -> analyze -> generate report. It computes real data and saves XLSX in the approved workspace. A configured cloud adapter requires approval before transmitting conversation/tool data. Do not claim a tool succeeded until `tool.completed` and observed results exist.

Default limit: 20 MB/file, five attachments/request, 50,000 rows and 256 columns. Read the first worksheet; cached formula values only, no macros or formula execution. Report strings remain text to prevent formula injection. Application policy is not an OS sandbox. Imported Skills cannot override policies, run scripts or add tools. Demo security cases evaluate synthetic requests without starting processes or creating network connections.

## Independent Windows artifact build

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-sidecar.ps1
.\.venv\Scripts\python.exe scripts/check-sidecar.py
```

The tracked portable `agentscope-backend.spec` is the PyInstaller specification. Build runs backend tests and produces `dist/agentscope-backend.exe`. `check-sidecar.py` starts that actual executable, checks readiness, imports/approves the sample Skill, performs real CSV analysis, validates the downloaded workbook and verifies graceful shutdown. Only this EXE is passed to Desktop packaging; the backend source tree is never copied into Desktop. Both repositories can release independently, provided their API contracts remain compatible.

## Data and relocation

Data files live outside SQLite binary blobs: `uploads/`, `workspace/`, `skills/`, alongside `agentscope.sqlite3`. The CLI defaults to `.agentscope` in its current directory; native app data uses the unchanged application identifier `com.agentscope.desktop`. Set `AGENTSCOPE_DATA_DIR` or pass `--data-dir` for another profile. Do not commit these directories, session tokens, databases, environment folders or binaries.

To relocate an old development profile, stop its backend and use:

```powershell
.\.venv\Scripts\python.exe scripts/migrate-data.py --source C:\old\.agentscope --destination C:\new\.agentscope
```

The destination must not exist. The tool copies files, uses SQLite backup, updates only file/Skill registry paths under the old root, and leaves all source data and historical audit records unchanged. Native app-local data is not moved by repository restructuring. Logs redact common secret fields/patterns; free-text data can still contain sensitive material. Retention/migrations for future database schema versions remain a separate concern.

## Git and remaining limits

This is a separate Git repository, not a submodule or nested Desktop repository. No Git history existed before restructuring. A baseline commit preserves the prior implementation and subsequent commits record path/build changes. No remotes were created or published. CI validates the backend independently; the Windows build workflow uploads a compiled artifact, never commits it.

Direct cloud API credentials have not been supplied. Antigravity ACP has been verified with the locally authenticated CLI; see `docs/REAL_CHAT_FIX.md`. Codex remains unavailable. These are existing limitations, not simulated successful integrations. See paired workspace `VERIFICATION.md` for actual local check results.

## Test scratch isolation

The interrupted run failed before application fixtures ran: Windows denied access to the inherited `TEMP/pytest-of-ADMIN` directory and an old `.pytest_cache`. The repository now sets `--basetemp=.test-tmp -o cache_dir=.pytest_cache-local` in `pyproject.toml`. Pytest creates its scratch directory automatically; both locations are ignored and hidden in the multi-root Explorer. No Windows system ACL, security setting or application business rule is changed by this fix. The suite passes from the backend repository using its own environment.

## REST and event endpoints

All requests require the current Bearer session. JSON is used except the multipart import/upload routes.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Authenticated readiness |
| GET/POST | `/api/conversations` | List/create conversations |
| GET/POST | `/api/conversations/{id}/messages` | History and task submission |
| POST | `/api/files` | Multipart spreadsheet upload (`file`) |
| GET | `/api/files/{id}/download` | Actual input/output bytes |
| GET | `/api/tasks`, `/api/tasks/{id}/events` | Persistent tasks and trace |
| POST | `/api/tasks/{id}/control` | Pause, resume, cancel |
| GET/POST | `/api/skills`, `/api/skills/import` | Registry and quarantined multipart import (`files`) |
| POST/DELETE | `/api/skills/{id}/approve`, `/disable`, `/api/skills/{id}` | Approval, disable, removal |
| GET/POST | `/api/settings` | Provider configuration, OS-backed secret storage |
| POST | `/api/settings/test`, `/api/security/demo` | Explicit provider test, synthetic policy scenarios |
| POST | `/api/approvals/{id}`, `/api/ws-ticket` | Permission resolution and one-use WebSocket ticket |
| GET | `/api/audit` | Sanitized persistent events |
| WS | `/ws/runs/{id}?ticket=...` | History replay followed by real-time events |
| POST | `/api/shutdown` | Authenticated lifecycle shutdown |


## Real Antigravity chat (0.1.1)

Fresh profiles default to Real AI and select Antigravity when `agy` is installed. Existing saved mode/provider/model values are preserved. In Settings select Antigravity, refresh the actual model list, save the configuration, and optionally test the connection (uses model quota). A blank model means the current model returned by the actual ACP session. Installation and a successful ACP handshake alone do not prove a working authenticated model response.

`POST .../messages` may omit `mode`; the backend snapshots saved mode/provider/model into the task. Demo is explicit and no ACP error changes a task into Demo. Regular chat needs no Skill or attachments. Streaming visible text is persisted and sent as `provider.response.streaming` message snapshots; private thoughts are discarded. Each conversation has an isolated CLI process/session, persisted session mapping, supported session restore, and observed history replay if restoration is unavailable. Up to four live sessions are retained; idle sessions are closed as needed.

The standard test suite uses mocked transports. To intentionally run the paid authenticated test: `$env:AGENTSCOPE_LIVE_ACP='1'; .\.venv\Scripts\python.exe -m pytest tests/test_antigravity_acp.py -k live_authenticated -q`. Unset the variable afterward. Model/auth/quota/timeout failures are surfaced, never converted into fabricated replies.

See [the Skill format guide](docs/SKILL_FORMAT.md) for a standards-compliant example and the runtime authorization rules. The spreadsheet tools are registered by AgentScope. Skill metadata is advisory.
