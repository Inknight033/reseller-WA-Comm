// Builds each day's group broadcast plan: random post times + shuffled category order.
// The plan is saved to disk so a restart mid-day reuses it (no double posts, no skips).
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  SLOT_COUNTS, WINDOW_START, WINDOW_END, MIN_GAP_MINUTES, MIDDAY_SPLIT, QUIET_WINDOWS,
} from "./config/schedule.js";
import { SLOT_LABELS } from "./config/categories.js";

const DATA_DIR  = process.env.DATA_DIR || "data";
const PLANS_DIR = join(DATA_DIR, "slot_plans");

// ── Time helpers ──────────────────────────────────────────────────────────────

const toMin = ({ hour, minute }) => hour * 60 + minute;

export function fmtTime(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// Current IST date (YYYY-MM-DD) and minutes since midnight
export function nowIST() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    date:    `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function randInt(min, max) { // inclusive
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Times ─────────────────────────────────────────────────────────────────────

// Broadcast window minus quiet windows, as [start, end) clock-minute ranges
function openRanges() {
  let ranges = [[toMin(WINDOW_START), toMin(WINDOW_END)]];
  for (const q of QUIET_WINDOWS) {
    const qs = toMin(q.start), qe = toMin(q.end);
    ranges = ranges.flatMap(([s, e]) => {
      if (qe <= s || qs >= e) return [[s, e]];
      const out = [];
      if (qs > s) out.push([s, qs]);
      if (qe < e) out.push([qe, e]);
      return out;
    });
  }
  return ranges;
}

// Position on the "open time" line (quiet windows cut out) → clock minute
function openToClock(pos, ranges) {
  for (const [s, e] of ranges) {
    if (pos < e - s) return s + pos;
    pos -= e - s;
  }
  return ranges[ranges.length - 1][1] - 1;
}

// Split the open time into n equal windows and pick a random minute in each,
// leaving MIN_GAP_MINUTES at the end of each window so posts never bunch up.
function pickTimes(n, ranges) {
  const open = ranges.reduce((s, [a, b]) => s + (b - a), 0);
  if (open / n < MIN_GAP_MINUTES + 1) {
    throw new Error(`Window too short for ${n} posts ${MIN_GAP_MINUTES} min apart`);
  }
  const times = [];
  for (let i = 0; i < n; i++) {
    const a = Math.round((i * open) / n);
    const b = Math.round(((i + 1) * open) / n);
    times.push(openToClock(a + randInt(0, b - a - MIN_GAP_MINUTES), ranges));
  }
  return times;
}

// ── Category order ────────────────────────────────────────────────────────────

const noAdjacentRepeats = (seq) => seq.every((c, i) => i === 0 || c !== seq[i - 1]);

// Categories posted 2+ times get one post before MIDDAY_SPLIT and one after;
// everything else is spread randomly. Never the same category twice in a row.
function orderCategories(times) {
  const split        = toMin(MIDDAY_SPLIT);
  const morningCount = times.filter((t) => t < split).length;
  const total        = times.length;

  let last;
  for (let attempt = 0; attempt < 500; attempt++) {
    const morning = [], afternoon = [], pool = [];
    for (const [cat, n] of Object.entries(SLOT_COUNTS)) {
      if (n >= 2) {
        morning.push(cat);
        afternoon.push(cat);
        for (let k = 2; k < n; k++) pool.push(cat);
      } else {
        for (let k = 0; k < n; k++) pool.push(cat);
      }
    }

    let seq;
    const splitFits = morning.length <= morningCount && afternoon.length <= total - morningCount;
    if (splitFits) {
      const rest = shuffle(pool);
      const toMorning = morningCount - morning.length;
      seq = [
        ...shuffle([...morning, ...rest.slice(0, toMorning)]),
        ...shuffle([...afternoon, ...rest.slice(toMorning)]),
      ];
    } else {
      // Not enough slots on one side of the split — fall back to a plain shuffle
      seq = shuffle([...morning, ...afternoon, ...pool]);
    }

    last = seq;
    if (noAdjacentRepeats(seq)) return seq;
  }
  return last;
}

// ── Plan ──────────────────────────────────────────────────────────────────────

export function buildPlan(date) {
  const total = Object.values(SLOT_COUNTS).reduce((s, n) => s + n, 0);
  const times = pickTimes(total, openRanges());
  const cats  = orderCategories(times);
  return {
    date,
    created_at:   new Date().toISOString(),
    summary_sent: false,
    last_sent_at: null,
    slots: times.map((t, i) => ({
      id:       i + 1,
      time:     fmtTime(t),
      minutes:  t,
      category: cats[i],
      status:   "pending", // pending → sending → sent | skipped | failed, or missed
    })),
  };
}

function planPath(date) {
  return join(PLANS_DIR, `${date}.json`);
}

export function loadPlan(date) {
  try { return JSON.parse(readFileSync(planPath(date), "utf8")); }
  catch { return null; }
}

export function savePlan(plan) {
  mkdirSync(PLANS_DIR, { recursive: true });
  writeFileSync(planPath(plan.date), JSON.stringify(plan, null, 2));
}

export function getOrCreatePlan(date) {
  const existing = loadPlan(date);
  if (existing) return existing;
  const plan = buildPlan(date);
  savePlan(plan);
  console.log(`[SlotPlanner] ${date}: ${plan.slots.map((s) => `${s.time} ${s.category}`).join(" · ")}`);
  return plan;
}

export function planSummary(plan) {
  const lines = plan.slots.map((s) => `${s.time}  ${SLOT_LABELS[s.category] || s.category}`);
  return `🗓️ *Today's broadcast plan — ${plan.date}*\n\n${lines.join("\n")}\n\n${plan.slots.length} posts`;
}
