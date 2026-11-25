from pathlib import Path
import pytest
from agentscope.migrations import relocate_data
from agentscope.models import Event
from agentscope.storage import Store


def test_data_relocation_preserves_source_and_audit(tmp_path):
    source = tmp_path / "before"
    source.mkdir()
    (source / "uploads").mkdir()
    original_file = source / "uploads/input.csv"
    original_file.write_bytes(b"name,value\nA,10\n")
    store = Store(source)
    store.put("files", {"id": "file", "path": str(original_file), "name": "input.csv"})
    store.put("conversations", {"id": "conversation", "title": "preserved"})
    store.event(
        Event(
            run_id="old-run",
            event_type="tool.completed",
            message="Observed at original path",
            arguments={"path": str(original_file)},
        )
    )
    before_events = store.events()
    target = tmp_path / "after"
    result = relocate_data(source, target)
    migrated = Store(target)
    assert result["record_counts"]["conversations"] == 1
    assert (
        Path(migrated.get("files", "file")["path"]).read_bytes()
        == original_file.read_bytes()
    )
    assert store.get("files", "file")["path"] == str(original_file)
    assert migrated.events() == before_events
    assert not (target / "session-token").exists()


def test_data_relocation_refuses_overwrite(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    Store(source)
    target = tmp_path / "existing"
    target.mkdir()
    marker = target / "keep.txt"
    marker.write_text("keep")
    with pytest.raises(ValueError):
        relocate_data(source, target)
    assert marker.read_text() == "keep"
