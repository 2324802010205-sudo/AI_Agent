import argparse
import os
import threading
import time
from pathlib import Path

import uvicorn

from .api import create_app
from .config import Config


def main():
    parser = argparse.ArgumentParser(description="AgentScope local backend")
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("AGENTSCOPE_PORT", "8765"))
    )
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--parent-pid", type=int)
    args = parser.parse_args()
    config = Config(args.data_dir)
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(config),
            host="127.0.0.1",
            port=args.port,
            log_level="warning",
            access_log=False,
            timeout_graceful_shutdown=15,
        )
    )

    def watch_shutdown():
        config.stop.wait()
        server.should_exit = True

    threading.Thread(target=watch_shutdown, daemon=True).start()
    if args.parent_pid:

        def watch_parent():
            # On Windows, check process existence via a handle (os.kill(pid,0) is not safe there).
            if os.name == "nt":
                import ctypes
                from ctypes import wintypes

                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel.OpenProcess.argtypes = [
                    wintypes.DWORD,
                    wintypes.BOOL,
                    wintypes.DWORD,
                ]
                kernel.OpenProcess.restype = wintypes.HANDLE
                kernel.GetExitCodeProcess.argtypes = [
                    wintypes.HANDLE,
                    ctypes.POINTER(wintypes.DWORD),
                ]
                kernel.CloseHandle.argtypes = [wintypes.HANDLE]
                handle = kernel.OpenProcess(0x1000, False, args.parent_pid)
                if not handle:
                    server.should_exit = True
                    return
                try:
                    while not server.should_exit:
                        code = wintypes.DWORD()
                        if (
                            not kernel.GetExitCodeProcess(handle, ctypes.byref(code))
                            or code.value != 259
                        ):
                            server.should_exit = True
                            return
                        time.sleep(1)
                finally:
                    kernel.CloseHandle(handle)
            else:
                while not server.should_exit:
                    try:
                        os.kill(args.parent_pid, 0)
                    except ProcessLookupError:
                        server.should_exit = True
                        return
                    time.sleep(1)

        threading.Thread(target=watch_parent, daemon=True).start()
    print(f"AgentScope backend: http://127.0.0.1:{args.port}", flush=True)
    print(
        f"Development session credential: {config.root / 'session-token'}", flush=True
    )
    server.run()


if __name__ == "__main__":
    main()
