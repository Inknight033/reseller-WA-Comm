// Daily broadcast plan settings. The actual times and category order are
// generated fresh each day by slot_planner.js — nothing here is a fixed clock time.

// How many posts each category gets per day (15 posts/day total).
// Co-ord is left out: its products have no product type in the catalogue data,
// so the bot can't find any. Add `coord: 1` back once that data is fixed.
export const SLOT_COUNTS = {
  mangalsutra: 2,
  necklace:    2,
  kurti:       2,
  earring:     2,
  saree:       2,
  bangle:      2,
  handbag:     1,
  slipper:     1,
  watch:       1,
};

// Broadcast window (IST). Posts land at random minutes inside it.
export const WINDOW_START = { hour: 9,  minute: 0  };
export const WINDOW_END   = { hour: 19, minute: 45 };

// Posts are never closer together than this
export const MIN_GAP_MINUTES = 20;

// Categories posted twice a day get one post before this time and one after
export const MIDDAY_SPLIT = { hour: 14, minute: 0 };

// No group posts inside these windows (IST) — the nudge and personalised
// reseller sends run here, and we don't want everything firing at once
export const QUIET_WINDOWS = [
  { start: { hour: 10, minute: 45 }, end: { hour: 11, minute: 30 } },
];

// A post that is this late (e.g. the bot was down) is skipped, not sent
export const MAX_LATE_MINUTES = 90;

export const PRODUCTS_PER_SHARE = 6;
export const MIN_L30D_ORDERS    = 0;
