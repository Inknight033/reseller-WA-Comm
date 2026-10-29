// Post category → website sub-categories it can draw from.
// Keys are "Category › Sub-category" from the website category mapping
// (Metabase question METABASE_CATEGORY_QUESTION_ID, built on
// csv_upload.reseller_website_category_mapping generated_l1 / generated_l2).
// Names must match the mapping exactly — check them in Metabase before adding one.
const sub = (category, ...subs) => subs.map((s) => `${category} › ${s}`);

export const CATEGORY_TYPES = {
  // ── Jewellery ────────────────────────────────────────────────────────────────
  mangalsutra: sub("Jewellery", "Mangalsutras", "Mangalsutra Sets"),
  necklace: sub("Jewellery",
    "Necklace Sets", "Necklaces", "Chains", "Pendant Sets", "Pendants", "Jewellery Combo Sets"),
  earring: sub("Jewellery", "Earrings"),
  bangle: sub("Jewellery",
    "Bangles & Bracelets", "Rings", "Anklets", "Hair Accessories", "Kamarbands"),

  // ── Ethnic wear (unstitched fabric and blouses left out) ────────────────────
  kurti: sub("Kurtas, Kurtis & Sets",
    "Kurta Pant & Dupatta Sets", "Kurta Sets - General", "Printed Kurtis", "Chikankari Kurtis",
    "Kurtis - General/Other", "Kurta Palazzo Sets", "Chikankari Kurta Sets"),
  saree: sub("Sarees",
    "Silk Sarees", "Cotton Sarees", "Sarees - General/Other", "Linen Sarees",
    "Banarasi Sarees", "Printed Sarees", "Handloom Sarees"),

  // ── Western wear (not scheduled; see SLOT_COUNTS) ───────────────────────────
  coord: sub("Western Wear", "Coord Sets"),

  // ── Bags (backpacks, wallets, luggage and "Other Bags" left out) ────────────
  handbag: sub("Bags", "Handbags", "Sling Bags", "Tote Bags", "Potli Bags", "Clutches"),

  // ── Footwear (shoes & sneakers left out) ────────────────────────────────────
  slipper: sub("Footwear", "Slippers", "Heels"),

  // ── Watches ─────────────────────────────────────────────────────────────────
  watch: sub("Watches & Wearables", "Fashion Watches"),
};

// Header label when a post's products have no sub-category name
export const SLOT_LABELS = {
  mangalsutra: "Mangalsutras",
  necklace:    "Necklaces",
  bangle:      "Bangles & Rings",
  earring:     "Earrings",
  coord:       "Co-ord Sets",
  handbag:     "Handbags",
  kurti:       "Kurtis",
  saree:       "Sarees",
  watch:       "Watches",
  slipper:     "Slippers",
};
