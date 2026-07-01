import { useState, useMemo } from "react";

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

const FURNITURE = [
  { id: "armchair", label: "Armchair", mult: 1.0 },
  { id: "couch", label: "Couch / Sofa", mult: 1.25 },
  { id: "sectional", label: "Sectional", mult: 1.6 },
  { id: "recliner", label: "Recliner", mult: 1.55 },
  { id: "office", label: "Office Chair", mult: 0.8 },
  { id: "ottoman", label: "Ottoman", mult: 0.55 },
];

const MATERIAL = [
  { id: "fabric", label: "Fabric / Cotton", factor: 320 },
  { id: "velvet", label: "Velvet", factor: 460 },
  { id: "wool", label: "Wool Blend", factor: 380 },
  { id: "leatherette", label: "Faux Leather", factor: 160 },
  { id: "leather", label: "Genuine Leather", factor: 60 },
];

// --- Usage-type weighting, grounded in published flatus-frequency research ---
// Adults pass gas ~32 times/day on average when measured continuously with a
// wearable sensor (Botasini et al., 2025) [1] — roughly double the ~14/day
// figure from earlier clinical estimates based on self-report and short
// observation windows (Tomlin, Lowis, & Read, 1991) [2]. We use the higher,
// sensor-measured baseline since it captures sleep-time and socially
// suppressed events that older methods missed.
const FLATUS_EVENTS_PER_DAY = 32; // Botasini et al., 2025 [1]
const FLATUS_EVENTS_PER_DAY_LEGACY = 14; // Tomlin, Lowis, & Read, 1991 [2]
const WAKING_HOURS = 16;
const FLATUS_RATE_PER_HOUR = FLATUS_EVENTS_PER_DAY / WAKING_HOURS; // ≈2/hr

// Scaling constant calibrated so the model's overall range matches the
// estimator's original 0–6000 display scale.
const ODOR_UNIT = 75;

// Each usage type carries a typical daily duration spent seated on the piece
// and a social-suppression factor (0 = no inhibition, 1 = total suppression).
// weight = hours * flatus-rate/hr * (1 - suppression) * ODOR_UNIT
// Work-from-home sessions run longest (up to 8 hrs/day), so despite heavier
// suppression during calls, WFH still produces the single largest usage-type
// contribution in the model — longer seat time outweighs the suppression.
const USAGE_TYPES = [
  { id: "tv", label: "TV / movie marathons", hours: 3, suppression: 0.1 },
  { id: "napping", label: "Napping / sleeping", hours: 1.5, suppression: 0 },
  { id: "gaming", label: "Gaming sessions", hours: 2.5, suppression: 0.1 },
  { id: "eating", label: "Eating meals", hours: 1, suppression: 0.3 },
  { id: "wfh", label: "Work-from-home seating", hours: 8, suppression: 0.6 },
  { id: "family", label: "Family time (kids + snacks)", hours: 2, suppression: 0.2 },
  { id: "guest", label: "Guest / formal seating only", hours: 0.5, suppression: 0.9 },
].map((u) => ({
  ...u,
  weight: Math.round(u.hours * FLATUS_RATE_PER_HOUR * (1 - u.suppression) * ODOR_UNIT),
}));

const RETENTION_LEVELS = [
  { key: "low", label: "Low", max: 150, color: "#6E8F72" },
  { key: "moderate", label: "Moderate", max: 350, color: "#D99A2B" },
  { key: "high", label: "High", max: Infinity, color: "#B4402A" },
];

function retentionFor(factor) {
  return RETENTION_LEVELS.find((r) => factor <= r.max) || RETENTION_LEVELS[RETENTION_LEVELS.length - 1];
}

const TIERS = [
  { key: "fresh", label: "Low Concern", max: 800, color: "#6E8F72", note: "Nothing here that should factor into your decision." },
  { key: "ripe", label: "Some History", max: 2000, color: "#D99A2B", note: "Typical wear for a used piece. A wipe-down and airing out should be plenty." },
  { key: "elevated", label: "Elevated", max: 4000, color: "#C1622D", note: "Heavier use than average. Worth inspecting cushions and inner padding before buying." },
  { key: "high", label: "High", max: Infinity, color: "#B4402A", note: "Significant estimated use. Consider a deep clean or reupholstering, or negotiate the price." },
];

const MAX_SCALE = 6000;
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
  const [pets, setPets] = useState(false);
  const [usage, setUsage] = useState(["tv", "napping"]);
  const [revealed, setRevealed] = useState(false);

  const toggleUsage = (id) =>
    setUsage((u) => (u.includes(id) ? u.filter((x) => x !== id) : [...u, id]));

  const seedKey = `${furniture}|${material}|${age}|${owners}|${pets}|${usage.slice().sort().join(",")}`;

  const result = useMemo(() => {
    const f = FURNITURE.find((x) => x.id === furniture);
    const m = MATERIAL.find((x) => x.id === material);
    const usageWeight = usage.reduce((sum, id) => {
      const u = USAGE_TYPES.find((x) => x.id === id);
      return sum + (u ? u.weight : 0);
    }, 0);

    const base = age * 38 + owners * 130 + usageWeight + (pets ? 520 : 0);
    const jitter = 0.82 + hashSeed(seedKey) * 0.36;
    const score = Math.max(0, Math.round(base * f.mult * jitter));

    const retention = retentionFor(m.factor);

    const baseIdx = TIERS.findIndex((t) => score <= t.max);
    const idx = baseIdx === -1 ? TIERS.length - 1 : baseIdx;
    const bumpedIdx = retention.key === "high" ? Math.min(idx + 1, TIERS.length - 1) : idx;
    const tier = TIERS[bumpedIdx];
    const bumped = bumpedIdx > idx;

    return { score, tier, retention, bumped, f, m };
  }, [seedKey, furniture, material, age, owners, pets, usage]);

  const pct = Math.min(result.score / MAX_SCALE, 1);
  const ringDeg = pct * 360;

  return (
    <div className="of-body min-h-screen w-full flex items-start justify-center py-10 px-4" style={{ background: "#F3F0E8" }}>
      <div className="w-full max-w-md">
        <div className="mb-5">
          <div className="of-display text-xl" style={{ color: "#211D18" }}>Prior Use Estimator</div>
          <p className="text-sm mt-1" style={{ color: "#6B6656" }}>
            Answer a few questions about the piece you're considering. This gives a rough estimate of use and odor
            retention risk, calibrated against published flatus-frequency research [1][2] and the compounds known
            to drive flatus odor [3] — not a lab measurement of this specific item.
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
              <div className="absolute rounded-full flex items-center justify-center" style={{ width: 76, height: 76, background: "#FFFFFF" }}>
                <span className="of-display text-lg" style={{ color: result.tier.color }}>{Math.round(pct * 100)}%</span>
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide" style={{ color: "#9A9384" }}>Estimated use score</div>
              <div className="mt-1.5"><OdometerReadout value={result.score} /></div>
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
              This rating was raised a level because {result.m.label.toLowerCase()} holds odor longer than the use score alone would suggest.
            </p>
          )}
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

          <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid #EDE9DF" }}>
            <span className="text-sm" style={{ color: "#211D18" }}>Known pet household?</span>
            <button onClick={() => setPets(!pets)} role="switch" aria-checked={pets} className="relative w-11 h-6 rounded-full transition-colors" style={{ background: pets ? "#C1622D" : "#E4DFD6" }}>
              <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: pets ? "translateX(20px)" : "translateX(0)" }} />
            </button>
          </div>

          <button onClick={() => setRevealed(true)} className="of-display w-full py-3 rounded-xl text-sm text-white mt-1" style={{ background: "#211D18" }}>
            Calculate estimate
          </button>
        </div>

        {revealed && (
          <div className="of-fade rounded-2xl p-6 mt-4" style={{ background: "#FFFFFF", boxShadow: "0 1px 2px rgba(33,29,24,0.06), 0 8px 24px rgba(33,29,24,0.06)" }}>
            <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "#9A9384" }}>Summary</div>
            <p className="text-sm leading-relaxed" style={{ color: "#4A453A" }}>
              A {age}-year-old {result.f.label.toLowerCase()} in {result.m.label.toLowerCase()}, with{" "}
              {owners} previous owner{owners === 1 ? "" : "s"}
              {pets ? " and pet exposure" : ""}
              {usage.length > 0 ? `, used mainly for ${usage.map((id) => USAGE_TYPES.find((u) => u.id === id)?.label.toLowerCase()).join(", ")}` : ""}, comes back with an estimated use score of{" "}
              <strong>{result.score.toLocaleString()}</strong> and{" "}
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
            Usage-type weights assume a baseline of {FLATUS_EVENTS_PER_DAY} flatus events per day spread across a{" "}
            {WAKING_HOURS}-hour waking day (≈{FLATUS_RATE_PER_HOUR}/hr) [1], adjusted for the typical hours spent
            seated during each activity and a social-suppression factor (for example, video calls suppress roughly
            60% of urges during work-from-home use, versus ~90% in front of guests). Because work-from-home
            sessions run the longest — up to 8 hours a day — they produce the single highest usage-type
            contribution in the model, even after that suppression is applied. Earlier clinical estimates put the
            daily baseline closer to {FLATUS_EVENTS_PER_DAY_LEGACY} events [2]. Odor intensity itself tracks
            hydrogen sulfide concentration rather than gas volume [3], which is why upholstery retention (above) is
            scored separately from usage.
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
