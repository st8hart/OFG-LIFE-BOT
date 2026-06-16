// src/seed-teams.js
// ─────────────────────────────────────────────────────────────────────────────
// One-time (re-runnable) bulk load: pushes everything in teams.js into the
// Supabase `team_members` table, which is what the bot reads at runtime.
//
// Use this for your initial setup after filling in teams.js (with help from
// `node pull-roster.js`). After this, you can tweak individuals from Discord
// with /teamassign, /teamremove — no need to touch the file again.
//
//   node seed-teams.js           (safe: refuses to run if placeholder ids remain)
//   node seed-teams.js --force   (seed anyway, including placeholders)
//
// Re-running is safe — it upserts (updates existing rows, adds new ones). It does
// NOT delete people who are only in the table (e.g. added via /teamassign).
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const { TEAM } = require('./teams');
const { upsertTeamMember } = require('./database');

const FORCE = process.argv.includes('--force');
const isRealId = (id) => /^\d{15,20}$/.test(id);

(async () => {
  const ids = Object.keys(TEAM);
  const placeholders = ids.filter(id => !TEAM[id].virtual && !isRealId(id));

  if (placeholders.length && !FORCE) {
    console.error(`Refusing to seed — ${placeholders.length} entr(ies) still have placeholder ids:`);
    placeholders.forEach(id => console.error(`   • ${TEAM[id].name} (${id})`));
    console.error('\nReplace those with real Discord ids in teams.js (try `node pull-roster.js`),');
    console.error('then run again. To seed anyway: node seed-teams.js --force');
    process.exit(1);
  }

  console.log(`Seeding ${ids.length} entr(ies) into team_members...`);
  for (const id of ids) {
    const p = TEAM[id];
    await upsertTeamMember({
      userId: id,
      name: p.name,
      uplineId: p.upline == null ? null : p.upline,
      baseShop: !!p.baseShop,
      isVirtual: !!p.virtual,
      isMaster: (p.master === undefined ? null : p.master),
    });
    console.log(`  ✓ ${p.name}`);
  }
  console.log('\nDone. Verify in Discord with /teamsetup (or re-run node check-teams.js for the file).');
})();
