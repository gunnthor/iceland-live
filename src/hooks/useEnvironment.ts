"use client";

import { useEffect, useState } from "react";
import type { EnvironmentResult } from "@/domain/api";
import type { AirQualityStation } from "@/domain/air-quality";
import type { RoadCondition, RoadWeatherStation } from "@/domain/roads";

export type EnvironmentState = {
  air: AirQualityStation[];
  airError: string | null;
  roadWeather: RoadWeatherStation[];
  roadConditions: RoadCondition[];
  roadConditionsTotal: number;
  roadConditionGeometry: GeoJSON.FeatureCollection | null;
  roadsError: string | null;
  roadAttribution: string | null;
  loading: boolean;
  unavailable: boolean;
};

const EMPTY = {
  air: [] as AirQualityStation[],
  airError: null as string | null,
  roadWeather: [] as RoadWeatherStation[],
  roadConditions: [] as RoadCondition[],
  roadConditionsTotal: 0,
  roadConditionGeometry: null as GeoJSON.FeatureCollection | null,
  roadsError: null as string | null,
  roadAttribution: null as string | null,
  unavailable: false,
};

/** Air readings are hourly averages; the road feeds move every few minutes. */
const POLL_INTERVAL_MS = 5 * 60_000;

/**
 * Air quality and road conditions.
 *
 * Loaded on first demand and then polled, because unlike the static layers this
 * one is genuinely live — a gas reading an hour old is a different fact from a
 * gas reading now.
 */
export function useEnvironment(enabled: boolean): EnvironmentState {
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch("/api/environment", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as EnvironmentResult;
        if (controller.signal.aborted) return;

        setState(
          body.ok
            ? {
                air: body.air,
                airError: body.airError,
                roadWeather: body.roadWeather,
                roadConditions: body.roadConditions,
                roadConditionsTotal: body.roadConditionsTotal,
                roadConditionGeometry: body.roadConditionGeometry,
                roadsError: body.roadsError,
                roadAttribution: body.roadAttribution,
                unavailable: false,
              }
            : { ...EMPTY, unavailable: true },
        );
      } catch {
        if (!controller.signal.aborted) setState({ ...EMPTY, unavailable: true });
      }
    };

    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [enabled]);

  return {
    ...state,
    loading:
      enabled && state.air.length === 0 && state.roadWeather.length === 0 && !state.unavailable,
  };
}
