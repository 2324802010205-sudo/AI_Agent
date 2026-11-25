from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Decision:
    outcome: str
    reason: str


def contained(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        # Do not follow symlinks / junctions anywhere under the approved root.
        current = path
        while current != root and current != current.parent:
            if current.is_symlink() or (
                hasattr(current, "is_junction") and current.is_junction()
            ):
                return False
            current = current.parent
        return True
    except (ValueError, OSError):
        return False


class SkillGuard:
    def __init__(self, uploads: Path, workspace: Path):
        self.uploads = uploads
        self.workspace = workspace

    def evaluate(
        self,
        operation: str,
        target: str,
        *,
        registered: bool = False,
        destination: str | None = None,
    ) -> Decision:
        if operation == "read":
            path = Path(target)
            if registered and (
                contained(path, self.uploads) or contained(path, self.workspace)
            ):
                return Decision("allow", "Cho phép đọc tệp đã được người dùng chọn.")
            return Decision("deny", "Đã chặn đọc tệp ngoài phạm vi được cấp quyền.")
        if operation == "write":
            if contained(Path(target), self.workspace):
                return Decision("allow", "Cho phép lưu báo cáo trong workspace.")
            return Decision("deny", "Đã chặn ghi tệp ngoài workspace.")
        if operation == "network":
            if destination in {
                "api.openai.com",
                "api.anthropic.com",
                "generativelanguage.googleapis.com",
            }:
                return Decision(
                    "require_approval",
                    "Cần đồng ý trước khi gửi nội dung tới dịch vụ AI.",
                )
            return Decision("deny", "Đã chặn kết nối tới đích chưa được cấp quyền.")
        return Decision(
            "deny", "Không có quyền thực thi tiến trình hoặc thao tác đặc quyền."
        )
