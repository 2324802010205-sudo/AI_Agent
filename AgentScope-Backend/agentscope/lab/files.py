"""Bounded observer file handles: reject links/replacements before privileged I/O."""

from contextlib import contextmanager
import os
from pathlib import Path
import stat


def identity(path: Path):
    value = path.stat(follow_symlinks=False)
    if (
        stat.S_ISLNK(value.st_mode)
        or value.st_nlink != 1
        or not stat.S_ISREG(value.st_mode)
    ):
        raise PermissionError("Research resource must be one regular non-linked file")
    return value.st_dev, value.st_ino


@contextmanager
def document_handle(path: Path, expected, *, write=False):
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        import msvcrt

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [
            wintypes.LPCWSTR,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.LPVOID,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.HANDLE,
        ]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        # Sharing=0 prevents a competing replacement/link while the validated
        # handle is used. OPEN_EXISTING never truncates before identity checks.
        handle = kernel.CreateFileW(
            str(path),
            0x80000000 | (0x40000000 if write else 0),
            0,
            None,
            3,
            0x00200000,
            None,
        )
        if handle == wintypes.HANDLE(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            descriptor = msvcrt.open_osfhandle(
                handle, os.O_BINARY | (os.O_RDWR if write else os.O_RDONLY)
            )
        except BaseException:
            kernel.CloseHandle(handle)
            raise
    else:
        descriptor = os.open(
            path, (os.O_RDWR if write else os.O_RDONLY) | getattr(os, "O_NOFOLLOW", 0)
        )
    with os.fdopen(descriptor, "r+b" if write else "rb") as stream:
        actual = os.fstat(stream.fileno())
        # lstat plus the opened-handle identity reject symlinks, hard links and
        # swapped files. Parent directories are observer-owned in the guest.
        if (
            identity(path) != expected
            or (actual.st_dev, actual.st_ino) != expected
            or actual.st_nlink != 1
        ):
            raise PermissionError("Research resource identity changed")
        yield stream


def witness_state(path: Path, expected):
    try:
        with document_handle(path, expected) as stream:
            data = stream.read()
        from .evidence import digest

        return {"exists": True, "sha256": digest(data), "bytes": len(data)}
    except FileNotFoundError:
        return {"exists": False, "sha256": None, "bytes": 0}
    except (PermissionError, OSError):
        return {
            "exists": path.exists(),
            "sha256": None,
            "identity_changed_or_unavailable": True,
        }
