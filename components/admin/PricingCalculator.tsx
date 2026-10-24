"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SEGMENTS,
  GATEWAYS,
  PRICING_DEFAULTS,
  PRICING_PLANS,
  deliveryAppCostPaise,
  formatBps,
  formatRupees,
  kitchenCost,
  ordersPerMonth,
  percentToBps,
  platformRevenue,
  shareBps,
  wholeRupeesToPaise,
  type GatewayKey,
  type PricingInputs,
  type PricingPlanKey,
  type Segment,
} from "@/lib/pricing-calculator";

/** One colour per plan, shared by the cards, chart lines and legend. */
const PLAN_COLOR: Record<PricingPlanKey, { dot: string; stroke: string }> = {
  flat: { dot: "bg-blue-600 dark:bg-blue-400", stroke: "stroke-blue-600 dark:stroke-blue-400" },
  pct: { dot: "bg-purple-600 dark:bg-purple-400", stroke: "stroke-purple-600 dark:stroke-purple-400" },
  capped: { dot: "bg-orange-600 dark:bg-orange-400", stroke: "stroke-orange-600 dark:stroke-orange-400" },
  annual: { dot: "bg-teal-700 dark:bg-teal-400", stroke: "stroke-teal-700 dark:stroke-teal-400" },
};

const rupeesText = (paise: number) => String(paise / 100);
const percentText = (bps: number) => String(bps / 100);

type Tab = "kitchen" | "platform";

export function PricingCalculator() {
  const [tab, setTab] = useState<Tab>("kitchen");

  // Sliders hold numbers; typed fields hold their raw text and parse on read.
  const [salesRupees, setSalesRupees] = useState(PRICING_DEFAULTS.salesPaise / 100);
  const [aovRupees, setAovRupees] = useState(PRICING_DEFAULTS.aovPaise / 100);
  const [gatewaySharePct, setGatewaySharePct] = useState(PRICING_DEFAULTS.gatewayShareBps / 100);
  const [gateway, setGateway] = useState<GatewayKey>("razorpay");
  const [flat, setFlat] = useState(rupeesText(PRICING_DEFAULTS.flatPaise));
  const [fee, setFee] = useState(percentText(PRICING_DEFAULTS.feeBps));
  const [cap, setCap] = useState(rupeesText(PRICING_DEFAULTS.capPaise));
  const [annual, setAnnual] = useState(rupeesText(PRICING_DEFAULTS.annualPaise));
  const [chargeGst, setChargeGst] = useState(PRICING_DEFAULTS.chargeGst);
  const [appCommission, setAppCommission] = useState(percentText(PRICING_DEFAULTS.appCommissionBps));
  const [segments, setSegments] = useState(() =>
    DEFAULT_SEGMENTS.map((s) => ({ name: s.name, kitchens: String(s.kitchens), avgSales: rupeesText(s.avgSalesPaise) })),
  );

  const inputs: PricingInputs = {
    salesPaise: salesRupees * 100,
    aovPaise: aovRupees * 100,
    gatewayShareBps: gatewaySharePct * 100,
    gatewayRateBps: GATEWAYS.find((g) => g.key === gateway)?.rateBps ?? 0,
    flatPaise: wholeRupeesToPaise(flat) ?? 0,
    feeBps: percentToBps(fee) ?? 0,
    capPaise: wholeRupeesToPaise(cap) ?? 0,
    annualPaise: wholeRupeesToPaise(annual) ?? 0,
    chargeGst,
    appCommissionBps: percentToBps(appCommission) ?? 0,
  };

  const parsedSegments: Segment[] = segments.map((s) => ({
    name: s.name,
    kitchens: /^\d{1,6}$/.test(s.kitchens.trim()) ? Number(s.kitchens.trim()) : 0,
    avgSalesPaise: wholeRupeesToPaise(s.avgSales) ?? 0,
  }));

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Calculator view" className="flex gap-2">
        {(
          [
            ["kitchen", "Kitchen view"],
            ["platform", "AwaazOS revenue"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`pricing-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`pricing-panel-${key}`}
            onClick={() => setTab(key)}
            className={cn(
              "min-h-11 rounded-full border px-4 text-sm font-medium",
              tab === key ? "border-foreground bg-foreground text-background" : "bg-card text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-[300px_minmax(0,1fr)]">
        <section aria-labelledby="pricing-settings" className="space-y-4 rounded-lg border bg-card p-4">
          <h2 id="pricing-settings" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Kitchen
          </h2>
          <Slider
            label="Monthly sales"
            value={salesRupees}
            display={formatRupees(inputs.salesPaise)}
            min={5_000}
            max={3_00_000}
            step={5_000}
            onChange={setSalesRupees}
          />
          <Slider
            label="Average order value"
            value={aovRupees}
            display={formatRupees(inputs.aovPaise)}
            min={100}
            max={2_000}
            step={50}
            onChange={setAovRupees}
          />
          <Slider
            label="Paid through gateway"
            value={gatewaySharePct}
            display={`${gatewaySharePct}%`}
            min={0}
            max={100}
            step={5}
            onChange={setGatewaySharePct}
            hint="The rest is paid by direct UPI, with no gateway fee."
          />
          <SelectField label="Payment gateway" value={gateway} onChange={(v) => setGateway(v as GatewayKey)}>
            {GATEWAYS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.name} – {formatBps(g.rateBps)} + GST
              </option>
            ))}
          </SelectField>

          <hr className="border-border" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AwaazOS plans</h2>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Flat / month (₹)" value={flat} onChange={setFlat} valid={wholeRupeesToPaise(flat) !== null} />
            <TextField label="Fee per order (%)" value={fee} onChange={setFee} valid={percentToBps(fee) !== null} />
            <TextField label="Monthly cap (₹)" value={cap} onChange={setCap} valid={wholeRupeesToPaise(cap) !== null} />
            <TextField
              label="Annual plan (₹)"
              value={annual}
              onChange={setAnnual}
              valid={wholeRupeesToPaise(annual) !== null}
            />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={chargeGst}
              onChange={(e) => setChargeGst(e.target.checked)}
            />
            Add 18% GST to the AwaazOS fee
          </label>
          <TextField
            label="Delivery-app commission (%)"
            value={appCommission}
            onChange={setAppCommission}
            valid={percentToBps(appCommission) !== null}
            hint="For the comparison line only."
          />
          <p className="text-xs text-muted-foreground">Defaults are today&apos;s STARTER prices.</p>
        </section>

        <div
          role="tabpanel"
          id={`pricing-panel-${tab}`}
          aria-labelledby={`pricing-tab-${tab}`}
          className="min-w-0 space-y-4"
        >
          {tab === "kitchen" ? (
            <KitchenView c={inputs} />
          ) : (
            <PlatformView
              c={inputs}
              segments={parsedSegments}
              raw={segments}
              onChange={(i, patch) => setSegments((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)))}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function KitchenView({ c }: { c: PricingInputs }) {
  const results = PRICING_PLANS.map((p) => ({ plan: p, cost: kitchenCost(p.key, c.salesPaise, c) }));
  const best = results.reduce((a, b) => (b.cost.totalPaise < a.cost.totalPaise ? b : a));
  const orders = ordersPerMonth(c);
  const gatewayName = GATEWAYS.find((g) => g.rateBps === c.gatewayRateBps)?.name ?? "the gateway";

  const flat = kitchenCost("flat", c.salesPaise, c);
  const flatAwaazos = flat.feePaise + flat.feeGstPaise;
  const allDirect = kitchenCost("flat", c.salesPaise, { ...c, gatewayShareBps: 0 });
  const appCost = deliveryAppCostPaise(c.salesPaise, c);

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {results.map(({ plan, cost }) => {
          const isBest = plan.key === best.plan.key;
          return (
            <li
              key={plan.key}
              className={cn(
                "relative rounded-lg border bg-card p-3",
                isBest && "border-success bg-success/10",
              )}
            >
              {isBest ? (
                <span className="absolute -top-2.5 right-2 rounded-full bg-success px-2 text-xs font-semibold text-success-foreground">
                  Cheapest
                </span>
              ) : null}
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <span aria-hidden className={cn("size-2.5 rounded-full", PLAN_COLOR[plan.key].dot)} />
                {plan.name}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{formatRupees(cost.totalPaise)}</p>
              <p className="text-sm text-muted-foreground">{formatBps(shareBps(cost.totalPaise, c.salesPaise))} of sales</p>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="pricing-breakdown" className="rounded-lg border bg-card p-4">
        <h2 id="pricing-breakdown" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Monthly breakdown for this kitchen
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 pr-2 text-left font-medium">
                  <span className="sr-only">Line</span>
                </th>
                {PRICING_PLANS.map((p) => (
                  <th key={p.key} scope="col" className="whitespace-nowrap px-2 py-2 text-right font-medium">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row label={`${gatewayName} fees (incl. GST)`} values={results.map((r) => r.cost.gatewayPaise)} />
              <Row label="AwaazOS fee" values={results.map((r) => r.cost.feePaise)} />
              {c.chargeGst ? <Row label="GST on AwaazOS fee" values={results.map((r) => r.cost.feeGstPaise)} /> : null}
              <Row label="Total cost" bold values={results.map((r) => r.cost.totalPaise)} />
              <Row label="Kitchen receives" values={results.map((r) => c.salesPaise - r.cost.totalPaise)} />
              <Row
                label="Cost per order"
                values={results.map((r) => (orders ? Math.floor(r.cost.totalPaise / orders) : null))}
              />
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          About {orders.toLocaleString("en-IN")} orders a month at {formatRupees(c.aovPaise)} each. Gateway fees apply only
          to the {c.gatewayShareBps / 100}% paid through {gatewayName}.
        </p>
      </section>

      <FeeChart c={c} />

      <section aria-labelledby="pricing-pitch" className="rounded-lg bg-primary/10 p-4 text-sm">
        <h2 id="pricing-pitch" className="font-semibold">
          Sales line for this kitchen
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            AwaazOS on the flat plan: <b>{formatRupees(flatAwaazos)}</b> a month (
            {formatBps(shareBps(flatAwaazos, c.salesPaise))} of sales), no commission.
          </li>
          <li>
            {gatewayName} on {c.gatewayShareBps / 100}% of orders: <b>{formatRupees(flat.gatewayPaise)}</b>. Paid by direct
            UPI instead, the total cost would be <b>{formatRupees(allDirect.totalPaise)}</b>
            {flat.gatewayPaise > flatAwaazos ? " — the gateway saving alone covers AwaazOS" : ""}.
          </li>
          <li>
            The same sales on a delivery app at {formatBps(c.appCommissionBps)} commission:{" "}
            <b>{formatRupees(appCost)}</b> (incl. GST).
          </li>
        </ul>
      </section>
    </>
  );
}

function Row({ label, values, bold }: { label: string; values: (number | null)[]; bold?: boolean }) {
  return (
    <tr className={cn("border-b last:border-0", bold && "font-bold")}>
      <th scope="row" className="whitespace-nowrap py-2 pr-2 text-left font-[inherit]">
        {label}
      </th>
      {values.map((v, i) => (
        <td key={i} className="whitespace-nowrap px-2 py-2 text-right">
          {v === null ? "–" : formatRupees(v)}
        </td>
      ))}
    </tr>
  );
}

const CHART = { w: 640, h: 260, l: 64, r: 24, t: 14, b: 32, maxSalesPaise: 3_00_000_00, steps: 60 };

function FeeChart({ c }: { c: PricingInputs }) {
  const series = PRICING_PLANS.map((p) => ({
    plan: p,
    points: Array.from({ length: CHART.steps + 1 }, (_, i) => {
      const sales = (CHART.maxSalesPaise / CHART.steps) * i;
      const k = kitchenCost(p.key, sales, c);
      return [sales, k.feePaise + k.feeGstPaise] as const;
    }),
  }));
  const peak = Math.max(...series.flatMap((s) => s.points.map((pt) => pt[1])));
  const step = 500_00;
  const maxY = Math.max(step, Math.ceil(peak / step) * step);
  const x = (v: number) => CHART.l + ((CHART.w - CHART.l - CHART.r) * v) / CHART.maxSalesPaise;
  const y = (v: number) => CHART.h - CHART.b - ((CHART.h - CHART.t - CHART.b) * v) / maxY;
  const here = x(Math.min(c.salesPaise, CHART.maxSalesPaise));

  return (
    <section aria-labelledby="pricing-chart" className="rounded-lg border bg-card p-4">
      <h2 id="pricing-chart" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        AwaazOS fee at different sales levels
      </h2>
      <svg
        viewBox={`0 0 ${CHART.w} ${CHART.h}`}
        className="mt-3 w-full"
        role="img"
        aria-label="AwaazOS fee per month by monthly sales, one line per plan"
      >
        {[0, 1, 2, 3, 4].map((g) => {
          const v = Math.floor((maxY * g) / 4);
          return (
            <g key={g}>
              <line x1={CHART.l} x2={CHART.w - CHART.r} y1={y(v)} y2={y(v)} className="stroke-border" />
              <text x={CHART.l - 6} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                {formatRupees(v)}
              </text>
            </g>
          );
        })}
        {[0, 50_000, 1_00_000, 1_50_000, 2_00_000, 2_50_000, 3_00_000].map((rupees) => (
          <text
            key={rupees}
            x={x(rupees * 100)}
            y={CHART.h - 10}
            textAnchor="middle"
            className="fill-muted-foreground text-[11px]"
          >
            {rupees ? `₹${rupees / 1000}k` : "₹0"}
          </text>
        ))}
        {series.map((s) => (
          <path
            key={s.plan.key}
            d={s.points.map((pt, i) => `${i ? "L" : "M"}${x(pt[0])} ${y(pt[1])}`).join(" ")}
            fill="none"
            strokeWidth={2.2}
            className={PLAN_COLOR[s.plan.key].stroke}
          />
        ))}
        <line
          x1={here}
          x2={here}
          y1={CHART.t}
          y2={CHART.h - CHART.b}
          strokeDasharray="4 4"
          className="stroke-foreground/50"
        />
        <text x={here + 4} y={CHART.t + 10} className="fill-muted-foreground text-[11px]">
          this kitchen
        </text>
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {PRICING_PLANS.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2.5 rounded-full", PLAN_COLOR[p.key].dot)} />
            {p.name}
          </li>
        ))}
      </ul>
    </section>
  );
}

type RawSegment = { name: string; kitchens: string; avgSales: string };

function PlatformView({
  c,
  segments,
  raw,
  onChange,
}: {
  c: PricingInputs;
  segments: Segment[];
  raw: RawSegment[];
  onChange: (index: number, patch: Partial<RawSegment>) => void;
}) {
  const revenue = platformRevenue(segments, c);

  return (
    <>
      <section aria-labelledby="pricing-segments" className="rounded-lg border bg-card p-4">
        <h2 id="pricing-segments" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Kitchens on AwaazOS
        </h2>
        <div className="mt-3 space-y-3">
          {raw.map((s, i) => (
            <fieldset key={s.name} className="grid grid-cols-[4rem_minmax(0,1fr)_minmax(0,1.4fr)] items-end gap-2">
              <legend className="sr-only">{s.name} kitchens</legend>
              <span className="pb-2.5 text-sm font-medium">{s.name}</span>
              <TextField
                label="Kitchens"
                value={s.kitchens}
                onChange={(v) => onChange(i, { kitchens: v })}
                valid={/^\d{1,6}$/.test(s.kitchens.trim())}
              />
              <TextField
                label="Avg sales / month (₹)"
                value={s.avgSales}
                onChange={(v) => onChange(i, { avgSales: v })}
                valid={wholeRupeesToPaise(s.avgSales) !== null}
              />
            </fieldset>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Plan settings apply here too. Revenue excludes any GST collected.
        </p>
      </section>

      <section aria-labelledby="pricing-revenue" className="rounded-lg border bg-card p-4">
        <h2 id="pricing-revenue" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          AwaazOS revenue by plan
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-2 text-left font-medium">
                  Segment
                </th>
                {PRICING_PLANS.map((p) => (
                  <th key={p.key} scope="col" className="whitespace-nowrap px-2 py-2 text-right font-medium">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {revenue.rows.map(({ segment, byPlan }) => (
                <Row
                  key={segment.name}
                  label={`${segment.name} (${segment.kitchens} × ${formatRupees(segment.avgSalesPaise)})`}
                  values={byPlan}
                />
              ))}
              <Row label="Per month" bold values={revenue.monthlyByPlan} />
              <Row label="Per year" bold values={revenue.monthlyByPlan.map((v) => v * 12)} />
              <tr>
                <th scope="row" className="whitespace-nowrap py-2 pr-2 text-left font-normal">
                  Share of kitchens&apos; sales
                </th>
                {revenue.monthlyByPlan.map((v, i) => (
                  <td key={i} className="whitespace-nowrap px-2 py-2 text-right">
                    {formatBps(shareBps(v, revenue.gmvPaise))}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          &ldquo;Flat&rdquo; assumes every kitchen signs up and stays, which small kitchens are least likely to do on a
          fixed fee.
        </p>
      </section>
    </>
  );
}

function Slider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-muted-foreground">
          {label}
        </Label>
        <span className="text-sm font-semibold tabular-nums" aria-hidden>
          {display}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 w-full accent-primary"
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  valid,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  valid: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        aria-invalid={!valid}
        onChange={(e) => onChange(e.target.value)}
        className={cn(!valid && "border-destructive")}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-muted-foreground">
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="touch-target flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        {children}
      </select>
    </div>
  );
}
