// Daily Facebook plan. Each day has posting windows; in every window each
// active group gets one post at its own random time. A window's posts are
// built the first time its plan is asked for and saved, so the posting run
// and the photos it downloads always match what was planned.
import fs from "fs";
import { join } from "path";
import { FB_GROUPS } from "./config/fb_groups.js";
import { CORE_TOPICS, getTopic } from "./config/topics.js";
import { introText, topicPost } from "./fb_posts.js";

const DIR = join(process.env.DATA_DIR || "data", "fb_plans");

// 13 Nov 2026 is the last day with an intro post; after that, 3 product posts a day
const SPECIAL_DAYS = {
  "2026-11-13": [
    { slot: "intro", kind: "intro", from: "09:00", to: "10:30" },
    { slot: "p1",    kind: "topic", from: "11:00", to: "13:00" },
    { slot: "p2",    kind: "topic", from: "16:00", to: "18:00" },
  ],
};
const DEFAULT_WINDOWS = [
  { slot: "p1", kind: "topic", from: "10:00", to: "12:00" },
  { slot: "p2", kind: "topic", from: "14:00", to: "16:00" },
  { slot: "p3", kind: "topic", from: "17:00", to: "19:00" },
];
export const windowsFor = (date) => SPECIAL_DAYS[date] || DEFAULT_WINDOWS;

// Topics each kind of group gets. General groups get every core topic.
const POOLS = {
  general: CORE_TOPICS.map((t) => t.key),
  sarees: [
    "sarees/cotton-sarees", "sarees/silk-sarees", "sarees/linen-sarees", "sarees/banarasi-sarees",
    "sarees/blouses", "lehenga-gowns-and-ethnic-dresses/all", "fashion-accessories/saree-accessories",
    "jewellery/necklace-sets", "jewellery/bangles-and-bracelets", "jewellery/earrings",
  ],
  kurtis: [
    "kurtas-kurtis-and-sets/kurta-pant-and-dupatta-sets", "kurtas-kurtis-and-sets/unstitched-suit-fabric",
    "kurtas-kurtis-and-sets/printed-kurtis", "kurtas-kurtis-and-sets/kurta-sets-general",
    "ethnic-bottoms-and-dupattas/dupattas-and-shawls", "jewellery/earrings",
    "jewellery/bangles-and-bracelets", "bags/tote-bags",
  ],
};

// A group doesn't see the same product again within this many days
const NO_REPEAT_DAYS = 7;

const file = (date, slot) => join(DIR, `${date}_${slot}.json`);
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

function seeded(seedText) {
  let a = [...seedText].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadSlot(date, slot) {
  try { return JSON.parse(fs.readFileSync(file(date, slot), "utf8")); } catch { return null; }
}

// Saved plans before this window, newest relevant first: { date, slot, posts }[]
function history(date, slot) {
  let names = [];
  try { names = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")); } catch {}
  const order = windowsFor(date).map((w) => w.slot);
  return names
    .map((n) => { const [d, s] = n.replace(".json", "").split("_"); return { d, s }; })
    .filter(({ d, s }) => {
      const age = daysBetween(d, date);
      if (age > NO_REPEAT_DAYS || age < 0) return false;
      return age > 0 || order.indexOf(s) < order.indexOf(slot);
    })
    .map(({ d, s }) => loadSlot(d, s))
    .filter(Boolean);
}

const building = new Map();

// Builds (once) and returns the plan for one window
export function getSlot(date, slot) {
  const saved = loadSlot(date, slot);
  if (saved) return Promise.resolve(saved);
  const key = `${date}_${slot}`;
  if (!building.has(key)) {
    building.set(key, buildSlot(date, slot).finally(() => building.delete(key)));
  }
  return building.get(key);
}

async function buildSlot(date, slot) {
  const win = windowsFor(date).find((w) => w.slot === slot);
  if (!win) throw new Error(`No window "${slot}" on ${date}`);
  const rand = seeded(`${date}/${slot}`);

  // Each group's random time in the window (last 10 minutes kept free)
  const from = toMin(win.from), to = toMin(win.to) - 10;
  const groups = FB_GROUPS.filter((g) => g.active !== false)
    .map((g) => ({ g, minute: from + Math.floor(rand() * (to - from)) }))
    .sort((a, b) => a.minute - b.minute);

  const past = history(date, slot);
  const posts = [];

  for (const { g, minute } of groups) {
    const base = { g: g.code, group: g.name, groupId: g.id, time: toHHMM(minute) };
    if (win.kind === "intro") {
      posts.push({ ...base, kind: "intro", text: introText(g.code) });
      continue;
    }

    // Topic: one this group hasn't had today, had longest ago, and that the
    // fewest other groups have in this window
    const mine = past.flatMap((p) => p.posts.filter((x) => x.g === g.code).map((x) => ({ ...x, date: p.date })));
    const usedToday = new Set(mine.filter((x) => x.date === date).map((x) => x.topic));
    const lastUsed = (key) => mine.filter((x) => x.topic === key).map((x) => x.date).sort().pop() || "";
    const inWindow = (key) => posts.filter((x) => x.topic === key).length;
    const topics = POOLS[g.theme || "general"]
      .filter((key) => getTopic(key) && !usedToday.has(key))
      .map((key) => ({ key, last: lastUsed(key), n: inWindow(key), tie: rand() }))
      .sort((a, b) => a.last.localeCompare(b.last) || a.n - b.n || a.tie - b.tie);

    // Products: none this group saw in the last week, none another group gets in this window
    const exclude = new Set([...mine.flatMap((x) => x.products || []), ...posts.flatMap((x) => x.products || [])]);

    let built = null;
    for (const t of topics) {
      try { built = await topicPost(g.code, t.key, exclude); } catch (e) { console.warn(`[FB plan] ${g.code} ${t.key}:`, e.message); }
      if (built) { posts.push({ ...base, kind: "topic", topic: t.key, ...built }); break; }
    }
    if (!built) console.warn(`[FB plan] ${date} ${slot}: no post for ${g.code}`);
  }

  // Most groups missing means product data failed to load — don't save, so the
  // next request tries again
  if (posts.length < groups.length / 2) {
    throw new Error(`Only ${posts.length} of ${groups.length} posts built for ${date} ${slot} — not saved`);
  }

  const plan = { date, slot, kind: win.kind, from: win.from, to: win.to, built_at: new Date().toISOString(), posts };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file(date, slot), JSON.stringify(plan, null, 2));
  pruneOld(date);
  console.log(`[FB plan] Built ${date} ${slot}: ${posts.length} posts`);
  return plan;
}

function pruneOld(today) {
  try {
    for (const n of fs.readdirSync(DIR)) {
      if (daysBetween(n.slice(0, 10), today) > 30) fs.unlinkSync(join(DIR, n));
    }
  } catch {}
}
