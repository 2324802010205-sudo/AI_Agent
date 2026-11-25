# AgentScope Skill package format

Import a `SKILL.md`, a folder, or a ZIP containing one Skill. AgentScope validates the package, scans its contents, and keeps a SHA-256 manifest and an import snapshot. It uses the Skill name, description, and Markdown instructions to match a task.

## Frontmatter

The [Agent Skills specification](https://agentskills.io/specification#frontmatter) requires `name` and `description`. A Skill can contain only those fields and its Markdown instructions.

| Field | Required | Purpose |
| --- | --- | --- |
| `name` | Yes | Lowercase Unicode letters, digits and single hyphens. Maximum 64 characters. |
| `description` | Yes | One to 1,024 characters describing the Skill and when to use it. |
| `license` | No | A license name or reference to a bundled license file. |
| `compatibility` | No | Up to 500 characters describing the Skill's environment requirements. |
| `metadata` | No | A map from strings to strings. |
| `allowed-tools` | No | An experimental, space-separated tool declaration recorded in the import and selection evidence. |

AgentScope also accepts the comma-separated and YAML list forms documented by [Claude Code](https://code.claude.com/docs/en/skills#frontmatter-reference). Claude Code applies its own turn-scoped grants. In AgentScope, `allowed-tools` and any legacy `capabilities` entries are advisory. Other frontmatter extensions do not configure the runtime.

## Spreadsheet example

```markdown
---
name: sales-summary
description: Summarize sales by region.
---

Use the attached workbook and report recorded totals.
```

AgentScope registers `read_spreadsheet`, `analyze_spreadsheet`, and `generate_report` as application tools. The runtime checks the registered operation and arguments, current task attachments, and policy before each call. The report's authorized destination is inside the AgentScope workspace. Tools exposed by the research MCP broker also follow that broker's session and resource policy.

## Packaging and execution

Every packaged member must be under the folder containing `SKILL.md`. AgentScope normalizes uploaded wrapper folders and stores each import under an internal identifier. Keep the parent directory name consistent with `name` when publishing a portable Skill. The importer rejects unsafe paths and links, encrypted entries, suspicious compression ratios, and packages over 20 MB or 200 files.

Text-only activation uses the verified Skill instructions where permitted by runtime policy. Bundled executables are flagged for separate, isolated authorization.

AgentScope fingerprints normalized member paths and their SHA-256 hashes. An identical reimport reuses the installed ID and its current state. Different contents have distinct fingerprints. A new eligible revision can supersede the previous revision. The library groups older identical copies under one revision and offers individual removal in the details view. Removal preserves historical import snapshots and task records.
