import { useState, useMemo } from "react";

// Furniture types are distinguished by seat capacity (a sectional is just a
// bigger sofa, so the labels say so) and by how attractive they are to a dog
// looking for somewhere to spend the day. Types with a `uses` list only allow
// those activities; the rest allow everything.
const FURNITURE = [
  { id: "armchair", label: "Armchair", seats: 1, dogAppeal: 0.7 },
  { id: "loveseat", label: "Loveseat (2-seat)", seats: 2, dogAppeal: 1 },
  { id: "sofa", label: "Sofa (3-seat)", seats: 3, dogAppeal: 1 },
  { id: "sectional", label: "Sectional (5-seat)", seats: 5, dogAppeal: 1 },
  { id: "recliner", label: "Recliner", seats: 1, dogAppeal: 0.8 },
  { id: "office", label: "Office Chair", seats: 1, dogAppeal: 0.1, uses: ["wfh", "gaming", "eating"] },
  { id: "ottoman", label: "Ottoman", seats: 0.5, dogAppeal: 0.6, uses: ["tv", "eating", "family", "guest"] },
  // On a mattress, "napping / sleeping" is a full night, not a 1.5-hour nap —
  // hourOverrides replaces a usage type's default daily hours for this piece.
  { id: "mattress", label: "Mattress", seats: 2, dogAppeal: 1, uses: ["napping", "everyday", "tv", "wfh", "gaming", "eating", "family"], hourOverrides: { napping: 8 } },
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
// observation windows (Tomlin, Lowis, & Read, 1991) [2]. The sensor baseline
// covers the full 24-hour day including sleep, so the hourly rate is spread
// over 24 hours — this keeps sleeping and waking activities on the same
// footing instead of double-counting sleep events at a waking-only rate.
const FLATUS_EVENTS_PER_DAY = 32; // Botasini et al., 2025 [1]
const FLATUS_EVENTS_PER_DAY_LEGACY = 14; // Tomlin, Lowis, & Read, 1991 [2]
const HUMAN_RATE_PER_HOUR = FLATUS_EVENTS_PER_DAY / 24; // ≈1.33/hr, uniform
// Dogs emit at a minimum of 1.5× the human rate (stated model assumption — no
// wearable-sensor canine study exists yet) and experience no social
// suppression. Unlike humans, a dog's furniture time doesn't follow the
// household's activities: it occupies the piece on its own schedule, modeled
// as 6 hours/day scaled by how appealing the piece is to lie on.
const DOG_RATE_MULTIPLIER = 1.5;
const DOG_RATE_PER_HOUR = HUMAN_RATE_PER_HOUR * DOG_RATE_MULTIPLIER; // 2/hr
const DOG_HOURS_ON_FURNITURE = 6;
// Children emit at the adult rate but suppress roughly half as much.
const CHILD_SUPPRESSION_FACTOR = 0.5;
// A household can't collectively occupy the piece more than 16 hours a day;
// selecting every activity scales the claimed hours down to this cap.
const MAX_OCCUPIED_HOURS_PER_DAY = 16;
const DAYS_PER_YEAR = 365.25;

// Each usage type carries a typical daily duration spent on the piece and a
// social-suppression factor for adults (0 = no inhibition, 1 = total
// suppression). Work-from-home sessions run longest (up to 8 hrs/day), so
// despite heavier suppression during calls, WFH still contributes heavily —
// longer seat time outweighs the suppression.
const USAGE_TYPES = [
  { id: "everyday", label: "Everyday use / lounging", hours: 4, suppression: 0.15 },
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

// Tier thresholds are lifetime event counts, from the count alone — odor
// retention is a separate axis and no longer bumps the tier. A typical 5-year
// two-adult sofa lands around 20,000 events, anchoring "Some History".
// `note` advises the buyer; `ask` is the corresponding line in the
// copy-pasteable negotiation brief sent to the seller.
const TIERS = [
  {
    key: "fresh", label: "Low Concern", max: 10000, color: "#6E8F72",
    note: "Nothing here to bargain with. If the piece checks out otherwise, the asking price is fair.",
    ask: "I'm comfortable proceeding at your asking price — I'm sharing these figures purely in the interest of transparency.",
  },
  {
    key: "ripe", label: "Some History", max: 50000, color: "#D99A2B",
    note: "Typical accumulation for a used piece — which is exactly why used prices run below retail. A modest discount request is reasonable.",
    ask: "Given the piece's documented history, I'd propose a modest adjustment to the asking price.",
  },
  {
    key: "elevated", label: "Elevated", max: 150000, color: "#C1622D",
    note: "Heavier accumulation than average. Inspect the cushions and inner padding in front of the seller, then make an offer that reflects what you find.",
    ask: "In light of the elevated figures, I'd want to inspect the cushions in person and discuss a price that reflects the findings.",
  },
  {
    key: "high", label: "High", max: Infinity, color: "#B4402A",
    note: "Significant estimated accumulation. Budget for a deep clean or reupholstering in your offer — or be prepared to walk.",
    ask: "The estimated accumulation here is significant, and any offer I make would need to account for deep cleaning or reupholstery.",
  },
];

// --- Cars: driver's seat only ---
// A car seat's exposure is driven by time behind the wheel, which the odometer
// lets us derive. Only the driver is counted. Assume a 30 mph mixed
// city/highway door-to-door average, so hours-in-seat = miles / 30. The driver
// emits at the same 32/day human baseline (≈1.33/hr) with ~0 social suppression
// — driving alone is a private setting — which works out to ≈0.044 events/mile.
const CAR_AVG_SPEED_MPH = 30;
const DRIVING_SUPPRESSION = 0;
const CAR_EVENTS_PER_MILE = (HUMAN_RATE_PER_HOUR * (1 - DRIVING_SUPPRESSION)) / CAR_AVG_SPEED_MPH;

// Cars accumulate far fewer seat-hours than furniture, so they get their own
// thresholds (a ~270k-mile beater should read "High", not "Low Concern").
const CAR_TIERS = [
  {
    key: "fresh", label: "Low Concern", max: 2000, color: "#6E8F72",
    note: "Barely broken in for the miles. If it checks out mechanically, the driver's seat isn't a bargaining point.",
    ask: "The driver's seat shows minimal accumulation for the mileage; I'm comfortable proceeding at your asking price.",
  },
  {
    key: "ripe", label: "Some History", max: 6000, color: "#D99A2B",
    note: "Normal for the mileage — which is why used cars sell below sticker. A modest discount request is reasonable.",
    ask: "Given the mileage and the driver's-seat history, I'd propose a modest adjustment to the asking price.",
  },
  {
    key: "elevated", label: "Elevated", max: 12000, color: "#C1622D",
    note: "Heavier than average for the miles. Sit in the driver's seat and check the bolster and cushion before you make an offer.",
    ask: "In light of the elevated figures for the driver's seat, I'd want to inspect it in person and discuss a price that reflects the findings.",
  },
  {
    key: "high", label: "High", max: Infinity, color: "#B4402A",
    note: "Significant seat-hours. Budget for a detail or ozone treatment — or a seat cover — into your offer, or keep looking.",
    ask: "The estimated accumulation in the driver's seat is significant, and any offer I make would need to account for detailing or a seat replacement.",
  },
];

// Velvet and wool aren't car upholstery; cars pick from these seat materials.
const CAR_MATERIAL_IDS = ["fabric", "leatherette", "leather"];

// Ring gauge maps the FFi onto a log scale: 10² events ≈ empty, 10^6.5 ≈ full.
const RING_LOG_MIN = 2;
const RING_LOG_MAX = 6.5;

const DIGIT_HEIGHT = 44;
const DIGIT_WIDTH = 26;

// Log-scale calibration: the dial sweeps 10² … 10^6.5 across 360°. Majors sit
// at each power of ten; minors are cosmetic graduations between them.
const GAUGE_MAJORS = [2, 3, 4, 5, 6].map((exp) => ({
  exp,
  deg: ((exp - RING_LOG_MIN) / (RING_LOG_MAX - RING_LOG_MIN)) * 360,
}));
const GAUGE_MINORS = Array.from({ length: 36 }, (_, i) => i * 10);

function allowedForFurniture(furnitureId, usageId) {
  const f = FURNITURE.find((x) => x.id === furnitureId);
  return !f?.uses || f.uses.includes(usageId);
}

function OdometerDigit({ digit }) {
  return (
    <div style={{ height: DIGIT_HEIGHT, width: DIGIT_WIDTH, overflow: "hidden" }}>
      <div
        className="of-roll"
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
      className="of-display inline-flex items-center relative"
      style={{
        background: "linear-gradient(#0c0a07, #1b1710)",
        border: "1px solid #4b4130",
        borderRadius: 7,
        padding: "5px 10px",
        overflow: "hidden",
        boxShadow:
          "inset 0 3px 8px rgba(0,0,0,0.85), inset 0 -1px 0 rgba(255,255,255,0.05), 0 1px 0 rgba(255,255,255,0.4), 0 2px 5px rgba(33,29,24,0.35)",
        fontSize: 32,
        fontWeight: 700,
        color: "#F2DAA0",
        textShadow: "0 0 7px rgba(242,218,160,0.32)",
        height: DIGIT_HEIGHT + 12,
      }}
    >
      {chars.map((c, i) =>
        c === "," ? (
          <span key={i} style={{ color: "#7c7052", width: 9, textAlign: "center" }}>,</span>
        ) : (
          <OdometerDigit key={i} digit={Number(c)} />
        )
      )}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0) 42%)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// A machined brass dial. The conic fill carries the data (log-scale FFi); ticks,
// needle, glass and bezel are pure instrument dressing.
function BrassGauge({ fill, deg, color, center, unit }) {
  return (
    <div className="relative shrink-0" style={{ width: 184, height: 184 }}>
      {/* brass bezel */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: "conic-gradient(from 208deg, #d8c489, #8a7038 22%, #efe0b0 42%, #7c6533 63%, #cbb374 82%, #8a7038)",
          boxShadow: "0 7px 18px rgba(33,29,24,0.4), inset 0 2px 3px rgba(255,255,255,0.55), inset 0 -3px 7px rgba(0,0,0,0.4)",
        }}
      />
      {/* dial face */}
      <div
        style={{
          position: "absolute",
          inset: 13,
          borderRadius: "50%",
          background: "radial-gradient(circle at 50% 36%, #2b2720, #141009 82%)",
          boxShadow: "inset 0 2px 9px rgba(0,0,0,0.75)",
          overflow: "hidden",
        }}
      >
        {/* minor graduations */}
        {GAUGE_MINORS.map((d) => (
          <div key={"m" + d} style={{ position: "absolute", inset: 0, transform: `rotate(${d}deg)` }}>
            <div
              style={{
                position: "absolute",
                top: 5,
                left: "50%",
                width: d % 40 === 0 ? 1.5 : 1,
                height: d % 40 === 0 ? 9 : 5,
                marginLeft: -0.75,
                background: "rgba(228,214,178,0.4)",
              }}
            />
          </div>
        ))}
        {/* labelled powers-of-ten */}
        {GAUGE_MAJORS.map(({ exp, deg: md }) => (
          <div key={"M" + exp} style={{ position: "absolute", inset: 0, transform: `rotate(${md}deg)` }}>
            <div
              style={{
                position: "absolute",
                top: 15,
                left: "50%",
                transform: `translateX(-50%) rotate(${-md}deg)`,
                fontSize: 8.5,
                lineHeight: 1,
                letterSpacing: "0.02em",
                color: "rgba(233,220,186,0.72)",
              }}
              className="of-display"
            >
              10<sup style={{ fontSize: 6 }}>{exp}</sup>
            </div>
          </div>
        ))}
        {/* data fill ring */}
        <div
          className="of-ring"
          style={{
            position: "absolute",
            inset: 26,
            borderRadius: "50%",
            background: `conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.055) ${deg}deg)`,
            transition: "background 600ms ease",
          }}
        >
          {/* raised centre cap */}
          <div
            style={{
              position: "absolute",
              inset: 17,
              borderRadius: "50%",
              background: "radial-gradient(circle at 50% 34%, #29251e, #131009)",
              boxShadow: "inset 0 1px 2px rgba(255,255,255,0.08), 0 2px 7px rgba(0,0,0,0.6)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span className="of-display" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, color }}>{center}</span>
            <span className="of-display" style={{ fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", color: "#8f8674", marginTop: 5 }}>{unit}</span>
          </div>
        </div>
        {/* needle */}
        <div className="of-needle" style={{ position: "absolute", inset: 0, transform: `rotate(${deg}deg)`, transition: "transform 700ms cubic-bezier(.22,.9,.24,1)" }}>
          <div style={{ position: "absolute", top: 13, left: "50%", width: 2.5, height: 30, marginLeft: -1.25, borderRadius: 2, background: "linear-gradient(#f4e6b8, #c9a24a)", boxShadow: "0 0 5px rgba(0,0,0,0.55)" }} />
        </div>
        <div style={{ position: "absolute", top: "50%", left: "50%", width: 9, height: 9, marginLeft: -4.5, marginTop: -4.5, borderRadius: "50%", background: "radial-gradient(circle at 40% 35%, #f4e6b8, #8a7038)", boxShadow: "0 1px 2px rgba(0,0,0,0.6)" }} />
        {/* glass reflection */}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "linear-gradient(138deg, rgba(255,255,255,0.16), rgba(255,255,255,0) 46%)", pointerEvents: "none" }} />
      </div>
    </div>
  );
}

// Engraved section rule used to divide the appraisal form into labelled parts.
function SectionRule({ numeral, title, right }) {
  return (
    <div className="flex items-center gap-3" style={{ color: "#6B6656" }}>
      <span className="of-display" style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: "#C1622D" }}>{numeral}</span>
      <span className="of-display" style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{title}</span>
      <span style={{ flex: 1, height: 0, borderTop: "1px solid #DDD5C4" }} />
      {right && <span className="of-display" style={{ fontSize: 10, letterSpacing: "0.1em", color: "#A79F8C" }}>{right}</span>}
    </div>
  );
}

// A field label engraved above a control on the parameters form.
function FieldLabel({ children }) {
  return (
    <span className="of-display" style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "#6B6656" }}>{children}</span>
  );
}

// Compact number for tight readouts: 3,333 -> "3.3k".
function compact(n) {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(Math.round(n));
}

// A slider with a mono readout window and calibration graduations beneath it.
function CalibratedSlider({ label, readout, value, min, max, step = 1, onChange }) {
  const span = max - min || 1;
  const count = Math.min(Math.round(span / step), 40); // graduation segments
  const majorEvery = count > 8 ? 5 : 1;
  const ticks = [];
  for (let i = 0; i <= count; i++) ticks.push({ pct: (i / count) * 100, major: i % majorEvery === 0 || i === count });
  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <FieldLabel>{label}</FieldLabel>
        <span className="of-display" style={{ fontSize: 11, fontWeight: 600, color: "#211D18", background: "#EFE7D6", border: "1px solid #D8D0BE", borderRadius: 4, padding: "1px 8px", whiteSpace: "nowrap", boxShadow: "inset 0 1px 1px rgba(255,255,255,0.6)" }}>{readout}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={onChange} />
      <div className="relative" style={{ height: 9, marginTop: 5 }} aria-hidden="true">
        {ticks.map((t, i) => (
          <div key={i} style={{ position: "absolute", left: `${t.pct}%`, top: 0, transform: "translateX(-50%)", width: 1, height: t.major ? 8 : 5, background: t.major ? "#9a9384" : "#cabfa9" }} />
        ))}
      </div>
    </div>
  );
}

const SELECT_STYLE = {
  border: "1px solid #D8D0BE",
  background: "#FBF9F4",
  color: "#211D18",
  boxShadow: "inset 0 1px 2px rgba(33,29,24,0.06)",
  appearance: "none",
  WebkitAppearance: "none",
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7' viewBox='0 0 10 7'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236B6656' stroke-width='1.4' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
};

export default function App() {
  const [furniture, setFurniture] = useState("sofa");
  const [material, setMaterial] = useState("fabric");
  const [age, setAge] = useState(5);
  const [owners, setOwners] = useState(1);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [pets, setPets] = useState(0);
  const [usage, setUsage] = useState(["tv", "napping"]);
  const [category, setCategory] = useState("furniture");
  const [mileage, setMileage] = useState(80000);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const isCar = category === "car";
  const materialOptions = isCar ? MATERIAL.filter((m) => CAR_MATERIAL_IDS.includes(m.id)) : MATERIAL;

  const changeCategory = (cat) => {
    setCategory(cat);
    // Velvet/wool aren't car upholstery — snap to a sensible seat material.
    if (cat === "car" && !CAR_MATERIAL_IDS.includes(material)) setMaterial("fabric");
  };

  const usageDisabled = (id) =>
    !allowedForFurniture(furniture, id) || (id === "family" && children === 0);

  const toggleUsage = (id) => {
    if (usageDisabled(id)) return;
    setUsage((u) => (u.includes(id) ? u.filter((x) => x !== id) : [...u, id]));
  };

  const changeFurniture = (id) => {
    setFurniture(id);
    setUsage((u) => u.filter((x) => allowedForFurniture(id, x)));
  };

  const changeChildren = (n) => {
    setChildren(n);
    if (n === 0) setUsage((u) => u.filter((x) => x !== "family"));
  };

  const result = useMemo(() => {
    const m = MATERIAL.find((x) => x.id === material);
    const retention = retentionFor(m.factor);
    // Each previous owner is an undocumented history — the count doesn't
    // change, but confidence in it does.
    const uncertaintyPct = 8 + 7 * owners;
    const withRange = (ffi) => ({
      ffi,
      ffiLow: Math.round(ffi * (1 - uncertaintyPct / 100)),
      ffiHigh: Math.round(ffi * (1 + uncertaintyPct / 100)),
    });

    // --- Car: driver's seat only, exposure derived from the odometer ---
    if (category === "car") {
      const hoursSeated = mileage / CAR_AVG_SPEED_MPH;
      const ffi = Math.round(hoursSeated * HUMAN_RATE_PER_HOUR * (1 - DRIVING_SUPPRESSION));
      const idx = CAR_TIERS.findIndex((t) => ffi <= t.max);
      const tier = CAR_TIERS[idx === -1 ? CAR_TIERS.length - 1 : idx];
      return { ...withRange(ffi), uncertaintyPct, hoursSeated, tier, retention, m };
    }

    // --- Furniture ---
    const f = FURNITURE.find((x) => x.id === furniture);

    const activeUsage = usage
      .map((id) => USAGE_TYPES.find((x) => x.id === id))
      .filter((u) => u && allowedForFurniture(furniture, u.id) && !(u.id === "family" && children === 0));

    // Seat capacity caps how much of the household can occupy the piece at
    // once: a sectional hosts the whole family, an office chair one emitter.
    const humans = adults + children;
    const humanFill = humans > 0 ? Math.min(f.seats, humans) / humans : 0;

    // Some pieces redefine an activity's daily hours (a mattress turns
    // "napping" into a full night's sleep).
    const hoursFor = (u) => f.hourOverrides?.[u.id] ?? u.hours;

    // The household can't collectively sit on the piece more than 16 h/day.
    const claimedHours = activeUsage.reduce((s, u) => s + hoursFor(u), 0);
    const hourScale = claimedHours > MAX_OCCUPIED_HOURS_PER_DAY ? MAX_OCCUPIED_HOURS_PER_DAY / claimedHours : 1;

    const humanDaily = activeUsage.reduce((sum, u) => {
      const ratePerHour =
        adults * HUMAN_RATE_PER_HOUR * (1 - u.suppression) +
        children * HUMAN_RATE_PER_HOUR * (1 - u.suppression * CHILD_SUPPRESSION_FACTOR);
      return sum + hoursFor(u) * hourScale * ratePerHour * humanFill;
    }, 0);

    // Dogs run on their own schedule, independent of household activities,
    // capped by seats and scaled by how inviting the piece is to lie on.
    const dogDaily = Math.min(f.seats, pets) * DOG_RATE_PER_HOUR * DOG_HOURS_ON_FURNITURE * f.dogAppeal;

    const dailyEvents = humanDaily + dogDaily;

    // Age 0 on the slider means "under a year" — call it six months, since
    // even a nearly-new piece has a history.
    const effectiveAge = age === 0 ? 0.5 : age;
    const ffi = Math.round(dailyEvents * DAYS_PER_YEAR * effectiveAge);

    const idx = TIERS.findIndex((t) => ffi <= t.max);
    const tier = TIERS[idx === -1 ? TIERS.length - 1 : idx];

    return { ...withRange(ffi), uncertaintyPct, dailyEvents, tier, retention, f, m };
  }, [category, mileage, furniture, material, age, owners, adults, children, pets, usage]);

  const ringFill =
    result.ffi > 0
      ? Math.min(Math.max((Math.log10(result.ffi) - RING_LOG_MIN) / (RING_LOG_MAX - RING_LOG_MIN), 0), 1)
      : 0;
  const ringDeg = ringFill * 360;

  // Confidence is the flip side of the uncertainty range: more undocumented
  // previous owners widen the range and drop the confidence rating.
  const confidence =
    result.uncertaintyPct <= 10 ? { label: "High", color: "#6E8F72" }
    : result.uncertaintyPct <= 22 ? { label: "Moderate", color: "#D99A2B" }
    : result.uncertaintyPct <= 36 ? { label: "Low", color: "#C1622D" }
    : { label: "Very low", color: "#B4402A" };

  // A straight-faced, paste-ready message to the seller. The evidence is
  // presented; the human picks the price — the brief never invents a number.
  const negotiationBrief = () => {
    if (isCar) {
      return [
        `Hi — I'm interested in the car. Before we settle on a price, I ran the details through the Prior Use Estimator (methodology per Botasini et al., 2025, Biosensors and Bioelectronics: X).`,
        ``,
        `Based on the odometer — roughly ${mileage.toLocaleString()} miles on ${result.m.label.toLowerCase()} seats, with ${owners} previous owner${owners === 1 ? "" : "s"} — the driver's seat carries an estimated ${result.ffi.toLocaleString()} FFi (Flatulence Factor Index: cumulative absorbed flatus events), plausible range ${result.ffiLow.toLocaleString()}–${result.ffiHigh.toLocaleString()}, with ${result.retention.label.toLowerCase()} odor retention from the upholstery. That places the driver's seat in the "${result.tier.label}" band.`,
        ``,
        result.tier.ask,
        ``,
        `Full methodology and references available on request.`,
      ].join("\n");
    }
    // "Sofa (3-seat)" reads fine in a dropdown, oddly in a message to a human.
    const pieceName = result.f.label.replace(/\s*\(.*\)$/, "").toLowerCase();
    const household = [
      `${adults} adult${adults === 1 ? "" : "s"}`,
      children > 0 ? `${children} ${children === 1 ? "child" : "children"}` : null,
      pets > 0 ? `${pets} dog${pets === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(", ");
    const uses = usage
      .map((id) => USAGE_TYPES.find((u) => u.id === id)?.label.toLowerCase())
      .filter(Boolean)
      .join(", ");
    return [
      `Hi — I'm interested in the ${pieceName}. Before we settle on a price, I ran the details through the Prior Use Estimator (methodology per Botasini et al., 2025, Biosensors and Bioelectronics: X).`,
      ``,
      `Based on what you've shared — a ${age === 0 ? "nearly new" : `${age}-year-old`} ${pieceName} in ${result.m.label.toLowerCase()}, serving a household of ${household}${uses ? `, used mainly for ${uses}` : ""} — the piece carries an estimated ${result.ffi.toLocaleString()} FFi (Flatulence Factor Index: cumulative absorbed flatus events), plausible range ${result.ffiLow.toLocaleString()}–${result.ffiHigh.toLocaleString()}, with ${result.retention.label.toLowerCase()} odor retention from the upholstery. That places it in the "${result.tier.label}" band.`,
      ``,
      result.tier.ask,
      ``,
      `Full methodology and references available on request.`,
    ].join("\n");
  };

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(negotiationBrief());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — leave the
      // button label unchanged so it doesn't claim a copy that didn't happen.
    }
  };

  const CARD = {
    background: "#FBF9F3",
    border: "1px solid #E4DDCC",
    boxShadow: "0 1px 0 rgba(255,255,255,0.7) inset, 0 1px 2px rgba(33,29,24,0.05)",
  };

  return (
    <div
      className="of-body min-h-screen w-full flex items-start justify-center py-6 sm:py-10 px-3 sm:px-6"
      style={{
        color: "#211D18",
        background:
          "radial-gradient(120% 80% at 50% 0%, #33302a 0%, #262320 55%, #1d1b17 100%)",
      }}
    >
      {/* The appraisal sheet */}
      <div
        className="w-full relative"
        style={{
          maxWidth: 880,
          background:
            "linear-gradient(#F5F1E8, #F1ECE0)",
          border: "1px solid #C9C0AC",
          boxShadow: "0 24px 60px rgba(0,0,0,0.42), 0 2px 0 rgba(255,255,255,0.5) inset",
        }}
      >
        {/* top double rule */}
        <div style={{ height: 4, background: "#211D18" }} />
        <div style={{ height: 1, background: "#211D18", marginTop: 3 }} />

        <div className="px-5 sm:px-10 lg:px-12 py-7 sm:py-9">
          {/* ---------- LETTERHEAD ---------- */}
          <header className="flex items-start justify-between gap-4 pb-5" style={{ borderBottom: "1px solid #DDD5C4" }}>
            <div className="flex items-start gap-4">
              {/* embossed seal */}
              <div className="shrink-0 relative" style={{ width: 58, height: 58 }} aria-hidden="true">
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px double #C1622D", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(circle at 50% 38%, #FBF9F3, #EDE6D6)", boxShadow: "inset 0 0 0 4px rgba(193,98,45,0.08)" }}>
                  <span className="of-display" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.02em", color: "#C1622D" }}>PUE</span>
                </div>
              </div>
              <div>
                <div className="of-display" style={{ fontSize: 9.5, letterSpacing: "0.28em", textTransform: "uppercase", color: "#A0987F" }}>{isCar ? "Pre-owned vehicle appraisal" : "Pre-owned furniture appraisal"}</div>
                <h1 className="of-body" style={{ fontSize: 30, lineHeight: 1.03, fontWeight: 600, marginTop: 4, letterSpacing: "-0.01em" }}>Prior Use Estimator</h1>
                <a href="https://wristskill.com/projects" target="_blank" rel="noopener" className="of-display mt-1 inline-block" style={{ fontSize: 10.5, letterSpacing: "0.05em", color: "#8A8371", textDecoration: "none" }}>A WristSkill project&nbsp;↗</a>
              </div>
            </div>
            <div className="text-right hidden sm:block" style={{ minWidth: 132 }}>
              <div className="of-display" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "#A0987F" }}>Classification</div>
              <div className="of-display mt-1" style={{ fontSize: 12, fontWeight: 600, color: result.tier.color }}>{result.tier.label}</div>
            </div>
          </header>

          {/* preamble */}
          <p className="of-body mt-5" style={{ fontSize: 14.5, lineHeight: 1.65, color: "#4A453A", textWrap: "pretty" }}>
            {isCar ? (
              <>For the informed acquisition of a pre-owned vehicle. This instrument estimates the cumulative number of
              flatus events the <strong style={{ fontWeight: 600 }}>driver's seat</strong> has absorbed over its service
              life, derived from the odometer — calibrated against published flatus-frequency
              research<span style={{ verticalAlign: "super", fontSize: 10 }}>[1][2]</span> and the compounds known to
              drive flatus odor<span style={{ verticalAlign: "super", fontSize: 10 }}>[3]</span>. It is evidence assembled
              for the negotiation, not a laboratory measurement of the specific vehicle.</>
            ) : (
              <>For the informed acquisition of pre-owned seating. This instrument estimates the cumulative number of
              flatus events a piece has absorbed over its service life — calibrated against published flatus-frequency
              research<span style={{ verticalAlign: "super", fontSize: 10 }}>[1][2]</span> and the compounds known to
              drive flatus odor<span style={{ verticalAlign: "super", fontSize: 10 }}>[3]</span>. It is evidence assembled
              for the negotiation, not a laboratory measurement of the specific item.</>
            )}
          </p>

          {/* ---------- INSTRUMENT + PARAMETERS ---------- */}
          <div className="mt-8 lg:grid lg:items-start" style={{ gridTemplateColumns: "356px 1fr", columnGap: 40 }}>
            {/* READOUT INSTRUMENT PANEL */}
            <section className="mb-8 lg:mb-0">
              <SectionRule numeral="I" title="Instrument Readout" />
              <div
                className="mt-4"
                style={{
                  borderRadius: 14,
                  padding: "22px 20px 18px",
                  background: "linear-gradient(#242019, #17140f)",
                  border: "1px solid #0e0c09",
                  boxShadow: "0 2px 0 rgba(255,255,255,0.35), 0 14px 30px rgba(33,29,24,0.32), inset 0 1px 0 rgba(255,255,255,0.06)",
                }}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="of-display" style={{ fontSize: 8.5, letterSpacing: "0.2em", textTransform: "uppercase", color: "#8a8065" }}>Ring gauge · log₁₀</span>
                  <span className="of-display" style={{ fontSize: 8.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "#8a8065" }}>{isCar ? "hours in seat" : "events / day"}</span>
                </div>

                <div className="flex justify-center">
                  <BrassGauge fill={ringFill} deg={ringDeg} color={result.tier.color} center={isCar ? compact(result.hoursSeated) : Math.round(result.dailyEvents)} unit={isCar ? "hrs seated" : "per day"} />
                </div>

                {/* lifetime readout */}
                <div className="mt-6 pt-5" style={{ borderTop: "1px solid #322c22" }}>
                  <div className="of-display" style={{ fontSize: 8.5, letterSpacing: "0.22em", textTransform: "uppercase", color: "#8a8065" }}>Lifetime estimate</div>
                  <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                    <OdometerReadout value={result.ffi} />
                    <span className="of-display" style={{ fontSize: 13, letterSpacing: "0.08em", color: "#b3a982" }}>FFi</span>
                    <span className="of-display" style={{ fontSize: 12, letterSpacing: "0.04em", color: "#8a8065" }}>± {result.uncertaintyPct}%</span>
                  </div>
                </div>

                {/* tier band + retention */}
                <div className="mt-5 flex items-center justify-between gap-3">
                  <span className="of-display" style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap", padding: "4px 11px", borderRadius: 5, color: result.tier.color, border: `1px solid ${result.tier.color}`, background: `${result.tier.color}1F` }}>
                    {result.tier.label}
                  </span>
                  <div className="flex gap-5 text-right">
                    <div>
                      <div className="of-display" style={{ fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", color: "#8a8065" }}>Confidence</div>
                      <div className="of-display" style={{ fontSize: 12, fontWeight: 600, color: confidence.color }}>{confidence.label}</div>
                    </div>
                    <div>
                      <div className="of-display" style={{ fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", color: "#8a8065" }}>Odor retention</div>
                      <div className="of-display" style={{ fontSize: 12, fontWeight: 600, color: result.retention.color }}>{result.retention.label}</div>
                    </div>
                  </div>
                </div>

                {/* footnote — FFi definition kept inconspicuous */}
                <p className="of-display mt-4" style={{ fontSize: 9.5, lineHeight: 1.6, color: "#7d7460" }}>
                  FFi — Flatulence Factor Index: estimated cumulative flatus events absorbed over the {isCar ? "driver's seat's" : "piece's"} lifetime.
                  Range {result.ffiLow.toLocaleString()}–{result.ffiHigh.toLocaleString()} (±{result.uncertaintyPct}%, widening
                  with each undocumented previous owner).
                </p>
              </div>
            </section>

            {/* PARAMETERS FORM */}
            <section>
              <SectionRule numeral="II" title={isCar ? "Vehicle Parameters" : "Piece Parameters"} right="declared by buyer" />
              <div className="mt-4" style={{ ...CARD, borderRadius: 12, padding: "22px 20px" }}>
                {/* category toggle */}
                <div className="mb-5">
                  <div className="mb-2"><FieldLabel>Category</FieldLabel></div>
                  <div className="inline-flex rounded-md overflow-hidden" style={{ border: "1px solid #D8D0BE" }}>
                    {[{ id: "furniture", label: "Furniture" }, { id: "car", label: "Car — driver's seat" }].map((c) => {
                      const on = category === c.id;
                      return (
                        <button key={c.id} onClick={() => changeCategory(c.id)} className="of-display" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", padding: "7px 14px", background: on ? "#211D18" : "#FBF9F4", color: on ? "#F4EFE4" : "#6B6656", cursor: "pointer" }}>
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {isCar ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                      <div>
                        <div className="mb-2"><FieldLabel>Seat material</FieldLabel></div>
                        <select value={material} onChange={(e) => setMaterial(e.target.value)} className="of-body w-full rounded-md px-3 py-2 text-sm" style={SELECT_STYLE}>
                          {materialOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                      </div>
                      <CalibratedSlider label="Prev. owners" readout={String(owners)} value={owners} min={0} max={6} onChange={(e) => setOwners(Number(e.target.value))} />
                    </div>
                    <div className="mt-6">
                      <CalibratedSlider label="Odometer" readout={`${mileage.toLocaleString()} mi`} value={mileage} min={0} max={300000} step={5000} onChange={(e) => setMileage(Number(e.target.value))} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                      <div>
                        <div className="mb-2"><FieldLabel>Furniture type</FieldLabel></div>
                        <select value={furniture} onChange={(e) => changeFurniture(e.target.value)} className="of-body w-full rounded-md px-3 py-2 text-sm" style={SELECT_STYLE}>
                          {FURNITURE.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <div className="mb-2"><FieldLabel>Upholstery</FieldLabel></div>
                        <select value={material} onChange={(e) => setMaterial(e.target.value)} className="of-body w-full rounded-md px-3 py-2 text-sm" style={SELECT_STYLE}>
                          {MATERIAL.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                      <CalibratedSlider label="Age" readout={age === 0 ? "<1 yr" : `${age} ${age === 1 ? "yr" : "yrs"}`} value={age} min={0} max={25} onChange={(e) => setAge(Number(e.target.value))} />
                      <CalibratedSlider label="Prev. owners" readout={String(owners)} value={owners} min={0} max={6} onChange={(e) => setOwners(Number(e.target.value))} />
                    </div>

                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-6">
                      <CalibratedSlider label="Adults" readout={String(adults)} value={adults} min={0} max={6} onChange={(e) => setAdults(Number(e.target.value))} />
                      <CalibratedSlider label="Children" readout={String(children)} value={children} min={0} max={8} onChange={(e) => changeChildren(Number(e.target.value))} />
                      <CalibratedSlider label="Dogs" readout={String(pets)} value={pets} min={0} max={5} onChange={(e) => setPets(Number(e.target.value))} />
                    </div>

                    {/* usage checklist */}
                    <div className="mt-7">
                      <div className="mb-3"><FieldLabel>Primary use — select all applicable</FieldLabel></div>
                      <div className="flex flex-wrap gap-2">
                        {USAGE_TYPES.map((u) => {
                          const disabled = usageDisabled(u.id);
                          const active = !disabled && usage.includes(u.id);
                          return (
                            <button
                              key={u.id}
                              onClick={() => toggleUsage(u.id)}
                              disabled={disabled}
                              title={disabled
                                ? u.id === "family"
                                  ? "Set Children above 0 first"
                                  : `Not applicable to ${result.f.label.toLowerCase()}`
                                : undefined}
                              className="of-display inline-flex items-center gap-2 text-xs rounded-md"
                              style={{
                                padding: "6px 11px",
                                letterSpacing: "0.01em",
                                border: `1px solid ${disabled ? "#D3CBBA" : active ? "#211D18" : "#D3CBB9"}`,
                                background: disabled
                                  ? "repeating-linear-gradient(135deg, #EBE6DA, #EBE6DA 5px, #E1DBCC 5px, #E1DBCC 10px)"
                                  : active ? "#211D18" : "#FBF9F3",
                                color: disabled ? "#8A8272" : active ? "#F4EFE4" : "#4A453A",
                                cursor: disabled ? "not-allowed" : "pointer",
                                boxShadow: active ? "0 1px 2px rgba(33,29,24,0.25)" : "none",
                              }}
                            >
                              <span
                                aria-hidden="true"
                                className="inline-flex items-center justify-center"
                                style={{
                                  width: 13, height: 13, borderRadius: 3, fontSize: 10, lineHeight: 1,
                                  border: `1px solid ${disabled ? "#C9C1B0" : active ? "#F4EFE4" : "#B7AF9C"}`,
                                  background: active ? "#C1622D" : "transparent",
                                  color: "#F4EFE4",
                                }}
                              >
                                {active ? "✓" : disabled ? "–" : ""}
                              </span>
                              {u.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {/* actuator */}
                <button
                  onClick={() => setRevealed(true)}
                  className="of-display w-full mt-7 rounded-lg text-white inline-flex items-center justify-center gap-3"
                  style={{
                    padding: "13px 16px",
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    background: "linear-gradient(#2c2720, #1b1712)",
                    border: "1px solid #0f0d0a",
                    boxShadow: "0 2px 0 rgba(255,255,255,0.35), 0 3px 8px rgba(33,29,24,0.28), inset 0 1px 0 rgba(255,255,255,0.08)",
                  }}
                >
                  <span
                    className={revealed ? "of-led-on" : undefined}
                    style={{ width: 8, height: 8, borderRadius: "50%", background: revealed ? "#7FBE86" : "#5a5344", boxShadow: revealed ? "0 0 7px rgba(127,190,134,0.9)" : "inset 0 1px 1px rgba(0,0,0,0.5)" }}
                  />
                  Calculate estimate
                </button>
              </div>
            </section>
          </div>

          {/* ---------- ISSUED BRIEF ---------- */}
          {revealed && (
            <section className="of-fade mt-9">
              <SectionRule numeral="III" title="Negotiation Brief" right="for issue to seller" />
              <div className="mt-4 relative overflow-hidden" style={{ ...CARD, borderRadius: 12, padding: "24px 22px" }}>
                <div className="of-display" style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "#A0987F" }}>Summary of Findings</div>
                <p className="of-body mt-3" style={{ fontSize: 15, lineHeight: 1.68, color: "#3B372E", textWrap: "pretty" }}>
                  {isCar ? (
                    <>The driver's seat of a car showing roughly {mileage.toLocaleString()} miles on {result.m.label.toLowerCase()} upholstery, with{" "}
                    {owners} previous owner{owners === 1 ? "" : "s"}, comes back with an estimated{" "}
                    <strong style={{ fontWeight: 700 }}>{result.ffi.toLocaleString()} FFi</strong> (≈{compact(result.hoursSeated)} hours behind the wheel) and{" "}
                    <strong style={{ fontWeight: 700 }}>{result.retention.label.toLowerCase()}</strong> odor retention risk from the seat material.</>
                  ) : (
                    <>A {age === 0 ? "nearly new" : `${age}-year-old`} {result.f.label.toLowerCase()} in {result.m.label.toLowerCase()}, serving a household
                    of {adults} adult{adults === 1 ? "" : "s"}
                    {children > 0 ? `, ${children} ${children === 1 ? "child" : "children"}` : ""}
                    {pets > 0 ? ` and ${pets} dog${pets === 1 ? "" : "s"} (on their own schedule)` : ""}, with{" "}
                    {owners} previous owner{owners === 1 ? "" : "s"}
                    {usage.length > 0 ? `, used mainly for ${usage.map((id) => USAGE_TYPES.find((u) => u.id === id)?.label.toLowerCase()).join(", ")}` : ""}, comes back with an estimated{" "}
                    <strong style={{ fontWeight: 700 }}>{result.ffi.toLocaleString()} FFi</strong> (≈{Math.round(result.dailyEvents)} events/day) and{" "}
                    <strong style={{ fontWeight: 700 }}>{result.retention.label.toLowerCase()}</strong> odor retention risk from its upholstery.</>
                  )}
                </p>
                <p className="of-body mt-4" style={{ fontSize: 14, lineHeight: 1.6, fontStyle: "italic", color: result.tier.color, paddingLeft: 14, borderLeft: `2px solid ${result.tier.color}` }}>{result.tier.note}</p>

                <div className="relative mt-6">
                  <button
                    onClick={copyBrief}
                    className="of-display w-full rounded-lg transition-colors inline-flex items-center justify-center gap-2.5"
                    style={{
                      padding: "13px 16px",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      border: `1px solid ${copied ? "#211D18" : "#C1622D"}`,
                      background: copied ? "#211D18" : "#C1622D",
                      color: "#F6F1E6",
                      boxShadow: "0 2px 0 rgba(255,255,255,0.4), 0 3px 8px rgba(33,29,24,0.22)",
                    }}
                  >
                    {copied ? "Copied — go get your discount" : "Copy negotiation brief"}
                  </button>
                  {/* issued rubber stamp */}
                  {copied && (
                    <div
                      aria-hidden="true"
                      className="of-stamp"
                      style={{
                        position: "absolute", top: "50%", left: "50%", marginTop: -30, marginLeft: -66,
                        width: 132, textAlign: "center", pointerEvents: "none",
                        border: "2.5px solid rgba(180,64,42,0.78)", borderRadius: 8,
                        padding: "5px 6px", color: "rgba(180,64,42,0.82)",
                      }}
                    >
                      <div className="of-display" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.18em" }}>ISSUED</div>
                      <div className="of-display" style={{ fontSize: 7, letterSpacing: "0.14em", marginTop: 1 }}>COPY RELEASED TO CLIPBOARD</div>
                    </div>
                  )}
                </div>

                <p className="of-display mt-5" style={{ fontSize: 9.5, lineHeight: 1.6, color: "#9A9384" }}>
                  A rough, input-based estimate meant to guide inspection and inform your offer — not a verified
                  measurement of the item.
                </p>
              </div>
            </section>
          )}

          {/* ---------- JOURNAL REPRINT: METHODOLOGY + REFERENCES ---------- */}
          <section className="mt-10 pt-7" style={{ borderTop: "2px solid #211D18" }}>
            <h2 className="of-body" style={{ fontSize: 19, fontWeight: 600 }}>Methodology</h2>
            <p className="of-body mt-2" style={{ fontSize: 13.5, lineHeight: 1.72, color: "#3B372E", textAlign: "justify", hyphens: "auto", WebkitHyphens: "auto" }}>
              The FFi is a direct event count, not a score. Adults emit a baseline of {FLATUS_EVENTS_PER_DAY} flatus
              events per day [1], spread across the full 24-hour day (≈1.3/hr); earlier clinical estimates put the
              daily baseline closer to {FLATUS_EVENTS_PER_DAY_LEGACY} [2]. Odor intensity itself tracks hydrogen
              sulfide concentration rather than gas volume [3], which is why upholstery retention is reported as its
              own rating and never alters the count or its tier. Previous owners don't change the count, only our
              confidence in it: each prior owner is an undocumented household whose particular use is unknown, so
              rather than inflate the estimate — the mileage or age already captures the actual exposure — an
              additional owner widens the stated uncertainty range by ±7% and lowers the confidence rating shown
              on the readout.
            </p>
            {!isCar && (
              <p className="of-body mt-3" style={{ fontSize: 13.5, lineHeight: 1.72, color: "#3B372E", textAlign: "justify", hyphens: "auto", WebkitHyphens: "auto" }}>
                For furniture, the daily total combines every occupant. Children emit at the adult rate but suppress
                roughly half as much; dogs are modeled at {DOG_RATE_MULTIPLIER}× the human rate with no social
                suppression whatsoever (a stated model assumption — no wearable-sensor canine study exists yet), and
                unlike humans they use the furniture on their own schedule: {DOG_HOURS_ON_FURNITURE} hours a day,
                scaled by how inviting the piece is to lie on (an office chair holds little appeal). Each selected
                activity contributes its typical daily hours, discounted by an adult social-suppression factor (video
                calls suppress roughly 60% of urges, guests ~90%); total household occupancy is capped at{" "}
                {MAX_OCCUPIED_HOURS_PER_DAY} hours a day. Seat count caps concurrent occupancy — a sectional absorbs
                the whole household at once, while an office chair hosts exactly one emitter — and the daily total is
                compounded over the item's age (a piece under a year old is counted as six months).
              </p>
            )}
            {isCar && (
              <p className="of-body mt-3" style={{ fontSize: 13.5, lineHeight: 1.72, color: "#3B372E", textAlign: "justify", hyphens: "auto", WebkitHyphens: "auto" }}>
                For vehicles, only the driver's seat is assessed. Time behind the wheel is derived from the odometer
                at an assumed {CAR_AVG_SPEED_MPH} mph mixed city/highway average (hours = miles ÷ {CAR_AVG_SPEED_MPH}),
                and the driver emits at the same {FLATUS_EVENTS_PER_DAY}-per-day baseline with negligible social
                suppression, since driving alone is a private setting — about {CAR_EVENTS_PER_MILE.toFixed(3)} events
                per mile. Because a car accumulates far fewer seat-hours than household furniture, vehicles are scored
                against their own tier thresholds.
              </p>
            )}

            <h2 className="of-body mt-7" style={{ fontSize: 19, fontWeight: 600 }}>References</h2>
            <ol className="of-body mt-2" style={{ fontSize: 12.5, lineHeight: 1.6, color: "#4A453A", listStyle: "none", padding: 0 }}>
              <li style={{ paddingLeft: 26, textIndent: -26, marginTop: 8 }}>
                [1] Botasini, S., Zhan, D., Fischer, N., Ravel, C. T., Tien, A., Grant, M. R., Ndjite, G. M., Sopko,
                T., Childs, H., Greenfield, M., Qian, C. X., Gardiner, K. E., Anders, N. M., Ullah, T. F., Redmond,
                L. T., Callaway, D. A., Behailu, E. M., Sarkar, G. M., Sany, N. C., ... Hall, B. (2025). Smart
                underwear: A novel wearable for long-term monitoring of gut microbial gas production via flatus.{" "}
                <em>Biosensors and Bioelectronics: X, 27</em>, Article 100699.{" "}
                <span className="of-display" style={{ fontSize: 11, color: "#6B6656" }}>https://doi.org/10.1016/j.biosx.2025.100699</span>
              </li>
              <li style={{ paddingLeft: 26, textIndent: -26, marginTop: 8 }}>
                [2] Tomlin, J., Lowis, C., &amp; Read, N. W. (1991). Investigation of normal flatus production in
                healthy volunteers. <em>Gut, 32</em>(6), 665–669.{" "}
                <span className="of-display" style={{ fontSize: 11, color: "#6B6656" }}>https://doi.org/10.1136/gut.32.6.665</span>
              </li>
              <li style={{ paddingLeft: 26, textIndent: -26, marginTop: 8 }}>
                [3] Suarez, F. L., Springfield, J., &amp; Levitt, M. D. (1998). Identification of gases responsible
                for the odour of human flatus and evaluation of a device purported to reduce this odour.{" "}
                <em>Gut, 43</em>(1), 100–104.{" "}
                <span className="of-display" style={{ fontSize: 11, color: "#6B6656" }}>https://doi.org/10.1136/gut.43.1.100</span>
              </li>
            </ol>
          </section>

          {/* page footer */}
          <footer className="mt-9 pt-4 flex items-center justify-between flex-wrap gap-2" style={{ borderTop: "1px solid #DDD5C4" }}>
            <span className="of-display" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "#A79F8C" }}>© 2026 WristSkillLabs LLC</span>
            <a href="https://wristskill.com/projects" target="_blank" rel="noopener" className="of-display" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "#A79F8C", textDecoration: "none" }}>More projects at wristskill.com&nbsp;↗</a>
          </footer>
        </div>
      </div>
    </div>
  );
}
