#!/usr/bin/env python3
"""Copy the canonical Perseus navigation assets into a sibling web project."""

import argparse
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ("perseus-navigation.css", "perseus-navigation.js")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--target",
        type=Path,
        default=ROOT.parent / "idi-greek" / "docs" / "assets",
        help="directory that receives byte-identical generated copies",
    )
    args = parser.parse_args()
    args.target.mkdir(parents=True, exist_ok=True)
    for name in ASSETS:
        source = ROOT / "assets" / name
        destination = args.target / name
        shutil.copy2(source, destination)
        print(f"Synced {source.relative_to(ROOT)} -> {destination}")


if __name__ == "__main__":
    main()
