// src/sync-all-members.js
// ─────────────────────────────────────────────────────────────────────────────
// Manual one-off: make sure every Discord member is in team_members so the OFG
// Hub can match/link anyone.
//
// You normally DON'T need this — the deployed bot runs the same sweep
// automatically once a day (see the "Daily member sync" block in index.js).
// This is here for when you want to run it on the spot.
//
//   node sync-all-members.js --dry   # preview, writes nothing
//   node sync-all-members.js         # add the missing members now
//
// Safe + re-runnable: only adds people not already in team_members, never
// touches placed leaders, never deletes. Uses the same .env as the bot and the
// Server Members Intent (already on).
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const { REST } = require('discord.js');
const { syncAllMembers } = require('./member-sync');

const DRY = process.argv.includes('--dry');

(async () => {
  const { DISCORD_TOKEN, GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !GUILD_ID) {
    console.error('Missing DISCORD_TOKEN or GUILD_ID in .env — this uses the same .env as the bot.');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  try {
    const r = await syncAllMembers({
      rest,
      guildId: GUILD_ID,
      dryRun: DRY,
      onProgress: (n) => console.log(`   …${n} added`),
    });

    console.log(`\nHuman members on the server:  ${r.scanned}`);
    console.log(`Already in team_members:       ${r.alreadyIn}  (left untouched)`);

    if (DRY) {
      console.log(`New members that WOULD be added:   ${r.newcomers.length}`);
      console.log(`   …auto-placed under a recruiter: ${r.placedUnderRecruiter}  (the rest come in flat)`);
      r.newcomers.slice(0, 15).forEach((m) => console.log(`   • ${m.name}  (${m.id})`));
      if (r.newcomers.length > 15) console.log(`   … and ${r.newcomers.length - 15} more.`);
      console.log('\nDRY RUN — nothing written. Re-run without --dry to add them.');
    } else {
      console.log(`Added:                         ${r.added}`);
      console.log(`   …auto-placed under recruiter: ${r.placedUnderRecruiter}  (the rest come in flat)`);
      console.log('\nDone. Now open the OFG Hub → Roster → "Sync Identities" to auto-link everyone.');
    }
  } catch (err) {
    const msg = err && (err.message || String(err));
    console.error('\nFailed:', msg);
    if (/missing access|intent|403/i.test(msg)) {
      console.error('\n→ Enable the SERVER MEMBERS INTENT:');
      console.error('  Developer Portal → your app → Bot → Privileged Gateway Intents → Save.');
    }
    process.exit(1);
  }
})();
