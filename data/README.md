# BRU Route Explorer v0.7.1
# BRU Route Explorer

Prototype static web app for visualising voluntary-return route options from BRU.

## What it does

- Fixed origin: BRU.
- Filters out any route containing Schengen airports after BRU.
- Uses CSV files as a small operational knowledge base.
- Shows all matching route options as a horizontal tree.
- Shows connection wait time between flight cards.
- Supports overnight arrivals and connections on following days.

## Run locally with VS Code Live Server

1. Open this folder in VS Code.
2. Right-click `index.html`.
3. Select **Open with Live Server**.

## Data files

- `data/airports.csv` — airport codes and Schengen flag.
- `data/flights.csv` — one row per known flight leg.

## Important

This is not a booking system. FAR remains the operational source for final booking and validation.


## v0.5.2

- Restored the v0.4.1 tree layout.
- Added destination country and destination airport selectors.
- Schengen airports remain excluded after BRU.


## Airport data

`data/airports.csv` contains a broad operational starter list. For a full global IATA airport list, use `tools/build_airports_from_ourairports.py` with the public OurAirports CSV dumps and replace `data/airports.csv`.

Only airports with an IATA code are useful for this prototype. Schengen countries are marked in the `schengen` column so the route engine can exclude them after BRU.
