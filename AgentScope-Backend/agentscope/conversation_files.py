"""Conversation workbook references, including turns saved by older clients."""

FILE_FIELDS = ("id", "name", "size", "type")
MAX_SELECTED = 5


def public_file(file):
    return {key: file[key] for key in FILE_FIELDS}


def can_use_file(file, conversation_id):
    return file.get("conversation_id") in (None, conversation_id)


def attachment_state(store, conversation_id, *, connection=None):
    saved = store.get("conversation_files", conversation_id, connection=connection)
    owned_ids = saved["owned_ids"] if saved else []
    history_ids = {}
    last_used = []
    last_experiment = None
    for message in store.conversation_messages(conversation_id, connection=connection):
        if message["role"] != "user":
            continue
        attached = [item["id"] for item in message.get("attachments") or ()]
        if attached:
            last_used = attached
            history_ids.update(dict.fromkeys(attached))
            if message.get("experiment_id"):
                last_experiment = attached[0]

    files = []
    for file_id in dict.fromkeys([*history_ids, *owned_ids]):
        file = store.get("files", file_id, connection=connection)
        if file and can_use_file(file, conversation_id):
            files.append(public_file(file))
    available = {file["id"] for file in files}
    selection = saved["selected_ids"] if saved else last_used
    return {
        "files": files,
        "selected_ids": [file_id for file_id in selection if file_id in available][
            :MAX_SELECTED
        ],
        **(
            {"research_selected_id": last_experiment}
            if last_experiment in available
            else {}
        ),
    }


def save_selection(store, conversation_id, selected_ids, *, connection, new_file=None):
    saved = store.get("conversation_files", conversation_id, connection=connection)
    owned_ids = saved["owned_ids"] if saved else []
    if new_file:
        owned_ids.append(new_file)
    store.put_many(
        "conversation_files",
        [{"id": conversation_id, "owned_ids": owned_ids, "selected_ids": selected_ids}],
        connection=connection,
    )
