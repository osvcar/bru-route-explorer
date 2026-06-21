#!/usr/bin/env python3
"""
File: tools/build_airports_from_ourairports.py
Project: BRU Route Explorer
Author: Migus in collaboration with ChatGPT

Purpose:
    Convert the public OurAirports airports.csv and countries.csv dumps into
    the simplified data/airports.csv format used by this static web app.

Usage:
    1. Download from:
       https://davidmegginson.github.io/ourairports-data/airports.csv
       https://davidmegginson.github.io/ourairports-data/countries.csv
    2. Run:
       python tools/build_airports_from_ourairports.py airports.csv countries.csv data/airports.csv

Notes:
    - Keeps only rows with an IATA code.
    - Excludes closed airports and heliports.
    - Marks Schengen by ISO country code. Review this list if law changes.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

SCHENGEN_ISO2 = {
    "AT", "BE", "BG", "CH", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
    "GR", "HR", "HU", "IS", "IT", "LI", "LT", "LU", "LV", "MT", "NL",
    "NO", "PL", "PT", "RO", "SE", "SI", "SK",
}

EXCLUDED_TYPES = {"closed", "closed_airport", "heliport"}


def load_countries(path: Path) -> dict[str, str]:
    countries: dict[str, str] = {}
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            countries[row["code"].upper()] = row["name"]
    return countries


def main() -> int:
    if len(sys.argv) != 4:
        print("Usage: python build_airports_from_ourairports.py airports.csv countries.csv output.csv")
        return 2

    airports_path = Path(sys.argv[1])
    countries_path = Path(sys.argv[2])
    output_path = Path(sys.argv[3])

    countries = load_countries(countries_path)
    rows = []

    with airports_path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            iata = (row.get("iata_code") or "").strip().upper()
            airport_type = (row.get("type") or "").strip().lower()
            iso_country = (row.get("iso_country") or "").strip().upper()

            if not iata or airport_type in EXCLUDED_TYPES:
                continue

            rows.append({
                "code": iata,
                "name": row.get("name", "").strip(),
                "country": countries.get(iso_country, iso_country),
                "schengen": "yes" if iso_country in SCHENGEN_ISO2 else "no",
            })

    # Deduplicate by IATA code, preferring the first occurrence from OurAirports.
    seen = set()
    deduped = []
    for row in sorted(rows, key=lambda r: (r["country"], r["code"])):
        if row["code"] in seen:
            continue
        seen.add(row["code"])
        deduped.append(row)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["code", "name", "country", "schengen"])
        writer.writeheader()
        writer.writerows(deduped)

    print(f"Wrote {len(deduped)} airports to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
