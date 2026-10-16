import cron from "node-cron";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { MIN_GAP_MINUTES, MAX_LATE_MINUTES } from "./config/schedule.js";
import { sendSlot } from "./sender.js";
import { nowIST, getOrCreatePlan, savePlan, planSummary } from "./slot_planner.js";
import { TEST_GROUP_JID } from "./pending_changes.js";
import { runDailyLearning } from "./learning.js";
import { checkOrders } from "./orders.js";
import { startNudgeCampaign } from "./nudge.js";
import { warmCache } from "./cache.js";
import { sendYesterdayReport, sendTodayReport, processWelcomeQueue, pollCommunityMembers } from "./community.js";
import { seedConvo } from "./bot.js";
import { runResellerPlanner } from "./reseller_planner.js";
import { sendDailyResellerCampaign, isResellerCampaignRunning } from "./reseller_sender.js";
import client from "./client/whatsapp.js";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Group broadcast tick ──────────────────────────────────────────────────────
// Runs every minute. Sends at most one due slot from today's plan, never within
// MIN_GAP_MINUTES of the previous send, and skips anything over MAX_LATE_MINUTES late.
let ticking = false;

async function slotTick() {
  if (ticking) return;
  ticking = true;
  try {
    const { date, minutes } = nowIST();
    if (minutes < 6 * 60) return; // plan + summary go out from 6am
    const plan = getOrCreatePlan(date);
    if (!client.isReady) return;

    if (!plan.summary_sent) {
      // Best effort — a failed summary (e.g. bot not in the test group) must never block posts
      try {
        await client.sendTextMessage(TEST_GROUP_JID, planSummary(plan));
      } catch (err) {
        console.warn("[Scheduler] Plan summary not sent to test group:", err.message);
      }
      plan.summary_sent = true;
      savePlan(plan);
    }

    // Don't overlap with the personalised reseller sends
    if (isResellerCampaignRunning()) return;

    let changed = false;
    for (const s of plan.slots) {
      if (s.status === "pending" && minutes - s.minutes > MAX_LATE_MINUTES) {
        s.status = "missed";
        changed = true;
        console.log(`[Scheduler] ${s.time} ${s.category} missed (bot was not ready in time)`);
      }
    }

    const next = plan.slots.find((s) => s.status === "pending" && s.minutes <= minutes);
    const sinceLast = plan.last_sent_at ? Date.now() - new Date(plan.last_sent_at).getTime() : Infinity;

    if (next && sinceLast >= MIN_GAP_MINUTES * 60 * 1000) {
      console.log(`[Scheduler] ${date} ${next.time} → ${next.category}`);
      // Mark before sending — if the process dies mid-send, the slot is never re-sent
      next.status = "sending";
      next.started_at = new Date().toISOString();
      savePlan(plan);
      try {
        const result = await sendSlot({
          hour:     Math.floor(next.minutes / 60),
          minute:   next.minutes % 60,
          category: next.category,
        });
        next.status   = result.sent ? "sent" : "skipped";
        next.products = result.count;
        if (result.sent) plan.last_sent_at = new Date().toISOString();
      } catch (err) {
        next.status = "failed";
        next.error  = err.message;
        console.error(`[Scheduler] Slot ${next.time} failed:`, err.message);
      }
      changed = true;
    }

    if (changed) savePlan(plan);
  } catch (err) {
    console.error("[Scheduler] Tick failed:", err.message);
  } finally {
    ticking = false;
  }
}

export function startScheduler() {
  // Every minute, 6:00am–8:59pm IST. The first tick of the day builds the plan
  // and sends it to the test group; later ticks fire slots as they come due.
  cron.schedule("* 6-20 * * *", slotTick, { timezone: "Asia/Kolkata" });
  slotTick();

  // Daily cache refresh — 5:45am IST (fresh data before first slot)
  cron.schedule(
    "45 5 * * *",
    () => warmCache().catch(e => console.error("[cache] Daily refresh failed:", e.message)),
    { timezone: "Asia/Kolkata" }
  );

  // Daily learning — 8:45am IST (before 9am slots fire)
  cron.schedule(
    "45 8 * * *",
    async () => {
      try {
        await runDailyLearning(client);
      } catch (err) {
        console.error("[Learning] Daily run failed:", err.message);
      }
    },
    { timezone: "Asia/Kolkata" }
  );

  // Order polling — every 5 minutes during business hours (8am–11pm IST)
  cron.schedule(
    "*/5 8-23 * * *",
    async () => {
      try { await checkOrders(); }
      catch (err) { console.error("[Orders] Poll failed:", err.message); }
    },
    { timezone: "Asia/Kolkata" }
  );

  // ── Community member reports ───────────────────────────────────────────────

  // 8:30am IST — yesterday's final joiner/leaver count
  cron.schedule("30 8 * * *",
    () => sendYesterdayReport().catch(e => console.error("[Community] Yesterday report failed:", e.message)),
    { timezone: "Asia/Kolkata" }
  );

  // 3pm, 6pm, 9pm IST — today's running count
  for (const hour of [15, 18, 21]) {
    cron.schedule(`0 ${hour} * * *`,
      () => sendTodayReport().catch(e => console.error("[Community] Today report failed:", e.message)),
      { timezone: "Asia/Kolkata" }
    );
  }

  // Every 30 min during business hours — poll member lists, then send welcome DMs
  cron.schedule("*/30 9-19 * * *",
    async () => {
      await pollCommunityMembers().catch(e => console.error("[Community] Poll failed:", e.message));
      await processWelcomeQueue(seedConvo).catch(e => console.error("[Community] Welcome queue failed:", e.message));
    },
    { timezone: "Asia/Kolkata" }
  );

  // ── Daily nudge campaign ───────────────────────────────────────────────────

  // Daily nudge campaign — ~11am IST (randomised)
  // Last nudge date is saved to disk so a restart/redeploy doesn't re-send it the same day
  const NUDGE_STATE = join(process.env.DATA_DIR || "data", "nudge_state.json");

  async function runNudge() {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    let lastDate = null;
    try { lastDate = JSON.parse(readFileSync(NUDGE_STATE, "utf8")).date; } catch {}
    if (lastDate === today) return;
    mkdirSync(dirname(NUDGE_STATE), { recursive: true });
    writeFileSync(NUDGE_STATE, JSON.stringify({ date: today }));
    try {
      await startNudgeCampaign(seedConvo);
    } catch (err) {
      console.error("[Nudge] Campaign failed:", err.message);
    }
  }

  // Fires at a random minute between 10:50 and 11:00am IST
  cron.schedule("50 10 * * *",
    async () => { await sleep(Math.random() * 10 * 60 * 1000); await runNudge(); },
    { timezone: "Asia/Kolkata" }
  );

  // On startup, catch up only if the bot was down during this morning's nudge window
  // (11am–1pm IST). Outside that, wait for the next scheduled run.
  setTimeout(() => {
    const { minutes } = nowIST();
    if (minutes >= 11 * 60 && minutes < 13 * 60) runNudge();
  }, 5000);

  // ── Acquired reseller personalised sends ──────────────────────────────────

  // 6:30am IST — build today's per-reseller product plan (fresh catalog + 60d activity)
  cron.schedule("30 6 * * *",
    async () => {
      try { await runResellerPlanner(); }
      catch (err) { console.error("[ResellerPlanner] Daily run failed:", err.message); }
    },
    { timezone: "Asia/Kolkata" }
  );

  // Random minute between 11:10 and 11:20am IST — personalised recommendations
  // to each acquired reseller. Starts after the nudge to avoid concurrent WA sends;
  // group posts wait while this runs.
  cron.schedule("10 11 * * *",
    async () => {
      await sleep(Math.random() * 10 * 60 * 1000);
      if (!client.isReady) return;
      try { await sendDailyResellerCampaign(); }
      catch (err) { console.error("[ResellerSender] Campaign failed:", err.message); }
    },
    { timezone: "Asia/Kolkata" }
  );

  console.log("Scheduler started — group posts follow today's random plan (see /slots/today)");
}
