# AgentScope real chat fix — 0.1.1

## Root cause verified from source and local profiles

The initial React mode, SendMessage request default and unsaved backend settings default were all Demo. The native default profile had no settings row, while development and migrated profiles were different databases. The UI explicitly sent Demo; execute returned through its Demo branch before provider resolution. Saving Antigravity preserved Demo. This was routing/default state, not an exception fallback.

Additional defects fixed: a fresh ACP process/session every turn; swallowed set_model errors; hardcoded model fallbacks; progress counters instead of text streaming; detached notification callbacks; spreadsheet acknowledgement on ordinary chat; stale bao-cao.xlsx discovery unrelated to tool execution; incorrect ACP permission result shape; installed CLI conflated with authenticated AI readiness.

## Runtime and data contracts

Existing explicit preferences and all historical data remain intact. Missing settings now resolve to Real and installed Antigravity (otherwise unconfigured OpenAI); blank model is resolved from session/new or session/load, never guessed. Each task stores mode, provider, actual model, user message ID and ACP session ID. Configuration changes affect subsequent tasks. Model selection errors fail before prompting.

One CLI process per conversation isolates sessions. The conversation record persists the session ID/cwd; the CLI's advertised loadSession capability controls restoration. A failed load emits session.recreated and a new real session receives completed Real history, excluding current message by ID. Repeated identical user text does not truncate context. Failed/cancelled sessions are invalidated and closed. Shutdown closes all retained sessions; native Windows Job Object contains sidecar descendants.

Only visible agent_message_chunk content is delivered. Ordered notifications are drained before completion. Assistant snapshots carry task_id (not the spreadsheet plan run_id), streaming, revision and conversation_id. Final text remains in SQLite; replay/slow HTTP responses cannot rewind the UI to an older revision. Private thought chunks are discarded before callbacks/logging.

For spreadsheet attachments, approved Skills and typed Python read/analyze/report tools retain their existing SkillGuard checks. Only actual generated reports emit report.created. The AI receives observed tool summaries. Ordinary greetings never execute those tools.

## ACP security boundary and limitations

The CLI starts with acp --sandbox --include-default-customizations=false --disable-telemetry, stdio only. No shell, skip-permissions/YOLO flags, MCP servers or client filesystem/terminal capabilities are exposed. Unknown ACP client RPCs return method-not-found. Permission requests deny by default. Only the exact registered attached path, read_file tool identity, read kind and path-only input can pass the existing SkillGuard read policy; writes, commands, unknown tools and unattached paths are rejected. Offered allow_once/reject_once option IDs are used with the ACP selected outcome schema; absent matching options yields cancelled.

ACP permission events cover requests actually received by this client. Antigravity CLI owns its internal tools, cached authentication, network and global configuration. Some CLI-owned operations may not request client authorization. The --sandbox option and application policy have not been independently verified as complete OS isolation; AgentScope does not claim they are. No untrusted scripts/customizations are intentionally loaded; per-conversation working directories are isolated under workspace/acp. Native Job Object is lifecycle containment, not a filesystem/network sandbox. Pause gates application work and response delivery; it cannot suspend the CLI's internal compute. Use external OS isolation when that stronger boundary is required.

Protocol references: https://antigravity.google/docs/cli/acp/ ; https://antigravity.google/docs/permissions?tab=cli ; https://agentclientprotocol.com/protocol/v1/session-setup ; https://agentclientprotocol.com/protocol/v1/tool-calls .

## Verification

Actual locally authenticated Antigravity CLI 1.5.9 returned six discovered model IDs and current model gemini-3.8-flash-high. A live prompt containing chào returned “Xin chào! Tôi có thể giúp gì cho bạn hôm nay?” in two visible chunks. The same session answered the follow-up language question “Tiếng Việt.” Total two-turn probe duration: 16.41 seconds. No quota blocker occurred in this probe. These are provider observations, separate from mocked unit tests. Native packaging/UI results are recorded in the Desktop companion report.


Final verification: 69 backend regressions passed; one opt-in paid pytest case skipped in the default suite. Separate authenticated probes and native UI tests succeeded with four real chat turns, a real connection test, actual same-session reuse and restart restoration. The final installed UI was observed while streaming revision 1 (80 characters) and displaying the receiving label; all tasks completed. Native Debug, Release and installed-package spreadsheet/lifecycle checks passed, as did 9 frontend tests, TypeScript/Vite and browser E2E. No quota blocker occurred. Full evidence and exact changed files are in the Desktop companion docs/REAL_CHAT_VERIFICATION.md. Model discovery now preserves previously observed authentication; failures still replace status with an explicit error.


## 0.1.2 follow-up (2026-11-17)

Re-investigation of the reported "DEMO · Dữ liệu sự kiện tổng hợp" reply to `chào`:

- The native profile (`%LOCALAPPDATA%\com.agentscope.desktop\agentscope.sqlite3`) has no settings row. Its two Demo tasks (2026-11-16 17:01 UTC and 2026-11-17 04:46 UTC, the `chào` one) were recorded with `mode=demo, provider=None` by the 0.1.0 build, whose React state, `SendMessage.mode` default and unsaved settings default were all `demo` (Backend `39e9981`, Desktop `1af6e03`). Every task created by 0.1.1 or later in the same profile is `real/antigravity/gemini-3.8-flash-high` with genuine replies. The Desktop and Start-menu shortcuts point to `AgentScope-Desktop\artifacts\installed-verification\agentscope-desktop.exe`. Old Demo conversations remain visible in history, but they are historical records and are labeled Demo.
- The remaining misleading UI element was the title bar's "Agent đã kết nối", shown whenever the local FastAPI service answered. It now reports the observed AI state (backend not connected / AI not verified / ACP ready, no AI reply yet / AI replied / AI connection error / explicit Demo).
- The uncommitted pre-warm work is preserved and covered by tests. `POST /api/antigravity/prepare` starts one empty, isolated ACP session (no prompt or user content) for the current Real/Antigravity routing key. `POST /api/conversations` claims it for exactly one new conversation. Mismatched settings or Demo discard it, and shutdown closes unclaimed sessions. `session/set_model` is skipped only when the session already reports the selected model as current. Stream persistence is coalesced (~50 ms). The final `message.created` snapshot always carries the complete text with a higher revision. Per-task timing metadata is stored on the task. The Desktop UI does not call `prepare` yet, so it is an optional latency optimization.
- Opt-in live check: `AGENTSCOPE_LIVE_ACP=1 pytest -k live` (uses quota).

## Update: the permission boundary is now measured (0.1.4)

The statement above that some CLI-owned operations may not request authorization is now verified for file reads. With Antigravity CLI 1.5.10, a read under a directory listed in the CLI's own `trustedWorkspaces` (user-level `~/.gemini/antigravity-cli/settings.json`) runs without any `session/request_permission`, so SkillGuard cannot deny it. AgentScope reports this as `security.boundary` and `security.unmediated_tool` events. See `docs/PROMPT_INJECTION_LAB.md`.
