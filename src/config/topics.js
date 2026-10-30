// What group posts are about. A topic is a website sub-category with collection
// pages on the app (e.g. Jewellery › Bangles & Bracelets), or a whole category
// that has no sub-category pages (e.g. Lehenga, Gowns & Ethnic Dresses).
//
// Core topics are posted every 2-day cycle, as many times as listed below.
// Every other topic with collections is a discovery topic: they take turns in the
// discovery posts, least recently posted first.
import { COLLECTIONS } from "./collections.js";

// Category names differ slightly between files ("Kurtas Kurtis & Sets" vs
// "Kurtas, Kurtis & Sets", "T Shirts" vs "T-Shirts") — compare by slug.
export const slug = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const topicKey = (category, sub) => `${slug(category)}/${sub ? slug(sub) : "all"}`;

// [category, sub-category (null = whole category), posts per 2 days, label override]
// Ranked by reseller interest (app activity × onboarding picks). Must add up to
// 2 × CORE_POSTS_PER_DAY (see schedule.js).
const CORE = [
  ["Jewellery",                       "Bangles & Bracelets",        3],
  ["Kurtas, Kurtis & Sets",           "Kurta Pant & Dupatta Sets",  2],
  ["Home & Living",                   "Home Decor",                 2],
  ["Jewellery",                       "Mangalsutras",               1],
  ["Sarees",                          "Cotton Sarees",              1],
  ["Bags",                            "Tote Bags",                  1],
  ["Jewellery",                       "Earrings",                   1],
  ["Sarees",                          "Silk Sarees",                1],
  ["Jewellery",                       "Necklace Sets",              1],
  ["Jewellery",                       "Necklaces",                  1],
  ["Footwear",                        "Slippers",                   1],
  ["Sarees",                          "Linen Sarees",               1],
  ["Kurtas, Kurtis & Sets",           "Unstitched Suit Fabric",     1],
  ["Footwear",                        "Heels",                      1],
  ["Sarees",                          "Banarasi Sarees",            1],
  ["Home & Living",                   "Kitchen & Dining",           1],
  ["Jewellery",                       "Chains",                     1],
  ["Jewellery",                       "Rings",                      1],
  ["Lehenga, Gowns & Ethnic Dresses", null,                         1, "Lehengas & Gowns"],
  ["Home & Living",                   "Bed Linen",                  1],
];

function makeTopic(category, sub, tier, per2days = 0, label) {
  return { key: topicKey(category, sub), category, sub_category: sub, label: label || sub || category, tier, per2days };
}

export const CORE_TOPICS = CORE.map(([c, s, n, label]) => makeTopic(c, s, "core", n, label));

// Discovery: every other sub-category page, plus categories with no sub-category pages
const coreKeys    = new Set(CORE_TOPICS.map((t) => t.key));
const catsWithSub = new Set(COLLECTIONS.filter((c) => c.level === "Sub-category").map((c) => slug(c.category)));
const seen        = new Set();
export const DISCOVERY_TOPICS = [];
for (const c of COLLECTIONS) {
  const sub = c.level === "Sub-category" ? c.sub_category : null;
  if (!sub && catsWithSub.has(slug(c.category))) continue;
  const t = makeTopic(c.category, sub, "discovery");
  if (coreKeys.has(t.key) || seen.has(t.key)) continue;
  seen.add(t.key);
  DISCOVERY_TOPICS.push(t);
}

const ALL = new Map([...CORE_TOPICS, ...DISCOVERY_TOPICS].map((t) => [t.key, t]));
export const getTopic  = (key) => ALL.get(key);
export const allTopics = () => [...ALL.values()];

// Collections a topic's post can link: its own sub-category pages plus its
// whole-category pages.
export function collectionsForTopic(topic) {
  const cat = slug(topic.category), sub = slug(topic.sub_category);
  return COLLECTIONS.filter((c) =>
    slug(c.category) === cat &&
    (c.level === "Category" || (topic.sub_category && slug(c.sub_category) === sub))
  );
}
