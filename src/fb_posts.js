// Facebook group posts: the intro post and topic posts (2 collections + 4
// products), with every link a short link for that group (see fb_links.js).
// Building a post does not record it in the WhatsApp share history.
import { buildPost, fmt, fmtOrders, THEME_EMOJI } from "./sender.js";
import { slug } from "./config/topics.js";
import { getFbGroup } from "./config/fb_groups.js";
import { SHORT_HOST } from "./fb_links.js";

const BRIEF = "QRate by ShopDeck: 1 lakh+ products at the lowest prices for resellers. Zero investment, no stock — share with your customers, add your margin, and we deliver in your name with COD across India.";

const CONTACT = "📞 Questions? Call or WhatsApp us: 9740857732";

const CATEGORY_EMOJI = {
  "sarees": "🥻", "jewellery": "💍", "kurtas-kurtis-and-sets": "👗", "home-and-living": "🏠",
  "bags": "👜", "footwear": "👡", "lehenga-gowns-and-ethnic-dresses": "👗", "western-wear": "👚",
};

const short = (code, path) => `https://${SHORT_HOST}/${code}/${path}`;

// Cut long product names at a word, so each product fits in about 3 lines
function shortName(name, max = 60) {
  const s = name.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, s.lastIndexOf(" ", max)).replace(/[\s,(|-]+$/, "");
}

export function introText(code) {
  const s = (p) => short(code, p);
  return [
    "🛍️ Start your reselling business today — zero investment, zero stock!",
    "",
    "QRate by ShopDeck gives you 1 lakh+ products at the lowest prices for resellers — Kurtis, Sarees, Jewellery, Bags, Footwear, Home Decor & more.",
    "",
    "✅ Shipping included in the price — no hidden charges",
    "✅ COD available on every product, every pincode",
    "✅ Parcel goes to your customer with YOUR name on the label — no QRate branding",
    "✅ Add your own margin — earn on every order",
    "✅ Customer refuses delivery? You pay nothing",
    "",
    "Top categories se shuru karein:",
    `💍 Jewellery: ${s("jw")}`,
    `🥻 Sarees: ${s("sr")}`,
    `👗 Kurtis: ${s("kt")}`,
    `🏠 Home & Living: ${s("hl")}`,
    "",
    `🔍 Sab categories: ${s("all")}`,
    "",
    "📲 Download the QRate app",
    `▶️ Android: ${s("android")}`,
    `🍎 iPhone: ${s("ios")}`,
    "",
    "💬 Join our WhatsApp community for daily trending products & tips:",
    `👉 ${s("wa")}`,
    "",
    CONTACT,
  ].join("\n");
}

// Topic post for one group: { text, photos (image URLs, in list order), products }
export async function topicPost(code, topicKey, exclude) {
  const post = await buildPost(topicKey, exclude);
  if (!post) return null;
  const { topic, collections, products } = post;
  const s = (p) => short(code, p);

  const lines = [
    `${CATEGORY_EMOJI[slug(topic.category)] || "🛍️"} ${topic.label.replace(/ General$/, "")} — today's top picks for resellers on QRate`,
    "",
    BRIEF,
    "",
    "👇 Explore the full collections",
  ];
  for (const c of collections) {
    lines.push(`${THEME_EMOJI[c.theme] || "✨"} ${c.name} — ${c.products.toLocaleString("en-IN")} designs`);
    lines.push(s(`c/${c.short_id}`));
  }
  lines.push("", "━━━━━━━━━━", "");

  const NUM = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];
  products.forEach((p, i) => {
    lines.push(`${NUM[i]} ${shortName(p.product_name)}`);
    const orders = fmtOrders(p.orders_30d);
    const stats = [
      `Your price ${fmt(p.reseller_selling_price)}${p.website_price > p.reseller_selling_price ? ` (website ${fmt(p.website_price)})` : ""}`,
      p.margin >= 50 ? `💰 Earn up to ${fmt(p.margin)}` : "",
      orders ? `📦 ${orders} orders` : "",
    ].filter(Boolean).join(" · ");
    lines.push(stats);
    lines.push(s(`p/${p.customer_product_short_id}`));
    lines.push("");
  });

  lines.push(
    "✅ No shipping or return charges · COD available",
    "🏆 Quality guaranteed — no-questions-asked returns",
    "",
    `🔍 All categories: ${s("pb")}`,
    "",
    "📲 Get the QRate app",
    `▶️ Android: ${s("pa")}`,
    `🍎 iPhone: ${s("pi")}`,
    "",
    `💬 Join our WhatsApp community for daily picks: ${s("pw")}`,
    "",
    CONTACT,
  );

  return {
    text:     lines.join("\n"),
    photos:   products.map((p) => p.img_link),
    products: products.map((p) => p.customer_product_short_id),
  };
}

export function checkGroup(code) {
  const g = getFbGroup(code);
  if (!g) throw new Error(`Unknown Facebook group code: ${code}`);
  return g;
}
