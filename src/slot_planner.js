// Builds each day's group broadcast plan: random post times + which topic each post is about.
// Core topics are spread over a 2-day cycle (days paired from a fixed start, so both
// days of a cycle agree without sharing state); discovery topics take turns,
// least recently posted first. The plan is saved to disk so a restart mid-day
// reuses it (no double posts, no skips).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import {
  CORE_POSTS_PER_DAY, DISCOVERY_POSTS_PER_DAY,
  WINDOW_START, WINDOW_END, MIN_GAP_MINUTES, MIDDAY_SPLIT, QUIET_WINDOWS,
} from "./config/schedule.js";
import { CORE_TOPICS, DISCOVERY_TOPICS, getTopic } from "./config/topics.js";

const PLAN_VERSION = 2; // 1 = old fixed 9-category plans

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

function shuffle(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Repeatable random numbers from a string seed (mulberry32)
function seeded(seedStr) {
  let h = 1779033703;
  for (const ch of String(seedStr)) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
  return () => {
    h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayNumber = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);

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

// ── Which topics post today ───────────────────────────────────────────────────

// Core topics for one day. Each 2-day cycle shares out every core topic's posts
// (a topic with 2+ posts gets them split across both days) so each day gets
// about the same number.
function coreTopicsForDay(date) {
  const day   = dayNumber(date);
  const cycle = Math.floor(day / 2);
  const rand  = seeded(`core-${cycle}`);
  const days  = [[], []];

  for (const t of CORE_TOPICS.filter((t) => t.per2days >= 2)) {
    const [a, b] = rand() < 0.5 ? [0, 1] : [1, 0];
    for (let k = 0; k < Math.ceil(t.per2days / 2); k++)  days[a].push(t.key);
    for (let k = 0; k < Math.floor(t.per2days / 2); k++) days[b].push(t.key);
  }
  for (const t of shuffle(CORE_TOPICS.filter((t) => t.per2days === 1), rand)) {
    const d = days[0].length === days[1].length ? (rand() < 0.5 ? 0 : 1)
            : days[0].length < days[1].length ? 0 : 1;
    days[d].push(t.key);
  }
  return days[day % 2];
}

// Last date each topic was in a saved plan (dates before `beforeDate` only)
function lastPlannedDates(beforeDate) {
  const last = new Map();
  let files = [];
  try { files = readdirSync(PLANS_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)); } catch {}
  for (const f of files) {
    const date = f.slice(0, 10);
    if (date >= beforeDate) continue;
    const plan = loadPlan(date);
    for (const s of plan?.slots || []) {
      if (s.topic && (!last.has(s.topic) || last.get(s.topic) < date)) last.set(s.topic, date);
    }
  }
  return last;
}

// Discovery topics for one day: those posted longest ago (never = first)
function discoveryTopicsForDay(date, lastDates) {
  const rand = seeded(`discovery-${date}`);
  return shuffle(DISCOVERY_TOPICS, rand)
    .sort((a, b) => (lastDates.get(a.key) || "").localeCompare(lastDates.get(b.key) || ""))
    .slice(0, DISCOVERY_POSTS_PER_DAY)
    .map((t) => t.key);
}

// ── Order ─────────────────────────────────────────────────────────────────────

const categoryOf = (key) => getTopic(key)?.category;
const noAdjacentRepeats = (seq) => seq.every((k, i) => i === 0 || categoryOf(k) !== categoryOf(seq[i - 1]));

// Topics posted twice in a day get one post before MIDDAY_SPLIT and one after;
// everything else is spread randomly. Two posts from the same category (e.g.
// Earrings then Rings) are kept apart where possible.
function orderTopics(times, keys) {
  const split        = toMin(MIDDAY_SPLIT);
  const morningCount = times.filter((t) => t < split).length;
  const counts       = new Map();
  for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1);

  let last;
  for (let attempt = 0; attempt < 2000; attempt++) {
    const morning = [], afternoon = [], pool = [];
    for (const [k, n] of counts) {
      if (n >= 2) {
        morning.push(k);
        afternoon.push(k);
        for (let i = 2; i < n; i++) pool.push(k);
      } else {
        pool.push(k);
      }
    }

    let seq;
    const splitFits = morning.length <= morningCount && afternoon.length <= keys.length - morningCount;
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

// lastDates: topic → last date posted, for picking discovery topics (read from
// saved plans unless given, e.g. by a preview)
export function buildPlan(date, lastDates = lastPlannedDates(date)) {
  const keys   = [...coreTopicsForDay(date), ...discoveryTopicsForDay(date, lastDates)];
  const times  = pickTimes(keys.length, openRanges());
  const order  = orderTopics(times, keys);
  return {
    version:      PLAN_VERSION,
    date,
    created_at:   new Date().toISOString(),
    summary_sent: false,
    last_sent_at: null,
    slots: times.map((t, i) => {
      const topic = getTopic(order[i]);
      return {
        id:       i + 1,
        time:     fmtTime(t),
        minutes:  t,
        topic:    topic.key,
        label:    topic.label,
        tier:     topic.tier,
        status:   "pending", // pending → sending → sent | skipped | failed, or missed
      };
    }),
  };
}

// Plans for the next few days, without saving anything (discovery turns are
// simulated from the saved history plus the preview's own earlier days)
export function previewPlans(fromDate, days) {
  const lastDates = lastPlannedDates(fromDate);
  const plans = [];
  for (let i = 0; i < days; i++) {
    const date = new Date((dayNumber(fromDate) + i) * 86400000).toISOString().slice(0, 10);
    const plan = buildPlan(date, new Map(lastDates));
    for (const s of plan.slots) lastDates.set(s.topic, date);
    plans.push(plan);
  }
  return plans;
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
  if (existing?.version === PLAN_VERSION) return existing;

  const plan = buildPlan(date);
  if (existing) {
    // Today's plan was made by the old 9-category version: keep what it already
    // sent and start the new plan from now (earlier slots are not caught up)
    const { minutes } = nowIST();
    for (const s of plan.slots) {
      if (s.minutes <= minutes) { s.status = "skipped"; s.error = "before switch to topic plan"; }
    }
    plan.summary_sent = existing.summary_sent;
    plan.last_sent_at = existing.last_sent_at;
    plan.replaced     = existing.slots;
  }
  savePlan(plan);
  console.log(`[SlotPlanner] ${date}: ${plan.slots.map((s) => `${s.time} ${s.label}`).join(" · ")}`);
  return plan;
}

export function planSummary(plan) {
  const lines = plan.slots.map((s) => `${s.time}  ${s.label}${s.tier === "discovery" ? "  🧭" : ""}`);
  return `🗓️ *Today's broadcast plan — ${plan.date}*\n\n${lines.join("\n")}\n\n${plan.slots.length} posts (🧭 = discovery)`;
}
