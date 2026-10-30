// Daily broadcast plan settings. The actual times and category order are
// generated fresh each day by slot_planner.js — nothing here is a fixed clock time.

// Posts per day: 15 in all. Which topics fill them comes from config/topics.js —
// core topics are spread over a 2-day cycle, discovery topics take turns.
export const CORE_POSTS_PER_DAY      = 12; // 80% — core topics
export const DISCOVERY_POSTS_PER_DAY = 3;  // 20% — discovering smaller categories

// Broadcast window (IST). Posts land at random minutes inside it.
export const WINDOW_START = { hour: 9,  minute: 0  };
export const WINDOW_END   = { hour: 19, minute: 45 };

// Posts are never closer together than this
export const MIN_GAP_MINUTES = 20;

// Topics posted twice in a day get one post before this time and one after
export const MIDDAY_SPLIT = { hour: 14, minute: 0 };

// No group posts inside these windows (IST) — the nudge and personalised
// reseller sends run here, and we don't want everything firing at once
export const QUIET_WINDOWS = [
  { start: { hour: 10, minute: 45 }, end: { hour: 11, minute: 30 } },
];

// A post that is this late (e.g. the bot was down) is skipped, not sent
export const MAX_LATE_MINUTES = 90;

// Each post: this many products plus two collections
export const PRODUCTS_PER_SHARE = 4;
