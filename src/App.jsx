import { useState, useMemo } from "react";

const FURNITURE = [
  { id: "armchair", label: "Armchair", seats: 1 },
  { id: "couch", label: "Couch / Sofa", seats: 3 },
  { id: "sectional", label: "Sectional", seats: 5 },
  { id: "recliner", label: "Recliner", seats: 1 },
  { id: "office", label: "Office Chair", seats: 1 },
  { id: "ottoman", label: "Ottoman", seats: 0.5 },
];

const MATERIAL = [
  { id: "fabric", label: "Fabric / Cotton", factor: 320 },
  { id: "velvet", label: "Velvet", factor: 460 },
  { id: "wool", label: "Wool Blend", factor: 380 },
  { id: "leatherette", label: "Faux Leather", factor: 160 },
  { id: "leather", label: "Genuine Leather", factor: 60 },
];

// --- Emission rates, grounded in published flatus-frequency research ---
// Adults pass gas ~32 times/day on average when measured continuously with a
// wearable sensor (Botasini et al., 2025) [1] — roughly double the ~14/day
// figure from earlier clinical estimates based on self-report and short
// observation windows (Tomlin, Lowis, & Read, 1991) [2]. We use the higher,
// sensor-measured baseline since it captures sleep-time and socially
// suppressed events that older methods missed.
const FLATUS_EVENTS_PER_DAY = 32; // Botasini et al., 2025 [1]
const FLATUS_EVENTS_PER_DAY_LEGACY = 14; // Tomlin, Lowis, & Read, 1991 [2]
const WAKING_HOURS = 16;
const HUMAN_RATE_PER_HOUR = FLATUS_EVENTS_PER_DAY / WAKING_HOURS; // ≈2/hr
// Dogs emit at a minimum of 1.5× the human rate (stated model assumption — no
// wearable-sensor canine study exists yet) and experience no social suppression.
const DOG_RATE_MULTIPLIER = 1.5;
const DOG_RATE_PER_HOUR = HUMAN_RATE_PER_HOUR * DOG_RATE_MULTIPLIER; // 3/hr
// Children emit at the adult rate but suppress roughly half as much.
const CHILD_SUPPRESSION_FACTOR = 0.5;
const DAYS_PER_YEAR = 365.25;

// Each usage type carries a typical daily duration spent on the piece and a
// social-suppression factor for adults (0 = no inhibition, 1 = total
// suppression). Work-from-home sessions run longest (up to 8 hrs/day), so
// despite heavier suppression during calls, WFH still contributes heavily —
// longer seat time outweighs the suppression.
const USAGE_TYPES = [
  { id: "tv", label: "TV / movie marathons", hours: 3, suppression: 0.1 },
  { id: "napping", label: "Napping / sleeping", hours: 1.5, suppression: 0 },
  { id: "gaming", label: "Gaming sessions", hours: 2.5, suppression: 0.1 },
  { id: "eating", label: "Eating meals", hours: 1, suppression: 0.3 },
  { id: "wfh", label: "Work-from-home seating", hours: 8, suppression: 0.6 },
  { id: "family", label: "Family time (kids + snacks)", hours: 2, suppression: 0.2 },
  { id: "guest", label: "Guest / formal seating only", hours: 0.5, suppression: 0.9 },
];

const RETENTION_LEVELS = [
  { key: "low", label: "Low", max: 150, color: "#6E8F72" },
  { key: "moderate", label: "Moderate", max: 350, color: "#D99A2B" },
  { key: "high", label: "High", max: Infinity, color: "#B4402A" },
];

function retentionFor(factor) {
  return RETENTION_LEVELS.find((r) => factor <= r.max) || RETENTION_LEVELS[RETENTION_LEVELS.length - 1];
}

// Tier thresholds are lifetime event counts. A typical 5-year family couch
// lands around 30,000 events, anchoring "Some History".
const TIERS = [
  { key: "fresh", label: "Low Concern", max: 10000, color: "#6E8F72", note: "Nothing here that should factor into your decision." },
  { key: "ripe", label: "Some History", max: 50000, color: "#D99A2B", note: "Typical accumulation for a used piece. A wipe-down and airing out should be plenty." },
  { key: "elevated", label: "Elevated", max: 150000, color: "#C1622D", note: "Heavier accumulation than average. Worth inspecting cushions and inner padding before buying." },
  { key: "high", label: "High", max: Infinity, color: "#B4402A", note: "Significant estimated accumulation. Consider a deep clean or reupholstering, or negotiate the price." },
];

// Ring gauge maps the FFi onto a log scale: 10² events ≈ empty, 10^6.5 ≈ full.
const RING_LOG_MIN = 2;
const RING_LOG_MAX = 6.5;

const DIGIT_HEIGHT = 38;
const DIGIT_WIDTH = 22;

function OdometerDigit({ digit }) {
  return (
    <div style={{ height: DIGIT_HEIGHT, width: DIGIT_WIDTH, overflow: "hidden" }}>
      <div
        style={{
          transform: `translateY(-${digit * DIGIT_HEIGHT}px)`,
          transition: "transform 700ms cubic-bezier(.22,.9,.24,1)",
        }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <div
            key={d}
            style={{
              height: DIGIT_HEIGHT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {d}
          </div>
        ))}
      </div>
    </div>
  );
}

function OdometerReadout({ value }) {
  const chars = value.toLocaleString().split("");
  return (
    <div
      className="of-display inline-flex items-center rounded-md px-2.5"
      style={{
        background: "#1C1A16",
        boxShadow: "inset 0 2px 4px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.05)",
        fontSize: 26,
        fontWeight: 700,
        color: "#F4EFE4",
        height: DIGIT_HEIGHT + 12,
      }}
    >
      {chars.map((c, i) =>
        c === "," ? (
          <span key={i} style={{ color: "#8A8375", width: 8, textAlign: "center" }}>,</span>
        ) : (
          <OdometerDigit key={i} digit={Number(c)} />
        )
      )}
    </div>
  );
}

export default function App() {
  const [furniture, setFurniture] = useState("couch");
  const [material, setMaterial] = useState("fabric");
  const [age, setAge] = useState(5);
  const [owners, setOwners] = useState(1);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [pets, setPets] = useState(0);
  const [usage, setUsage] = useState(["tv", "napping"]);
  const [revealed, setRevealed] = useState(false);

  const toggleUsage = (id) =>
    setUsage((u) => (u.includes(id) ? u.filter((x) => x !== id) : [...u, id]));

  const result = useMemo(() => {
    const f = FURNITURE.find((x) => x.id === furniture);
    const m = MATERIAL.find((x) => x.id === material);

    // Seat capacity caps how much of the household can occupy the piece at
    // once: a sectional hosts the whole family, an office chair one emitter.
    const occupants = adults + children + pets;
    const fillFraction = occupants > 0 ? Math.min(f.seats, occupants) / occupants : 0;

    const dailyEvents = usage.reduce((sum, id) => {
      const u = USAGE_TYPES.find((x) => x.id === id);
      if (!u) return sum;
      const householdRatePerHour =
        adults * HUMAN_RATE_PER_HOUR * (1 - u.suppression) +
        children * HUMAN_RATE_PER_HOUR * (1 - u.suppression * CHILD_SUPPRESSION_FACTOR) +
        pets * DOG_RATE_PER_HOUR;
      return sum + u.hours * householdRatePerHour * fillFraction;
    }, 0);

    const ffi = Math.round(dailyEvents * DAYS_PER_YEAR * age);

    // Each previous owner is an undocumented household — the count doesn't
    // change, but confidence in it does.
    const uncertaintyPct = 8 + 7 * owners;
    const ffiLow = Math.round(ffi * (1 - uncertaintyPct / 100));
    const ffiHigh = Math.round(ffi * (1 + uncertaintyPct / 100));

    const retention = retentionFor(m.factor);

    const baseIdx = TIERS.findIndex((t) => ffi <= t.max);
    const idx = baseIdx === -1 ? TIERS.length - 1 : baseIdx;
    const bumpedIdx = retention.key === "high" ? Math.min(idx + 1, TIERS.length - 1) : idx;
    const tier = TIERS[bumpedIdx];
    const bumped = bumpedIdx > idx;

    return { ffi, ffiLow, ffiHigh, uncertaintyPct, dailyEvents, tier, retention, bumped, f, m };
  }, [furniture, material, age, owners, adults, children, pets, usage]);

  const ringFill =
    result.ffi > 0
      ? Math.min(Math.max((Math.log10(result.ffi) - RING_LOG_MIN) / (RING_LOG_MAX - RING_LOG_MIN), 0), 1)
      : 0;
  const ringDeg = ringFill * 360;

  return (
    <div className="of-body min-h-screen w-full flex items-start justify-center py-10 px-4" style={{ background: "#F3F0E8" }}>
      <div className="w-full max-w-md">
        <div className="mb-5">
          <div className="of-display text-xl" style={{ color: "#211D18" }}>Prior Use Estimator</div>
          <p className="text-sm mt-1" style={{ color: "#6B6656" }}>
            Answer a few questions about the piece you're considering. This estimates the total number of flatus
            events the item has absorbed, calibrated against published flatus-frequency research [1][2] and the
            compounds known to drive flatus odor [3] — not a lab measurement of this specific item.
          </p>
        </div>

        <div className="rounded-2xl p-6 mb-4" style={{ background: "#FFFFFF", boxShadow: "0 1px 2px rgba(33,29,24,0.06), 0 8px 24px rgba(33,29,24,0.06)" }}>
          <div className="flex items-center gap-5">
            <div
              className="of-ring relative flex items-center justify-center shrink-0"
              style={{
                width: 96,
                height: 96,
                borderRadius: "50%",
                background: `conic-gradient(${result.tier.color} ${ringDeg}deg, #EDE9DF ${ringDeg}deg)`,
                transition: "background 500ms ease",
              }}
            >
              <div className="absolute rounded-full flex flex-col items-center justify-center" style={{ width: 76, height: 76, background: "#FFFFFF" }}>
                <span className="of-display text-lg leading-none" style={{ color: result.tier.color }}>{Math.round(result.dailyEvents)}</span>
                <span className="text-[10px] mt-0.5" style={{ color: "#9A9384" }}>per day</span>
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide" style={{ color: "#9A9384" }}>Lifetime estimate</div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <OdometerReadout value={result.ffi} />
                <span className="of-display text-sm" style={{ color: "#9A9384" }}>FFi</span>
              </div>
              <span className="inline-block mt-2 px-2.5 py-1 rounded-md text-xs of-display" style={{ background: `${result.tier.color}1A`, color: result.tier.color }}>
                {result.tier.label}
              </span>
            </div>
          </div>

          <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: "1px solid #EDE9DF" }}>
            <span className="text-sm" style={{ color: "#6B6656" }}>Odor retention risk (material)</span>
            <span className="of-display text-sm" style={{ color: result.retention.color }}>{result.retention.label}</span>
          </div>
          {result.bumped && (
            <p className="text-xs mt-2" style={{ color: "#9A9384" }}>
              This rating was raised a level because {result.m.label.toLowerCase()} holds odor longer than the event count alone would suggest.
            </p>
          )}
          <p className="text-xs mt-3" style={{ color: "#B5AF9F" }}>
            FFi — Flatulence Factor Index: the estimated cumulative number of flatus events this piece has absorbed
            over its lifetime. Range: {result.ffiLow.toLocaleString()}–{result.ffiHigh.toLocaleString()}{" "}
            (±{result.uncertaintyPct}%, widening with each undocumented previous owner).
          </p>
        </div>

        <div className="rounded-2xl p-6 space-y-5" style={{ background: "#FFFFFF", boxShadow: "0 1px 2px rgba(33,29,24,0.06), 0 8px 24px rgba(33,29,24,0.06)" }}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs" style={{ color: "#6B6656" }}>Furniture type</label>
              <select value={furniture} onChange={(e) => setFurniture(e.target.value)} className="w-full mt-1.5 rounded-lg px-3 py-2 text-sm" style={{ border: "1px solid #E4DFD6", background: "#FBF9F4", color: "#211D18" }}>
                {FURNITURE.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs" style={{ color: "#6B6656" }}>Upholstery</label>
              <select value={material} onChange={(e) => setMaterial(e.target.value)} className="w-full mt-1.5 rounded-lg px-3 py-2 text-sm" style={{ border: "1px solid #E4DFD6", background: "#FBF9F4", color: "#211D18" }}>
                {MATERIAL.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs" style={{ color: "#6B6656" }}>Age: {age} {age === 1 ? "yr" : "yrs"}</label>
              <input type="range" min="0" max="25" value={age} onChange={(e) => setAge(Number(e.target.value))} className="w-full mt-3" />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#6B6656" }}>Previous owners: {owners}</label>
              <input type="range" min="0" max="6" value={owners} onChange={(e) => setOwners(Number(e.target.value))} className="w-full mt-3" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs" style={{ color: "#6B6656" }}>Adults: {adults}</label>
              <input type="range" min="0" max="6" value={adults} onChange={(e) => setAdults(Number(e.target.value))} className="w-full mt-3" />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#6B6656" }}>Children: {children}</label>
              <input type="range" min="0" max="8" value={children} onChange={(e) => setChildren(Number(e.target.value))} className="w-full mt-3" />
            </div>
            <div>
              <label className="text-xs" style={{ color: "#6B6656" }}>Dogs: {pets}</label>
              <input type="range" min="0" max="5" value={pets} onChange={(e) => setPets(Number(e.target.value))} className="w-full mt-3" />
            </div>
          </div>

          <div>
            <label className="text-xs" style={{ color: "#6B6656" }}>Primary use (select all that apply)</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {USAGE_TYPES.map((u) => {
                const active = usage.includes(u.id);
                return (
                  <button key={u.id} onClick={() => toggleUsage(u.id)} className="text-xs px-3 py-1.5 rounded-full transition-colors" style={{ border: `1px solid ${active ? "#C1622D" : "#E4DFD6"}`, background: active ? "#C1622D" : "#FBF9F4", color: active ? "#FFFFFF" : "#4A453A" }}>
                    {u.label}
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={() => setRevealed(true)} className="of-display w-full py-3 rounded-xl text-sm text-white mt-1" style={{ background: "#211D18" }}>
            Calculate estimate
          </button>
        </div>

        {revealed && (
          <div className="of-fade rounded-2xl p-6 mt-4" style={{ background: "#FFFFFF", boxShadow: "0 1px 2px rgba(33,29,24,0.06), 0 8px 24px rgba(33,29,24,0.06)" }}>
            <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "#9A9384" }}>Summary</div>
            <p className="text-sm leading-relaxed" style={{ color: "#4A453A" }}>
              A {age}-year-old {result.f.label.toLowerCase()} in {result.m.label.toLowerCase()}, serving a household
              of {adults} adult{adults === 1 ? "" : "s"}
              {children > 0 ? `, ${children} ${children === 1 ? "child" : "children"}` : ""}
              {pets > 0 ? ` and ${pets} dog${pets === 1 ? "" : "s"}` : ""}, with{" "}
              {owners} previous owner{owners === 1 ? "" : "s"}
              {usage.length > 0 ? `, used mainly for ${usage.map((id) => USAGE_TYPES.find((u) => u.id === id)?.label.toLowerCase()).join(", ")}` : ""}, comes back with an estimated{" "}
              <strong>{result.ffi.toLocaleString()} FFi</strong> (≈{Math.round(result.dailyEvents)} events/day) and{" "}
              <strong>{result.retention.label.toLowerCase()}</strong> odor retention risk from its upholstery.
            </p>
            <p className="text-sm mt-3" style={{ color: result.tier.color }}>{result.tier.note}</p>
            <p className="text-xs mt-4" style={{ color: "#9A9384" }}>
              This is a rough, input-based estimate meant to guide inspection — not a verified measurement of the item.
            </p>
          </div>
        )}

        <div className="rounded-2xl p-6 mt-4" style={{ background: "#FFFFFF", boxShadow: "0 1px 2px rgba(33,29,24,0.06), 0 8px 24px rgba(33,29,24,0.06)" }}>
          <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "#9A9384" }}>Methodology</div>
          <p className="text-sm leading-relaxed" style={{ color: "#4A453A" }}>
            The FFi is a direct event count, not a score. Adults emit a baseline of {FLATUS_EVENTS_PER_DAY} flatus
            events per day across a {WAKING_HOURS}-hour waking day (≈{HUMAN_RATE_PER_HOUR}/hr) [1]; earlier clinical
            estimates put that closer to {FLATUS_EVENTS_PER_DAY_LEGACY} [2]. Children emit at the adult rate but
            suppress roughly half as much; dogs are modeled at {DOG_RATE_MULTIPLIER}× the human rate with no social
            suppression whatsoever (a stated model assumption — no wearable-sensor canine study exists yet). Each
            selected activity contributes its typical daily hours, discounted by an adult social-suppression factor
            (video calls suppress roughly 60% of urges, guests ~90%). Seat count caps concurrent occupancy — a
            sectional absorbs the whole household at once, while an office chair hosts exactly one emitter — and the
            daily total is compounded over the item's age. Previous owners don't change the count, only the
            confidence in it: each undocumented household widens the uncertainty range by ±7%. Odor intensity itself
            tracks hydrogen sulfide concentration rather than gas volume [3], which is why upholstery retention is
            scored separately from the count.
          </p>
        </div>

        <div className="rounded-2xl p-6 mt-4 mb-2" style={{ background: "#FFFFFF", boxShadow: "0 1px 2px rgba(33,29,24,0.06), 0 8px 24px rgba(33,29,24,0.06)" }}>
          <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "#9A9384" }}>References</div>
          <ol className="text-xs leading-relaxed space-y-2" style={{ color: "#6B6656" }}>
            <li>
              [1] Botasini, S., Zhan, D., Fischer, N., Ravel, C. T., Tien, A., Grant, M. R., Ndjite, G. M., Sopko,
              T., Childs, H., Greenfield, M., Qian, C. X., Gardiner, K. E., Anders, N. M., Ullah, T. F., Redmond,
              L. T., Callaway, D. A., Behailu, E. M., Sarkar, G. M., Sany, N. C., ... Hall, B. (2025). Smart
              underwear: A novel wearable for long-term monitoring of gut microbial gas production via flatus.{" "}
              <em>Biosensors and Bioelectronics: X, 27</em>, Article 100699.{" "}
              https://doi.org/10.1016/j.biosx.2025.100699
            </li>
            <li>
              [2] Tomlin, J., Lowis, C., &amp; Read, N. W. (1991). Investigation of normal flatus production in
              healthy volunteers. <em>Gut, 32</em>(6), 665–669. https://doi.org/10.1136/gut.32.6.665
            </li>
            <li>
              [3] Suarez, F. L., Springfield, J., &amp; Levitt, M. D. (1998). Identification of gases responsible
              for the odour of human flatus and evaluation of a device purported to reduce this odour.{" "}
              <em>Gut, 43</em>(1), 100–104. https://doi.org/10.1136/gut.43.1.100
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
