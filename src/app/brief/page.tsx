import type { Metadata } from "next";
import Link from "next/link";
import type {
  Brief,
  BriefObservationItem,
  BriefRegionItem,
  BriefScenario,
  BriefVolcano,
  BriefWarning,
} from "@/analytics/brief";
import type { AlertColour } from "@/domain/alert";
import type { AviationColour } from "@/domain/volcano";
import { parseTimeRange, TIME_RANGES } from "@/domain/time-range";
import { formatMagnitude } from "@/lib/format";
import { formatDayClock, formatExact } from "@/lib/time";
import { getBrief } from "@/server/brief";

/**
 * The written brief.
 *
 * ## What this is for
 *
 * Everything else here is a panel to be read in front of a map. This is the
 * thing you send. Somebody asks what is going on, and the honest answer is
 * four panels and a legend — so this is those panels arranged into a page
 * with an order, a timestamp and its own standing statement, at a URL that
 * survives being pasted into a message.
 *
 * ## Why it renders on the server and stops there
 *
 * No client component, no polling, no map. A brief is a statement about a
 * moment, and a document that quietly updates after it was sent is a document
 * whose reader and sender saw different things. The time it was assembled is
 * at the top, and reloading is how you get a newer one.
 *
 * That also makes it work with images off, in a text-only mail client, and on
 * paper — which is the other half of "sendable".
 *
 * ## Whose words are whose
 *
 * IMO's material is set against a coloured rule in their published colours
 * with their name under it; our arithmetic is monochrome. The rule is not
 * decoration. A reader skimming this on a phone has to be able to tell a
 * warning somebody issued from a number we calculated, without reading
 * carefully enough to notice the attribution.
 */

export const dynamic = "force-dynamic";

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function rangeOf(params: Record<string, string | string[] | undefined>) {
  const raw = Array.isArray(params.range) ? params.range[0] : params.range;
  return parseTimeRange(raw);
}

export async function generateMetadata({ searchParams }: Params): Promise<Metadata> {
  const range = rangeOf(await searchParams);
  const brief = await getBrief(range);

  return {
    title: "Situation brief",
    // The summary is already one deterministic paragraph about the window,
    // which is exactly what a link preview should carry.
    description:
      brief?.summary.join(" ") ??
      "A summary of published earthquake and volcanic data for Iceland.",
    // A brief is a statement about a moment and goes stale by design; a search
    // engine holding one from last Tuesday would be worse than holding none.
    robots: { index: false, follow: true },
  };
}

const ALERT_COLOUR: Record<AlertColour, string> = {
  Yellow: "var(--color-alert-yellow)",
  Orange: "var(--color-alert-orange)",
  Red: "var(--color-alert-red)",
};

const AVIATION_COLOUR: Record<AviationColour, string> = {
  GREEN: "var(--color-alert-green)",
  YELLOW: "var(--color-alert-yellow)",
  ORANGE: "var(--color-alert-orange)",
  RED: "var(--color-alert-red)",
};

function Section({
  title,
  lead,
  unavailable,
  empty,
  count,
  children,
}: {
  title: string;
  lead: string;
  unavailable: string | null;
  /** What to say when the source answered and had nothing. */
  empty: string;
  count: number;
  children?: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-[13px] font-medium tracking-wide text-[var(--color-ink)] uppercase">
        {title}
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-dim)]">{lead}</p>

      {unavailable ? (
        <p className="mt-3 border-l-2 border-[var(--color-quake-recent)] pl-3 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          {unavailable}
        </p>
      ) : count === 0 ? (
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">{empty}</p>
      ) : (
        children
      )}
    </section>
  );
}

/** IMO's material, set against their own colour with their name under it. */
function Relayed({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <li className="mt-3 border-l-2 pl-3" style={{ borderColor: colour }}>
      {children}
    </li>
  );
}

function Attribution({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">{children}</p>
  );
}

function Warning({ warning }: { warning: BriefWarning }) {
  return (
    <Relayed colour={warning.colour ? ALERT_COLOUR[warning.colour] : "var(--color-ink-dim)"}>
      <p className="text-[13px] font-medium text-[var(--color-ink)]">
        {warning.event}
        {warning.colour && (
          <span
            className="ml-2 text-[11px] font-normal"
            style={{ color: ALERT_COLOUR[warning.colour] }}
          >
            {warning.colour}
          </span>
        )}
      </p>
      {warning.headline && (
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          {warning.headline}
        </p>
      )}
      {warning.areas.length > 0 && (
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink-dim)]">
          {warning.areas.join(" · ")}
        </p>
      )}
      <Attribution>
        {warning.senderName ?? "Icelandic Meteorological Office"} · issued{" "}
        {formatDayClock(warning.sentAt)}
        {warning.expiresAt ? ` · until ${formatDayClock(warning.expiresAt)}` : ""}
        {warning.url && (
          <>
            {" · "}
            <a
              href={warning.url}
              className="underline underline-offset-2 hover:text-[var(--color-ink-muted)]"
            >
              IMO
            </a>
          </>
        )}
      </Attribution>
    </Relayed>
  );
}

function Volcano({ volcano }: { volcano: BriefVolcano }) {
  const colour = volcano.aviationColour
    ? AVIATION_COLOUR[volcano.aviationColour]
    : "var(--color-ink-dim)";
  return (
    <Relayed colour={colour}>
      <p className="text-[13px] font-medium text-[var(--color-ink)]">
        {volcano.name}
        {volcano.aviationColour && (
          <span className="ml-2 text-[11px] font-normal" style={{ color: colour }}>
            aviation {volcano.aviationColour.toLowerCase()}
          </span>
        )}
      </p>
      <Attribution>
        {volcano.alertLevel ? `Alert level ${volcano.alertLevel}` : "No alert level issued"}
        {volcano.zone ? ` · ${volcano.zone}` : ""} · Icelandic Meteorological Office
      </Attribution>
    </Relayed>
  );
}

function Scenario({ scenario }: { scenario: BriefScenario }) {
  return (
    <Relayed colour="var(--color-line-strong)">
      <p className="text-[13px] font-medium text-[var(--color-ink)]">
        {scenario.volcano}
        <span className="ml-2 text-[11px] font-normal text-[var(--color-ink-dim)]">
          {scenario.hazard}
        </span>
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
        {scenario.scenario} · {scenario.durationHours} h from{" "}
        {formatDayClock(scenario.startsAt)}
        {scenario.columnHeightM !== null && (
          <>
            {" · "}column height given as {scenario.columnHeightM.toLocaleString("en-GB")} m
          </>
        )}
      </p>
      <Attribution>
        Icelandic Meteorological Office ·{" "}
        <a
          href={scenario.viewerUrl}
          className="underline underline-offset-2 hover:text-[var(--color-ink-muted)]"
        >
          IMO&rsquo;s viewer, which carries the quantitative legend
        </a>
      </Attribution>
    </Relayed>
  );
}

function Observation({ observation }: { observation: BriefObservationItem }) {
  return (
    <li className="mt-4">
      <p className="text-[13px] font-medium text-[var(--color-ink)]">{observation.headline}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
        {observation.detail}
      </p>
      {observation.context && (
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-dim)]">
          {observation.context}
        </p>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        {formatDayClock(observation.span.from)} to {formatDayClock(observation.span.to)}
      </p>
    </li>
  );
}

/**
 * The methods behind the observations above, each printed once.
 *
 * On screen every observation carries its own method behind a toggle, which is
 * right there: you expand the one you are questioning. Printed inline, three
 * findings from one detector repeat the same paragraph three times, and a
 * document nobody finishes reading has verified nothing. Deduplicated and set
 * at the foot of the section, the arithmetic is still all here to be checked.
 */
function Methods({ observations }: { observations: readonly BriefObservationItem[] }) {
  const methods = [...new Set(observations.map((observation) => observation.method))];
  if (methods.length === 0) return null;

  return (
    <div className="mt-5 border-t border-[var(--color-line)] pt-3">
      <h3 className="text-[11px] font-medium tracking-wide text-[var(--color-ink-dim)] uppercase">
        How these were calculated
      </h3>
      {methods.map((method) => (
        <p
          key={method}
          className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-faint)]"
        >
          {method}
        </p>
      ))}
    </div>
  );
}

function Region({ region }: { region: BriefRegionItem }) {
  return (
    <li className="mt-3">
      <p className="text-[13px] text-[var(--color-ink)]">
        <span className="font-medium">{region.region}</span>
        <span className="ml-2 tnum text-[var(--color-ink-muted)]">
          {region.count.toLocaleString("en-GB")}{" "}
          {region.count === 1 ? "event" : "events"}
        </span>
        {region.largestMagnitude !== null && (
          <span className="ml-2 tnum text-[var(--color-ink-dim)]">
            largest {formatMagnitude(region.largestMagnitude)}
          </span>
        )}
      </p>
      {region.comparison && (
        <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-ink-dim)]">
          {region.comparison}
        </p>
      )}
    </li>
  );
}

function BriefBody({ brief }: { brief: Brief }) {
  const phrase = TIME_RANGES[brief.range].phrase;

  return (
    <>
      <header>
        <h1 className="text-[20px] font-medium tracking-tight text-[var(--color-ink)]">
          Iceland Live &mdash; situation brief
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          Assembled {formatExact(brief.generatedAt)}. Covers {phrase}, from{" "}
          {formatDayClock(brief.window.from)} to {formatDayClock(brief.window.to)}.
        </p>
        <p className="mt-2 text-[12px] print:hidden">
          <Link
            href={`/?range=${brief.range}`}
            className="text-[var(--color-ink-dim)] underline underline-offset-2 hover:text-[var(--color-ink)]"
          >
            Open the live map
          </Link>
        </p>
      </header>

      <div className="mt-6 border-y border-[var(--color-line)] py-4">
        {brief.standing.map((sentence) => (
          <p
            key={sentence}
            className="mt-2 text-[12px] leading-relaxed text-[var(--color-ink-dim)] first:mt-0"
          >
            {sentence}
          </p>
        ))}
      </div>

      <section className="mt-10">
        <h2 className="text-[13px] font-medium tracking-wide text-[var(--color-ink)] uppercase">
          Summary
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink)]">
          {brief.summary.join(" ")}
        </p>
      </section>

      <Section
        title="Official warnings"
        lead={brief.warnings.lead}
        unavailable={brief.warnings.unavailable}
        empty="IMO has no warnings in force."
        count={brief.warnings.items.length}
      >
        <ul>
          {brief.warnings.items.map((warning) => (
            <Warning key={warning.id} warning={warning} />
          ))}
        </ul>
      </Section>

      <Section
        title="Volcanic systems above normal"
        lead={brief.volcanoes.lead}
        unavailable={brief.volcanoes.unavailable}
        empty="IMO places no system above its normal state."
        count={brief.volcanoes.items.length}
      >
        <ul>
          {brief.volcanoes.items.map((volcano) => (
            <Volcano key={volcano.name} volcano={volcano} />
          ))}
        </ul>
      </Section>

      <Section
        title="Observations"
        lead={brief.observations.lead}
        unavailable={brief.observations.unavailable}
        empty="Nothing in this window met the thresholds."
        count={brief.observations.items.length}
      >
        <>
          <ul>
            {brief.observations.items.map((observation) => (
              <Observation
                key={observation.headline + observation.span.from}
                observation={observation}
              />
            ))}
          </ul>
          <Methods observations={brief.observations.items} />
        </>
      </Section>

      <Section
        title="Where the activity was"
        lead={brief.regions.lead}
        unavailable={brief.regions.unavailable}
        empty="No events were recorded anywhere in the region during this window."
        count={brief.regions.items.length}
      >
        <ul>
          {brief.regions.items.map((region) => (
            <Region key={region.region} region={region} />
          ))}
        </ul>
      </Section>

      <Section
        title="Dispersal simulations"
        lead={brief.scenarios.lead}
        unavailable={brief.scenarios.unavailable}
        empty="IMO is publishing no runs at the moment."
        count={brief.scenarios.items.length}
      >
        <ul>
          {brief.scenarios.items.map((scenario) => (
            <Scenario key={scenario.id} scenario={scenario} />
          ))}
        </ul>
      </Section>

      <footer className="mt-12 border-t border-[var(--color-line)] pt-4">
        <p className="text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
          Earthquake catalogue, warnings, volcanic status and dispersal simulations:{" "}
          <a
            href="https://en.vedur.is/"
            className="underline underline-offset-2 hover:text-[var(--color-ink-dim)]"
          >
            Icelandic Meteorological Office
          </a>
          . Volcanic systems are published through the Catalogue of Icelandic Volcanoes.
          Assembled by Iceland Live, which is not affiliated with IMO.
        </p>
      </footer>
    </>
  );
}

export default async function BriefPage({ searchParams }: Params) {
  const range = rangeOf(await searchParams);
  const brief = await getBrief(range);

  return (
    <main className="mx-auto min-h-[100dvh] max-w-[46rem] px-5 py-10 sm:px-8 sm:py-14">
      {brief ? (
        <BriefBody brief={brief} />
      ) : (
        <>
          <h1 className="text-[20px] font-medium tracking-tight text-[var(--color-ink)]">
            Iceland Live &mdash; situation brief
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
            The earthquake catalogue could not be read, and every part of this document is
            derived from it. Rather than publish a page of caveats, here is the one fact
            that matters: this brief could not be assembled. Nothing should be read into
            that about Iceland.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
            IMO&rsquo;s own pages are at{" "}
            <a
              href="https://en.vedur.is/"
              className="underline underline-offset-2 hover:text-[var(--color-ink)]"
            >
              en.vedur.is
            </a>
            .
          </p>
        </>
      )}
    </main>
  );
}
