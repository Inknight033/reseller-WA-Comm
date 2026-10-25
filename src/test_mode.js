// Test mode — ON unless the Railway variable TEST_MODE is set to "false".
//
// While on:
//   • Group posts still go to the reseller groups (unchanged)
//   • Personalised seller picks and welcome messages go to the testers instead
//     of real sellers (a few per day), and nothing is recorded as sent
//   • The chatbot only replies to the testers
//
// Testers default to the three nudge contacts; override with TEST_PHONES
// (comma-separated, with country code, e.g. 919876543210,919812345678).

export const TEST_MODE = process.env.TEST_MODE !== "false";

// All direct messages (nudge, seller picks, welcome messages, chatbot replies)
// are OFF unless the Railway variable DMS_ENABLED is set to "true".
// Group posts and test-group reports are not affected.
export const DMS_ENABLED = process.env.DMS_ENABLED === "true";

export const TEST_PHONES = (process.env.TEST_PHONES || "919167856948,919553336937,919869446277")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

export const TEST_JIDS = TEST_PHONES.map((p) => `${p}@s.whatsapp.net`);

// Numbers allowed to receive a manual sample welcome message (/welcome/sample).
// Kept to a fixed list so the endpoint can't be used to message anyone else.
export const SAMPLE_PHONES = new Set([...TEST_PHONES, "917357969781"]);

// Testers can message from a phone-number JID or a newer @lid JID — learn both
const _testerJids = new Set(TEST_JIDS);

export async function resolveTesterJids(sock) {
  for (const phone of TEST_PHONES) {
    try {
      const [res] = await sock.onWhatsApp(phone);
      if (res?.jid) _testerJids.add(res.jid);
      if (res?.lid) _testerJids.add(res.lid);
    } catch (e) {
      console.warn(`[TestMode] Could not resolve ${phone}:`, e.message);
    }
  }
  console.log(`[TestMode] ${TEST_MODE ? "ON" : "OFF"} — testers: ${[..._testerJids].join(", ")}`);
}

export function isTester(jid) {
  return _testerJids.has(jid);
}
