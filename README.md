# Iceland Live

A real-time map of what is happening geologically around Iceland, built on official
data from the Icelandic Meteorological Office (Veðurstofa Íslands).

The homepage *is* the application: you land on a dark map of Iceland with every
earthquake IMO has recorded in your selected window, sized by magnitude and
coloured by how recently it happened. No marketing page, no sign-up.

**Phase 1 scope: doing earthquakes properly.** Volcanic systems are on the map as a
toggleable layer with each system's official IMO aviation colour code. Everything
else in the roadmap is deliberately not built yet.

---

## Contents

- [What it does](#what-it-does)
- [Stack](#stack)
- [Running it](#running-it)
- [Data sources](#data-sources)
- [Architecture](#architecture)
- [Caching](#caching)
- [Analytics: what the numbers mean](#analytics-what-the-numbers-mean)
- [Scientific integrity](#scientific-integrity)
- [Adding a data provider](#adding-a-data-provider)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Credits](#credits)

---

## What it does

- **Full-screen dark map** of Iceland with every earthquake in the selected window.
  Marker size encodes magnitude, colour encodes recency, and the edge treatment
  encodes depth.
- **Five windows** — 1h, 6h, 24h (default), 7d, 30d. Changing one updates the map,
  statistics, timeline and activity feed without a page load.
- **Live statistics** — count, largest, deepest and latest, all computed from the
  events currently in the window. Each is clickable and flies the map to that event.
- **Activity feed** — every event as text, sortable by time, magnitude or depth.
  This is also the accessible route to everything the map shows.
- **Event details** — magnitude and scale, region, exact time, elapsed time, depth,
  coordinates, review status, IMO event id, and when the solution was last revised.
- **Timeline** — event counts binned over the window, with bars coloured by the
  largest magnitude in each bin. Selecting a bar selects the largest event in it.
- **"What's happening"** — a deterministic prose summary generated from the data.
  No language model involved.
- **Activity observations** — thresholded statistical findings (dense clusters,
  repeated M2+ events, rate changes), each with its calculation shown on request.
- **Volcanic systems layer** — central volcanoes, caldera rims and fissure swarms
  from the Catalogue of Icelandic Volcanoes, with each system's official IMO
  aviation colour code.
- **Reykjanes quick-focus**, because it is active and near the capital.
- **Shareable URLs** — `?range=7d&event=IMO2026smblhr&volcanoes=1`.

---

## Stack

| Choice | Why |
| --- | --- |
| **Next.js 16** (App Router) | Server-rendered first paint with real data, plus route handlers for the API proxy. |
| **React 19 + TypeScript** (strict, `noUncheckedIndexedAccess`) | |
| **Tailwind CSS 4** | CSS-first config; design tokens live in `src/app/globals.css`. |
| **MapLibre GL JS 5** | WebGL rendering of thousands of points from one GeoJSON source. See the version note below. |
| **Vitest** | Unit tests for the logic that matters. |

Deliberately **not** used:

- **No charting library.** The timeline is ~200 lines of hand-written SVG. Recharts
  or D3 would have been more code to fight than to write, for one chart that needs
  exact control over its appearance.
- **No component library.** The handful of primitives needed (segmented control,
  bottom sheet, panels) are small, and writing them directly meant getting the
  keyboard and ARIA behaviour right rather than working around someone else's.
- **No clustering.** A 30-day window is ~2,800 points; one WebGL circle layer draws
  that without effort, and clustering would hide the very thing the map is for —
  the shape of a swarm.

Runtime dependencies total four: `next`, `react`, `react-dom`, `maplibre-gl`.

> **MapLibre is pinned to v5 on purpose.** v6 splits its web worker into a sibling
> ESM chunk located via `new URL('./maplibre-gl-worker.mjs', import.meta.url)` — a
> dynamic form no bundler can rewrite. Under Next that URL 404s, the worker dies on
> creation, and the style never finishes loading: a map that reports no error and
> renders nothing at all. v5 ships a single bundle with the worker inlined as a
> blob. Revisit when MapLibre provides a bundler-safe worker entry point.

---

## Running it

Requires Node 20+ (developed on Node 22).

```bash
npm install
npm run dev          # http://localhost:3000
```

There is nothing to configure — the IMO API needs no key. Copy `.env.example` to
`.env.local` only if you want to override a default.

```bash
npm run build        # production build
npm start            # serve the production build

npm run check        # typecheck + lint + tests — run this before committing
npm run typecheck
npm run lint
npm test
npm run test:live    # hits the real IMO API; excluded from `npm test`
```

### Working offline

```bash
EARTHQUAKE_SOURCE=fixture npm run dev
```

Serves a checked-in snapshot of a real IMO response
(`src/providers/fixtures/quakes-snapshot.json`, 844 events over 7 days). The
snapshot's timestamps are shifted forward so recency-dependent UI can be exercised,
and the interface labels itself **Sample data** in orange the whole time. The
provider registry refuses this mode in production builds unless
`ALLOW_FIXTURES_IN_PRODUCTION=true` is set explicitly.

---

## Data sources

Everything comes from IMO's public API gateway at **https://api.vedur.is**, which
hosts eight OpenAPI-documented services (Quakes, Volcanoes, EPOS, CAP, GIS, Weather,
Dispersion, Glaciers). Browse them at https://api.vedur.is.

No API key is required. We send `x-vi-api-version` to pin the schema — IMO rejects
an unknown version with HTTP 400, so a bad pin fails loudly at deploy time instead
of silently shifting data under us.

### Earthquakes — Quakes API (pinned `2026-08-06`)

```
GET https://api.vedur.is/quakes/events
    ?start_time=<ISO>&end_time=<ISO>
    &format=csv
    &system=seiscomp
    &polygon=POLYGON((-27.0 62.0, -12.5 62.0, -12.5 68.5, -27.0 68.5, -27.0 62.0))
```

This is the public gateway to IMO's **SeisComP** catalogue, which replaced the
legacy SIL system as their primary earthquake monitoring system. We request
`system=seiscomp` explicitly rather than relying on the default.

**We use CSV, not GeoJSON, and that is deliberate.** The two formats are not
equivalent: the CSV carries two fields the GeoJSON omits — `status` (IMO's review
state) and `magnitude_type` (the magnitude scale). Both are things worth showing.

Observed CSV columns:

```
event_id, time, latitude, longitude, depth, magnitude, magnitude_type,
status, evaluation_mode, type, region, update_time
```

Columns are resolved by header name, never by position, so an upstream reordering
cannot silently shift values between fields.

The bounding polygon is our own editorial choice, not IMO's. The Icelandic network
detects events as far off as Jan Mayen (~70°N) and the mid-Atlantic (~58°N); those
are real detections but they are not what this site is about. The box keeps every
named Icelandic seismic region, including the Reykjanes Ridge to the south-west and
the Tjörnes fracture zone to the north.

Other endpoints on this service, used or available:

| Endpoint | Status |
| --- | --- |
| `GET /quakes/events` | **In use** |
| `GET /quakes/events/{event_id}` | Available — richer detail with uncertainties and confidence levels. Not yet used; see roadmap. |
| `GET /quakes/events/count` | Available |
| `GET /quakes/regions` | Available — four collections of seismic region polygons |

### Volcanic systems — Volcanoes API (pinned `2026-06-04`)

```
GET https://api.vedur.is/volcanoes/volcanoes?include_geometry=true
```

Returns 34 volcanic systems. IMO republishes the **Catalogue of Icelandic
Volcanoes** here, so the geometry carries its own per-feature attribution, which we
preserve verbatim. Feature types present: central volcano outlines, caldera rims,
fissure swarms, and offshore volcanic zones — all as line work, which is why we draw
them as lines and never fill them (see [Scientific integrity](#scientific-integrity)).

The same payload carries each system's official **aviation colour code** (from its
most recent VONA notice) and its **VALS volcanic alert level**. Both are IMO's
assessments and are shown as such.

### Researched, architected for, not yet integrated

`src/providers/` is shaped so these plug in without touching feature code:

- **EPOS API** (`/epos`, 29 endpoints) — webcams, plume height, ground-based radar
  and DOAS, InSAR interferograms, shakemaps, GNSS stations and RINEX, SO₂ and tephra
  hazard maps, ash/gas dispersion forecasts, eruption catalogue and imagery.
- **CAP API** (`/cap`) — official Common Alerting Protocol warnings, including
  Meteoalarm. This is the correct source for official alerts if we ever show them.
- **GIS API** (`/gis/layers`) — WMS/WFS layers including Grindavík and Svartsengi
  lava barriers, eruption lava extents, glacier outlines, and SIL station locations.
- **Weather API** (`/weather`), **Dispersion**, **Glaciers**.
- Non-IMO: air quality (Environment and Energy Agency), road conditions
  (Vegagerðin / Umferðin), road weather stations, webcams.

---

## Architecture

```
src/
├── domain/          Normalized types. No upstream shapes appear here.
│   ├── earthquake.ts    Earthquake, EventType, ReviewStatus
│   ├── volcano.ts       VolcanicSystem, AviationStatus, VolcanicAlertLevel
│   ├── time-range.ts    The five windows, and how to resolve one to instants
│   └── api.ts           The contract between our routes and the browser
│
├── providers/       Everything that talks to the outside world.
│   ├── types.ts         EarthquakeProvider, VolcanoProvider, ProviderResult, ProviderError
│   ├── registry.ts      The one place that picks an implementation
│   ├── imo/             client · normalize · quakes-provider · volcano-provider
│   └── fixtures/        Offline snapshot provider
│
├── server/          Caching and the degraded-mode policy.
│   ├── cache.ts         TTL cache that keeps serving after upstream failures
│   ├── earthquakes.ts   One upstream window, sliced for every range
│   └── volcanoes.ts
│
├── analytics/       Pure functions over normalized data. Heavily tested.
│   ├── stats.ts         counts, largest, deepest, latest, region tallies
│   ├── histogram.ts     adaptive time binning
│   ├── clusters.ts      DBSCAN + thresholded activity observations
│   └── summary.ts       deterministic prose
│
├── app/             Next.js routes.
│   ├── page.tsx         Server-renders the first payload
│   └── api/             /api/earthquakes · /api/volcanoes
│
├── components/
│   ├── map/             MapView, base-style tuning, layer specs, GeoJSON builders
│   ├── charts/          Timeline
│   ├── ui/              Panels, feed, detail, controls, states
│   └── AppShell.tsx     Orchestration and layout
│
├── hooks/           useEarthquakeData · useUrlState · useNow · useMediaQuery
└── lib/             time · format · geo
```

The dependency rule runs one way: `app` → `components` → `hooks` → `analytics` →
`domain`, with `providers` and `server` reachable only from `app`. No component
imports a provider, and no provider imports a component.

### The provider seam

```ts
interface EarthquakeProvider {
  readonly id: string;
  readonly attribution: ProviderAttribution;
  fetchEarthquakes(query: EarthquakeQuery): Promise<ProviderResult<Earthquake[]>>;
}
```

Every result carries provenance:

```ts
type ProviderMeta = {
  providerId: string;
  freshness: "live" | "cached" | "stale" | "fixture";
  fetchedAt: string;
  degradedReason?: string;
  attribution: ProviderAttribution;
};
```

That `freshness` field is how the interface keeps its promise never to pass cached,
unavailable or sample data off as live. The status pill in the header reads it
directly and is never green unless the payload genuinely came from IMO inside the
cache window.

### Why the server renders first

`src/app/page.tsx` assembles the first payload server-side, so the map, statistics
and summary are in the initial HTML rather than appearing after a client round-trip.
If that fails, the shell renders with `initialData = null` and the client retries —
a transient IMO hiccup does not produce a blank page.

---

## Caching

Three layers, each with a different job.

**1. Next.js data cache — protects IMO.**
The IMO client passes `next: { revalidate: 60 }` for earthquakes and `3600` for
volcanoes. On Vercel this cache is shared across instances, so a busy deployment
issues roughly one upstream request per minute regardless of how many people have
the site open.

**2. In-process snapshot cache — protects us, and survives outages.**
`src/server/earthquakes.ts` requests **one window from IMO — the widest the UI
offers (30 days) — and slices it in memory for every range.** Consequences:

- Switching between 1h and 30d costs no upstream request at all.
- Upstream load is a function of time, not of traffic or of how many ranges people
  click through.
- The ~450 KB catalogue is parsed once per window, not once per request.

TTL is 60s. Past that we *keep* the snapshot for up to 6 hours and serve it if IMO
becomes unreachable, flagged `stale`. That is what puts the amber "last known" banner
on screen instead of an empty map. Concurrent callers share one in-flight fetch.

**3. HTTP cache headers — lets a CDN help.**

| Route | Header |
| --- | --- |
| `/api/earthquakes` (healthy) | `public, s-maxage=60, stale-while-revalidate=300` |
| `/api/earthquakes` (degraded) | `no-store` |
| `/api/volcanoes` (healthy) | `public, s-maxage=3600, stale-while-revalidate=86400` |

Degraded responses are `no-store` so a CDN never pins an outage state in place after
IMO recovers.

Both API routes are `force-dynamic`. `/api/volcanoes` in particular must not
prerender: with `revalidate` it would be generated at build time, and a build-time
upstream failure would be baked into a cached 503 for an hour.

The browser polls every 60s, pauses while the tab is hidden, and catches up on
return. A failed poll never discards data already on screen.

---

## Analytics: what the numbers mean

Every threshold lives in `OBSERVATION_THRESHOLDS` (`src/analytics/clusters.ts`) and
every observation can show its own method in the UI.

**Observation window.** Observations answer "what is notable *now*", so they are
computed over the selected window capped at **48 hours**. The chart and statistics
still cover the full 7 or 30 days; calling a month of ordinary ridge seismicity
"elevated" would be meaningless.

**Dense cluster.** DBSCAN over great-circle distance with `eps = 5 km` and
`minPts = 6`, grid-indexed so it stays near-linear. Reported only when a cluster
holds **≥ 12 events** *and* spans **≤ 20 km**. That radius cap matters: DBSCAN links
density-connected points, so over a long window the continuous seismicity along the
Reykjanes peninsula chains into one group tens of kilometres across. That is regional
background, not a cluster, and we decline to report it as one. The place name is the
IMO region most common among the cluster's members — we never invent a name.

**Repeated moderate events.** Count of M ≥ 2.0 events inside a reported cluster,
surfaced at 3 or more.

**Rate change.** Events per hour in the most recent third of the window versus the
earlier two thirds. Reported at ≥ 2× with at least 10 recent and 5 baseline events —
that last condition stops us announcing a "doubling" that is really one quiet hour
followed by two ordinary ones.

**The summary** is assembled from counts, the dominant region (when one holds ≥ 35%
of events), the largest event, and a note when under half the catalogue has been
reviewed. Same input, same text, every time.

**Event filtering.** IMO only assigns a `type` to events a seismologist has manually
reviewed, so most automatic detections have none. `null` therefore means "not yet
classified", **not** "not an earthquake". We exclude only events IMO has explicitly
classified as something else — `explosion`, `mining explosion`, `ice quake`,
`not locatable`, `not existing`, `outside of network interest` — and keep
unclassified detections, which are ordinary events awaiting review. Excluding them
would hide most recent activity.

---

## Scientific integrity

Iceland Live is visualization software. It is not an emergency warning system, and
the code is written to make that hard to forget.

- **We never fabricate data.** If IMO is unreachable, the UI says so. Cached data is
  labelled as cached, stale data as stale, fixtures as sample data. Production never
  silently substitutes anything.
- **Our analytics are arithmetic, not interpretation.** Observations state the
  numbers they came from and can show their own method. A test asserts that no
  generated string contains predictive or hazard language (`precursor`, `imminent`,
  `erupt`, `warning`, `evacuate`, …).
- **Official status is IMO's, shown as IMO's.** The aviation colour codes are
  rendered in their published colours with IMO's own wording and attribution,
  visually distinct from our monochrome-and-amber analytics.
- **We do not draw hazard zones.** The Catalogue publishes volcanic systems as line
  work, so we draw lines. A filled polygon reads as a zone with an inside and an
  outside — a claim this dataset does not make.
- **Missing is not zero.** A depth of `0 km` and an unreported depth are different
  facts and render differently (`0.0 km` versus `—`).
- **No activity index.** A LOW/MODERATE/ELEVATED/HIGH badge is on the roadmap only as
  an explicitly site-specific statistical index with published metrics, clearly
  separated from official warning levels. It is not implemented, and a half-designed
  version would be worse than none.

---

## Adding a data provider

Say you want air quality. Four steps, none of which touch a component:

**1. Add the normalized type** — `src/domain/air-quality.ts`:

```ts
export type AirQualityReading = {
  stationId: string;
  stationName: string;
  observedAt: string;   // ISO 8601 UTC
  latitude: number;
  longitude: number;
  so2: number | null;   // µg/m³ — null means "not reported", never 0
  pm25: number | null;
  source: "UST";
};
```

**2. Declare the contract** in `src/providers/types.ts`:

```ts
export interface AirQualityProvider {
  readonly id: string;
  readonly attribution: ProviderAttribution;
  fetchReadings(query: AirQualityQuery): Promise<ProviderResult<AirQualityReading[]>>;
}
```

**3. Implement it** under `src/providers/<source>/`, keeping the upstream response
shape *inside that folder*. Reuse the HTTP client if the source is another IMO
service (`imoFetchJson({ service: "epos", path: "/gps/station" })`); otherwise write
a sibling client that throws the same `ProviderError` kinds. Return a
`ProviderMeta` with honest `freshness`.

**4. Register and serve it** — add a getter to `src/providers/registry.ts`, a
service in `src/server/` if it needs caching (reuse `TtlCache` and copy the
stale-fallback shape from `earthquakes.ts`), and a route handler under
`src/app/api/`.

Tests go next to the normalizer. The normalization tests are the valuable ones —
that is where upstream reality meets our assumptions.

---

## Known limitations

- **Magnitude semantics are mixed.** Live data contains both `ML_SIL` (local
  magnitude) and `Mpgv_w`. We display the scale alongside the number but do not
  convert between them, and "largest" compares them directly. That is defensible for
  a headline figure but is not a rigorous comparison.
- **Automatic solutions dominate recent data.** In a typical 24-hour window only a
  quarter to a third of events have been reviewed by a seismologist; the rest can
  move or vanish.
  The UI marks them `auto` and the summary says what share is reviewed.
- **The detail endpoint is not used yet.** `GET /quakes/events/{id}` returns location
  and magnitude uncertainties, confidence levels and `depthType`. We show only what
  the bulk CSV carries, so no error bars appear anywhere.
- **Depth is capped upstream.** The Quakes API constrains `depth_max` to 50 km. Any
  deeper event would be invisible to us. (Icelandic seismicity is overwhelmingly
  shallower than 30 km, so this is close to theoretical.)
- **The bounding polygon is editorial.** Events near its edge — far Reykjanes Ridge,
  Kolbeinsey — may drop in and out. Jan Mayen is excluded by choice.
- **Aviation colour codes are point-in-time.** We show the current VONA per system.
  We do not show VONA history, and a system with no VONA ever issued shows no dot.
- **Region names are Icelandic.** IMO's `name_en` is frequently `null`, so we show
  the Icelandic name rather than invent a translation. The interface is otherwise in
  English.
- **No offline support.** No service worker; a dropped connection shows the offline
  state rather than a cached map.
- **Basemap tiles are third-party.** Land, coastline and settlement names come from
  CARTO/OpenStreetMap, not from IMO.

---

## Roadmap

**Next up**

1. **Event detail from `/quakes/events/{id}`** — fetch on selection to show location
   and depth uncertainty, confidence level and `depthType`. Turns "5.2 km" into
   "5.2 ± 1.9 km" and is honest about how well-constrained an automatic solution is.
2. **Official alerts from the CAP API** — real IMO and Civil Protection warnings,
   clearly separated from our analytics. This is the single highest-value addition,
   and the API is already documented and reachable.
3. **Reykjanes detail mode** — Svartsengi, Sundhnúkur, Fagradalsfjall, Grindavík and
   the Blue Lagoon as named reference points, plus the lava-barrier layers already
   published through the GIS API.

**Later**

- *Volcano mode* — EPOS webcams, plume height, shakemaps, InSAR, GNSS deformation.
- *Air* — SO₂, PM2.5, PM10, H₂S, NO₂ from the Environment and Energy Agency.
- *Roads* — conditions, closures, road weather stations, webcams (Vegagerðin).
- *Weather* — wind, precipitation, temperature, alerts.
- *Historical analytics* — is activity increasing, how unusual is today, where has
  activity migrated. Requires great care to keep description separate from
  interpretation.
- *Activity index* — only as an explicitly site-specific statistical index with
  published metrics, never as an unofficial hazard level.

---

## Credits

**Earthquake data**: [Icelandic Meteorological Office (Veðurstofa Íslands)](https://en.vedur.is/),
via the public Quakes API. IMO's SeisComP catalogue.

**Volcanic systems**: [Catalogue of Icelandic Volcanoes](https://icelandicvolcanoes.is/),
published through IMO's Volcanoes API — a collaboration of IMO, the Institute of
Earth Sciences at the University of Iceland, the Icelandic Institute of Natural
History and Iceland GeoSurvey (ÍSOR). Individual features credit their originating
institution in the data, and those strings are preserved and shown.

**Basemap**: [CARTO](https://carto.com/attributions) · [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

For official warnings and hazard information, always go to
[vedur.is](https://en.vedur.is/) and [almannavarnir.is](https://www.almannavarnir.is/).
This site is not affiliated with either.
