"""Append/query helpers for the Perennial memory (PDD §6).

Two backends behind one interface:

* JSONL (always on): one append-only ``data/<table>.jsonl`` per table. This is
  the PDD §12 fallback and the file format the Next.js UI reads.
* RawTree (``PERENNIAL_STORE=rawtree``): every append is *also* written to
  RawTree through the ``rtree`` CLI, so RawTree holds the queryable archive
  while the local mirror keeps the UI fast. A RawTree failure is logged and
  never stops the loop — history is append-only, so nothing is lost locally.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
TABLES = ("observations", "plan_versions", "plan_edits", "qa_log", "loops")


def load_env(path: Path = ROOT / ".env") -> None:
    """Minimal .env loader (KEY=VALUE lines); real env vars win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def data_dir() -> Path:
    raw = os.environ.get("PERENNIAL_DATA_DIR") or "data"
    path = Path(raw)
    return path if path.is_absolute() else (ROOT / path).resolve()


class Store:
    def __init__(self, directory: Path | None = None, rawtree: bool | None = None):
        self.dir = directory or data_dir()
        self.dir.mkdir(parents=True, exist_ok=True)
        if rawtree is None:
            rawtree = os.environ.get("PERENNIAL_STORE", "").lower() == "rawtree"
        self.rawtree = rawtree and shutil.which("rtree") is not None
        if rawtree and not self.rawtree:
            print("[store] PERENNIAL_STORE=rawtree but `rtree` is not on PATH — JSONL only", file=sys.stderr)

    def _file(self, table: str) -> Path:
        if table not in TABLES:
            raise ValueError(f"unknown table {table!r}")
        return self.dir / f"{table}.jsonl"

    # ── writes ───────────────────────────────────────────────
    def append(self, table: str, *rows: dict[str, Any]) -> None:
        if not rows:
            return
        with self._file(table).open("a", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        if self.rawtree:
            for row in rows:
                self._rtree("insert", "--table", table, "--data", json.dumps(row, ensure_ascii=False))

    # ── reads ────────────────────────────────────────────────
    def read(self, table: str) -> list[dict[str, Any]]:
        path = self._file(table)
        if not path.exists():
            return []
        rows = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass  # a torn write from a crashed loop never takes the loop down
        return rows

    def latest_plan(self) -> dict[str, Any] | None:
        versions = self.read("plan_versions")
        return max(versions, key=lambda v: v["version"]) if versions else None

    def last_loop(self) -> dict[str, Any] | None:
        loops = self.read("loops")
        return max(loops, key=lambda l: l["loop"]) if loops else None

    def query(self, sql: str) -> list[dict[str, Any]]:
        """Runs SQL against RawTree (e.g. for history questions). Empty if unavailable."""
        if not self.rawtree:
            return []
        out = self._rtree("query", sql)
        if not out:
            return []
        try:
            parsed = json.loads(out)
            return parsed if isinstance(parsed, list) else parsed.get("rows", [])
        except json.JSONDecodeError:
            return [json.loads(l) for l in out.splitlines() if l.strip().startswith("{")]

    def _rtree(self, *args: str) -> str | None:
        try:
            done = subprocess.run(["rtree", *args], capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired) as err:
            print(f"[store] rtree {args[0]} failed: {err}", file=sys.stderr)
            return None
        if done.returncode != 0:
            print(f"[store] rtree {args[0]} failed: {done.stderr.strip()[:200]}", file=sys.stderr)
            return None
        return done.stdout
