import { getProductMap } from "./cache.js";
import { CATEGORY_TYPES } from "./config/categories.js";
import { MIN_L30D_ORDERS, PRODUCTS_PER_SHARE, SLOT_COUNTS } from "./config/schedule.js";
import { getRecentlyShared, getRecentlySharedTimes } from "./history.js";
import { loadWeights, loadSubcategoryPerf } from "./learning.js";

// Exclude products explicitly marketed to men/boys — catches mismapped types
// and cross-gender products where the name makes it clear. Word-boundary match
// so "women", "element", "female" are not caught.
const MALE_NAME_PATTERN = /\b(men|mens|men's|boys|boy's|gents|male|unisex\s+men)\b/i;

function normalise(arr) {
  const max = Math.max(...arr, 1);
  return arr.map((v) => v / max);
}

// Average EMA orders across known sub-categories within this slot's valid types
function categoryAvgOrders(subPerf, validTypes) {
  const entries = Object.entries(subPerf).filter(([sc]) => validTypes.has(sc));
  if (!entries.length) return 1;
  return entries.reduce((s, [, e]) => s + e.ema_orders, 0) / entries.length;
}

// Historical performance multiplier for a sub-category. Returns 1.0 if not enough data.
function subcatBoost(subPerf, sc, catAvg) {
  const entry = subPerf[sc];
  if (!entry || entry.samples < 3) return 1.0;
  const ratio = entry.ema_orders / Math.max(catAvg, 0.01);
  return Math.max(0.7, Math.min(1.5, ratio)); // clamp so one great day doesn't dominate
}

// Products that belong in a slot category (before the "recently shared" filter)
function categoryProducts(products, category) {
  const validTypes = new Set(CATEGORY_TYPES[category] || []);

  return [...products.values()].filter((p) => {
    if (!validTypes.has(p.clean_product_type))                        return false;
    // Some newly uploaded products have no name or price yet — never post those
    if (!p.product_name?.trim() || !p.reseller_selling_price)        return false;
    if (p.orders_last_30d < MIN_L30D_ORDERS)                         return false;
    // Drop anything explicitly marketed to men/boys — catches mismapped types
    if (MALE_NAME_PATTERN.test(p.product_name))                       return false;
    return true;
  });
}

export async function getRankedForSlot({ category }) {
  const weights   = loadWeights();
  const recentIds = getRecentlyShared();
  const products  = await getProductMap();

  const inCategory = categoryProducts(products, category);
  const candidates = inCategory.filter((p) => !recentIds.has(p.customer_product_short_id));

  // Running low on fresh products → top up with the ones shared longest ago
  const reused = candidates.length < REUSE_POOL ? oldestShared(inCategory, REUSE_POOL - candidates.length) : [];

  if (!candidates.length) return reused;

  // Signals — all normalised 0→1
  // Priority: 40% reseller L30d orders, 30% overall L30d orders, 15% L7d shares, 15% margin
  const normResellerOrders = normalise(candidates.map((p) => p.reseller_orders_last_30d || 0));
  const normOrders         = normalise(candidates.map((p) => p.orders_last_30d));
  const normShares         = normalise(candidates.map((p) => p.shares_last_7d));
  const normMargin         = normalise(candidates.map((p) => p.margin || 0));

  const scored = candidates.map((p, i) => ({
    ...p,
    _score:
      (weights.reseller_orders_l30d || 0.40) * normResellerOrders[i] +
      (weights.l30d_orders          || 0.30) * normOrders[i]         +
      (weights.l7d_shares           || 0.15) * normShares[i]         +
      (weights.margin               || 0.15) * normMargin[i],
  }));

  scored.sort((a, b) => b._score - a._score);
  return [...scored, ...reused];
}

// Enough to fill a post even if a few images fail to load
const REUSE_POOL = PRODUCTS_PER_SHARE * 2;

// Recently shared products in this category, oldest share first. Scores are tiny
// so they always rank below fresh products and the oldest comes first.
function oldestShared(inCategory, count) {
  const times = getRecentlySharedTimes();
  const old = inCategory
    .filter((p) => times.has(p.customer_product_short_id))
    .sort((a, b) => times.get(a.customer_product_short_id) - times.get(b.customer_product_short_id))
    .slice(0, count);
  if (old.length) console.log(`[Ranking] Low on fresh products — reusing ${old.length} shared longest ago`);
  return old.map((p, i) => ({ ...p, _score: 0.001 * (1 - i / old.length), _reused: true }));
}

// Pick products for a slot, grouped by same sub-category.
// poolSize controls how many candidates to return from the best group —
// caller uses a larger pool so it can replace products whose images fail.
export async function pickSlotProducts(slot, poolSize = PRODUCTS_PER_SHARE) {
  const n      = PRODUCTS_PER_SHARE;
  const ranked = await getRankedForSlot(slot);

  if (!ranked.length) return [];

  const subPerf    = loadSubcategoryPerf();
  const validTypes = new Set(CATEGORY_TYPES[slot.category] || []);
  const catAvg     = categoryAvgOrders(subPerf, validTypes);

  // Group by sub-category
  const groups = new Map();
  for (const p of ranked) {
    const sc = p.clean_product_type;
    if (!groups.has(sc)) groups.set(sc, []);
    groups.get(sc).push(p);
  }

  // Best group: sum of top-N product scores × historical performance boost
  let bestKey      = null;
  let bestEffScore = -Infinity;

  for (const [sc, group] of groups) {
    const rawScore = group.slice(0, n).reduce((s, p) => s + p._score, 0);
    const boost    = subcatBoost(subPerf, sc, catAvg);
    const effScore = rawScore * boost;
    if (effScore > bestEffScore) { bestEffScore = effScore; bestKey = sc; }
  }

  const best = groups.get(bestKey) || [];
  if (!best.length) return [];
  return best.slice(0, poolSize);
}

// Per-category stock: how many products exist, how many are fresh (not shared
// in the no-repeat window), and roughly how many days of posts that covers.
export async function getStockReport() {
  const recentIds = getRecentlyShared();
  const products  = await getProductMap();

  return Object.entries(SLOT_COUNTS).map(([category, postsPerDay]) => {
    const all      = categoryProducts(products, category);
    const fresh    = all.filter((p) => !recentIds.has(p.customer_product_short_id)).length;
    const perDay   = postsPerDay * PRODUCTS_PER_SHARE;
    return {
      category,
      posts_per_day:    postsPerDay,
      products_per_day: perDay,
      total_products:   all.length,
      fresh_products:   fresh,
      days_of_stock:    Math.floor(fresh / perDay),
    };
  });
}
