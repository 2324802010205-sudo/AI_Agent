# AgentScope restructuring verification

Verified locally on 2026-11-17 (Asia/Bangkok). This is a continuation of the existing implementation; no UI redesign or application rewrite was performed.

## 1. Final structure

```text
AgentScope-Workspace/
  AgentScope.code-workspace
  REORGANIZATION.md
  VERIFICATION.md
  data-migration-report.json
  AgentScope-Desktop/
    .git/  .github/  .vscode/
    src/  public/  e2e/  docs/  scripts/  src-tauri/
    package.json  package-lock.json  README.md
  AgentScope-Backend/
    .git/  .github/  .vscode/
    agentscope/  tests/  samples/  scripts/
    pyproject.toml  requirements.lock.txt  agentscope-backend.spec  README.md
```

Generated node_modules, virtual environments, caches, data profiles, build/target/dist, executables and test reports remain on disk where appropriate but are ignored and hidden. Desktop has no tracked Python implementation files. The two source projects and their .git directories are siblings.

## 2. Work completed

- Preserved baseline commits and all interrupted working-tree changes; completed ordinary forward commits. No remote was added or pushed.
- Kept backend setup/tests/PyInstaller specification independent of Desktop. Updated fixture and smoke-test paths.
- Updated native development to discover the sibling backend environment, with documented overrides. Production collects only a compiled executable artifact.
- Kept Windows Job Object and parent-watch lifecycle controls intact; verified actual process cleanup.
- Completed multi-root Explorer exclusions, independent READMEs, API/architecture documentation and separate CI definitions.
- Added native/installed/debug verification and browser reconnect/navigation regression checks; product UI source/assets remain identical to their preserved baseline.

## 3. Windows pytest permission issue

The inherited global TEMP/pytest-of-ADMIN and old .pytest_cache directories produced WinError 5 before fixtures could run. pyproject.toml now sets --basetemp=.test-tmp and cache_dir=.pytest_cache-local. These new project-local scratch directories are created by pytest and ignored. The fix does not alter system permissions/security or application business logic.

## 4. Executed checks

| Check | Result |
| --- | --- |
| Standalone backend pytest tests -q | PASS: 46 tests |
| Python pip check and Black checks | PASS |
| Frontend component tests | PASS: 6 tests |
| TypeScript and Vite production build | PASS |
| Frontend formatting / Rust formatting | PASS |
| Browser spreadsheet E2E | PASS: 1 scenario; all navigation pages, real report/download, actual event timeline, forced WebSocket reconnect/replay, previous-task plan regression |
| Independent PyInstaller build | PASS |
| Frozen executable smoke test | PASS: readiness, quarantine/approval, actual CSV analysis, valid XLSX download, graceful shutdown |
| Native release build and NSIS packaging | PASS |
| Native release workflow | PASS: 9 rows, 20 real events, Excel download, process-tree cleanup after simulated crash |
| Installed executable, first launch | PASS: actual installer installation, auto backend, real workflow, cleanup |
| Installed executable, second launch | PASS: previous conversation retained, new conversation/report added, cleanup |
| Installed window controls | PASS: connected window, maximize, minimize, restore, normal close |
| Normal-close process observation | PASS: desktop PID 17488, launcher 27536 and child 13012 all exited |
| Debug native build and workflow | PASS: discovered sibling Backend/.venv/Scripts/python.exe, actual spreadsheet/report, process-tree cleanup |
| Downloaded native/installed workbook parsing | PASS: expected worksheets and 9 data rows using openpyxl |
| Data preservation | PASS: counts, audit equality and copied file hashes |
| Git checks | PASS: independent main branches, clean trees, no generated/private tracked files |

Native workflow checks launch the real application and exercise its automatically started backend through authenticated APIs. The browser test exercises the complete React UI workflow; installed-window controls/connection/normal-close were additionally inspected through Windows UI automation.

## 5. Data preservation

```json
{
  "records_preserved": {
    "conversations": 3,
    "messages": 9,
    "files": 6,
    "skills": 3,
    "tasks": 5,
    "approvals": 0,
    "settings": 1,
    "events": 68
  },
  "historical_audit_exactly_equal": true,
  "file_hashes_match": true,
  "original_profile_retained": "C:\\Users\\ADMIN\\AgentScope-Desktop\\.agentscope",
  "new_development_profile": "C:\\Users\\ADMIN\\AgentScope-Workspace\\AgentScope-Backend\\.agentscope"
}
```

Historical audit paths were left as originally observed. Only file/Skill metadata paths were relocated. The original development profile, native app-local profile and OS credential storage were not deleted. Automated checks use separate ignored profiles.

## 6. Git repositories

### Desktop

Branch: main; working tree: clean; remotes: none.

```text
f455503 build: preserve sibling backend discovery and native packaging
6f26093 refactor: separate desktop workspace and integration contracts
47cac87 chore: preserve existing desktop implementation
```

### Backend

Branch: main; working tree: clean; remotes: none.

```text
e5a8861 build: package backend as an independent sidecar artifact
6d73978 refactor: isolate backend development and test data
8c63d3a chore: preserve existing backend implementation
```

No Git history existed before the baseline commits. Both baselines remain intact. New commits record the already-working code separation, test isolation and sidecar integration; no resets, cleans or force pushes were used.

## 7. Start the backend

```powershell
cd C:\Users\ADMIN\AgentScope-Workspace\AgentScope-Backend
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1
.\.venv\Scripts\python.exe -m agentscope --data-dir .agentscope --port 8765
```

The .agentscope profile is the preserved migrated development profile. For tests use another --data-dir. Session credentials stay in that local profile and must not be committed.

## 8. Start Desktop

```powershell
cd C:\Users\ADMIN\AgentScope-Workspace\AgentScope-Desktop
npm.cmd ci
npm.cmd run desktop:dev
```

Native development starts the sibling backend automatically on an ephemeral loopback port. For independent browser development run npm.cmd run dev and enter the separately running backend session in Settings. Open AgentScope.code-workspace for two clearly separated VS Code roots.

## 9. Build the installer

```powershell
cd C:\Users\ADMIN\AgentScope-Workspace\AgentScope-Backend
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-sidecar.ps1
.\.venv\Scripts\python.exe scripts/check-sidecar.py
cd ..\AgentScope-Desktop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -BackendArtifact ..\AgentScope-Backend\dist\agentscope-backend.exe
npm.cmd run test:native
```

The exact artifact-input packaging path above was executed successfully. Alternatively build-windows.ps1 without -BackendArtifact delegates building the sibling source checkout to its own build script. The native scripts activate installed MSVC/SDK tools for the current process only.

## 10. Verified artifacts and limits

Installer: `C:\Users\ADMIN\AgentScope-Workspace\AgentScope-Desktop\src-tauri\target\release\bundle\nsis\AgentScope_0.1.0_x64-setup.exe`
Installer size: 22,352,143 bytes.
Installer SHA-256: `3e5f86fe16f4da30bded7ee016db4c9883b79d56fd6be947a68fc386efec25b0`

Installed verification copy: `C:\Users\ADMIN\AgentScope-Workspace\AgentScope-Desktop\artifacts\installed-verification\agentscope-desktop.exe`
Backend SHA-256 (independent artifact, Tauri staging, release sidecar and installed sidecar all match): `56435bab6d5bbff375ffdd8664825e332a0907552c158e8fbe5cd9af1654fd9a`

- Installer was actually installed and its executable was launched/tested, not merely generated. The isolated installed copy and test profiles are retained.
- Live cloud-provider credentials were not supplied, so paid/live provider calls were not run; adapter protocol/error/cancellation fixtures passed. Codex remains explicitly unavailable.
- Installer is unsigned and was tested on this Windows host, not on a separate clean VM.
- CI workflows are configured but were not run remotely; no repository was published.
- Existing library deprecation/optional packaging warnings remain non-failing. Application policy is not an OS sandbox.
- Legacy C:\Users\ADMIN\AgentScope-Desktop contains preserved original data, old environments/caches and the registered .buildtools installation; it is no longer the source workspace.
