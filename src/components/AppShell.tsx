"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityObservation } from "@/analytics/clusters";
import { Timeline } from "@/components/charts/Timeline";
import { MapView, type MapPadding, type MapViewHandle } from "@/components/map/MapView";
import { ActivityFeed, type FeedSort } from "@/components/ui/ActivityFeed";
import { AlertsPanel } from "@/components/ui/AlertsPanel";
import { DeformationPanel } from "@/components/ui/DeformationPanel";
import { RegionList } from "@/components/ui/RegionList";
import { WebcamPanel } from "@/components/ui/WebcamPanel";
import { EnvironmentPanel } from "@/components/ui/EnvironmentPanel";
import { BottomSheet, type SheetSnap } from "@/components/ui/BottomSheet";
import { Brand } from "@/components/ui/Brand";
import { MapControls } from "@/components/ui/MapControls";
import { QuakeDetail } from "@/components/ui/QuakeDetail";
import { RangeControl } from "@/components/ui/RangeControl";
import { StatBar } from "@/components/ui/StatBar";
import { StatusPill } from "@/components/ui/StatusPill";
import { SummaryPanel } from "@/components/ui/SummaryPanel";
import { ErrorBanner, LoadingState, UnavailableState } from "@/components/ui/States";
import type { EarthquakesResponse, VolcanoesResult } from "@/domain/api";
import type { VolcanicSystem } from "@/domain/volcano";
import type { OfficialAlert } from "@/domain/alert";
import type { Interferogram } from "@/domain/deformation";
import type { RegionTally } from "@/analytics/stats";
import type { WebcamSite } from "@/domain/webcam";
import { useEarthquakeData } from "@/hooks/useEarthquakeData";
import { useEarthquakeDetail } from "@/hooks/useEarthquakeDetail";
import { useAlerts } from "@/hooks/useAlerts";
import { useReykjanesLayer } from "@/hooks/useReykjanesLayer";
import { useDeformation } from "@/hooks/useDeformation";
import { useWebcams } from "@/hooks/useWebcams";
import { useEnvironment } from "@/hooks/useEnvironment";
import { lavaFlowsByRecency } from "@/domain/reykjanes";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useNow } from "@/hooks/useNow";
import { useUrlState } from "@/hooks/useUrlState";
import { DEFAULT_FOCUS, padBounds, type BoundingBox, type MapFocus } from "@/lib/geo";
import { TIME_RANGE_IDS, type TimeRangeId } from "@/domain/time-range";

const DESKTOP_QUERY = "(min-width: 1024px)";
const PANEL_WIDTH = 372;

/** Room the panels need so framing never puts events underneath them. */
function mapPadding(isDesktop: boolean, sheetSnap: SheetSnap): MapPadding {
  if (isDesktop) {
    return { top: 96, right: 32, bottom: 150, left: PANEL_WIDTH + 32 };
  }
  return {
    top: 132,
    right: 16,
    bottom: sheetSnap === "peek" ? 120 : 24,
    left: 16,
  };
}

export function AppShell({
  initialData,
  serverNowMs,
}: {
  initialData: EarthquakesResponse | null;
  serverNowMs: number;
}) {
  const {
    range,
    eventId,
    showVolcanoes,
    showReykjanes,
    showDeformation,
    showWebcams,
    showEnvironment,
    insarId,
    setRange,
    setEventId,
    setShowVolcanoes,
    setShowReykjanes,
    setShowDeformation,
    setShowWebcams,
    setShowEnvironment,
    setInsarId,
  } = useUrlState();
  const isDesktop = useMediaQuery(DESKTOP_QUERY, true);
  const nowMs = useNow(serverNowMs);

  const { data, error, refreshing, offline, refresh } = useEarthquakeData(
    range,
    initialData,
  );

  // Loaded only while an event is open, so panning the map never pays for it.
  const { detail, loading: detailLoading } = useEarthquakeDetail(eventId);

  const [sort, setSort] = useState<FeedSort>("newest");
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("peek");
  const [volcanoes, setVolcanoes] = useState<VolcanicSystem[] | null>(null);
  const [volcanoError, setVolcanoError] = useState(false);

  const { alerts, unavailable: alertsUnavailable } = useAlerts();
  const reykjanes = useReykjanesLayer(showReykjanes);
  const deformation = useDeformation(showDeformation);
  const webcams = useWebcams(showWebcams);
  const environment = useEnvironment(showEnvironment);

  /**
   * Where the current activity is centred, used to order the camera list.
   * The busiest region is the best single answer to "what am I looking at".
   */
  const activityFocus = useMemo(
    () => data?.regions.find((region) => region.centre !== null)?.centre ?? null,
    [data],
  );

  /** The interferogram named in the URL, once the catalogue has loaded. */
  const selectedInsar = useMemo(
    () => deformation.interferograms.find((item) => item.id === insarId) ?? null,
    [deformation.interferograms, insarId],
  );
  /** The one warning area currently drawn on the map, if any. */
  const [alertArea, setAlertArea] = useState<GeoJSON.FeatureCollection | null>(null);

  const mapRef = useRef<MapViewHandle>(null);

  /*
   * The header's height changes with viewport width (one row on desktop, two on
   * a phone) and with the font metrics the browser actually resolves, so the
   * floating map controls are positioned from a measurement rather than a
   * hard-coded offset that drifts whenever the bar's padding changes.
   */
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(96);
  useEffect(() => {
    const element = headerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeaderHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const quakes = useMemo(() => data?.quakes ?? [], [data]);
  const selected = useMemo(
    () => (eventId ? (quakes.find((quake) => quake.id === eventId) ?? null) : null),
    [quakes, eventId],
  );

  const padding = mapPadding(isDesktop, sheetSnap);

  /** The newest mapped lava flow, for the Reykjanes legend. */
  const latestEruption = useMemo(
    () => (reykjanes.layer ? (lavaFlowsByRecency(reykjanes.layer)[0]?.properties ?? null) : null),
    [reykjanes.layer],
  );

  /** The next range up, offered when the current window turns up nothing. */
  const widerRange: TimeRangeId | null =
    TIME_RANGE_IDS[TIME_RANGE_IDS.indexOf(range) + 1] ?? null;

  // --- Selection --------------------------------------------------------------

  /** Selection made on the map: the event is already in view, so do not move. */
  const selectFromMap = useCallback(
    (id: string | null) => {
      setEventId(id);
      if (id && !isDesktop) setSheetSnap((snap) => (snap === "peek" ? "half" : snap));
    },
    [setEventId, isDesktop],
  );

  /** Selection made from a list, stat or chart: bring the map to it. */
  const focusEvent = useCallback(
    (id: string) => {
      setEventId(id);
      const quake = quakes.find((item) => item.id === id);
      if (quake) mapRef.current?.flyToPoint(quake.longitude, quake.latitude, 9.5);
      if (!isDesktop) setSheetSnap("half");
    },
    [quakes, setEventId, isDesktop],
  );

  const focusObservation = useCallback(
    (observation: ActivityObservation) => {
      if (!observation.focus) return;
      const { centre, radiusKm } = observation.focus;
      const box: BoundingBox = padBounds(
        {
          west: centre.longitude,
          south: centre.latitude,
          east: centre.longitude,
          north: centre.latitude,
        },
        Math.max(radiusKm * 1.6, 6),
      );
      mapRef.current?.fitBounds(box, { maxZoom: 11 });
      if (!isDesktop) setSheetSnap("peek");
    },
    [isDesktop],
  );

  /**
   * Draws an official warning's area and frames it.
   *
   * Only one at a time — IMO's forecast regions are large, and several at once
   * would cover the map. Selecting the same warning again clears it.
   */
  const showAlertArea = useCallback(
    (alert: OfficialAlert) => {
      const features = alert.areas
        .filter((area) => area.geometry !== null)
        .map((area, index) => ({
          type: "Feature" as const,
          id: `${alert.id}-${index}`,
          geometry: area.geometry as GeoJSON.Geometry,
          properties: {
            colour:
              alert.colour === "Red"
                ? "#e2564a"
                : alert.colour === "Orange"
                  ? "#e8913c"
                  : alert.colour === "Yellow"
                    ? "#e8c34a"
                    : "#9aa0ad",
          },
        }));

      if (features.length === 0) return;

      const alreadyShown = alertArea?.features[0]?.id === features[0]?.id;
      if (alreadyShown) {
        setAlertArea(null);
        return;
      }

      setAlertArea({ type: "FeatureCollection", features });

      // Frame the union of the area's rings.
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const area of alert.areas) {
        if (area.geometry?.type !== "Polygon") continue;
        for (const ring of area.geometry.coordinates) {
          for (const [lon, lat] of ring as Array<[number, number]>) {
            if (lon < west) west = lon;
            if (lon > east) east = lon;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
          }
        }
      }
      if (Number.isFinite(west)) {
        mapRef.current?.fitBounds({ west, south, east, north }, { maxZoom: 9 });
      }
      if (!isDesktop) setSheetSnap("peek");
    },
    [alertArea, isDesktop],
  );

  /** Lays an interferogram over the map and frames its footprint. */
  const selectInterferogram = useCallback(
    (item: Interferogram) => {
      const alreadyShown = item.id === insarId;
      setInsarId(alreadyShown ? null : item.id);
      if (!alreadyShown) {
        mapRef.current?.fitBounds(item.bounds, { maxZoom: 11 });
        if (!isDesktop) setSheetSnap("peek");
      }
    },
    [insarId, setInsarId, isDesktop],
  );

  /** Centres the map on a camera site. */
  const focusWebcam = useCallback(
    (site: WebcamSite) => {
      mapRef.current?.flyToPoint(site.longitude, site.latitude, 11);
      if (!isDesktop) setSheetSnap("half");
    },
    [isDesktop],
  );

  /** Frames a region's events, using the mean position of what we plotted. */
  const focusRegion = useCallback(
    (region: RegionTally) => {
      if (!region.centre) return;
      const members = quakes.filter((quake) => quake.region === region.region);
      if (members.length === 0) return;

      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const quake of members) {
        if (quake.longitude < west) west = quake.longitude;
        if (quake.longitude > east) east = quake.longitude;
        if (quake.latitude < south) south = quake.latitude;
        if (quake.latitude > north) north = quake.latitude;
      }

      mapRef.current?.fitBounds(padBounds({ west, south, east, north }, 8), { maxZoom: 10 });
      if (!isDesktop) setSheetSnap("peek");
    },
    [quakes, isDesktop],
  );

  const focusArea = useCallback(
    (focus: MapFocus) => {
      mapRef.current?.fitBounds(focus.bounds);
      if (!isDesktop) setSheetSnap("peek");
    },
    [isDesktop],
  );

  // Escape clears the selection, wherever focus happens to be.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && eventId) setEventId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [eventId, setEventId]);

  // A deep link to an event should arrive with the map already on it.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || !selected) return;
    deepLinkHandled.current = true;
    mapRef.current?.flyToPoint(selected.longitude, selected.latitude, 9.5);
  }, [selected]);

  // --- Volcanic systems, fetched only when the layer is first switched on -----
  useEffect(() => {
    if (!showVolcanoes || volcanoes || volcanoError) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/volcanoes", { headers: { accept: "application/json" } });
        const body = (await response.json()) as VolcanoesResult;
        if (cancelled) return;
        if (body.ok) setVolcanoes(body.systems);
        else setVolcanoError(true);
      } catch {
        if (!cancelled) setVolcanoError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showVolcanoes, volcanoes, volcanoError]);

  // --- Panel content, shared between the desktop rail and the mobile sheet ----

  const hasData = data !== null;
  const fatal = !hasData && error !== null;

  const panelBody = fatal ? (
    <UnavailableState message={error.message} onRetry={refresh} offline={offline} />
  ) : !hasData ? (
    <LoadingState />
  ) : selected ? (
    <QuakeDetail
      quake={selected}
      detail={detail?.id === selected.id ? detail : null}
      detailLoading={detailLoading}
      nowMs={nowMs}
      onBack={() => setEventId(null)}
      onLocate={() => mapRef.current?.flyToPoint(selected.longitude, selected.latitude, 10.5)}
    />
  ) : (
    <>
      <AlertsPanel
        alerts={alerts}
        nowMs={nowMs}
        onShowArea={showAlertArea}
        unavailable={alertsUnavailable}
      />
      <SummaryPanel
        summary={data.summary}
        observations={data.observations}
        observationWindowCapped={data.observationWindow.capped}
        quakes={quakes}
        selectedId={eventId}
        onFocusObservation={focusObservation}
        onSelectEvent={focusEvent}
      />
      {showDeformation && (
        <DeformationPanel
          interferograms={deformation.interferograms}
          selectedId={insarId}
          onSelect={selectInterferogram}
          onClear={() => setInsarId(null)}
          loading={deformation.loading}
          unavailable={deformation.unavailable}
        />
      )}
      {showEnvironment && (
        <EnvironmentPanel
          air={environment.air}
          airError={environment.airError}
          roadWeather={environment.roadWeather}
          roadConditions={environment.roadConditions}
          roadConditionsTotal={environment.roadConditionsTotal}
          roadsError={environment.roadsError}
          roadAttribution={environment.roadAttribution}
          focus={activityFocus}
          nowMs={nowMs}
          loading={environment.loading}
          unavailable={environment.unavailable}
        />
      )}
      {showWebcams && (
        <WebcamPanel
          sites={webcams.sites}
          focus={activityFocus}
          attribution={webcams.attribution}
          loading={webcams.loading}
          unavailable={webcams.unavailable}
          onSelectSite={focusWebcam}
        />
      )}
      <RegionList regions={data.regions} nowMs={nowMs} onSelect={focusRegion} />
      <ActivityFeed
        quakes={quakes}
        sort={sort}
        onSortChange={setSort}
        selectedId={eventId}
        nowMs={nowMs}
        onSelect={focusEvent}
        onWiden={widerRange ? () => setRange(widerRange) : undefined}
      />
    </>
  );

  const banner =
    hasData && error ? (
      <ErrorBanner
        message={
          offline
            ? "You are offline. Showing the last data received."
            : `${error.message} Showing the last data received.`
        }
        onRetry={refresh}
      />
    ) : hasData && data.meta.freshness === "stale" ? (
      <ErrorBanner
        message="The Icelandic Meteorological Office is not reachable. This is the last data we received, not current observations."
        onRetry={refresh}
      />
    ) : null;

  /* Lift MapLibre's own controls above whichever panel occupies the bottom. */
  const controlBottom = isDesktop ? 136 : sheetSnap === "peek" ? 184 : 24;

  return (
    <main
      className="relative h-[100dvh] w-full overflow-hidden bg-[var(--color-base)]"
      style={{ "--map-ctrl-bottom": `${controlBottom}px` } as React.CSSProperties}
    >
      <MapView
        ref={mapRef}
        quakes={quakes}
        referenceMs={data ? Date.parse(data.generatedAt) : nowMs}
        selectedId={eventId}
        onSelect={selectFromMap}
        volcanoes={volcanoes}
        showVolcanoes={showVolcanoes && volcanoes !== null}
        alertArea={alertArea}
        reykjanes={reykjanes.layer}
        showReykjanes={showReykjanes && reykjanes.layer !== null}
        stations={deformation.stations}
        showStations={showDeformation}
        insar={
          selectedInsar
            ? { imageUrl: selectedInsar.imageUrl, bounds: selectedInsar.bounds }
            : null
        }
        webcams={webcams.sites}
        showWebcams={showWebcams}
        airStations={environment.air}
        showAir={showEnvironment}
        padding={padding}
      />

      {/* ---- Top bar ---- */}
      <header
        ref={headerRef}
        className="panel absolute inset-x-0 top-0 z-20 border-x-0 border-t-0 lg:inset-x-3 lg:top-3 lg:rounded-lg lg:border"
      >
        <div className="flex items-center gap-4 px-4 py-2.5 lg:px-5 lg:py-3">
          <Brand className="hidden sm:flex" />
          <Brand markOnly className="sm:hidden" />
          <div className="hidden h-8 w-px shrink-0 bg-[var(--color-line)] lg:block" />
          <div className="min-w-0 flex-1">
            {data ? (
              <StatBar
                stats={data.stats}
                range={range}
                nowMs={nowMs}
                onFocusEvent={focusEvent}
              />
            ) : (
              <div className="h-[46px]" aria-hidden="true" />
            )}
          </div>
          <div className="hidden shrink-0 items-center gap-3 lg:flex">
            <RangeControl value={range} onChange={setRange} />
            <StatusPill
              meta={data?.meta ?? null}
              error={error}
              refreshing={refreshing}
              nowMs={nowMs}
              onRetry={refresh}
            />
          </div>
        </div>

        {/* On narrow screens the range control gets its own row. */}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] px-4 py-2 lg:hidden">
          <RangeControl value={range} onChange={setRange} className="flex-1 justify-between" />
          <StatusPill
            meta={data?.meta ?? null}
            error={error}
            refreshing={refreshing}
            nowMs={nowMs}
            onRetry={refresh}
          />
        </div>
      </header>

      {/* ---- Desktop rail ---- */}
      {isDesktop && (
        <aside
          className="panel absolute bottom-3 left-3 z-20 flex flex-col overflow-hidden rounded-lg"
          style={{ width: PANEL_WIDTH, top: headerHeight + 24 }}
          aria-label="Earthquake activity"
        >
          {banner}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{panelBody}</div>
        </aside>
      )}

      {/* ---- Map controls ---- */}
      <div
        className="absolute z-20 flex flex-col items-end gap-1.5"
        style={{ top: headerHeight + (isDesktop ? 24 : 12), right: 12 }}
      >
        <MapControls
          onFocus={focusArea}
          showVolcanoes={showVolcanoes}
          onToggleVolcanoes={setShowVolcanoes}
          volcanoesAvailable={!volcanoError}
          showReykjanes={showReykjanes}
          onToggleReykjanes={setShowReykjanes}
          reykjanesAvailable={!reykjanes.unavailable}
          reykjanesLoading={reykjanes.loading}
          showDeformation={showDeformation}
          onToggleDeformation={setShowDeformation}
          deformationAvailable={!deformation.unavailable}
          deformationLoading={deformation.loading}
          showWebcams={showWebcams}
          onToggleWebcams={setShowWebcams}
          webcamsAvailable={!webcams.unavailable}
          webcamsLoading={webcams.loading}
          showEnvironment={showEnvironment}
          onToggleEnvironment={setShowEnvironment}
          environmentAvailable={!environment.unavailable}
          environmentLoading={environment.loading}
          latestEruption={latestEruption}
        />
      </div>

      {/* ---- Timeline ---- */}
      {isDesktop && data && (
        <div
          className="panel absolute bottom-3 z-20 rounded-lg px-4 py-3"
          style={{ left: PANEL_WIDTH + 24, right: 12 }}
        >
          <Timeline
            histogram={data.histogram}
            quakes={quakes}
            range={range}
            selectedId={eventId}
            onSelect={focusEvent}
          />
        </div>
      )}

      {/* ---- Mobile sheet ---- */}
      {!isDesktop && (
        <BottomSheet snap={sheetSnap} onSnapChange={setSheetSnap} label="Earthquake activity">
          {banner}
          {data && (
            <div className="border-b border-[var(--color-line)] px-4 pb-3 pt-1">
              <Timeline
                histogram={data.histogram}
                quakes={quakes}
                range={range}
                selectedId={eventId}
                onSelect={focusEvent}
              />
            </div>
          )}
          {panelBody}
        </BottomSheet>
      )}

      {/* Reset framing is useful once the user has wandered off. */}
      <button
        type="button"
        onClick={() => focusArea(DEFAULT_FOCUS)}
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-[var(--color-surface-raised)] focus:px-3 focus:py-2 focus:text-[12px]"
      >
        Reset map to all of Iceland
      </button>
    </main>
  );
}
