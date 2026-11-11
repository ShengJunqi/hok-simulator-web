"""Export N4's independent rank banks for the static browser, without a backend."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "src"))
from hokmodel.simulator import process, rank_profiles, comeback
from hokmodel.simulator.phases import ROLES
from hokmodel.simulator.state import plain
from hokmodel.simulator.winprob2 import WinProbCoefficients


def make_bundle(server):
    patch = rank_profiles.PATCH
    heroes = [dict(hero_id=f"demo_{lane}", lane=lane, server=server, patch=patch) for lane in ROLES]
    example = process.simulate_process("ranked", heroes, seed=7, server=server)
    source_files = ["simulator/process.py", "simulator/rank_profiles.py", "simulator/winprob2.py",
                    "simulator/comeback.py", "simulator/ledger.py", "simulator/phases.py", "simulator/scoring.py", "probability.py"]
    return {
        "schema_version": example["schema_version"], "server": server, "patch": patch,
        "label": rank_profiles.LABEL, "calibrated": False, "data_version": rank_profiles.DATA_VERSION,
        "profiles": {p.mode: p.to_dict() for p in rank_profiles.mode_profiles(server=server)},
        "modes": list(rank_profiles.MODES), "styles": list(rank_profiles.STYLES), "roles": list(ROLES),
        "parameter_units": process.PARAMETER_UNITS, "calibration_only": sorted(process.CALIBRATION_ONLY),
        "parameters": plain(process.synthetic_process_parameters(server=server)),
        "coefficients": plain(WinProbCoefficients(server, patch)),
        "style_kind": process._STYLE_KIND, "kind_styles": process._KIND_STYLES,
        "comeback_tags": list(comeback.COMEBACK_TAGS), "comeback_paths": comeback._PATHS,
        "phases": example["phases"], "assumptions": example["assumptions"],
        "defaults": {"horizon_s": example["horizon_s"], "initial_economy_diff": example["initial_economy_diff"]},
        "source_sha256": {f"src/hokmodel/{name}": hashlib.sha256((ROOT / "src/hokmodel" / name).read_bytes()).hexdigest()
                          for name in source_files},
    }


if __name__ == "__main__":
    for server in ("cn", "hok"):
        destination = Path(__file__).resolve().parent / "data" / f"rank-{server}.json"
        destination.write_text(json.dumps(make_bundle(server), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(destination.relative_to(ROOT))
