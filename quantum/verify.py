"""Exact dynamic-programming verification of campaign stages."""

from __future__ import annotations

import argparse
import json

from quantum.enumerate import campaign_catalog
from quantum.levels import LEVEL_IDS, read_level
from quantum.rules import actions, branches, logical_key, objective, start


def verify_stage(stage: dict, num_qubits: int = 2, allow_cx: bool = True) -> dict:
    initial = start(stage, num_qubits)

    return _report(stage, initial, num_qubits, allow_cx)


def _report(stage, initial, num_qubits, allow_cx):
    memo = {}
    positions = {}

    def evaluate(pos):
        key = logical_key(pos)
        if key not in positions and len(positions) >= 20000:
            raise ValueError("Verifier exceeded the 20000 logical-node guard")
        positions.setdefault(key, pos)
        if key in memo:
            return memo[key]
        status = objective(stage, pos)
        if status != "pending":
            memo[key] = (1.0 if status == "ready" else 0.0, 0, 0, [])
            return memo[key]
        options = []
        for action in actions(stage, pos, allow_cx=allow_cx):
            child = [(p, outcome, nxt, evaluate(nxt)) for p, outcome, nxt in branches(stage, pos, action)]
            prob = sum(p * r[0] for p, _, _, r in child)
            mg = int(action[0] == "gate") + max((r[1] for _, _, _, r in child), default=0)
            mm = int(action[0] == "measure") + max((r[2] for _, _, _, r in child), default=0)
            options.append((prob, mg, mm, action, child))
        if not options:
            memo[key] = (0.0, 0, 0, [])
            return memo[key]
        probability = max(o[0] for o in options)
        gates = min(o[1] for o in options if abs(o[0] - probability) < 1e-12)
        measurements = min(o[2] for o in options if abs(o[0] - probability) < 1e-12 and o[1] == gates)
        ties = [o for o in options if abs(o[0] - probability) < 1e-12 and o[1] == gates and o[2] == measurements]
        memo[key] = (probability, gates, measurements, ties)
        return memo[key]

    probability, min_gates, min_measurements, _ = evaluate(initial)
    node_ids = {}
    nodes = []

    def emit(pos):
        key = logical_key(pos)
        if key in node_ids:
            return node_ids[key]
        node_id = f"n{len(node_ids)}"
        node_ids[key] = node_id
        nodes.append({"id": node_id, "state": key[0], "measured": key[1], "actions": []})
        record = memo[key]
        for _, _, _, action, child in record[3]:
            edges = []
            for chance, outcome, nxt, _ in child:
                edges.append({"probability": chance, "outcome": outcome, "to": emit(nxt)})
            nodes[int(node_id[1:])]["actions"].append({"action": list(action), "transitions": edges})
        return node_id

    root = emit(initial)
    # Blind policy is the fixed strategy of measuring q0 then q1, with no feed-forward.
    def blind(pos, q):
        if objective(stage, pos) == "failed":
            return 0.0
        if objective(stage, pos) == "ready":
            return 1.0
        if q == num_qubits:
            return 1.0 if objective(stage, pos) == "ready" else 0.0
        if pos.measured[q] is not None:
            return blind(pos, q + 1)
        return sum(p * blind(nxt, q + 1) for p, _, nxt in branches(stage, pos, ("measure", q)))

    # Count all reachable logical nodes and physical states using the requested gate restriction.
    from collections import deque
    queue, seen = deque([initial]), {logical_key(initial)}
    while queue:
        pos = queue.popleft()
        if objective(stage, pos) != "pending":
            continue
        for action in actions(stage, pos, allow_cx=allow_cx):
            for _, _, nxt in branches(stage, pos, action):
                lk = logical_key(nxt)
                if lk not in seen:
                    seen.add(lk)
                    queue.append(nxt)
    physical_count = len({logical[0] for logical in seen})
    return {"probability": probability, "blind_probability": blind(initial, 0),
            "min_gates": min_gates, "min_measurements": min_measurements,
            "witness": {"root": root, "nodes": nodes}, "solutions": {"root": root, "nodes": nodes},
            "physical_states": physical_count, "logical_nodes": len(seen)}


def campaign_report() -> dict:
    report = {}
    all_levels = [read_level(level_id) for level_id in LEVEL_IDS]
    catalog = campaign_catalog(all_levels)
    for level in all_levels:
        report[level["id"]] = {stage["id"]: verify_stage(stage, level["num_qubits"])
                                for stage in level["stages"]}
    report["physical_states"] = len(catalog)
    report["level3"]["core"]["no_cx_probability"] = verify_stage(
        all_levels[2]["stages"][0], allow_cx=False)["probability"]
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", help="Optional JSON output file")
    args = parser.parse_args()
    report = campaign_report()
    rendered = json.dumps(report, indent=2, sort_keys=True)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(rendered + "\n")
    else:
        print(rendered)
    expected = {"independent": 0.5, "entangled": 1.0, "opposites": 1.0,
                "feed_forward": 1.0, "core": 1.0}
    for level in report.values():
        if isinstance(level, dict):
            for stage_id, result in level.items():
                if stage_id in expected and abs(result["probability"] - expected[stage_id]) > 1e-9:
                    return 1
    no_cx = verify_stage(read_level("level3")["stages"][0], allow_cx=False)
    return 0 if no_cx["probability"] < 1.0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
