/*
 * File: src/app.js
 * Project: BRU Route Explorer
 * Author: Migus in collaboration with ChatGPT
 * Purpose: Client-side route graph builder for static GitHub Pages deployment.
 *
 * Design notes:
 * - The application is static: all processing is done in the user's browser.
 * - One row in flights.csv represents one flight leg, not a whole journey.
 * - Schengen airports are filtered out from all routes, except BRU as the fixed origin.
 * - The algorithm uses depth-limited DFS to enumerate all plausible journeys.
 */

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

let airports = new Map();
let flights = [];

/**
 * Parses a basic CSV file into an array of objects.
 * This parser supports simple quoted cells for future Excel exports.
 */
function parseCSV(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = "";
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (current.length > 0 || row.length > 0) {
        row.push(current.trim());
        rows.push(row);
        row = [];
        current = "";
      }
      if (char === '\r' && next === '\n') i++;
    } else {
      current += char;
    }
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    rows.push(row);
  }

  const headers = rows.shift();
  return rows
    .filter(r => r.length === headers.length)
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

async function loadCSV(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return parseCSV(await response.text());
}

function normaliseFlight(raw) {
  return {
    ...raw,
    origin: raw.origin.toUpperCase(),
    destination: raw.destination.toUpperCase(),
    days: raw.days.toUpperCase(),
    arr_day_offset: Number(raw.arr_day_offset || 0),
    external_file: raw.external_file.toLowerCase() === "yes",
    old_file: raw.old_file.toLowerCase() === "yes"
  };
}

function isSchengen(code) {
  const airport = airports.get(code);
  return airport ? airport.schengen.toLowerCase() === "yes" : false;
}

function operatesOn(flight, date) {
  if (flight.days === "DAILY") return true;
  return flight.days.split(/\s+/).includes(DAY_NAMES[date.getDay()]);
}

function startOfLocalDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function sameLocalDay(a, b) {
  return startOfLocalDay(a).getTime() === startOfLocalDay(b).getTime();
}

function expandsDays(flight) {
  if (flight.days === "DAILY") return DAY_NAMES;
  return flight.days.split(/\s+/).filter(Boolean);
}

function combineDateAndTime(baseDate, timeText, dayOffset = 0) {
  const [hours, minutes] = timeText.split(":").map(Number);
  const result = new Date(baseDate);
  result.setHours(hours, minutes, 0, 0);
  result.setDate(result.getDate() + dayOffset);
  return result;
}

function minutesBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

function formatDateTime(date) {
  return date.toLocaleString([], {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function statusLabel(flight) {
  if (flight.confirmed_far_date) return `✅ FAR ${flight.confirmed_far_date}`;
  if (flight.external_file && flight.old_file) return "🟡⚪ external + old file";
  if (flight.external_file) return "🟡 external file";
  if (flight.old_file) return "⚪ old file";
  return "⚠️ unclassified";
}

function waitClass(waitMinutes, longWaitHours) {
  const longWaitMinutes = longWaitHours * 60;
  if (waitMinutes >= longWaitMinutes * 2) return "wait-very-long";
  if (waitMinutes >= longWaitMinutes) return "wait-long";
  return "wait-ok";
}

function getValidOutgoingFlights(origin, departureDate) {
  return flights.filter(f => {
    if (f.origin !== origin) return false;
    if (!operatesOn(f, departureDate)) return false;

    // Hard rule: BRU is the only Schengen airport allowed in a route.
    if (f.destination !== "BRU" && isSchengen(f.destination)) return false;
    if (f.origin !== "BRU" && isSchengen(f.origin)) return false;

    return true;
  });
}

/**
 * Finds the next real occurrence of a flight.
 *
 * Important operational rule:
 * - When "Show other-day flights" is OFF, each leg must operate on the
 *   actual local date reached by the previous leg + minimum connection time.
 * - When "Show other-day flights" is ON, the app also looks ahead for the next
 *   operating day, marking those cards as other-day options.
 *
 * The function returns the first departure that respects the earliest possible time.
 */
function findNextOccurrence(flight, earliestDateTime, isFirstLeg, showOtherDays) {
  const scanDays = showOtherDays ? 7 : 0;
  const requestedLocalDay = startOfLocalDay(earliestDateTime);

  for (let offset = 0; offset <= scanDays; offset++) {
    const candidateDate = new Date(earliestDateTime);
    candidateDate.setHours(0, 0, 0, 0);
    candidateDate.setDate(candidateDate.getDate() + offset);

    if (!operatesOn(flight, candidateDate)) continue;

    const departure = combineDateAndTime(candidateDate, flight.dep, 0);
    if (departure < earliestDateTime) continue;

    const arrival = combineDateAndTime(candidateDate, flight.arr, flight.arr_day_offset);
    return {
      departure,
      arrival,
      availability: sameLocalDay(candidateDate, requestedLocalDay) ? "match" : "other-day",
      requestedDay: DAY_NAMES[requestedLocalDay.getDay()],
      actualDay: DAY_NAMES[candidateDate.getDay()]
    };
  }

  return null;
}


function buildRoutes({ origin, destination, date, maxLegs, minConnection, showOtherDays }) {
  const results = [];
  const startDate = new Date(`${date}T00:00:00`);

  function dfs(currentAirport, earliestDeparture, path, visitedAirports) {
    if (path.length >= maxLegs) return;

    const outgoing = flights
      .filter(f => {
        if (f.origin !== currentAirport) return false;

        // Hard rule: BRU is the only Schengen airport allowed in a route.
        if (f.destination !== "BRU" && isSchengen(f.destination)) return false;
        if (f.origin !== "BRU" && isSchengen(f.origin)) return false;

        return true;
      })
      .sort((a, b) => a.dep.localeCompare(b.dep));

    for (const flight of outgoing) {
      if (visitedAirports.has(flight.destination)) continue;

      const isFirstLeg = path.length === 0;
      const occurrence = findNextOccurrence(flight, earliestDeparture, isFirstLeg, showOtherDays);
      if (!occurrence) continue;

      const wait = isFirstLeg
        ? null
        : minutesBetween(path[path.length - 1].arrival, occurrence.departure);

      const leg = {
        flight,
        departure: occurrence.departure,
        arrival: occurrence.arrival,
        wait,
        availability: occurrence.availability,
        requestedDay: occurrence.requestedDay,
        actualDay: occurrence.actualDay
      };

      const newPath = [...path, leg];

      if (flight.destination === destination) {
        results.push(newPath);
      } else {
        const nextEarliestDeparture = new Date(occurrence.arrival);
        nextEarliestDeparture.setMinutes(nextEarliestDeparture.getMinutes() + minConnection);

        dfs(
          flight.destination,
          nextEarliestDeparture,
          newPath,
          new Set([...visitedAirports, flight.destination])
        );
      }
    }
  }

  dfs(origin, startDate, [], new Set([origin]));

  results.sort((routeA, routeB) => {
    const limit = Math.min(routeA.length, routeB.length);
    for (let i = 0; i < limit; i++) {
      const diff = routeA[i].departure.getTime() - routeB[i].departure.getTime();
      if (diff !== 0) return diff;

      const flightDiff = routeA[i].flight.flight_no.localeCompare(routeB[i].flight.flight_no);
      if (flightDiff !== 0) return flightDiff;
    }
    return routeA.length - routeB.length;
  });

  return results;
}

function shortStatusLabel(flight) {
  if (flight.confirmed_far_date) return `✅ FAR ${flight.confirmed_far_date}`;
  const parts = [];
  if (flight.external_file) parts.push("🟡 external");
  if (flight.old_file) parts.push("⚪ old");
  return parts.length ? parts.join(" · ") : "⚠️ unclassified";
}

function flightKey(leg) {
  const f = leg.flight;
  return [
    f.origin,
    f.destination,
    f.airline,
    f.flight_no,
    leg.departure.toISOString(),
    leg.arrival.toISOString()
  ].join("|");
}

/**
 * Converts the flat list of complete routes into one shared-prefix tree.
 * This avoids showing the same first leg several times when it has several
 * possible onward connections.
 */
function buildVisualTree(routes) {
  const root = {
    type: "root",
    airport: "BRU",
    children: []
  };

  for (const route of routes) {
    let current = root;

    for (const leg of route) {
      const key = flightKey(leg);
      let child = current.children.find(node => node.key === key);

      if (!child) {
        child = {
          type: "flight",
          key,
          leg,
          children: []
        };
        current.children.push(child);
      }

      current = child;
    }

    // Store total journey time on the leaf node for this complete route.
    // Total time is calculated from first leg departure to final arrival.
    const firstLeg = route[0];
    const lastLeg = route[route.length - 1];
    current.totalMinutes = minutesBetween(firstLeg.departure, lastLeg.arrival);
    current.totalStart = firstLeg.departure;
    current.totalEnd = lastLeg.arrival;
  }

  sortVisualTree(root);
  return root;
}

/**
 * Keeps each tree level in chronological order.
 * This is operationally important: the user should read alternatives from
 * earliest to latest departure within the same branch/column.
 */
function sortVisualTree(node) {
  node.children.sort((a, b) => {
    const dateDiff = a.leg.departure.getTime() - b.leg.departure.getTime();
    if (dateDiff !== 0) return dateDiff;

    return a.leg.flight.flight_no.localeCompare(b.leg.flight.flight_no);
  });

  for (const child of node.children) sortVisualTree(child);
}

function renderRootNode(root) {
  return `
    <div class="root-node">
      <div class="airport-code">${root.airport}</div>
      <div class="root-subtitle">Fixed origin</div>
    </div>
  `;
}

function renderDaysBar(leg) {
  const activeDays = new Set(expandsDays(leg.flight));
  return `
    <div class="days-bar" title="Operates: ${leg.flight.days}">
      ${["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map(day => {
        const isActive = activeDays.has(day);
        const isActual = day === leg.actualDay;
        const isRequested = day === leg.requestedDay;
        const classes = ["day-chip", isActive ? "day-active" : "day-inactive", isActual ? "day-actual" : "", isRequested ? "day-requested" : ""].join(" ");
        return `<span class="${classes}">${day.slice(0, 2)}</span>`;
      }).join("")}
    </div>
  `;
}

function availabilityLabel(leg) {
  if (leg.availability === "other-day") {
    return `○ next available ${leg.actualDay}; requested ${leg.requestedDay}`;
  }
  return `● matches ${leg.actualDay}`;
}

function airportDisplayName(code) {
  const airport = airports.get(String(code).toUpperCase());
  return airport ? airport.name : "";
}

function renderFlightNode(leg) {
  const f = leg.flight;
  const availabilityClass = leg.availability === "other-day" ? "flight-other-day" : "flight-match";
  const destinationName = airportDisplayName(f.destination);
  return `
    <div class="flight-node ${availabilityClass}">
      <div class="node-title">
        ${f.origin} → ${f.destination}${destinationName ? ` <span class="destination-name-inline">${destinationName}</span>` : ""}
      </div>
      <div class="node-flight">${f.airline} ${f.flight_no}</div>
      <div class="node-time">${formatDateTime(leg.departure)} → ${formatDateTime(leg.arrival)}</div>
      ${renderDaysBar(leg)}
      <div class="node-availability">${availabilityLabel(leg)}</div>
      <div class="node-status">${shortStatusLabel(f)}</div>
      ${f.notes ? `<div class="node-notes">${f.notes}</div>` : ""}
    </div>
  `;
}

function renderConnectionBox(leg, longWait) {
  if (leg.wait === null) {
    return `<div class="connection first-connection">first leg</div>`;
  }

  const css = waitClass(leg.wait, longWait);
  const label = leg.wait >= longWait * 60 ? "long wait" : "wait";

  return `
    <div class="connection ${css}">
      <span>${label}</span>
      <strong>${formatDuration(leg.wait)}</strong>
    </div>
  `;
}

function renderTotalBox(node) {
  if (typeof node.totalMinutes !== "number") return "";

  return `
    <div class="total-route-row">
      <div class="edge-line"></div>
      <div class="connection total-connection" title="Departure to final arrival: ${formatDateTime(node.totalStart)} → ${formatDateTime(node.totalEnd)}">
        <span>total</span>
        <strong>${formatDuration(node.totalMinutes)}</strong>
      </div>
    </div>
  `;
}

function renderTreeNode(node, longWait) {
  const currentCard = node.type === "root" ? renderRootNode(node) : renderFlightNode(node.leg);

  if (node.children.length === 0) {
    return `
      <div class="tree-branch">
        <div class="tree-current">${currentCard}</div>
        ${node.type === "flight" ? `<div class="tree-children total-children">${renderTotalBox(node)}</div>` : ""}
      </div>
    `;
  }

  const children = node.children.map(child => `
    <div class="child-row">
      <div class="edge-line"></div>
      ${renderConnectionBox(child.leg, longWait)}
      ${renderTreeNode(child, longWait)}
    </div>
  `).join("");

  return `
    <div class="tree-branch">
      <div class="tree-current">${currentCard}</div>
      <div class="tree-children">${children}</div>
    </div>
  `;
}

function renderResults(routes, longWait) {
  const tree = document.getElementById("tree");
  const summary = document.getElementById("summary");
  if (routes.length === 0) {
    summary.innerHTML = `<strong>0 routes found.</strong> Try another date, destination, or maximum number of legs.`;
    tree.innerHTML = `<div class="empty">No valid non-Schengen route found with current parameters.</div>`;
    return;
  }

  const longWaitCount = routes.filter(route => route.some(leg => leg.wait !== null && leg.wait >= longWait * 60)).length;
  const otherDayCount = routes.filter(route => route.some(leg => leg.availability === "other-day")).length;
  const visualTree = buildVisualTree(routes);

  summary.innerHTML = `
    <strong>${routes.length} route(s)</strong> found.
    ${longWaitCount > 0 ? `${longWaitCount} include long waits.` : "No long waits above the selected threshold."}
    ${otherDayCount > 0 ? `${otherDayCount} include other-day flight options.` : ""}
  `;

  tree.innerHTML = `<div class="route-tree">${renderTreeNode(visualTree, longWait)}</div>`;
}


function populateDestinationSelectors() {
  const countrySelect = document.getElementById("destinationCountry");
  const airportSelect = document.getElementById("destinationAirport");

  const availableAirports = [...airports.values()]
    .filter(a => a.code.toUpperCase() !== "BRU")
    .filter(a => a.schengen.toLowerCase() !== "yes")
    .sort((a, b) => `${a.country} ${a.code}`.localeCompare(`${b.country} ${b.code}`));

  const countries = [...new Set(availableAirports.map(a => a.country))].sort();

  countrySelect.innerHTML = countries
    .map(country => `<option value="${country}">${country}</option>`)
    .join("");

  const preferredCountry = countries.includes("Brazil") ? "Brazil" : countries[0];
  countrySelect.value = preferredCountry;

  function refreshAirports() {
    const selectedCountry = countrySelect.value;
    const countryAirports = availableAirports.filter(a => a.country === selectedCountry);

    airportSelect.innerHTML = countryAirports
      .map(a => `<option value="${a.code.toUpperCase()}">${a.code.toUpperCase()} — ${a.name}</option>`)
      .join("");

    const hasRAO = countryAirports.some(a => a.code.toUpperCase() === "RAO");
    if (hasRAO) airportSelect.value = "RAO";
  }

  countrySelect.addEventListener("change", refreshAirports);
  refreshAirports();
}

function runSearch() {
  const params = {
    origin: "BRU",
    destination: document.getElementById("destinationAirport").value.trim().toUpperCase(),
    date: document.getElementById("date").value,
    maxLegs: Number(document.getElementById("maxLegs").value),
    minConnection: Number(document.getElementById("minConnection").value),
    showOtherDays: document.getElementById("showOtherDays").checked
  };
  const longWait = Number(document.getElementById("longWait").value);

  if (!params.destination || params.destination.length !== 3) {
    alert("Please enter a valid 3-letter destination airport code.");
    return;
  }

  const routes = buildRoutes(params);
  renderResults(routes, longWait);
}

async function init() {
  const today = new Date();
  document.getElementById("date").valueAsDate = today;

  const airportRows = await loadCSV("data/airports.csv");
  airports = new Map(airportRows.map(a => [a.code.toUpperCase(), a]));

  const flightRows = await loadCSV("data/flights.csv");
  flights = flightRows.map(normaliseFlight);

  populateDestinationSelectors();
  document.getElementById("searchBtn").addEventListener("click", runSearch);
  document.getElementById("showOtherDays").addEventListener("change", runSearch);
  runSearch();
}

init().catch(error => {
  document.getElementById("tree").innerHTML = `<div class="empty">Error: ${error.message}</div>`;
});
