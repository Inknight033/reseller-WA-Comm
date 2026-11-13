import express from "express";
import QRCode from "qrcode";
import fs from "fs";
import client from "./client/whatsapp.js";
import { sendSlot, buildPost, TARGET_JIDS } from "./sender.js";
import { getTopic, allTopics } from "./config/topics.js";
import { nowIST, getOrCreatePlan, previewPlans } from "./slot_planner.js";
import { getStockReport } from "./ranking.js";
import { runResellerPlanner, loadTodayPlan } from "./reseller_planner.js";
import { sendDailyResellerCampaign, previewResellerSend } from "./reseller_sender.js";
import { sendWelcomeSample } from "./community.js";
import { SAMPLE_PHONES } from "./test_mode.js";
import { registerFbLinks, clickSummary, fbTarget } from "./fb_links.js";
import { introText, topicPost, checkGroup } from "./fb_posts.js";
import { windowsFor, getSlot, loadSlot } from "./fb_planner.js";

const PORT = process.env.PORT || 3000;

export function startQRServer() {
  const app = express();

  // Facebook short links (only thing served on the short host)
  registerFbLinks(app);

  // Health check (Railway uses this)
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // QR page — open this in browser to scan on first connect
  app.get("/qr", async (_req, res) => {
    if (client.isReady) {
      return res.send(`
        <html><body style="font-family:sans-serif;padding:40px;text-align:center">
          <h2 style="color:green">✓ WhatsApp is connected</h2>
          <p>No QR needed — broadcaster is running.</p>
        </body></html>
      `);
    }

    if (!client.latestQR) {
      return res.send(`
        <html><body style="font-family:sans-serif;padding:40px;text-align:center">
          <h2>Waiting for QR code…</h2>
          <p>Refresh in a few seconds.</p>
          <script>setTimeout(() => location.reload(), 3000)</script>
        </body></html>
      `);
    }

    try {
      const qrDataUrl = await QRCode.toDataURL(client.latestQR, { scale: 8 });
      res.send(`
        <html><body style="font-family:sans-serif;padding:40px;text-align:center">
          <h2>Scan this QR with WhatsApp</h2>
          <p>WhatsApp → Linked Devices → Link a Device</p>
          <img src="${qrDataUrl}" style="max-width:320px;border:1px solid #eee;border-radius:8px"/>
          <p style="color:#888;font-size:14px">Refreshes automatically once connected.</p>
          <script>setTimeout(() => location.reload(), 30000)</script>
        </body></html>
      `);
    } catch {
      res.status(500).send("Failed to render QR");
    }
  });

  // Debug — dump all groups/communities with key fields
  app.get("/debug/groups", async (_req, res) => {
    if (!client.isReady) return res.status(503).json({ error: "WhatsApp not connected" });
    const groups = await client.sock.groupFetchAllParticipating();
    const summary = Object.values(groups).map((g) => ({
      id:           g.id,
      subject:      g.subject,
      linkedParent: g.linkedParent || null,
      isParent:     g.isParent     || null,
      isCommunity:  g.isCommunity  || null,
    }));
    res.json(summary);
  });

  // Manual trigger — post one topic to both groups right now
  // Usage: /trigger?topic=jewellery/bangles-and-bracelets  (no topic → lists them)
  // Doesn't change today's plan.
  app.get("/trigger", async (req, res) => {
    if (!client.isReady) return res.status(503).json({ error: "WhatsApp not connected" });

    const { topic } = req.query;
    if (!topic || !getTopic(topic)) {
      return res.status(400).json({ error: "Pass ?topic=<one of the topics>", topics: allTopics().map((t) => t.key) });
    }

    // Optional ?group=N (1-based) sends a test post to that group only
    const onlyGroup = req.query.group ? Number(req.query.group) : undefined;
    if (onlyGroup !== undefined && !TARGET_JIDS[onlyGroup - 1]) {
      return res.status(400).json({ error: `group must be 1–${TARGET_JIDS.length}` });
    }

    const { minutes } = nowIST();
    const slot = { hour: Math.floor(minutes / 60), minute: minutes % 60, topic };
    res.json({ message: `Firing: ${getTopic(topic).label}${onlyGroup ? ` (group ${onlyGroup} only)` : ""}` });
    sendSlot(slot, { onlyGroup }).catch((e) => console.error("[/trigger]", e));
  });

  // Send a sample welcome message to an allow-listed number
  // Usage: /welcome/sample?phone=917357969781
  app.get("/welcome/sample", async (req, res) => {
    if (!client.isReady) return res.status(503).json({ error: "WhatsApp not connected" });
    const phone = String(req.query.phone || "").replace(/\D/g, "");
    if (!SAMPLE_PHONES.has(phone)) return res.status(403).json({ error: "Number not on the sample list" });
    try {
      await sendWelcomeSample(phone);
      res.json({ message: `Sample welcome sent to ${phone}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Group broadcast plan ────────────────────────────────────────────────────

  // Today's random plan and what has been sent so far
  app.get("/slots/today", (_req, res) => {
    res.json(getOrCreatePlan(nowIST().date));
  });

  // Sample plans for the next few days, starting today — nothing is saved or sent
  // Usage: /slots/preview?days=4
  app.get("/slots/preview", (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 4, 31);
    res.json(Object.fromEntries(previewPlans(nowIST().date, days).map((p) =>
      [p.date, p.slots.map((s) => `${s.time} ${s.label}${s.tier === "discovery" ? " (discovery)" : ""}`)]
    )));
  });

  // What a topic's next post would look like — nothing is sent
  // Usage: /post/preview?topic=jewellery/bangles-and-bracelets
  app.get("/post/preview", async (req, res) => {
    const { topic } = req.query;
    if (!topic || !getTopic(topic)) {
      return res.status(400).json({ error: "Pass ?topic=<one of the topics>", topics: allTopics().map((t) => t.key) });
    }
    try {
      const built = await buildPost(topic);
      if (!built) return res.status(404).json({ error: "No eligible products" });
      res.type("text/plain").send(built.text);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // How many fresh products each topic has left, and how many days that covers
  app.get("/stock", async (_req, res) => {
    try {
      res.json(await getStockReport());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Acquired reseller endpoints ─────────────────────────────────────────────

  // Run (or view) today's reseller plan.
  // GET /reseller/plan          → returns cached plan if it exists
  // GET /reseller/plan?force=1  → regenerates even if plan exists today
  app.get("/reseller/plan", async (req, res) => {
    const existing = loadTodayPlan();
    if (existing && !req.query.force) {
      return res.json({ cached: true, resellers: existing.length, plan: existing });
    }
    res.json({ message: "Planning run started — check logs. Reload this URL in ~30s to see the plan." });
    runResellerPlanner().catch(e => console.error("[/reseller/plan]", e.message));
  });

  // Fire today's reseller send campaign immediately.
  // GET /reseller/send — generates plan if missing, then sends to all resellers
  app.get("/reseller/send", async (req, res) => {
    if (!client.isReady) return res.status(503).json({ error: "WhatsApp not connected" });
    res.json({ message: "Reseller campaign started — check Railway logs" });
    sendDailyResellerCampaign().catch(e => console.error("[/reseller/send]", e.message));
  });

  // Prevent double-fire on quick reloads (e.g. browser retry)
  let previewInFlight = false;

  // Preview: run plan for one reseller and send to Arunabh's test number.
  // GET /reseller/preview                     → uses first reseller in today's plan
  // GET /reseller/preview?phone=919039123954  → finds that reseller in the plan
  // Products are NOT recorded in reseller history (safe to call multiple times).
  app.get("/reseller/preview", async (req, res) => {
    if (!client.isReady) return res.status(503).json({ error: "WhatsApp not connected" });
    if (previewInFlight) return res.status(429).json({ error: "Preview already in progress — wait a minute" });

    const testPhone = process.env.PREVIEW_TEST_PHONE || "";
    if (!testPhone) return res.status(400).json({ error: "Set PREVIEW_TEST_PHONE env var (e.g. 919869446277) to enable preview sends" });
    const TEST_JID = `${testPhone}@s.whatsapp.net`;

    let plan = loadTodayPlan();
    if (!plan?.length) {
      // Auto-generate if missing
      plan = await runResellerPlanner().catch(() => null);
    }
    if (!plan?.length) {
      return res.status(404).json({ error: "No plan available — try /reseller/plan first" });
    }

    const phone    = req.query.phone;
    const reseller = phone
      ? plan.find(r => r.phone.includes(String(phone).replace(/\.0$/, ""))) ?? plan[0]
      : plan[0];

    res.json({
      message:   `Sending ${reseller.reseller_name}'s picks to test number`,
      reseller:  reseller.reseller_name,
      phone:     reseller.phone,
      products:  reseller.products.length,
      test_jid:  TEST_JID,
    });

    previewInFlight = true;
    previewResellerSend(reseller, TEST_JID)
      .catch(e => console.error("[/reseller/preview]", e.message))
      .finally(() => { previewInFlight = false; });
  });

  // Nuclear reset — clears ALL auth (including creds.json) and forces a fresh QR scan.
  // Use only if DMs are still broken after a normal deploy.
  // After hitting this URL, visit /qr within 60 seconds and scan with the bot's phone.
  app.get("/reset", (_req, res) => {
    const AUTH_DIR = process.env.DATA_DIR
      ? `${process.env.DATA_DIR}/auth`
      : (process.env.AUTH_DIR || "auth");
    try {
      const files = fs.readdirSync(AUTH_DIR);
      for (const f of files) fs.unlinkSync(`${AUTH_DIR}/${f}`);
      console.log(`[Reset] Cleared all ${files.length} auth files — QR rescan required`);
    } catch (e) {
      console.warn("[Reset] Failed:", e.message);
    }
    // Force reconnect — will generate a new QR
    client.isReady = false;
    try { client.sock?.ws?.close(); } catch {}
    res.send(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2 style="color:orange">⚠️ Auth cleared</h2>
        <p>Visit <a href="/qr">/qr</a> in 5 seconds and scan with the bot's WhatsApp phone.</p>
        <script>setTimeout(() => location.href='/qr', 5000)</script>
      </body></html>
    `);
  });

  // Facebook short-link clicks per group and link
  app.get("/fb/clicks", (_req, res) => res.json(clickSummary()));

  // Facebook post for a group: /fb/post?g=f1 (intro) or /fb/post?g=f3&topic=sarees/cotton-sarees
  app.get("/fb/post", async (req, res) => {
    try {
      checkGroup(req.query.g);
      if (!req.query.topic) return res.json({ kind: "intro", text: introText(req.query.g), video: "assets/intro.mp4" });
      if (!getTopic(req.query.topic)) return res.status(400).json({ error: `Unknown topic: ${req.query.topic}` });
      const post = await topicPost(req.query.g, req.query.topic);
      if (!post) return res.status(404).json({ error: "No products for this topic" });
      res.json({ kind: "topic", ...post });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Facebook day plan: /fb/plan?date=2026-11-13 lists the windows and, for
  // windows already built, each group's time and topic
  app.get("/fb/plan", (req, res) => {
    const date = req.query.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return res.status(400).json({ error: "date=YYYY-MM-DD required" });
    res.json(windowsFor(date).map((w) => {
      const plan = loadSlot(date, w.slot);
      return { ...w, built: !!plan, posts: plan?.posts.map(({ g, group, time, topic }) => ({ g, group, time, topic })) };
    }));
  });

  // One window's posts, built on first request: /fb/plan/slot?date=2026-11-13&slot=p1
  app.get("/fb/plan/slot", async (req, res) => {
    try {
      res.json(await getSlot(req.query.date, req.query.slot));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Record posts made outside the planner (e.g. by hand) so later plans avoid
  // their topics and products. Body: { date, slot, posts: [{ g, topic, products }] }
  app.post("/fb/plan/import", express.json({ limit: "1mb" }), (req, res) => {
    const { date, slot, posts } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^[a-z0-9]+$/.test(slot || "") || !Array.isArray(posts)) {
      return res.status(400).json({ error: "date, slot and posts required" });
    }
    if (loadSlot(date, slot)) return res.status(409).json({ error: "already exists" });
    const dir = `${process.env.DATA_DIR || "data"}/fb_plans`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${date}_${slot}.json`, JSON.stringify({ date, slot, kind: "imported", posts }, null, 2));
    res.json({ ok: true, posts: posts.length });
  });

  // Where a short link goes: /fb/link?g=f1&l=jw
  app.get("/fb/link", (req, res) => {
    const url = fbTarget(req.query.g, req.query.l);
    if (!url) return res.status(404).send("Unknown group or link");
    res.type("text/plain").send(url);
  });

  // Root redirects to /qr
  app.get("/", (_req, res) => res.redirect("/qr"));

  app.listen(PORT, () => {
    console.log(`QR server → http://localhost:${PORT}/qr`);
  });
}
