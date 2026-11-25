import argparse
import json
from pathlib import Path
from agentscope.migrations import relocate_data

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Copy AgentScope data and relocate metadata, keeping the source untouched. Stop the old backend first."
    )
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()
    print(
        json.dumps(
            relocate_data(args.source, args.destination), ensure_ascii=False, indent=2
        )
    )
