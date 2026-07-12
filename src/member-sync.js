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
const { getTeamMembersRaw, upsertTeamMember } = require('./database');

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

// Add any server member who isn't in team_members yet. Returns a small report.
// dryRun: fetch + compare only, write nothing (report.newcomers is populated).
async function syncAllMembers({ rest, guildId, dryRun = false, onProgress = null }) {
  const members = await fetchAllMembers(rest, guildId);
  const existing = await getTeamMembersRaw();
  const existingIds = new Set(existing.map((r) => r.user_id));
  const newcomers = members.filter((m) => !existingIds.has(m.id));

  if (dryRun) {
    return { scanned: members.length, alreadyIn: members.length - newcomers.length, added: 0, newcomers };
  }

  let added = 0;
  for (const m of newcomers) {
    try {
      // Only id + name: upsertTeamMember (read-merge-write) fills upline=null,
      // base_shop=false, is_master=null for a brand-new row, and preserves the
      // fields of anyone already present. We only pass newcomers, so nothing
      // curated is ever touched.
      await upsertTeamMember({ userId: m.id, name: m.name });
      added++;
      if (onProgress && added % 50 === 0) onProgress(added);
    } catch (e) {
      console.error(`[member-sync] failed to add ${m.name} (${m.id}):`, e.message || e);
    }
  }
  return { scanned: members.length, alreadyIn: members.length - newcomers.length, added, newcomers: [] };
}

module.exports = { syncAllMembers, fetchAllMembers };
