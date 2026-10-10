from quantum.levels import read_level
from quantum.verify import verify_stage
import pytest


def stage(level_id, stage_id):
    level = read_level(level_id)
    return next(item for item in level["stages"] if item["id"] == stage_id)


def test_campaign_probability_and_cost_targets():
    cases = [("level1", "calibration", 1, 2),
             ("level2", "opposites", 1, 1),
             ("level2", "feed_forward", 1, 1),
             ("level3", "core", 1, 3)]
    for level, name, probability, gates in cases:
        result = verify_stage(stage(level, name))
        assert result["probability"] == pytest.approx(probability)
        assert result["min_gates"] == gates
        # calibration: measuring blind skips the free RUN step, so it never validates.
        blind = {"calibration": 0, "opposites": 0, "feed_forward": .5, "core": 0}[name]
        assert result["blind_probability"] == pytest.approx(blind)
        assert result["witness"]["nodes"]


def test_core_without_cx_cannot_guarantee_success():
    assert verify_stage(stage("level3", "core"), allow_cx=False)["probability"] < 1


def test_feed_forward_policy_is_adaptive():
    result = verify_stage(stage("level2", "feed_forward"))
    assert result["min_measurements"] == 2
    root = result["witness"]["nodes"][0]
    assert root["actions"][0]["action"] == ["measure", 0]
    assert len(root["actions"][0]["transitions"]) == 2


def test_calibration_requires_the_run_step_and_the_run_is_free():
    result = verify_stage(stage("level1", "calibration"))
    assert result["probability"] == pytest.approx(1)
    assert result["min_gates"] == 2          # H then CX; the run does not count
    assert result["min_measurements"] == 2
    root = result["witness"]["nodes"][0]
    actions = [a["action"] for node in result["witness"]["nodes"] for a in node["actions"]]
    assert ["run"] in actions
    assert ["gate", "alice_h"] in actions and ["gate", "shared_cx"] in actions
    assert root["actions"][0]["action"] == ["gate", "alice_h"]


def test_calibration_without_cx_cannot_validate_or_win():
    assert verify_stage(stage("level1", "calibration"), allow_cx=False)["probability"] == 0
