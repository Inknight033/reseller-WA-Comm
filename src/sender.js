import client from "./client/whatsapp.js";
import { pickPost, byRank } from "./ranking.js";
import { recordShared, recordCollectionsShared } from "./history.js";
import { getTopic } from "./config/topics.js";
import { PRODUCTS_PER_SHARE } from "./config/schedule.js";

// Hardcoded target JIDs (from /debug/groups)
const TARGET_JIDS = [
  "120363410134784350@g.us", // Resellers - QRate By Shopdeck (community sub-group)
  "120363428254767701@g.us", // Resellers - QRate By Shopdeck - 2 (community sub-group)
];

// ── Festival calendar ─────────────────────────────────────────────────────────
// Header tag in the 10 days before a festival, for posts in these website categories
const FESTIVALS = [
  { name: "Diwali", emoji: "🪔", start: "2026-11-01", categories: ["Kurtas, Kurtis & Sets", "Sarees", "Jewellery", "Western Wear", "Bags", "Home & Living", "Lehenga, Gowns & Ethnic Dresses"] },
  { name: "Holi",   emoji: "🎨", start: "2027-03-14", categories: ["Kurtas, Kurtis & Sets", "Western Wear"] },
  { name: "Eid",    emoji: "🌙", start: "2027-03-30", categories: ["Kurtas, Kurtis & Sets", "Sarees"] },
];

function getActiveFestival(category) {
  const today = new Date();
  for (const f of FESTIVALS) {
    if (!f.categories.includes(category)) continue;
    const daysAway = (new Date(f.start) - today) / 86400000;
    if (daysAway >= 0 && daysAway <= 10) return f;
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  if (!n) return "";
  return `₹${Number(n).toLocaleString("en-IN")}`;
}

function fmtOrders(n) {
  if (!n || n < 10) return null;
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k+`;
  if (n >= 1000)  return `${(n / 1000).toFixed(1)}k+`;
  return `${n}+`;
}

// QRate dynamic link: opens the app on Android (Play Store if not installed),
// the website on iPhone and desktop. The target URL must be fully encoded.
function dynamicLink(url) {
  return `https://link.blitzshopdeck.in/r?link=${encodeURIComponent(url)}&apn=com.shopdeck.qrate`;
}

const NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];

const THEME_EMOJI = {
  "Trending":     "🔥",
  "Under ₹500":   "💸",
  "Premium":      "💎",
  "Top Rated":    "⭐",
  "New Arrivals": "🆕",
};

// ── Combined text message ─────────────────────────────────────────────────────
// Collections first (the main call to action), then the products.
function buildCombinedText(topic, collections, products) {
  const festival = getActiveFestival(topic.category);
  const lines = [
    `🛍️ *${topic.label}*${festival ? ` — ${festival.name} Picks ${festival.emoji}` : ""}`,
    "",
    "👇 *Explore the full collections*",
  ];
  for (const c of collections) {
    lines.push(`${THEME_EMOJI[c.theme] || "✨"} *${c.name}* — ${c.products.toLocaleString("en-IN")} designs`);
    lines.push(`🔗 ${dynamicLink(c.link)}`);
  }
  lines.push("", "─────────────", "");

  // Per-product block
  products.forEach((p, i) => {
    lines.push(`${NUMBERS[i] || `${i + 1}.`} *${p.product_name}*`);

    // Strikethrough website price → reseller price
    lines.push(`~${fmt(p.website_price)}~ *${fmt(p.reseller_selling_price)}*`);

    // Orders · rating · margin on one line
    const ordersLabel = fmtOrders(p.orders_30d);
    const ratingLabel = p.pq_score >= 3.5 ? `⭐ ${p.pq_score.toFixed(1)}` : "";
    const marginLabel = p.margin && p.margin >= 50 ? `💰 ${fmt(p.margin)} margin` : "";
    const statsLine   = [ordersLabel ? `📦 ${ordersLabel} orders` : "", ratingLabel, marginLabel].filter(Boolean).join(" · ");
    if (statsLine) lines.push(statsLine);

    lines.push(`🔗 ${dynamicLink(p.qrate_url)}`);
    lines.push("");
  });

  // Footer
  lines.push("✅ No Shipping or Return charges · COD available");
  lines.push("🏆 Quality Guaranteed by Us — otherwise no questions asked return");
  lines.push("");
  lines.push(`🛒 Explore all categories: ${dynamicLink("https://qrate.shopdeck.com/browse")}`);
  lines.push("📩 DM me for any help or specific product requests — I'll find and share!");

  return lines.join("\n");
}

// ── Image fetch with timeout + content-type guard + single retry ──────────────
// All retries happen here, BEFORE any WA send — never re-send to communities
async function fetchImage(url, attempt = 1) {
  if (!url) return null;
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[img] HTTP ${res.status} for ${url.slice(0, 80)}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 512) {
      console.warn(`[img] Empty response (${buf.length}B) for ${url.slice(0, 80)}`);
      return null;
    }
    return buf;
  } catch (err) {
    clearTimeout(timer);
    if (attempt === 1) {
      await new Promise((r) => setTimeout(r, 1500));
      return fetchImage(url, 2);
    }
    console.warn(`[img] Failed: ${err.message} — ${url.slice(0, 80)}`);
    return null;
  }
}

// WhatsApp sometimes never answers a send — fail it instead of hanging the bot
function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const SEND_TIMEOUT_MS = 60 * 1000;

// ── Main send ─────────────────────────────────────────────────────────────────

// Products for the post: half from each collection's best candidates, skipping
// any whose photo didn't load, topped up from the topic's best. Shown best first.
function chooseProducts(post, images) {
  const chosen = new Set();
  const take = (list, n) => {
    for (const p of list) {
      if (n <= 0) break;
      const id = p.customer_product_short_id;
      if (chosen.has(id) || !images.get(id)) continue;
      chosen.add(id);
      n--;
    }
  };
  const per = Math.ceil(PRODUCTS_PER_SHARE / Math.max(post.collections.length, 1));
  for (const c of post.collections) take(c.candidates, Math.min(per, PRODUCTS_PER_SHARE - chosen.size));
  take(post.others, PRODUCTS_PER_SHARE - chosen.size);

  const byId = new Map([...post.collections.flatMap((c) => c.candidates), ...post.others]
    .map((p) => [p.customer_product_short_id, p]));
  return [...chosen].map((id) => byId.get(id)).sort(byRank);
}

// Builds the post for a topic without sending it: { topic, collections, products, buffers, text }
export async function buildPost(topicKey) {
  const topic = getTopic(topicKey);
  if (!topic) throw new Error(`Unknown topic: ${topicKey}`);

  const post = await pickPost(topic);
  if (!post) return null;

  // Fetch every candidate's photo up front — all retries happen before any WA send
  const all = new Map([...post.collections.flatMap((c) => c.candidates), ...post.others]
    .map((p) => [p.customer_product_short_id, p]));
  const images = new Map(await Promise.all(
    [...all.values()].map(async (p) => [p.customer_product_short_id, await fetchImage(p.img_link)])
  ));

  const products = chooseProducts(post, images);
  if (!products.length) return null;
  const collections = post.collections.map(({ candidates, ...c }) => c);

  return {
    topic,
    collections,
    products,
    buffers: products.map((p) => images.get(p.customer_product_short_id)),
    text:    buildCombinedText(topic, collections, products),
  };
}

// Returns { sent, count } so the scheduler can record what happened to the slot
export async function sendSlot(slot) {
  const slotTag = `${slot.hour}:${String(slot.minute || 0).padStart(2, "0")}`;

  const built = await buildPost(slot.topic);
  if (!built) {
    console.log(`[Slot ${slotTag}] No eligible products for ${slot.topic} — skipping`);
    return { sent: false, count: 0 };
  }
  const { products, buffers, text, collections } = built;
  const targetJids = TARGET_JIDS;

  // Send to each target — one group failing (e.g. bot not a member) doesn't stop the others
  let delivered = 0;
  for (const jid of targetJids) {
    try {
      // 1. Quick image burst → WA auto-albums them
      for (let i = 0; i < products.length; i++) {
        if (buffers[i]) {
          try {
            const imgSent = await withTimeout(
              client.sock.sendMessage(jid, { image: buffers[i], mimetype: "image/jpeg" }),
              SEND_TIMEOUT_MS, `Image ${i}`
            );
            if (imgSent?.key?.id) client.registerSentMsg(imgSent.key.id, { imageMessage: {} });
          } catch (imgErr) {
            console.warn(`[Slot] Image ${i} send failed for ${jid}: ${imgErr.message}`);
          }
        }
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 200));
      }
      // 2. Brief pause so album renders first
      await new Promise((r) => setTimeout(r, 1500));
      // 3. One combined text
      await withTimeout(client.sendTextMessage(jid, text), SEND_TIMEOUT_MS, "Post text");
      delivered++;
    } catch (err) {
      console.error(`[Slot ${slotTag}] Send to ${jid} failed: ${err.message}`);
    }

    // Gap between targets to avoid flood detection
    if (targetJids.indexOf(jid) < targetJids.length - 1) {
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
    }
  }

  if (!delivered) throw new Error("Post failed for every group");

  recordShared(products, slot);
  recordCollectionsShared(collections);

  console.log(`✓ [${slotTag}] ${slot.topic} | ${products.length} products | ${collections.map((c) => c.name).join(" + ")}`);
  return { sent: true, count: products.length };
}
