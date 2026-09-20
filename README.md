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
  wherever the activity is. Select one on the map or in the list to watch it. These
  are stills, not video, and there is no stream to give you; the viewer polls every
  two minutes and steps back through the frames **the server** has collected, so the
  reel can reach past the moment you arrived.
- **Air & roads** — SO₂, H₂S and particulates from the Environment and Energy
  Agency's monitoring network, each with its last 24 hours as a sparkline and a
  rising/falling note; live wind drawn as downwind arrows; and every road segment
  that is not plainly clear, drawn on the map.
- **Air on the earthquake timeline** — the selected station's series drawn under
  the activity histogram on exactly the same x-axis, so a gas episode and a swarm
  can be read against one another. Shown together, never correlated.
- **Observation periods on both charts** — the stretch each observation's sentence
  is about, marked on the histogram and on the air trace at identical extents, so
  "over 8 hours" is a thing you can see rather than reconstruct from two clocks.
- **Dispersal simulations** — IMO's tephra and SO₂ dispersal runs, the raster laid
  over the map in Web Mercator with IMO's own colour scale, steppable hour by hour
  across the forecast window, evaluable at any monitoring station — IMO's own
  numbers at that coordinate, beside what the instrument there is actually
  measuring — and reduced to the road-weather stations the run's own footprint
  covers, ranked by how much the model puts at each. **These model eruptions that are not happening**: IMO produces them
  several times a day for selected volcanoes so the answer exists if one ever
  starts, and the panel says so before it lists anything.
- **Quick-focus viewpoints** for Iceland, Reykjanes and Grindavík.
- **Shareable URLs** — `?range=7d&event=<id>&volcanoes=1&reykjanes=1&deformation=1&cams=1&air=1&plume=1&insar=<id>&run=<uuid>`.

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

### Air quality — Environment and Energy Agency

```
GET https://api.ust.is/aq/a/getStations   — station metadata with coordinates
GET https://api.ust.is/aq/a/getLatest     — last 24 hours, hourly, per station
```

Volcanic gas is the hazard from a Reykjanes eruption that reaches the most
people, and SO₂ and H₂S are what this network measures. The two endpoints have
to be joined on `local_id`: measurements carry no position, metadata carries no
measurements.

Three things worth recording:

- **`Accept: application/json` gets a 406.** `api.ust.is` answers *406 Not
  Acceptable* to an explicit JSON accept header while serving exactly that, and
  works with `*/*` or no header at all. Its content negotiation evidently does
  not advertise the type it returns.
- **Everything live is unverified.** The agency documents `verification: 1` as
  verified and `3` as not verified; every real-time reading is `3`. This is the
  same situation as an unreviewed earthquake solution and is labelled the same
  way.
- **Negative concentrations appear and are dropped.** About 3% of live readings
  carry a value below zero — baseline drift near the detection limit. A mass
  concentration cannot be negative, so displaying it would present noise as a
  measurement and clamping it to zero would invent a reading that was never
  taken. The sample is treated as absent, which is what it is. A measured zero
  is kept.

**We report the measurements and do not grade them.** The agency publishes a
health scale for these pollutants and is linked as the place to read one; a
colour band invented here would be a health judgement this project has no
standing to make. Map markers are sized by measured gas, never coloured by a
band.

### Road weather and conditions — Vegagerðin open data

```
GET https://gagnaveita.vegagerdin.is/api/vedur2014_1   — ~203 weather stations
GET https://gagnaveita.vegagerdin.is/api/faerd2014_1   — ~970 road segments
```

Neither endpoint is listed in Vegagerðin's public documentation; both were found
by matching the naming pattern of the documented webcam endpoint.

**Weather stations** carry coordinates and live readings, and wind is the useful
one: it decides where volcanic gas goes. It is drawn as arrows pointing
**downwind** — the source reports the direction wind comes *from*, and the
conversion is done once, in `toWindGeoJson`, with a test, because reversing it
would send a plume the wrong way across the map.

**Road conditions** come from a third endpoint, found by enumerating
Vegagerðin's ArcGIS server:

```
GET https://vegasja.vegagerdin.is/arcgis/rest/services/data/faerd/FeatureServer/16/query
```

This carries the same conditions *with* line geometry, keyed by the same
`IDBUTUR`, so they are a map layer rather than only a list. The `where` clause
asks the server for just the segments that are not clear — 146 of 1,565 — because
fetching all of them would be megabytes to draw a uniformly green map. Elevation
is stripped from every coordinate (about a third of the payload) and the result
is simplified to 20 m, bringing 510 KB down to ~250 KB.

Line colour is Vegagerðin's own. Width and opacity come from our severity
ordering, because they give a 4x4-only track the same green as a clear road —
right for a driver, unhelpful on a map read at a glance.

Timestamps are day-first with no zone (`19.9.2026 17:40:00`) and are decomposed
explicitly — `Date.parse` would read `19.9` as a month.

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

**Watching a camera.** There is no video: Vegagerðin publishes periodically
refreshed JPEGs and exposes no stream, confirmed by probing for one and by
watching `Last-Modified` headers. The cadence varies by camera — a busy urban
view publishes every minute, a rural one had not moved in seven — so the viewer
polls every two minutes, which sits between them, says plainly that these are
stills, and lets the reader step back through earlier frames.

**The frame store** (`src/server/frame-store.ts`) is what makes "earlier
frames" reach past the current session. Vegagerðin publishes only the current
picture and offers no archive, so a reel can only be built out of frames
somebody already fetched — and a browser that has just opened the page has
fetched exactly one. That is the wrong way round for what these cameras are
for: nobody has the page open for an hour *before* something happens.

The image proxy therefore files each frame away on its way past, when asked
with `record=1`, and `/api/webcams/reel` reports what is held. Watching a
camera is what builds its history, and the next person to open it inherits the
result.

- **Opt-in, not automatic.** The same proxy serves the thumbnails in the camera
  list; recording those would spread a fixed budget across every camera on the
  page instead of concentrating it on the one being watched.
- **Timed by the camera's clock**, from `Last-Modified`, not ours. Two viewers
  polling on different schedules would otherwise store the same picture twice
  under different times, and the reel would claim a frame rate the camera does
  not have. Repeats are recognised by `ETag` as well.
- **Bounded**: 30 frames per view, 40 views, six hours, and a hard byte budget
  (`ICELAND_LIVE_FRAME_BUDGET_MB`, default 64). Over budget, the oldest frames
  go from *every* reel rather than one camera being emptied, and no view is
  ever left with nothing.
- **Best-effort, like the disk cache.** Every failure is swallowed and logged
  once. A recorder that can break the live image it is recording is worse than
  no recorder.
- **Durable where it is configured to be.** Frames go through a backend
  interface with two implementations: the local filesystem (the default, right
  for a VPS with a mounted volume) and any S3-compatible object store. On
  serverless the local path is per instance and temporary, so two readers may
  see different reels; with an object store configured they see one.

**State comes from a listing, not an index file.** The capture time is in the
key, so listing the store *is* the index. With one process an index would
merely be faster; with several sharing a bucket it is a correctness bug, since
two instances that each load it, record, and write it back silently drop each
other's frames. Putting the time in the key also makes writing idempotent
across instances: the same picture always derives the same `Last-Modified`, so
it always writes the same key.

**The object-store backend carries no SDK.** Four operations are needed — PUT,
GET, DELETE, LIST — and all four are plain HTTPS with a SigV4 signature, which
`node:crypto` can produce in under a hundred lines. An SDK for this would
multiply the project's dependency count several times over.

Its honest status: the signing is checked against the worked example in AWS's
own documentation — canonical request, string to sign and final signature all
match published values — and the operations are exercised against a local
server that recomputes and verifies every signature. **It has not been run
against a real bucket.** The failure it is most designed to catch, a request
signed in one form and sent in another, is exactly what that local server
rejects.

Keys are a SHA-256 prefix of the source URL, so nothing a caller sends names a
path; `/api/webcams/frame` additionally checks a frame is indexed before
touching the disk. The allowlist and the key derivation live in one place
(`allowWebcamSource`), used by the proxy, the reel endpoint and the recorder —
three copies of an allowlist is how one of them ends up permitting a host the
others do not, and three copies of a key derivation is how the same camera
gets filed under two keys.

**Recording without a reader** (`src/server/camera-recorder.ts`). Frames
arriving only while somebody is watching has the timing exactly backwards:
nobody has a camera open for the hour *before* something happens. A small
watch list is therefore polled on a schedule.

Which cameras is *derived*, not listed. A hard-coded set of identifiers would
be a guess frozen at the moment it was written — Vegagerðin renumbers and
retires cameras, and the interesting part of Iceland moves. Four sites, twelve
views maximum, four requests in flight; under half a megabyte a run.

**Where to point** is `src/server/watch-focus.ts`, a precedence ladder rather
than a weighted score. A score blending warnings, colour codes and event counts
has to answer "why is it looking there" with arithmetic nobody can check; a
ladder answers it with a sentence, and the recorder reports which rung fired.

1. **A geological warning in force**, most serious first, placed at the mean of
   its area's vertices.
2. **A volcano at orange or red** on IMO's aviation scale.
3. **The busiest seismic region**, which is where this started.
4. **The default map view**, when there is nothing at all to point at.

Two exclusions, both deliberate. **Weather warnings** are in force over large
parts of Iceland most weeks, and a wind warning covering the south would hold
the recorder there indefinitely; they matter for driving and are shown in the
interface, but they are not a reason to stop watching a volcano. **Yellow
aviation codes** mean "signs of elevated unrest", which Icelandic systems sit
at for months or years — treating yellow as a trigger would pin the recorder
to whichever system has been restless longest and never release it.

Nothing on the ladder is a hazard judgement of ours: each rung relays someone
else's published status, or counts events.

Two ways to drive it, both calling the same function:

| | how | when |
|---|---|---|
| `GET /api/cron/cameras` | any scheduler that can make an authenticated GET — Vercel Cron, GitHub Actions, a crontab | serverless, where there is no process between requests |
| `ICELAND_LIVE_CAMERA_RECORDER=1` | an in-process timer started from `src/instrumentation.ts` | a VPS, a container, anything long-running |

The endpoint takes a bearer token from `CRON_SECRET`, which is the convention
Vercel Cron sends. With the secret unset it refuses in production and allows
in development, the same way `ALLOW_FIXTURES_IN_PRODUCTION` is handled: a
misconfigured deployment should fail closed. The ticker is clamped to a
minimum of 60 seconds, because the cameras do not publish faster than that.

No `vercel.json` cron is committed. Hobby accounts are limited to daily
invocations, and a schedule the plan rejects would fail the deploy rather than
the feature — so the schedule is left as a deployment decision:

```json
{ "crons": [{ "path": "/api/cron/cameras", "schedule": "*/5 * * * *" }] }
```

Míla's volcano livestreams are real video but are published through YouTube with
no machine-readable listing, and their stream identifiers change between
eruptions. Hard-coding them would be guessing at data, so they are not included.

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

### Dispersal simulations — Dispersion API (pinned `2025-08-13`) + EPOS

```
GET https://api.vedur.is/epos/volcano/hazard/maps/probabilistic-modelling-based/dispersion-ash-gas
GET https://api.vedur.is/dispersion/simulations/{uuid}
GET https://api.vedur.is/dispersion/raster?uuid=&model_type=&dispersion_type=&altitude=&altitude_unit=&time=&srid=&filetype=
```

**Read this part before the endpoints.** IMO runs dispersal models several times
a day for eruptions at a handful of selected volcanoes, each with a preset
column height, so that the answer exists if one ever starts. On an ordinary day
— which is nearly every day — **none of the eruptions being modelled is
happening.** IMO's own description of the service says the simulations are for
"hypothetical eruptions at key selected Icelandic volcanoes", and that "in case
of real eruption, the service will provide access to the simulations produced
for the ongoing event".

Nothing in the published record distinguishes the two. A contingency run and a
run for a real event carry the same fields, the same model and the same
`product_type: Forecast`; some scenario names contain the word "hypothetical"
and others do not, which is a naming habit and not a flag. So the interface
states what a run *is* — a scenario, with its assumptions on the row — and never
what it means, and it points at IMO's aviation colour codes and official
warnings for whether anything is actually under way.

**Two services, joined.** Neither is sufficient alone:

| | catalogue (EPOS) | run record (Dispersion) |
|---|---|---|
| volcano name | ✅ | ✗ (coordinates only) |
| hazard type, model, validity | ✅ | partial |
| model grid bounds | ✗ | ✅ |
| available output layers | ✗ | ✅ |

They join on the run UUID, which the catalogue embeds in its
`product_reference` link to IMO's own viewer. The UUID is matched against a
UUID pattern rather than read as "whatever follows the equals sign", because it
goes into an upstream request path.

**Version pinning.** `/dispersion` versions itself independently of `/epos` and
answers **415** to anything it does not recognise — including EPOS's own version
string, which is how the separate pin was found. Both are in `IMO_API_VERSIONS`.

**Reducing 276 entries to seven.** IMO reruns the same scenarios several times a
day, so most of the catalogue is older copies of the current list. We keep the
newest entry per `(volcano, scenario)`, drop anything created more than 48 hours
ago *before* issuing any per-run request, cap the fan-out at 12, and then drop
any run whose forecast window has already elapsed. That last filter also applies
to a stale cached snapshot: everything else here degrades by getting older, but
a forecast window that has ended is no longer a forecast.

**Frames.** Verified against the service, not assumed: rasters are hourly, the
first is one hour *after* `start_time` (the start instant itself answers 404,
because nothing has dispersed yet) and the last is exactly
`start_time + duration`. Times are sent naive — a trailing `Z` makes the
endpoint answer **500**.

**`srid=3857`, fixed by us and never taken from the caller.** MapLibre maps a
raster onto four corners by interpolating in Web Mercator, so a plate carrée
image would be stretched in latitude — visibly, and wrongly, at Iceland's
latitudes. Asking IMO for Mercator makes the interpolation exact. Confirmed by
arithmetic: the returned image is 461×384 for bounds spanning 39.97° of
longitude and 60–72.95° of latitude, an aspect of 1.201 against a computed
Mercator aspect of 1.201. The plate carrée version of the same frame is
571×185, aspect 3.086 — which is the ratio of the raw degree spans.

**The raster proxy relays no URL.** Unlike the interferogram and camera proxies,
nothing here forwards an address. Every parameter is validated against the
values IMO's own OpenAPI description declares — model, dispersion type,
altitude unit, an integer altitude, a parseable time, a UUID — and the upstream
URL is then built from those alone. There is no input that could name a
different host. A 404 from upstream is passed through as a 404 rather than a
502, because "no frame at that time" is ordinary and "IMO is down" is not.

**The colour scale is IMO's**, transcribed from the legend their own dispersion
viewer ships (12 steps for NAME, 6 for CALPUFF). A colour-to-concentration
mapping invented here would turn a picture into a number we have no basis for,
so each run also links to IMO's viewer.

**Asking the model rather than reading the picture.** The same service will
evaluate a run at a coordinate and return an hourly series
(`/graphs/location/uuid/…`), which is how "what would this scenario put in the
air over Grindavík" gets answered with IMO's numbers instead of by sampling
pixels and guessing at a scale. The panel does this at the monitoring station
nearest the modelled source, and puts the station's actual current readings
next to the curve — not on the same axes, because a model of an eruption that
is not happening and a measurement of the air as it is are not two versions of
one quantity.

**Its values are not in the units its series names claim, and their own
viewer says so.** A deposit series named `0m Ash kg/m2` returns about 15,000
at a coordinate their raster colours as the `10 kg/m²` band. Read literally
that is fifty metres of ash. The dispersion viewer's own source resolves it:

```js
if ("name" === u && "kg/m2" === r[c].name.slice(-5))
    r[c].y[f] = r[c].y[f] / 1e3;        // deposit: grams, labelled kilograms
else if ("calpuff" === u) {
    r[c].y[f] = 1e6 * r[c].y[f];        // gas: grams per m³, shown as µg/m³
    r[c].name += " μg/m3"
}
```

So deposit arrives in g/m², the gas species arrive in g/m³, and airborne ash —
which their viewer does not touch — arrives in the unit it names. `scaleFor`
applies exactly those three factors at the edge, so nothing downstream ever
holds a figure in the wrong unit.

This was found the other way round first, by comparing values against the
colour IMO's own raster paints at the same coordinate
(`src/server/units-probe.integration.ts`, which reproduces it on whatever run
is current). Dividing deposit by a thousand put every sample, across four
decades, back inside the band IMO drew it in; airborne concentration agreed
untouched. Two independent lines of evidence for the same three factors.

Until the viewer source was found, the only defensible thing was to rank by
those figures and refuse to print them — which is how the first version of
this feature shipped. Worth recording, because for a while the honest answer
was the smaller feature.

One trap in the comparison: it has to be made at the raster's own instant.
Deposit accumulates, so its last frame is its maximum; concentration comes and
goes, and comparing a final frame against an earlier peak made the airborne
layer look wrong when it was the comparison that was.

Three other things about that endpoint are worth writing down:

- Outside the model grid it answers **200 with zeros**, not 404, so "not
  modelled" would arrive looking like "nothing will reach here". The server
  checks the point against the run's own bounds and refuses rather than
  passing that on.
- The x-axis convention **differs by product**: a 24-hour tephra run's series
  begins an hour after its `start_time`, a 72-hour gas run's begins at it. The
  returned times are used as given and never reconstructed.
- The series names carry their units — `5m Ash g/m3`, `0m SO2` — and are
  parsed rather than rebuilt and compared, so a change in IMO's formatting
  loses one series instead of mislabelling all of them. For the gas species,
  which name no unit, the unit comes from IMO's CALPUFF legend (µg/m³) and
  *not* from the EPOS catalogue's `units` field, which reports µg/m³ for the
  tephra products too and so contradicts their own series names.

**Gas runs have not been produced since 18 September 2025.** The CALPUFF SO₂
scenarios ran daily through the Sundhnúkur eruption series and stop there; every
current run is tephra (NAME). The code handles both identically and the panel
simply lists what exists, so gas returns on its own when IMO resumes it.

### Which roads a scenario reaches

The ground-deposit layer is the one with consequences for a road, and IMO
publishes it both as a raster and as a per-location series. Combining them
answers "which routes does this scenario put ash on" without either source
being asked for something it cannot give:

1. **The raster says where.** The final deposit frame is fetched in plate
   carrée (`srid=4326`, so the coordinate-to-pixel mapping is linear in both
   axes), decoded, and read for **one bit per pixel** — the alpha channel,
   meaning "the model puts something here". No colour is translated into a
   concentration; that would be a guess about a stepped, resampled scale.
2. **Routes are matched against it**, not points that happen to sit on roads.
   The whole network — about 1,565 segments over some 700 named routes — is
   fetched separately and cached for a day, because filtering by condition
   would hide exactly the clear road that ash is about to land on. A route is
   reached when any vertex of any of its segments lands in a covered cell;
   vertices are ~2 km apart after the service's generalisation and cells are
   ~7 km, so a segment cannot cross a covered cell without putting a vertex
   in it.
3. **Routes are grouped into model cells before anything is asked.** A cell is
   about seven kilometres across, so the roads around a vent all land in one
   or two of them. Without grouping, eight requests bought eight answers about
   the same place — and Grindavíkurvegur, sixteen kilometres out, was
   truncated off the end. Sixteen cells are sampled and at most two routes are
   listed per cell, so the list spans the plume instead of crowding one spot.
4. **The model says how much**, at one sampled point per cell: the covered
   point nearest the source. `sampledKm` says which point was measured,
   because a long route may be heavier somewhere else along it.

**"Covered" is reach, not severity.** The raster is drawn down to IMO's
lowest band, a hundredth of a kilogram per square metre, so a day after a
10 km column nearly every road in Iceland is technically covered — 672 of 702
on a live run. The panel leads with the routes it lists and gives that number
underneath with what it means, because "672 of 702 routes" as a headline is
true and reads as a catastrophe.

**Row 0 is the northern edge.** That is checked rather than assumed:
`src/server/orientation-probe.integration.ts` reads the mask at a scatter of
coordinates and compares each against IMO's per-location model. Top-down
agreed at 12 of 12; bottom-up at 9 of 12.

The PNG decoder (`src/server/png-alpha.ts`) is about a page of code because
`node:zlib` already does the hard part. It accepts only what IMO serves —
8-bit RGBA, non-interlaced — and refuses anything else rather than guess,
since a mis-decoded mask is confidently wrong in a way no mask is.

### Researched, architected for, not yet integrated

`src/providers/` is shaped so these plug in without touching feature code:

- **EPOS API** (`/epos`, 29 endpoints) — webcams, plume height, ground-based radar
  and DOAS, shakemaps, RINEX, SO₂ and tephra hazard maps, eruption catalogue and
  imagery. InSAR interferograms, GNSS stations and the ash/gas dispersal
  catalogue are in use.
- **CAP API** — Meteoalarm feeds and the historical archive
  (`/capbroker/sent/from/…`). The active-warnings path is in use; these are not.
- **GIS API** (`/gis/layers`) — 36 indexed layers. Four are in use for Reykjanes;
  the rest include glacier outlines, SIL station locations, high-temperature
  geothermal areas, South Iceland seismic fractures and Holocene eruptive fissures.
- **Weather API** (`/weather`) and **Glaciers**. The **Dispersion API** is in
  use for simulations and rasters; its per-location graph endpoint is not.
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
│   ├── dispersion.ts    DispersionRun, frame times, IMO's colour scale
│   ├── region-history.ts  a year of per-region daily counts
│   ├── webcam.ts        WebcamSite, IRCA attribution
│   ├── air-quality.ts   AirQualityStation, Reading, verification state
│   ├── roads.ts         RoadWeatherStation, RoadCondition
│   ├── reykjanes.ts     Lava flows, barriers, graben, facilities
│   ├── volcano.ts       VolcanicSystem, AviationStatus, VolcanicAlertLevel
│   ├── time-range.ts    The five windows, and how to resolve one to instants
│   └── api.ts           The contract between our routes and the browser
│
├── providers/       Everything that talks to the outside world.
│   ├── types.ts         EarthquakeProvider, VolcanoProvider, ProviderResult, ProviderError
│   ├── registry.ts      The one place that picks an implementation
│   ├── imo/             client · quakes · detail · volcanoes · CAP · EPOS
│   │                    dispersion (catalogue + run records)
│   ├── gis/             WFS client · Reykjanes layers (lava, barriers, graben)
│   ├── vegagerdin/      road cameras · road weather · road conditions
│   │                    road network line work
│   ├── ust/             air quality
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
│   ├── disk-cache.ts    best-effort accelerator for expensive derived data
│   ├── frame-store.ts   bounded reel of camera frames, over a backend
│   ├── frame-backend.ts    the backend seam (+ -local, -s3)
│   ├── aws-sigv4.ts     request signing for S3-compatible stores
│   ├── png-alpha.ts     alpha channel only: "is anything here"
│   ├── camera-recorder.ts  polls a derived watch list on a schedule
│   ├── watch-focus.ts   the ladder deciding where to point it
│   ├── road-network.ts  the line work, cached for a day
│   ├── dispersion.ts    current dispersal runs and per-location series
│   ├── environment.ts   air quality + roads
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
│                        /api/webcams[/image|/reel|/frame] · /api/environment
│                        /api/dispersion[/raster|/point|/exposure]
│                        /api/cron/cameras
│
├── components/
│   ├── map/             MapView, base-style tuning, layer specs, GeoJSON builders
│   ├── charts/          Timeline · DepthProfile · Sparkline · AirTrace
│   │                    ObservationBands (shared by Timeline and AirTrace)
│   ├── ui/              Panels, feed, detail, controls, states
│   └── AppShell.tsx     Orchestration and layout
│
├── hooks/           useEarthquakeData · useEarthquakeDetail · useAlerts
│                  useReykjanesLayer · useDeformation · useWebcams
│                  useEnvironment · useDispersion · useDispersionPoint
│                  useDispersionExposure · useUrlState · useNow · useMediaQuery
├── lib/             time · format · geo · simplify
└── instrumentation.ts   starts the in-process camera recorder, if enabled
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
| `/api/webcams/reel` | `no-store` | — (per instance; see the frame store) |
| `/api/webcams/frame` | `max-age=3600, immutable` | — (one picture, one instant) |
| `/api/dispersion` | `s-maxage=900, swr=3600` | 15min / 6h |
| `/api/dispersion/raster` | `max-age=31536000, immutable` | — (proxied, immutable) |
| `/api/dispersion/point` | `s-maxage=3600, swr=21600` | 1h / 6h, 400-entry LRU |
| `/api/dispersion/exposure` | `s-maxage=3600, swr=21600` | 1h / 6h; footprint 6h |
| `/api/cron/cameras` | `no-store` | — (a trigger, not a read) |
| `/api/environment` | `s-maxage=300, swr=900` | 5min / 1h |

The year of region history is cached separately for 24 hours and kept for a
fortnight: one upstream request a day for ~35,000 events, reduced in about 30 ms
to ~86 KB of daily counts. A baseline a day out of date is still a good
baseline; having none costs every observation its context.

### The disk cache

That year is also written to disk, so a cold start reads ~90 KB of local JSON
instead of re-fetching 5 MB and re-parsing it. Writes go to a temporary file and
are renamed into place, so a concurrent reader sees either the old complete file
or the new one, never a half-written one. Stored values carry a version and are
ignored when it changes.

It is **an accelerator, not storage**. Every caller works when it is empty,
unreadable, or when the filesystem is read-only, and failures are logged once
and swallowed — a cache that can take down the thing it accelerates is worse
than no cache. On serverless only `os.tmpdir()` is writable and it is per
instance, which still helps repeated cold starts on a warm instance. Set
`ICELAND_LIVE_CACHE_DIR` to point it at a persistent volume where one exists.

The camera frame store (`src/server/frame-store.ts`) lives under the same
directory and follows the same rules, with one difference in kind: it is the
only thing here that is not a cache of something fetchable on demand. Once a
camera publishes its next picture the previous one is gone from upstream
forever, so a frame we drop is not re-derivable. That is precisely why it is
bounded and labelled rather than trusted — see
[Road cameras](#road-cameras--vegagerðin-open-data).
| any of them, degraded | `no-store` | — |

The stale windows are not uniform, and the differences are deliberate. Six hours
of stale earthquakes is acceptable because an out-of-date map of past seismicity
is still true. Thirty minutes is the limit for warnings, because a lapsed warning
is not. Reykjanes geometry is kept for a week because those surveys are finished
and will never change. Dispersal rasters are immutable for the opposite
reason: a run's UUID identifies one finished set of model output, so the bytes
behind a frame can never change — which is what makes stepping through 48 of
them cheap. Per-event detail is keyed by event id, which is unbounded,
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
- **A simulation is never presented as a forecast of an event.** IMO's dispersal
  runs model eruptions at selected volcanoes several times a day whether or not
  anything is happening. The panel says so above the list, every row carries the
  plume height as an assumption the model was *given*, and nothing anywhere
  implies an eruption is expected. Because the published record does not
  distinguish a contingency run from one produced for a real event, the code
  declines to claim either — and points the reader at IMO's aviation colour
  codes and warnings for the thing these products cannot tell them.
- **Two series on one axis are not a correlation.** The air trace shares the
  earthquake timeline's clock so a reader can see a gas episode against a swarm,
  and the observation periods are marked on both at identical extents. No
  correlation is computed and none is implied; the caption says the two are
  shown together, not compared, and the station's classification stays on screen
  because a still day over a busy road moves these numbers too.
- **A model and an instrument are not two readings of one quantity.** The
  station probe puts IMO's modelled concentration beside what that station is
  actually measuring, and deliberately not on shared axes — the model is mostly
  in the future and describes an eruption that is not occurring, the reading is
  the last hour of real air. Shared axes invite subtraction, and there is
  nothing here to subtract. The model gets a curve, the measurement gets a
  number, each labelled for what it is.
- **A unit correction has to come from the source, not from us.** IMO's
  per-location values are not in the units their series names claim. For a
  while the only defensible response was to rank by them and refuse to print
  them, because a factor inferred from a handful of samples is a number we
  invented. The factors now applied are IMO's own, lifted from their viewer's
  source, and corroborated independently against their published colour scale.
  `scaleFor` is the one place that holds them.
- **A band marks a period, not a claim about it.** The shaded stretches under
  the charts are the periods the observations' own sentences describe, clipped
  to what is on screen. Two things overlapping in time is not evidence that one
  caused the other.
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
- **Air readings are unverified and can be stale.** Everything served live is
  `verification: 3`, and individual stations sometimes go quiet for hours. The
  age of each reading is shown for that reason.
- **The road condition geometry endpoint is undocumented.** It was found by
  enumerating Vegagerðin's ArcGIS server, not from published documentation, so it
  carries no stability promise. The layer fails softly: losing it costs the map
  layer, not the conditions list.
- **Road cameras are stills, not video.** Publish cadence varies by camera — a
  busy urban view publishes every minute, a rural one had not moved in seven —
  and the viewer polls every two minutes, so it both misses frames on the fast
  cameras and re-fetches pictures it already has from the slow ones. The
  repeats are recognised and discarded rather than stored.
- **A camera's reel is only as long as someone was watching, or the recorder
  was pointed at it.** The server keeps what it has fetched. The scheduled
  recorder covers the four sites nearest the current seismicity; every other
  camera has only what readers have opened, so a short reel means a lack of
  attention rather than a camera fault, and the viewer says so. The store is
  also per instance and not durable, so two readers may see different reels.
- **The recorder follows earthquakes, which is not the same as following
  risk.** The watch list is the cameras nearest the busiest seismic region. On
  a day when the seismicity is in the north and the thing worth watching is a
  road on Reykjanes, it will be pointed at the wrong end of the country.
  Deriving the list is still better than freezing one, but it is a proxy.
- **The dispersal point series is the model, not the air.** It is what IMO's
  simulation puts at a coordinate for a scenario, and on almost every day that
  scenario is an eruption that is not happening. The measured readings shown
  beside it are the only actual observation in that panel.
- **Observation bands are clipped, and one is suppressed.** A period starting
  before the window is drawn from the window's edge, so the band shows the
  visible part rather than the whole. A period covering the entire window —
  which "repeated M2.0+ events" always does, because that is what it counts
  over — gets no band at all, since a wash over every bar distinguishes
  nothing.
- **The road list is footprint, not forecast.** It says which routes a
  scenario's modelled deposit reaches and ranks them; it says nothing about
  whether a road would be passable, and the eruption behind it is not
  happening.
- **Each road figure is one point on a route.** The covered point nearest the
  source, whose distance is shown. Asking at every vertex of every route would
  be thousands of requests, so a long route may be heavier somewhere else
  along it than the figure says.
- **The recorder's ladder can still be pointed at the wrong thing.** It relays
  official status where there is any and falls back to seismicity where there
  is not, which is better than a frozen list but is not a hazard model.
- **The object-store backend has never written to a real bucket.** What it
  has passed: AWS's own documented worked example for the signature, a local
  server that recomputes and verifies every signature, and a live round trip
  to `s3.amazonaws.com` where the real service answered `InvalidAccessKeyId` —
  meaning it parsed the credential scope, the signed-header list and the dates
  and objected only to the key, which a malformed header does not manage
  (`AuthorizationHeaderMalformed`, 400). What remains unproven is a PUT
  landing, a GET returning it, and a listing paging.
- **A dispersal run is a scenario, not a prediction.** Every one of them models
  an eruption that is, on almost every day, not happening. Nothing published
  distinguishes a contingency run from one produced for a real event, so this
  product does not try to — see
  [Scientific integrity](#scientific-integrity).
- **The dispersal raster carries no numbers, only IMO's colours.** We reproduce
  their legend; we do not sample the image or quote a concentration from it.
  Each run links to IMO's own viewer, which does.
- **Gas dispersal is dormant upstream.** The last CALPUFF SO₂ run was produced
  on 18 September 2025, so in practice the panel currently shows tephra only.
- **The air trace covers 24 hours, so wider windows show nothing.** The network
  publishes about a day of hourly averages. Rather than pin that against the
  right-hand edge of a 7- or 30-day chart — which would read as six quiet days
  instead of six days we were not told about — the panel says what it has.
- **Air trends are crude by design.** "Rising" compares the mean of the last third
  of the 24-hour series with the rest and reports nothing below a 20% change. It
  describes the recent series; it does not extrapolate.
- **The disk cache is not durable on serverless.** It accelerates cold starts on
  a warm instance and nothing more; correctness never depends on it.
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

1. **Let the reader ask about a place.** The dispersal panel evaluates a run
   at monitoring stations and at road routes, both chosen for them. Clicking
   the map would answer "what does this scenario put *here*" for a farm, a
   campsite or a road junction that is on no list. The endpoint already takes
   a coordinate; what it needs is a click target that does not fight with
   selecting an earthquake.
2. **A frame that is worth keeping.** The reel stores every fetch, which
   during a still night is thirty near-identical pictures of a dark road. A
   cheap difference between consecutive frames would let the store keep the
   ones where something changed and spend its budget on cameras that are
   showing something.
3. **Say what the deposit means in depth.** IMO's own legend gives the
   equivalence — 1 kg/m² is about a millimetre — so "43 kg/m²" could read as
   "about 4 cm" without anything being invented. It is their conversion, not
   ours, and it is the difference between a number and a picture for most
   readers.

**Later**

- *Volcano mode* — EPOS shakemaps, eruption imagery, tephra and SO₂ hazard maps.
- *Air* — historical series, volcanic pollution overlays.
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

**Air quality**: [Environment and Energy Agency of Iceland (Umhverfis- og
orkustofnun)](https://ust.is/), from the national air quality monitoring network.
Real-time values are unverified.

**Basemap**: [CARTO](https://carto.com/attributions) · [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

For official warnings and hazard information, always go to
[vedur.is](https://en.vedur.is/) and [almannavarnir.is](https://www.almannavarnir.is/).
This site is not affiliated with either.
