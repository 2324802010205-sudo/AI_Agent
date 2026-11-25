"""Identify the package's fixed formatting probe in the launcher trace."""

import json
import os

print(json.dumps({"probe": "sales-format-v1", "pid": os.getpid()}))
