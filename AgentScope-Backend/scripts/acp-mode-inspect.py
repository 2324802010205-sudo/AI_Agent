"""Observe session/new metadata without prompts or mode/configuration changes."""

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from agentscope.antigravity_acp import AntigravityAcpAdapter  # noqa: E402


async def main(output):
    settings_path = AntigravityAcpAdapter.cli_settings_path()
    before = settings_path.read_bytes()
    settings = json.loads(before)
    report = {
        "kind": "live_handshake_only",
        "cli_version": AntigravityAcpAdapter.get_version(),
        "settings_mode_fields": {
            k: v for k, v in settings.items() if "mode" in k.lower() and k != "model"
        },
        "prompts": 0,
        "mode_switches": 0,
        "sessions": [],
    }
    adapter = AntigravityAcpAdapter()
    try:
        await adapter.start()
        initialized = await adapter.initialize()
        report["agent"] = initialized.get("agentInfo")
        for _ in range(2):
            result = await adapter.new_session(ROOT)
            report["sessions"].append(
                {
                    k: v
                    for k, v in result.items()
                    if k in ("modes", "models", "configOptions")
                }
            )
    finally:
        await adapter.close()
    report["global_settings_unchanged"] = (
        hashlib.sha256(before).digest()
        == hashlib.sha256(settings_path.read_bytes()).digest()
    )
    output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"Saved {len(report['sessions'])} mode observations; prompts=0; settings unchanged={report['global_settings_unchanged']}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    asyncio.run(main(parser.parse_args().output))
