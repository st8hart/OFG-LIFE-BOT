// src/member-sync.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared logic that makes sure EVERY human Discord member exists in the
// `team_members` table, so the OFG Hub can match/link anyone — not just people
// who've written business. Used by BOTH:
//   • the automatic daily sweep inside the deployed bot (index.js), and
//   • the manual one-off command (sync-all-members.js).
//
// SAFE BY DESIGN
//   • Only ADDS people who aren't in team_members yet. Anyone already placed
//     (a leader with an upline / base shop / master flag) is left 100% untouched.
//   • New people come in "flat" (no upline, not a base shop) — which changes NO
//     leaderboard; they only roll up once /teamassign gives them an upline. They
//     just now EXIST as a linkable identity the hub can attach an account to.
//   • Never deletes anyone.
//
// Fetches members over REST (no gateway session), so it never interferes with
// the running bot. Needs the "Server Members Intent" (already enabled).
// ─────────────────────────────────────────────────────────────────────────────

const { Routes } = require('discord.js');
const { getTeamMembersRaw, upsertTeamMember, getAllHiresForUpline } = require('./database');

// Normalize a name for matching: drop a trailing state/location tag ("Rob - FL",
// "Tara (Texas)"), diacritics, and punctuation. Mirrors the hub's matcher so the
// two systems agree on who's who.
function normName(raw) {
  let n = String(raw || '').trim();
  if (!n) return '';
  const tagged = n.replace(/[\s]*[-–—][\s]*[A-Za-z]{2}$|[\s]*\([A-Za-z ]{2,}\)$/g, '');
  if (tagged.trim().split(/\s+/).length >= 2) n = tagged;
  return n
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Every human member, paginated (1000 at a time).
async function fetchAllMembers(rest, guildId) {
  const out = [];
  let after = '0';
  for (;;) {
    const batch = await rest.get(Routes.guildMembers(guildId), {
      query: new URLSearchParams({ limit: '1000', after }),
    });
    if (!batch.length) break;
    for (const m of batch) {
      if (m.user.bot) continue;
      out.push({
        id: m.user.id,
        // Best name for hub matching: server nickname → global name → username.
        name: m.nick || m.user.global_name || m.user.username,
      });
    }
    after = batch[batch.length - 1].user.id;
    if (batch.length < 1000) break;
  }
  return out;
}

// Add any server member who isn't in team_members yet, and — when we're CERTAIN
// who they are — place them under whoever recruited them. Returns a small report.
// dryRun: fetch + compare only, write nothing (report.newcomers is populated).
async function syncAllMembers({ rest, guildId, dryRun = false, onProgress = null }) {
  const members = await fetchAllMembers(rest, guildId);
  const existing = await getTeamMembersRaw();
  const existingIds = new Set(existing.map((r) => r.user_id));
  const teamMemberIds = new Set(existing.map((r) => r.user_id)); // a recruiter must be a real node
  const newcomers = members.filter((m) => !existingIds.has(m.id));

  // ── Confident upline from recruiting ──────────────────────────────────────
  // Auto-place a newcomer under their recruiter ONLY when it's unambiguous on
  // BOTH sides: their name maps to exactly one recruiter in the hires data AND
  // exactly one server member carries that name. Anything unsure (a duplicate
  // name like the six "Rob Super"s, or no clear hire) stays FLAT — no upline —
  // for a human to confirm. A wrong upline poisons the tree worse than a blank.
  const hires = await getAllHiresForUpline();
  const recruitersByName = new Map(); // normName -> Set(recruiter_id)
  for (const h of hires) {
    const nn = normName(h.recruit_name);
    if (!nn || !h.recruiter_id) continue;
    if (!recruitersByName.has(nn)) recruitersByName.set(nn, new Set());
    recruitersByName.get(nn).add(h.recruiter_id);
  }
  const memberNameCount = new Map(); // normName -> how many members carry it
  for (const m of members) {
    const nn = normName(m.name);
    if (nn) memberNameCount.set(nn, (memberNameCount.get(nn) || 0) + 1);
  }
  const confidentUpline = (name) => {
    const nn = normName(name);
    if (!nn) return null;
    if ((memberNameCount.get(nn) || 0) !== 1) return null;   // duplicate member name → unsure
    const recs = recruitersByName.get(nn);
    if (!recs || recs.size !== 1) return null;               // zero or many recruiters → unsure
    const recruiterId = [...recs][0];
    if (!teamMemberIds.has(recruiterId)) return null;        // recruiter isn't a real node → unsure
    return recruiterId;
  };

  if (dryRun) {
    const placeable = newcomers.filter((m) => confidentUpline(m.name)).length;
    return {
      scanned: members.length,
      alreadyIn: members.length - newcomers.length,
      added: 0,
      placedUnderRecruiter: placeable,
      newcomers,
    };
  }

  let added = 0;
  let placed = 0;
  for (const m of newcomers) {
    try {
      const uplineId = confidentUpline(m.name);
      // Only id + name (+ uplineId when certain): upsertTeamMember is
      // read-merge-write, so a new row gets base_shop=false / is_master=null and
      // anyone already present is preserved. We only pass newcomers, so nothing
      // curated is ever touched; the upline is set only on a confident match.
      await upsertTeamMember(uplineId ? { userId: m.id, name: m.name, uplineId } : { userId: m.id, name: m.name });
      added++;
      if (uplineId) placed++;
      if (onProgress && added % 50 === 0) onProgress(added);
    } catch (e) {
      console.error(`[member-sync] failed to add ${m.name} (${m.id}):`, e.message || e);
    }
  }
  return {
    scanned: members.length,
    alreadyIn: members.length - newcomers.length,
    added,
    placedUnderRecruiter: placed,
    newcomers: [],
  };
}

module.exports = { syncAllMembers, fetchAllMembers };
