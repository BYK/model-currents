#!/usr/bin/env python3
"""Convert local Codex or Claude Code JSONL into metadata-only Model Tides v1 JSON.

Usage: python3 export-history.py codex|claude-code [history path] > model-tides.json
No transcript fields, paths, or identifiers are copied to the output.
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

MAX_EVENTS = 200_000
MAX_JSON_BYTES = 32 * 1024 * 1024
MAX_LINE_BYTES = 32 * 1024 * 1024
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
TIMESTAMP = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$")


class MissingZstd(ValueError):
    pass


class MalformedRecord(ValueError):
    pass


class NoModelObservations(ValueError):
    pass


def milliseconds(value):
    if not isinstance(value, str) or not TIMESTAMP.fullmatch(value):
        return None
    try:
        delta = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc) - EPOCH
    except ValueError:
        return None
    result = delta.days * 86_400_000 + delta.seconds * 1_000 + delta.microseconds // 1_000
    return result if abs(result) <= 8_640_000_000_000_000 else None


def valid_model(value):
    return (isinstance(value, str) and 0 < len(value) <= 320
            and sum(2 if ord(char) > 0xFFFF else 1 for char in value) <= 320
            and value == value.strip() and not value.startswith("\ufeff") and not value.endswith("\ufeff")
            and not any(ord(char) < 32 or ord(char) == 127 or 0xD800 <= ord(char) <= 0xDFFF
                        for char in value))


def codex_model(value, provider):
    if not valid_model(value):
        return None
    if "/" in value:
        return value
    if provider is not None and (not valid_model(provider) or "/" in provider):
        return None
    name = provider if provider is not None else "openai"
    result = f"{name}/{value}"
    return result if valid_model(result) else None


def claude_model(value):
    if not valid_model(value):
        return None
    if value.startswith("anthropic/claude-"):
        return value
    if value.startswith("claude-") or value.startswith("anthropic.claude-") or ".anthropic.claude-" in value:
        result = f"anthropic/{value}"
        return result if valid_model(result) else None
    return None


def records(path):
    # Bound memory while reading untrusted JSONL. Decode locally, then retain only metadata.
    process = None
    try:
        if path.suffix == ".zst":
            try:
                process = subprocess.Popen(["zstd", "-dc", "--", str(path)],
                                           stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                           stderr=subprocess.DEVNULL)
            except FileNotFoundError as error:
                raise MissingZstd from error
            stream = process.stdout
        else:
            stream = path.open("rb")
        with stream:
            while line := stream.readline(MAX_LINE_BYTES + 1):
                if len(line) > MAX_LINE_BYTES:
                    raise ValueError("Oversized history record")
                try:
                    value = json.loads(line)
                except (UnicodeError, json.JSONDecodeError) as error:
                    # A live session can have one incomplete final record. Other
                    # malformed lines would hide model changes, so fail closed.
                    if path.suffix != ".zst" and not line.endswith(b"\n") and not stream.read(1):
                        break
                    raise MalformedRecord from error
                if isinstance(value, dict):
                    yield value
        if process is not None and process.wait() != 0:
            raise ValueError("Could not decode compressed history")
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            process.wait()


def paths(root, source):
    if root.is_symlink():
        raise ValueError("History path must not be a symlink")
    single_file = root.is_file()
    if single_file:
        candidates = [root]
    elif root.is_dir():
        candidates = []
        for directory, folders, files in os.walk(root, followlinks=False):
            folders[:] = [name for name in folders if not (Path(directory) / name).is_symlink()
                           and (source != "claude-code" or name != "subagents")]
            candidates.extend(Path(directory) / name for name in files)
    else:
        raise ValueError("History path does not exist")
    selected = []
    for path in candidates:
        if path.is_symlink():
            continue
        if source == "codex":
            if not (path.name.endswith(".jsonl") or path.name.endswith(".jsonl.zst")):
                continue
            if not single_file and not path.name.startswith("rollout-"):
                continue
            if path.suffix == ".zst":
                plain = path.with_suffix("")
                if plain.is_file() and not plain.is_symlink():
                    continue
        elif path.suffix != ".jsonl" or path.name.startswith("agent-") or "subagents" in path.parts:
            continue
        selected.append(path)
    return sorted(selected)


def codex_is_subagent(meta):
    source = meta.get("source")
    return (bool(meta.get("parent_thread_id")) or meta.get("thread_source") == "subagent"
            or (isinstance(source, str) and "subagent" in source.lower())
            or (isinstance(source, dict) and any("subagent" in key.lower() for key in source)))


def codex_session(path):
    meta = None
    observations = []
    for record in records(path):
        kind = record.get("type")
        payload = record.get("payload")
        if not isinstance(payload, dict):
            continue
        if kind == "session_meta" and meta is None:
            meta = payload
            if codex_is_subagent(meta):
                return None
        elif kind == "turn_context" and meta is not None:
            time = milliseconds(record.get("timestamp"))
            model = codex_model(payload.get("model"), meta.get("model_provider"))
            if time is not None and model is not None:
                observations.append((time, model))
                if len(observations) > MAX_EVENTS * 5:
                    raise ValueError("Too many observations")
    if not meta or not isinstance(meta.get("id"), str) or not observations:
        return None
    return meta["id"], milliseconds(meta.get("timestamp")), observations


def claude_session(path):
    first_user = None
    observations = []
    seen_messages = set()
    for record in records(path):
        if record.get("isSidechain") is True or record.get("agentId") or record.get("agent_id"):
            continue
        time = milliseconds(record.get("timestamp"))
        if time is None:
            continue
        if record.get("type") == "user" and record.get("isMeta") is not True:
            first_user = time if first_user is None else min(first_user, time)
        if record.get("type") != "assistant":
            continue
        message = record.get("message")
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        model = claude_model(message.get("model"))
        if model is None:
            continue
        message_id = message.get("id")
        if isinstance(message_id, str):
            if message_id in seen_messages:
                continue
            seen_messages.add(message_id)
            if len(seen_messages) > MAX_EVENTS * 5:
                raise ValueError("Too many message identifiers")
        observations.append((time, model))
        if len(observations) > MAX_EVENTS * 5:
            raise ValueError("Too many observations")
    return (first_user, observations) if observations else None


def append_events(events, start, observations):
    # Rollouts can repeat history after a revert. Sort, then remove identical snapshots.
    ordered = sorted(dict.fromkeys(observations), key=lambda observation: observation[0])
    first_time, first_model = ordered[0]
    started = min(first_time, start) if start is not None else first_time
    events.append({"time": started, "model": first_model, "kind": "session"})
    if len(events) > MAX_EVENTS:
        raise ValueError("Too many events")
    previous_model, previous_time = first_model, started
    for time, model in ordered[1:]:
        if model != previous_model:
            events.append({"time": time, "model": model, "kind": "switch",
                           "fromModel": previous_model, "fromTime": previous_time})
            previous_model, previous_time = model, time
        if len(events) > MAX_EVENTS:
            raise ValueError("Too many events")


def export(source, root):
    events = []
    files = paths(root, source)
    if source == "codex":
        sessions = {}
        total_observations = 0
        for path in files:
            session = codex_session(path)
            if session is None:
                continue
            session_id, start, observations = session
            if session_id not in sessions:
                sessions[session_id] = [start, []]
            previous = sessions[session_id]
            if start is not None and (previous[0] is None or start < previous[0]):
                previous[0] = start
            previous[1].extend(observations)
            total_observations += len(observations)
            if total_observations > MAX_EVENTS * 5:
                raise ValueError("Too many observations")
            if len(previous[1]) > MAX_EVENTS * 5:
                raise ValueError("Too many observations")
        for start, observations in sessions.values():
            append_events(events, start, observations)
    else:
        for path in files:
            session = claude_session(path)
            if session is not None:
                append_events(events, *session)
    if not events:
        raise NoModelObservations
    events.sort(key=lambda event: event["time"])
    result = json.dumps({"format": "model-tides", "version": 1, "source": source,
                         "events": events}, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
    if len(result) > MAX_JSON_BYTES:
        raise ValueError("Export exceeds the metadata size limit")
    return result


if __name__ == "__main__":
    try:
        if len(sys.argv) not in (2, 3) or sys.argv[1] not in ("codex", "claude-code"):
            raise ValueError("Expected codex or claude-code and an optional path")
        source = sys.argv[1]
        default = Path.home() / (".codex" if source == "codex" else ".claude/projects")
        root = Path(sys.argv[2]).expanduser() if len(sys.argv) == 3 else default
        sys.stdout.buffer.write(export(source, root))
    except MissingZstd:
        print("Compressed Codex history requires zstd. Install it locally and retry.", file=sys.stderr)
        sys.exit(1)
    except MalformedRecord:
        print("A complete history record is malformed. Nothing was exported.", file=sys.stderr)
        sys.exit(1)
    except NoModelObservations:
        print("No model observations found in this history.", file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError):
        print("Could not export model metadata. Check the local history path and JSONL format.", file=sys.stderr)
        sys.exit(1)
