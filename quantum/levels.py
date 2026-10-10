"""Literal-path project assets and validation of the shared level contract."""

from __future__ import annotations

import base64
import json
from copy import deepcopy

LEVEL_IDS = ("level1", "level2", "level3")
THEMES = ("lab", "prison", "core")  # art sets of the client (assets/themes/*.json); purely visual


def integer(value, lower=0, upper=None):
    return type(value) is int and value >= lower and (upper is None or value < upper)


def validate_level(level: dict) -> dict:
    """Reject malformed definitions before creating a session or consuming a job."""
    if not isinstance(level, dict) or level.get("schema_version") != 2:
        raise ValueError("Expected level schema_version 2")
    if level.get("id") not in LEVEL_IDS or type(level.get("num_qubits")) is not int or level["num_qubits"] != 2:
        raise ValueError("MVP levels require a known id and exactly two qubits")
    if "theme" in level and level["theme"] not in THEMES:
        raise ValueError("theme must be one of " + ", ".join(THEMES))
    stages = level.get("stages")
    if not isinstance(stages, list) or not stages:
        raise ValueError("A level needs at least one stage")
    stage_ids = set()
    for stage in stages:
        if not isinstance(stage, dict) or not isinstance(stage.get("id"), str):
            raise ValueError("Invalid stage")
        if stage["id"] in stage_ids:
            raise ValueError("Stage ids must be unique")
        stage_ids.add(stage["id"])
        if not integer(stage.get("max_gates")):
            raise ValueError("max_gates must be a nonnegative integer")
        gate_set = stage.get("gate_set", {})
        if not isinstance(gate_set, dict) or set(gate_set) != {"alice", "bob", "shared"}:
            raise ValueError("gate_set must define alice, bob and shared")
        for owner, gates in gate_set.items():
            allowed = {"cx"} if owner == "shared" else {"h", "z", "x"}
            if owner == "bob":
                allowed.add("cx")  # L1: Bob places the q0-controlled pair operation.
            if not isinstance(gates, list) or any(g not in allowed for g in gates):
                raise ValueError("Invalid gate set")
        circuit = stage.get("initial_circuit")
        if not isinstance(circuit, list):
            raise ValueError("initial_circuit must be a list")
        for op in circuit:
            if not isinstance(op, list) or not op or op[0] not in {"x", "h", "z", "cx"}:
                raise ValueError("Unsupported initial gate")
            if len(op) != (3 if op[0] == "cx" else 2):
                raise ValueError("Invalid initial gate arity")
            if any(not integer(q, upper=2) for q in op[1:]):
                raise ValueError("Invalid initial gate qubit")
            if op[0] == "cx" and op[1] == op[2]:
                raise ValueError("CX needs different operands")
        validation = stage.get("validation")
        if validation is not None:
            if (not isinstance(validation, dict)
                    or validation.get("target_bell") not in {"Phi+", "Phi-", "Psi+", "Psi-"}
                    or not isinstance(validation.get("required_sequence"), list)
                    or not validation["required_sequence"]):
                raise ValueError("Invalid circuit validation protocol")
            if circuit:
                raise ValueError("Validated construction must start with an empty circuit")
            for op in validation["required_sequence"]:
                if (not isinstance(op, list) or not op or op[0] not in {"h", "x", "z", "cx"}
                        or len(op) != (3 if op[0] == "cx" else 2)
                        or any(not integer(q, upper=2) for q in op[1:])
                        or (op[0] == "cx" and op[1] == op[2])):
                    raise ValueError("Invalid validation gate sequence")
            if len(validation["required_sequence"]) > stage["max_gates"]:
                raise ValueError("Validation sequence exceeds gate budget")
        feed_forward = stage.get("feed_forward")
        if feed_forward is not None:
            if (not isinstance(feed_forward, dict) or validation is not None
                    or type(feed_forward.get("sender_qubit")) is not int or feed_forward["sender_qubit"] != 1
                    or type(feed_forward.get("receiver_qubit")) is not int or feed_forward["receiver_qubit"] != 0
                    or feed_forward.get("preparation_gate") != ["x", 1]
                    or feed_forward.get("corrections") != {"0": "x", "1": "i"}
                    or feed_forward.get("classical_channel") != "explicit_send_receive"):
                raise ValueError("Invalid Bell Block feed-forward protocol")
            if (circuit != [["h", 0], ["cx", 0, 1]] or stage["max_gates"] < 2
                    or gate_set != {"alice": ["x"], "bob": ["x"], "shared": []}):
                raise ValueError("Bell Block needs a fresh Phi+ and both owned X operations")
        win = stage.get("win")
        if not isinstance(win, dict) or not win:
            raise ValueError("Missing win condition")
        if "parity" in win:
            if set(win) != {"parity"} or win["parity"] not in {"equal", "different"}:
                raise ValueError("Invalid parity condition")
        elif any(k not in {"q0", "q1"} or not integer(v, upper=2) for k, v in win.items()):
            raise ValueError("Invalid win pattern")
        required = stage.get("required_measurements")
        if (not isinstance(required, list) or len(set(required)) != len(required)
                or any(not integer(q, upper=2) for q in required)):
            raise ValueError("Invalid required_measurements")
        needed = {0, 1} if "parity" in win else {int(k[1:]) for k in win}
        if not needed.issubset(required):
            raise ValueError("Win qubits must be explicitly measured")
        if feed_forward is not None and (win != {"q0": 0} or set(required) != {0, 1}):
            raise ValueError("Bell Block measures both qubits and targets Alice=0, not Bob's bit")
        if stage.get("failure_policy") not in {"retry_stage", "death"}:
            raise ValueError("Invalid failure policy")
        grid = stage.get("map")
        if (not isinstance(grid, list) or not grid or len(grid) > 12
                or not all(isinstance(row, str) for row in grid)
                or not 0 < len(grid[0]) <= 20
                or any(len(row) != len(grid[0]) for row in grid)):
            raise ValueError("Map must be rectangular and at most 20 by 12")
        legend = stage.get("legend", {})
        if not isinstance(legend, dict) or any(symbol not in legend for row in grid for symbol in row):
            raise ValueError("Every map symbol must be in legend")
        for symbol, label in (("A", "alice_start"), ("B", "bob_start"),
                              ("S", "sensor_q0"), ("s", "sensor_q1"),
                              ("E", "exit_A"), ("e", "exit_B")):
            if legend.get(symbol) != label or sum(row.count(symbol) for row in grid) != 1:
                raise ValueError("Each player requires one start, sensor and exit")
        objects = stage.get("objects", {})
        if not isinstance(objects, dict):
            raise ValueError("objects must be a dictionary")
        for obj in objects.values():
            if not isinstance(obj, dict):
                raise ValueError("Object definitions must be dictionaries")
            if obj.get("type") == "validated_exit":
                if (validation is None or not integer(obj.get("qubit"), upper=2)
                        or obj.get("unlock_when") != "objective_ready"
                        or obj.get("blocking") is not True or "open_on" in obj):
                    raise ValueError("Validated exits unlock through the objective, not a local bit")
            elif obj.get("type") == "protocol_exit":
                if (feed_forward is None or not integer(obj.get("qubit"), upper=2)
                        or obj.get("unlock_when") != "objective_ready"
                        or obj.get("blocking") is not True or "open_on" in obj):
                    raise ValueError("Protocol exits unlock only after the complete feed-forward sequence")
            elif "qubit" in obj:
                if not integer(obj["qubit"], upper=2) or not integer(obj.get("open_on"), upper=2):
                    raise ValueError("Invalid quantum object")
            elif obj.get("type") != "objective_controlled_joint_lock":
                raise ValueError("Objects require a qubit or a joint lock type")
        terminals = stage.get("terminals", [])
        if not isinstance(terminals, list):
            raise ValueError("terminals must be a list")
        terminal_ids = set()
        def check_cell(cell):
            if (not isinstance(cell, list) or len(cell) != 2
                    or not integer(cell[0], upper=len(grid))
                    or not integer(cell[1], upper=len(grid[0]))
                    or grid[cell[0]][cell[1]] in {"#", "|"}):
                raise ValueError("Terminal cell is out of bounds or blocked")
            return legend[grid[cell[0]][cell[1]]]
        for terminal in terminals:
            if not isinstance(terminal, dict):
                raise ValueError("Terminal definitions must be dictionaries")
            tid = terminal.get("id")
            if not isinstance(tid, str) or tid in terminal_ids:
                raise ValueError("Terminal ids must be unique")
            terminal_ids.add(tid)
            owner, gate = terminal.get("owner"), terminal.get("gate")
            if owner not in gate_set or gate not in gate_set[owner]:
                raise ValueError("Terminal must belong to its owner's gate set")
            expected_qubit = 0 if gate == "cx" else 1 if owner == "bob" else 0
            if type(terminal.get("qubit")) is not int or terminal["qubit"] != expected_qubit:
                raise ValueError("Terminal qubit does not match its owner")
            placement = terminal.get("placement", "map")
            if placement not in {"map", "hud"}:
                raise ValueError("Terminal placement must be map or hud")
            if placement == "hud":
                if (owner not in {"alice", "bob"} or gate == "cx"
                        or "cell" in terminal or "target_cell" in terminal):
                    raise ValueError("HUD terminals must be owned single-qubit gates without map cells")
            elif check_cell(terminal.get("cell")) != tid:
                raise ValueError("Terminal cell must reference its id in legend")
            if gate == "cx":
                if type(terminal.get("target")) is not int or terminal["target"] != 1:
                    raise ValueError("CX requires q0 control and q1 target")
                if owner == "shared":
                    if check_cell(terminal.get("target_cell")) != tid + "_target":
                        raise ValueError("Shared CX needs a target cell for coordinated activation")
                elif owner != "bob" or terminal.get("activation") != "owner" or "target_cell" in terminal:
                    raise ValueError("Bob's CX requires owner activation, not shared target cells")
            elif "target" in terminal:
                raise ValueError("Single-qubit terminal has no target")
            uses = terminal.get("uses")
            if uses is not None and not integer(uses, lower=1):
                raise ValueError("Terminal uses must be positive or null")
        if validation is not None:
            for op in validation["required_sequence"]:
                if not any(t["gate"] == op[0] and t["qubit"] == op[1]
                           and t.get("target", -1) == (op[2] if len(op) == 3 else -1)
                           for t in terminals):
                    raise ValueError("Validation gates need corresponding terminals")
        if feed_forward is not None:
            for owner, qubit in (("alice", 0), ("bob", 1)):
                if not any(t["owner"] == owner and t["gate"] == "x" and t["qubit"] == qubit
                           for t in terminals):
                    raise ValueError("Bell Block requires an X terminal for each player")
        known_labels = {"wall", "floor", "region_separator", "alice_start", "bob_start",
                        "sensor_q0", "sensor_q1", "exit_A", "exit_B"}
        known_labels |= set(objects) | terminal_ids | {t + "_target" for t in terminal_ids}
        if any(label not in known_labels for label in legend.values()):
            raise ValueError("Legend references unknown entities")
        _check_decorations(stage.get("decorations", []), grid, legend)
    return deepcopy(level)


SCENERY_LABELS = {"wall", "floor", "region_separator"}


def _check_decorations(decorations, grid, legend):
    """Purely visual layer: never read by the engine, but it must not hide gameplay cells.

    Each item is {"sprite": name, "cell": [row, col] (top-left), "footprint": [w, h] in tiles, "solid": bool (optional)}.
    `solid` only matters to the client (it blocks movement over the footprint); the engine never reads it.
    Covered cells may only be plain scenery; wall cells are allowed solely for `wall_*` sprites.
    """
    if not isinstance(decorations, list):
        raise ValueError("decorations must be a list")
    for deco in decorations:
        if not isinstance(deco, dict):
            raise ValueError("Decoration definitions must be dictionaries")
        sprite, cell, footprint = deco.get("sprite"), deco.get("cell"), deco.get("footprint")
        if not isinstance(sprite, str) or not sprite:
            raise ValueError("Decoration needs a sprite name")
        if (not isinstance(cell, list) or len(cell) != 2
                or not integer(cell[0], upper=len(grid)) or not integer(cell[1], upper=len(grid[0]))):
            raise ValueError("Decoration cell must be [row, col] inside the map")
        if (not isinstance(footprint, list) or len(footprint) != 2
                or not all(integer(n, lower=1) for n in footprint)):
            raise ValueError("Decoration footprint must be [w, h] positive integers")
        if "solid" in deco and type(deco["solid"]) is not bool:
            raise ValueError("Decoration solid must be a boolean")
        row, col = cell
        width, height = footprint
        if row + height > len(grid) or col + width > len(grid[0]):
            raise ValueError("Decoration footprint leaves the map")
        for r in range(row, row + height):
            for c in range(col, col + width):
                label = legend[grid[r][c]]
                if label not in SCENERY_LABELS:
                    raise ValueError("Decorations cannot cover interactive cells")
                if label != "floor" and not sprite.startswith("wall_"):
                    raise ValueError("Only wall_* decorations may cover wall cells")


def read_level(level_id: str) -> dict:
    """Literal open calls are intentional for Qollab's asset discovery."""
    if level_id == "level1":
        with open("levels/level1.json", encoding="utf-8") as handle:
            data = json.load(handle)
    elif level_id == "level2":
        with open("levels/level2.json", encoding="utf-8") as handle:
            data = json.load(handle)
    elif level_id == "level3":
        with open("levels/level3.json", encoding="utf-8") as handle:
            data = json.load(handle)
    else:
        raise ValueError("Unknown level id")
    if data.get("id") != level_id:
        raise ValueError("Level id does not match its asset")
    return validate_level(data)


AUDIO_TRACKS = ("menu", "level1", "level2")
AUDIO_MAX_BYTES = 2 * 1024 * 1024


class InvalidTrack(ValueError):
    code = "INVALID_TRACK"


def audio_payload(track: str = "menu") -> dict:
    """Background track as JSON-compatible base64 (no proxies). Fixed track -> file map.

    Separate literal open() calls are intentional: Qollab's file access relies on literal paths.
    Levels 2 and 3 share the "level2" track.
    """
    if not isinstance(track, str) or track not in AUDIO_TRACKS:
        raise InvalidTrack(f"Unknown audio track; expected one of {', '.join(AUDIO_TRACKS)}")
    if track == "menu":
        with open("audio/fondo_inicio.ogg", "rb") as handle:
            data = handle.read(AUDIO_MAX_BYTES + 1)
    elif track == "level1":
        with open("audio/fondo_1.ogg", "rb") as handle:
            data = handle.read(AUDIO_MAX_BYTES + 1)
    else:
        with open("audio/fondo_2.ogg", "rb") as handle:
            data = handle.read(AUDIO_MAX_BYTES + 1)
    if len(data) > AUDIO_MAX_BYTES:
        raise ValueError("Audio track exceeds the 2 MB asset limit")
    return {"mime": "audio/ogg", "encoding": "base64",
            "data": base64.b64encode(data).decode("ascii")}
