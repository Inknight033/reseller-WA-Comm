import { getProductMap } from "./cache.js";
import { PRODUCTS_PER_SHARE } from "./config/schedule.js";
import { CORE_TOPICS, DISCOVERY_TOPICS, collectionsForTopic, slug } from "./config/topics.js";
import { getRecentlyShared, getRecentlySharedTimes, getCollectionLastShared } from "./history.js";

// Exclude products explicitly marketed to men/boys — catches mismapped types
// and cross-gender products where the name makes it clear. Word-boundary match
// so "women", "element", "female" are not caught. Not applied to men's categories.
const MALE_NAME_PATTERN = /\b(men|mens|men's|boys|boy's|gents|male|unisex\s+men)\b/i;

// Which products belong in a collection of each theme (same rules the
// collections were built with)
const THEME_RULES = {
  "Trending":     (p) => p.orders_30d >= 1,
  "Under ₹500":   (p) => p.reseller_selling_price < 500,
  "Premium":      (p) => p.reseller_selling_price > 750,
  "Top Rated":    (p) => p.pq_score >= 3.9,
  "New Arrivals": (p) => p.is_new_arrival,
};

// Products rated below this (any number of reviews) are never posted; unrated is fine
const MIN_RATING = 3.0;

// Most orders in 30 days first, then higher rating (unrated last), then more reviews
const byRank = (a, b) =>
  b.orders_30d - a.orders_30d ||
  (b.pq_score ?? -1) - (a.pq_score ?? -1) ||
  b.review_count - a.review_count;

// Products in a topic (before the "recently shared" filter)
function topicProducts(products, topic) {
  const cat = slug(topic.category), sub = slug(topic.sub_category);
  const mensCategory = cat.startsWith("men-s");
  return [...products.values()].filter((p) => {
    if (slug(p.category_l1) !== cat)                                   return false;
    if (topic.sub_category && slug(p.category_l2) !== sub)            return false;
    // Some newly uploaded products have no name or price yet — never post those
    if (!p.product_name?.trim() || !p.reseller_selling_price)        return false;
    if (!mensCategory && MALE_NAME_PATTERN.test(p.product_name))      return false;
    // Ranking is orders first, so keep badly rated products out entirely
    if (p.pq_score !== null && p.pq_score < MIN_RATING)                return false;
    return true;
  });
}

// Candidates for a topic's post, best first. Products shared in the last 15 days
// are left out; if fewer than a few posts' worth are left, the ones shared
// longest ago are added at the end.
function rankedCandidates(products, topic) {
  const recentIds = getRecentlyShared();
  const all   = topicProducts(products, topic);
  const fresh = all.filter((p) => !recentIds.has(p.customer_product_short_id)).sort(byRank);
  const want  = PRODUCTS_PER_SHARE * 3;
  if (fresh.length >= want) return fresh;

  const times = getRecentlySharedTimes();
  const reused = all
    .filter((p) => times.has(p.customer_product_short_id))
    .sort((a, b) => times.get(a.customer_product_short_id) - times.get(b.customer_product_short_id))
    .slice(0, want - fresh.length)
    .map((p) => ({ ...p, _reused: true }));
  if (reused.length) console.log(`[Ranking] ${topic.label}: low on fresh products — reusing ${reused.length} shared longest ago`);
  return [...fresh, ...reused];
}

// Two collections for the post, rotated: the one linked longest ago (never = first)
// goes first; the second is the next longest-ago with a different theme, so a post
// never links e.g. "Trending Rings" and "Trending Jewellery" together. A collection
// is only used if at least 2 of the topic's candidates fit it.
function pickCollections(topic, candidates) {
  const lastShared = getCollectionLastShared();
  const usable = collectionsForTopic(topic)
    .map((c) => ({ ...c, fits: candidates.filter(THEME_RULES[c.theme] || (() => false)) }))
    .filter((c) => c.fits.length >= 2)
    .map((c) => ({ c, last: lastShared[c.short_id] || "", tie: Math.random() }))
    .sort((a, b) => a.last.localeCompare(b.last) || a.tie - b.tie)
    .map((x) => x.c);

  const first = usable[0];
  if (!first) return [];
  const second = usable.find((c) => c !== first && c.theme !== first.theme)
              || usable.find((c) => c !== first);
  return second ? [first, second] : [first];
}

// Everything a post needs: the topic's two collections and, for each, its best
// candidates. The sender takes PRODUCTS_PER_SHARE / 2 from each (skipping any
// whose photo fails) and tops up from `others`.
export async function pickPost(topic) {
  const products   = await getProductMap();
  const candidates = rankedCandidates(products, topic);
  if (!candidates.length) return null;

  const collections = pickCollections(topic, candidates);
  const pool = PRODUCTS_PER_SHARE * 2;
  return {
    collections: collections.map(({ fits, ...c }) => ({ ...c, candidates: fits.slice(0, pool) })),
    others:      candidates.slice(0, pool),
  };
}

export { byRank };

// Per-topic stock: how many products exist, how many are fresh (not shared in
// the no-repeat window), and roughly how many days of posts that covers.
export async function getStockReport() {
  const recentIds = getRecentlyShared();
  const products  = await getProductMap();

  return [...CORE_TOPICS, ...DISCOVERY_TOPICS].map((topic) => {
    const all   = topicProducts(products, topic);
    const fresh = all.filter((p) => !recentIds.has(p.customer_product_short_id)).length;
    const perDay = topic.tier === "core" ? (topic.per2days / 2) * PRODUCTS_PER_SHARE : null;
    return {
      topic:            topic.key,
      label:            topic.label,
      tier:             topic.tier,
      posts_per_2_days: topic.tier === "core" ? topic.per2days : "rotating",
      total_products:   all.length,
      with_orders:      all.filter((p) => p.orders_30d >= 1).length,
      fresh_products:   fresh,
      days_of_stock:    perDay ? Math.floor(fresh / perDay) : null,
    };
  });
}
