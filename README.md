# Iceland Live

A real-time map of what is happening geologically around Iceland, built on official
data from the Icelandic Meteorological Office (Veðurstofa Íslands).

The homepage *is* the application: you land on a dark map of Iceland with every
earthquake IMO has recorded in your selected window, sized by magnitude and
coloured by how recently it happened. No marketing page, no sign-up.

**Scope.** Earthquakes are the core and are done properly. On top of that sit
layers built on official data: volcanic systems with their IMO aviation colour
codes, official CAP warnings, Reykjanes detail (lava, barriers, graben) and
published radar interferograms. Everything else in the roadmap is deliberately
not built yet.

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
  Opening an event also fetches its full solution, adding the uncertainties on
  magnitude, location, origin time and depth at IMO's stated confidence level.
- **Official warnings** — the IMO warnings currently in force, relayed unaltered
  from the CAP broker, in IMO's own colours and clearly separated from our
  analytics. Geological warnings are tagged as such, and a warning's area can be
  drawn on the map.
- **Timeline** — event counts binned over the window, with bars coloured by the
  largest magnitude in each bin. Selecting a bar selects the largest event in it.
- **"What's happening"** — a deterministic prose summary generated from the data.
  No language model involved.
- **Activity observations** — thresholded statistical findings (dense clusters,
  repeated M2+ events, rate changes), each with its calculation shown on request,
  and each compared against that region's own preceding record so "46 earthquakes
  in 26 hours" comes with "about 11× the usual rate for Norðurland".
- **Volcanic systems layer** — central volcanoes, caldera rims and fissure swarms
  from the Catalogue of Icelandic Volcanoes, with each system's official IMO
  aviation colour code.
- **Reykjanes detail layer** — lava from the twelve mapped eruptions of 2021–2025,
  the lava barriers protecting Grindavík and Svartsengi, the Grindavík subsidence
  graben as mapped from InSAR, and the peninsula's geothermal plants.
- **Ground deformation** — IMO's published radar interferograms, laid over the map
  georeferenced, plus the GNSS station network.
- **By region** — every active region for the window, ranked by how unusual it is
  *for itself*. Twenty-two events at Kleifarvatn is an ordinary day; eight on the
  Reykjanes Ridge is not, and a raw count cannot tell you that.
- **Depth over time** — depth against time for any observation's events, so a
  cluster confined to one level reads differently from one spanning the crust.
- **Live road cameras** — Vegagerðin's national network, ordered by distance from
  wherever the activity is, refreshing about once a minute.
- **Quick-focus viewpoints** for Iceland, Reykjanes and Grindavík.
- **Shareable URLs** — `?range=7d&event=<id>&volcanoes=1&reykjanes=1&deformation=1&cams=1&insar=<id>`.

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
| `GET /quakes/events` | **In use** — the bulk catalogue |
| `GET /quakes/events/{event_id}` | **In use** — per-event solution with uncertainties, fetched on selection |
| `GET /quakes/events/count` | Available |
| `GET /quakes/regions` | Available — four collections of seismic region polygons |

#### Per-event uncertainties, and the units problem

`GET /quakes/events/{id}` mirrors SeisComP's origin and magnitude structure, and
reports every number as a string. It has **no response schema in the OpenAPI
spec and documents no units**, so the units were established by inspecting live
data across the quality range:

- `time.uncertainty` — seconds (observed 0.04–0.25).
- `depth.uncertainty` — kilometres, matching the depth value itself.
- `latitude`/`longitude.uncertainty` — **kilometres, not degrees.** Observed
  values run 0.2–3.8. Read as degrees those would be horizontal errors of
  22–420 km, which is not a solution IMO would publish as reviewed.
- `confidenceLevel` — percent, arriving as `89.99999761581421` for 90%.

The field that matters most is `depthType`. When the recorded phases cannot
constrain depth, IMO fixes it — usually at 10 km — and marks the solution
`depthType: "operator assigned"` with an uncertainty of exactly `0`. Rendered
naively that reads as "10.0 ± 0.0 km", i.e. perfectly known, which is precisely
backwards. Those solutions are shown as "10.0 km (fixed)" with an explanation,
and `isFixedDepth()` guards every place depth meets an error bar.

### Official warnings — CAP API (pinned `2026-04-14`)

```
GET https://api.vedur.is/cap/capbroker/active/category/all
GET https://api.vedur.is/cap/capbroker/sender/{sender}/identifier/{id}/sent/{sent}/json
```

IMO's broker for OASIS CAP 1.2 messages. We list the active identifiers and then
fetch each message, rather than using the flatter `/active/detailed/all`: the
two-step route returns canonical CAP, a published standard, and it is the shape
we could verify against real messages.

Three things this integration has to get right:

- **The payload is XML converted to JSON**, which collapses single-element
  sequences into bare objects. `info` is an array when IMO publishes both
  languages and an object when it publishes one; the same goes for `area`,
  `parameter` and `eventCode`. All are read through `asArray`.
- **CAP polygons are `latitude,longitude`**, the opposite of GeoJSON. Read the
  wrong way round an Icelandic warning lands in the Indian Ocean.
- **Only `status: "Actual"` is shown.** CAP also carries `Test`, `Exercise`,
  `Draft` and `System`. Presenting a drill as a live warning is the worst thing
  this product could do, so the filter lives in the normalizer, once.

No warnings in force is the normal state: the broker answers `204 No Content`,
which resolves to an empty list and renders nothing. "None in force" and "we
could not ask" are tracked separately.

### Reykjanes detail — GeoServer WFS

Four datasets, discovered through the gateway's own index (`GET /gis/layers`)
rather than guessed, and fetched as GeoJSON in EPSG:4326:

| Layer | Source | Endpoint |
| --- | --- | --- |
| Lava flows, 2021–2025 | Náttúrufræðistofnun Íslands / Landmælingar Íslands | `gis.natt.is` — `LMI_vektor:goslok_reykjaneselda` |
| Lava barriers | Icelandic Meteorological Office | `geo.vedur.is` — `infrastructure:Svartsengi_Grindavik_lava_Barriers` |
| Grindavík graben | Landmælingar Íslands (InSAR, Nov 2023) | `gis.lmi.is` — `…graben_formation_graben_outline` |
| Geothermal plants | Orkustofnun | `gis.lmi.is` — `orkustofnun:gisvirkjun` |

The lava layer carries each eruption's working name, start and end dates, mapped
area and erupted volume — twelve eruptions from Geldingadalir (March 2021) to
Sundhnúksgígar IX (July 2025).

It also arrives as **5.5 MB of GeoJSON**, mapped at roughly one vertex every ten
metres, with one outline alone holding 226,776 points. At the zooms where lava is
visible that detail is well below a pixel, so it is simplified server-side
(Ramer–Douglas–Peucker, 20 m tolerance) to about 2% of the original — the whole
Reykjanes payload is then ~118 KB. The implementation is iterative rather than
recursive because the recursive form overflows the stack on that largest ring.

The four fetches run concurrently and each may fail on its own: one GeoServer
being down costs that layer, not the whole view, and the legend credits only the
datasets that actually arrived.

**On reference points.** No coordinates are hand-typed. Svartsengi and
Reykjanesvirkjun come from Orkustofnun's register, filtered by bounding box
rather than by name. Grindavík and the Blue Lagoon are left to the basemap,
which already labels them — an invented coordinate sitting beside surveyed data
would be indistinguishable from it. The quick-focus viewpoints are camera
framing, which is a hint about where to look, not a claim about where something
is.

### Deformation — EPOS API (pinned `2026-02-05`)

```
GET https://api.vedur.is/epos/satellite/insar/wrapped
GET https://api.vedur.is/epos/gps/station?format_type=GeoJSON
```

**What EPOS publishes, and what it does not.** This is worth stating plainly
because it shaped the feature:

- **Interferograms — yes.** 142 products covering Fagradalsfjall (to October
  2023) and Sundhnúkur (to July 2025). Each is a finished IMO product: two radar
  acquisitions differenced, with a rendered PNG, a bounding box, both
  acquisition dates, the orbit direction and the satellite. We lay the published
  image over the map, georeferenced to its own bounds, and measure nothing from
  it.
- **GNSS displacement time series — no.** The `/gps/*` endpoints serve station
  metadata, site logs, and raw RINEX observation files. Turning RINEX into
  displacements requires full geodetic processing; doing that here and
  presenting the result as fact is exactly what this project refuses to do. So
  the GNSS layer shows where the instruments are and links to IMO's own data —
  14 stations on Reykjanes, including SENG at Svartsengi and GRIV at Grindavík.
- **Live webcams — no.** The webcam endpoint holds three datasets, all from the
  2014–15 Holuhraun eruption, published as `.tar.gz` archives. There is no live
  camera feed in this API.

The same applies to plume height: real CoverageJSON observations, but from past
eruptions rather than a current feed.

**The image proxy.** `data.epos-iceland.is` serves the PNGs with no
`Access-Control-Allow-Origin` header, and MapLibre draws a raster source onto a
WebGL texture — a cross-origin read the browser refuses. So the images are
served through `/api/insar/image`, which is allowlisted to `https` URLs on that
one host with a `.png` path. A proxy that fetches whatever a query parameter
names is an open relay, usable to reach internal addresses from our own server.
The products are immutable (the filename encodes sensor and both dates), so they
are cached for a year.

### Road cameras — Vegagerðin open data

```
GET https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1
```

IMO's own webcam endpoint holds three `.tar.gz` archives from the 2014–15
Holuhraun eruption and nothing live, so the cameras come from the **Icelandic
Road and Coastal Administration** instead: ~497 views across ~165 sites,
refreshing several times an hour. The coverage happens to be exactly what this
product wants — Gíghæð on Grindavíkurvegur, Festarfjall on Suðurstrandarvegur,
Kleifarvatn and Sveifluháls on Krýsuvíkurvegur.

Field names are Icelandic, and one is a trap: `Breidd` is **latitude** (it also
means "width") and `Lengd` is **longitude**.

**Terms.** IRCA's open data licence permits copying, publishing, distributing
and commercial use, on condition that the source is acknowledged with a specific
sentence and that use does not imply official status or endorsement. That
sentence — *"Based on information provided by the Icelandic Road and Coastal
Administration (IRCA)"* — is in `IRCA_ATTRIBUTION` and is rendered wherever the
images appear, alongside a note that we are not affiliated with them.

**The image proxy.** Unlike the interferograms this is not a CORS requirement —
an `<img>` needs no CORS. It is a courtesy: every viewer loading directly would
put our traffic on IRCA's servers, whereas proxying with a 60-second shared
cache means they see at most one request per image per minute however many
people have the page open. It also keeps our referrer off their logs and gives
us one place to stop if they ask. Same allowlist discipline as the
interferogram proxy: `https`, their host, an image extension.

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
- **CAP API** — Meteoalarm feeds and the historical archive
  (`/capbroker/sent/from/…`). The active-warnings path is in use; these are not.
- **GIS API** (`/gis/layers`) — 36 indexed layers. Four are in use for Reykjanes;
  the rest include glacier outlines, SIL station locations, high-temperature
  geothermal areas, South Iceland seismic fractures and Holocene eruptive fissures.
- **Weather API** (`/weather`), **Dispersion**, **Glaciers**.
- Non-IMO: air quality (Environment and Energy Agency), road conditions
  (Vegagerðin / Umferðin), road weather stations, webcams.

---

## Architecture

```
src/
├── domain/          Normalized types. No upstream shapes appear here.
│   ├── earthquake.ts    Earthquake, EventType, ReviewStatus
│   ├── earthquake-detail.ts   Measured values, isFixedDepth
│   ├── alert.ts         OfficialAlert — IMO's assessment, never ours
│   ├── deformation.ts   Interferogram, GnssStation
│   ├── region-history.ts  a year of per-region daily counts
│   ├── webcam.ts        WebcamSite, IRCA attribution
│   ├── reykjanes.ts     Lava flows, barriers, graben, facilities
│   ├── volcano.ts       VolcanicSystem, AviationStatus, VolcanicAlertLevel
│   ├── time-range.ts    The five windows, and how to resolve one to instants
│   └── api.ts           The contract between our routes and the browser
│
├── providers/       Everything that talks to the outside world.
│   ├── types.ts         EarthquakeProvider, VolcanoProvider, ProviderResult, ProviderError
│   ├── registry.ts      The one place that picks an implementation
│   ├── imo/             client · quakes · detail · volcanoes · CAP · EPOS
│   ├── gis/             WFS client · Reykjanes layers (lava, barriers, graben)
│   ├── vegagerdin/      live road cameras
│   └── fixtures/        Offline snapshot provider
│
├── server/          Caching and the degraded-mode policy.
│   ├── cache.ts         TTL cache that keeps serving after upstream failures
│   ├── earthquakes.ts   One upstream window, sliced for every range
│   ├── earthquake-detail.ts   Per-event solutions, bounded LRU
│   ├── alerts.ts        Official warnings
│   ├── volcanoes.ts
│   ├── reykjanes.ts
│   ├── deformation.ts   interferograms + GNSS network
│   ├── region-history.ts  the year that baselines compare against
│   └── webcams.ts
│
├── analytics/       Pure functions over normalized data. Heavily tested.
│   ├── stats.ts         counts, largest, deepest, latest, region tallies
│   ├── histogram.ts     adaptive time binning
│   ├── clusters.ts      DBSCAN + thresholded activity observations
│   ├── baseline.ts      region rate and rank vs its own year
│   └── summary.ts       deterministic prose
│
├── app/             Next.js routes.
│   ├── page.tsx         Server-renders the first payload
│   └── api/             /api/earthquakes[/:id] · /api/alerts · /api/volcanoes
│                        /api/reykjanes · /api/insar[/image]
│                        /api/webcams[/image]
│
├── components/
│   ├── map/             MapView, base-style tuning, layer specs, GeoJSON builders
│   ├── charts/          Timeline · DepthProfile
│   ├── ui/              Panels, feed, detail, controls, states
│   └── AppShell.tsx     Orchestration and layout
│
├── hooks/           useEarthquakeData · useEarthquakeDetail · useAlerts
│                  useReykjanesLayer · useDeformation · useWebcams
│                  useUrlState · useNow · useMediaQuery
└── lib/             time · format · geo · simplify
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

| Route | Header | In-process TTL / stale window |
| --- | --- | --- |
| `/api/earthquakes` | `s-maxage=60, swr=300` | 60s / 6h |
| `/api/earthquakes/{id}` | `s-maxage=300, swr=1800` | 5min / 1h, 500-entry LRU |
| `/api/alerts` | `s-maxage=180, swr=600` | 3min / 30min |
| `/api/volcanoes` | `s-maxage=3600, swr=86400` | 1h / 24h |
| `/api/reykjanes` | `s-maxage=86400, swr=604800` | 24h / 7d |
| `/api/insar` | `s-maxage=21600, swr=604800` | 6h / 7d |
| `/api/insar/image` | `max-age=31536000, immutable` | — (proxied, immutable) |
| `/api/webcams` | `s-maxage=21600, swr=604800` | 6h / 7d (catalogue only) |
| `/api/webcams/image` | `s-maxage=60, swr=120` | — (proxied, deliberately short) |

The year of region history is cached separately for 24 hours and kept for a
fortnight: one upstream request a day for ~35,000 events, reduced in about 30 ms
to ~86 KB of daily counts. A baseline a day out of date is still a good
baseline; having none costs every observation its context.
| any of them, degraded | `no-store` | — |

The stale windows are not uniform, and the differences are deliberate. Six hours
of stale earthquakes is acceptable because an out-of-date map of past seismicity
is still true. Thirty minutes is the limit for warnings, because a lapsed warning
is not. Reykjanes geometry is kept for a week because those surveys are finished
and will never change. Per-event detail is keyed by event id, which is unbounded,
so that cache is size-capped as well as time-capped.

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

**Baselines.** A cluster observation also states how that area's current rate
compares with its own record, because "46 earthquakes in 26 hours" is a fact a
reader cannot judge without knowing what the area normally does — forty a day is
routine on the Reykjanes Ridge and remarkable under Öræfajökull.

The comparison is against **a year** of that region's daily counts, and the
window is also **ranked inside that region's own distribution**. The ranking is
the part that actually answers "is this unusual": a 3× ratio means something
different in a region that swings by an order of magnitude week to week than in
one that never does. Days with no recorded events count as zeros, because
ranking today only against days a region was already active flatters quiet
regions into looking permanently busy.

A rank sentence only ever *qualifies* a rate already outside the typical band.
In a region whose daily count barely varies, a rate a shade above the mean can
outrank every day on record while being entirely ordinary, and "close to the
usual rate, and among the busiest days ever" contradicts itself.

The comparison is made **across the whole region, not the cluster** — a cluster
is a spatial group picked out by this window, so it has no history to compare
against; the region does. Ratios between 0.6 and 1.6 are reported as "close to
the usual rate" rather than as a number, and nothing is reported below 5 events
in the window, 8 in the baseline, or 3 days of history. The method note states
whether the window was excluded from its own baseline — true over a month, where
leaving the burst in hides it; false over a year, where one day moves the mean by
a fraction of a percent.

**Why a year and not a decade.** The Quakes API accepts dates back to 1991, but
the SeisComP catalogue only begins around 2015 and is patchy before 2020 — the
earlier record lives in the legacy SIL system, which has different detection
characteristics and a different completeness threshold. Comparing across the two
would manufacture rate changes that are really catalogue changes. Continuity was
checked month by month over 18 months before settling on a year.

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
- **Official status is IMO's, shown as IMO's.** Aviation colour codes and CAP
  warnings are rendered in their published colours with IMO's own wording and
  attribution, visually distinct from our monochrome-and-amber analytics. We
  relay them; we never derive, adjust or summarise them. Drills and drafts
  (`status` other than `Actual`) are refused outright.
- **An absent error bar is not a zero one.** A fixed depth renders as "fixed"
  with an explanation rather than as "± 0.0 km", and an unreported uncertainty
  renders as nothing rather than as zero.
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
- **Uncertainty units are inferred, not documented.** The per-event endpoint has no
  response schema and states no units. Kilometres for horizontal and depth error,
  seconds for time, is the only reading consistent with live data across the
  quality range — but it is an inference, and it is the first thing to re-check if
  IMO publishes a schema.
- **Warnings are relayed, not interpreted.** We show what is in force; we do not
  model what it means for a given location, and a warning's polygon is IMO's
  forecast region, not a precise hazard boundary.
- **Deformation is not live.** Interferograms appear only after IMO processes an
  acquisition pair; the most recent covers July 2025. There is no real-time
  deformation here, and none is available through this API.
- **Baselines are only as good as a year.** A region whose whole year was
  unusual will have an unusual baseline, and the SeisComP record does not go back
  far enough to do better without mixing catalogues. The period is always stated
  for exactly this reason.
- **Region baselines are region-shaped.** IMO's seismic regions vary enormously
  in area, so a ratio compares a region with its own past and never one region
  with another. The list sorts by that ratio; it does not claim Norðurland and
  Kleifarvatn are comparable places.
- **Road cameras point at roads.** They are the best live imagery publicly
  available for Iceland, but they were installed to show driving conditions. A
  camera near an eruption may well be looking the other way.
- **Depth is inferred as fixed from its value.** The bulk catalogue carries no
  `depthType`, so the depth chart marks exactly 10.00 km as assigned. The detail
  panel gets the real answer from the per-event endpoint; the chart is a hint.
- **Reykjanes lava is historical.** Twelve mapped eruptions through July 2025. If
  a new eruption began, its flow would not appear here until the surveying
  agencies published an outline — this layer is a record, not a live feed.
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

1. **Air quality.** The Environment and Energy Agency publishes SO₂, PM2.5 and
   H₂S from a monitoring network, and volcanic gas is the hazard that most often
   reaches Reykjavík when Reykjanes erupts. It is the largest remaining gap
   between this site and "what do I actually need to know today".
2. **Road conditions to go with the cameras.** Vegagerðin's DATEX II and
   road-condition services sit beside the webcam API already in use, and a
   camera showing a closed road is more useful when the closure is labelled.
3. **Persisting the region history.** The year of daily counts is rebuilt from
   scratch on a cold start, which costs one 5 MB fetch. Storing the reduced
   counts would make cold starts instant and open the door to multi-year
   baselines without re-fetching.

**Later**

- *Volcano mode* — EPOS shakemaps, eruption imagery, tephra and SO₂ hazard maps.
- *Air* — SO₂, PM2.5, PM10, H₂S, NO₂ from the Environment and Energy Agency.
- *Roads* — conditions, closures, road weather stations (Vegagerðin).
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

**Official warnings**: [Icelandic Meteorological Office](https://en.vedur.is/weather/warnings/),
via its CAP broker. Relayed unaltered.

**Reykjanes layers**: lava outlines from
[Náttúrufræðistofnun Íslands](https://www.ni.is/) and
[Landmælingar Íslands](https://www.lmi.is/); lava barriers from the Icelandic
Meteorological Office; Grindavík graben mapping from Landmælingar Íslands
(InSAR, November 2023); geothermal plant locations from
[Orkustofnun](https://orkustofnun.is/). Served through those agencies' public
GeoServer instances, indexed by IMO's GIS API.

**Deformation**: interferograms and GNSS station metadata from
[EPOS Iceland](https://api.vedur.is/epos/), operated by the Icelandic
Meteorological Office. Sentinel-1, TerraSAR-X, COSMO-SkyMed and SAOCOM
acquisitions, processed and published by IMO.

**Road cameras**: Based on information provided by the Icelandic Road and
Coastal Administration (IRCA) — [Vegagerðin](https://www.vegagerdin.is/), used
under their [open data terms](https://www.vegagerdin.is/vegagerdin/gagnasafn/vefthjonustur/terms-and-conditions).
Iceland Live is not affiliated with IRCA and this use is not endorsed by them.

**Basemap**: [CARTO](https://carto.com/attributions) · [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

For official warnings and hazard information, always go to
[vedur.is](https://en.vedur.is/) and [almannavarnir.is](https://www.almannavarnir.is/).
This site is not affiliated with either.
