# AgentScope workspace separation

The two sibling directories are independent Git repositories on `main`. No Git repository/history existed before restructuring; baseline commits preserve the existing source implementation (Desktop `47cac87`, Backend `8c63d3a`). All subsequent work is ordinary forward commits. No remotes, pushes, force operations or history rewrites were performed.

- Desktop owns React/TypeScript/Tailwind/Vite, Tauri/Rust, icons, frontend tests and installer integration.
- Backend owns Python runtime, dependencies/environment, its tests, data relocation utility, samples and portable PyInstaller specification.
- Native development discovers the sibling Backend checkout/environment. Production copies only the compiled backend executable into ignored Tauri binary staging.
- Each project has its own README, .gitignore, CI and setup/build scripts. The optional multi-root `AgentScope.code-workspace` hides generated directories without deleting them; a tracked equivalent is included in Desktop.
- The original `C:\Users\ADMIN\AgentScope-Desktop` remains as a preserved legacy location for original data, old environments/caches and installed build tools. It is no longer the source workspace. The installed MSVC toolchain currently resolves to its `.buildtools` directory.
- Development data was copied to Backend/.agentscope using SQLite backup and controlled metadata path relocation. Three conversations, nine messages, six files, three Skills, five tasks and 68 audit rows were preserved. The original profile was retained. Historical audit rows and copied file hashes were compared exactly. Native app-local data and OS provider credentials were not migrated or deleted.
- Integration, native and installed-application verification use ignored isolated test profiles, not the preserved user data.

See `VERIFICATION.md` for actual checks, final commits, commands and installer location. Open `AgentScope.code-workspace` from this directory in VS Code.
