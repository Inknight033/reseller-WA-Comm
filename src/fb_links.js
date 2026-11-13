// Short links for Facebook group posts: qrate-go.up.railway.app/<group>/<link>
// redirects to the full QRate / app store / WhatsApp link with UTMs, and logs
// the click so we can count visits per group.
import fs from "fs";
import { join } from "path";
import { FB_GROUPS, getFbGroup } from "./config/fb_groups.js";
import { getProductMap } from "./cache.js";

export const SHORT_HOST = process.env.FB_SHORT_HOST || "qrate-go.up.railway.app";

const DATA_DIR    = process.env.DATA_DIR || "data";
const CLICKS_FILE = join(DATA_DIR, "fb_clicks.jsonl");

const QRATE = "https://qrate.shopdeck.com";

// Fixed links used in the intro post
const LINKS = {
  jw:      { campaign: "qrate_intro", url: `${QRATE}/store/collection/jtpi6W6A` },
  sr:      { campaign: "qrate_intro", url: `${QRATE}/store/collection/oQQggIzH` },
  kt:      { campaign: "qrate_intro", url: `${QRATE}/store/collection/lnuPB_jw` },
  hl:      { campaign: "qrate_intro", url: `${QRATE}/store/collection/KPtv3w7q` },
  all:     { campaign: "qrate_intro", url: `${QRATE}/browse` },
  android: { campaign: "qrate_intro", playStore: true },
  ios:     { campaign: "qrate_intro", url: "https://apps.apple.com/in/app/qrate-resell-earn-online/id6812978276", noUtm: true },
  wa:      { campaign: "qrate_intro", url: "https://chat.whatsapp.com/FoF6hBFPU2c2KCqVQgeXvv", noUtm: true },
  // Same links in topic posts, tracked under the topic-post campaign
  pb:      { campaign: "daily_product_sharing", url: `${QRATE}/browse` },
  pa:      { campaign: "daily_product_sharing", playStore: true },
  pi:      { campaign: "daily_product_sharing", url: "https://apps.apple.com/in/app/qrate-resell-earn-online/id6812978276", noUtm: true },
  pw:      { campaign: "daily_product_sharing", url: "https://chat.whatsapp.com/FoF6hBFPU2c2KCqVQgeXvv", noUtm: true },
};

const utm = (campaign, group) =>
  `utm_source=facebook&utm_medium=fb_group&utm_campaign=${campaign}&utm_content=${group.id}`;

const withQuery = (url, q) => `${url}${url.includes("?") ? "&" : "?"}${q}`;

function target(link, group) {
  const q = utm(link.campaign, group);
  // Play Store hands the referrer to the app on install
  if (link.playStore) return `https://play.google.com/store/apps/details?id=com.shopdeck.qrate&referrer=${encodeURIComponent(q)}`;
  return link.noUtm ? link.url : withQuery(link.url, q);
}

// Facebook and WhatsApp fetch links to build previews — not real clicks
const CRAWLER = /facebookexternalhit|facebot|whatsapp|bot|crawler|spider|preview/i;

function logClick(group, link, req) {
  if (CRAWLER.test(req.get("user-agent") || "")) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(CLICKS_FILE, JSON.stringify({ ts: new Date().toISOString(), g: group.code, link }) + "\n");
  } catch (e) {
    console.warn("[FB links] Could not log click:", e.message);
  }
}

// Clicks per group and link, newest data included
export function clickSummary() {
  let lines = [];
  try { lines = fs.readFileSync(CLICKS_FILE, "utf8").trim().split("\n").filter(Boolean); } catch {}
  const counts = {};
  for (const l of lines) {
    const { g, link } = JSON.parse(l);
    counts[g] ??= { total: 0 };
    counts[g][link] = (counts[g][link] || 0) + 1;
    counts[g].total++;
  }
  return FB_GROUPS.map((g) => ({ code: g.code, group: g.name, ...(counts[g.code] || { total: 0 }) }));
}

// Must be registered before any other route: on the short host only short
// links are served, so the admin pages (QR login, /reset, /trigger) never
// show up on the address we post publicly.
export function registerFbLinks(app) {
  app.use(async (req, res, next) => {
    if (req.hostname !== SHORT_HOST) return next();
    try {
      const url = await resolve(req.path, req);
      if (!url) return res.status(404).send("Not found");
      res.redirect(302, url);
    } catch (e) {
      console.warn("[FB links]", req.path, e.message);
      res.redirect(302, `${QRATE}/browse`);
    }
  });
}

// /<group>/<link>, /<group>/c/<collection id> or /<group>/p/<product id>
async function resolve(path, req) {
  const parts = path.split("/").slice(1);
  const group = getFbGroup(parts[0]);
  if (!group) return null;

  if (parts.length === 2 && LINKS[parts[1]]) {
    logClick(group, parts[1], req);
    return target(LINKS[parts[1]], group);
  }
  if (parts.length !== 3 || !/^[\w-]+$/.test(parts[2])) return null;

  const q = utm("daily_product_sharing", group);
  if (parts[1] === "c") {
    logClick(group, `c/${parts[2]}`, req);
    return withQuery(`${QRATE}/store/collection/${parts[2]}`, q);
  }
  if (parts[1] === "p") {
    // Product pages need the name slug and SKU — look them up; a product that
    // has left QRate goes to browse instead
    const p = (await getProductMap()).get(parts[2]);
    logClick(group, `p/${parts[2]}`, req);
    return withQuery(p ? p.qrate_url : `${QRATE}/browse`, q);
  }
  return null;
}

// For checking links from the main host: /fb/link?g=f1&l=jw
export const fbTarget = (code, key) => {
  const group = getFbGroup(code), link = LINKS[key];
  return group && link ? target(link, group) : null;
};
