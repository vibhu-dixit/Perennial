"""Seeds two seasons of demo history (PDD §13, hour 2).

    python seed/demo_garden.py            # rewrite data/ with fresh history
    python seed/demo_garden.py --rawtree  # …and copy every row into RawTree too

The history itself is defined once, in ui/lib/seed.ts (the UI also self-seeds
from it on first run), so the Python and Next.js sides can never drift apart.
This script runs that generator, then optionally loads the rows into RawTree.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "loop"))

from rawtree_store import TABLES, Store, data_dir, load_env  # noqa: E402


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--rawtree", action="store_true", help="also insert every row into RawTree via rtree")
    args = parser.parse_args()

    if not shutil.which("node"):
        sys.exit("node is required (the history generator lives in ui/lib/seed.ts)")
    env = {**os.environ, "PERENNIAL_DATA_DIR": str(data_dir())}
    subprocess.run(["node", "--experimental-strip-types", "--no-warnings", "scripts/seed.mts"],
                   cwd=ROOT / "ui", env=env, check=True)

    if args.rawtree:
        local, remote = Store(rawtree=False), Store(rawtree=True)
        if not remote.rawtree:
            sys.exit("`rtree` not found on PATH — run `rtree login` first")
        for table in TABLES:
            rows = local.read(table)
            for row in rows:
                remote._rtree("insert", "--table", table, "--data", json.dumps(row, ensure_ascii=False))
            print(f"rawtree {table:<14} {len(rows)} rows")


if __name__ == "__main__":
    main()
