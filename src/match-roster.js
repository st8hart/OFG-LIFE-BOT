// match-roster.js
// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME HELPER — pulls every member of your Discord server (using the bot's
// existing token) and matches them against a hand-typed roster, so you never
// have to right-click "Copy User ID" fifteen times.
//
// It prints three things:
//   1. MATCHED   — name → real Discord id (+ any ambiguous matches for you to pick)
//   2. teams.js  — a paste-ready block with real ids and the correct upline chain
//   3. SQL       — an INSERT ... ON CONFLICT for the `team_members` table
//
// Uses REST only (no gateway session), so it will NOT interfere with the bot
// while it's running. Drop it next to index.js and run:
//
//   node match-roster.js            # print everything
//   node match-roster.js --all      # also dump the FULL server roster
//
// ⚠ ONE-TIME SETUP: this needs the "Server Members Intent" toggled on.
//   Discord Developer Portal → your app → Bot → Privileged Gateway Intents →
//   enable SERVER MEMBERS INTENT → Save. (No verification needed under 100 servers.)
//   You do NOT need to change index.js — the running bot keeps its Guilds-only
//   intent and is unaffected.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const { REST, Routes } = require('discord.js');

// ── THE ROSTER ───────────────────────────────────────────────────────────────
// `key`      – internal handle used for the upline chain below
// `name`     – how they should appear on the boards
// `search`   – name to look for in Discord (edit if their Discord name differs)
// `upline`   – key of the person directly above them, or 'OVERALL_AGENCY'
// `baseShop` – true ONLY for someone with their own base shop
const ROSTER = [
  { key: 'chris',     name: 'Chris Gonzalez',    search: 'Chris Gonzalez',    upline: 'OVERALL_AGENCY', baseShop: true },

  { key: 'daylin',    name: 'Daylin Rufus',      search: 'Daylin Rufus',      upline: 'chris', baseShop: false },
  { key: 'dulce',     name: 'Dulce Carillo',     search: 'Dulce Carillo',     upline: 'chris', baseShop: false },
  { key: 'jose',      name: 'Jose Salazar',      search: 'Jose Salazar',      upline: 'chris', baseShop: false },
  { key: 'dylan',     name: 'Dylan Brito',       search: 'Dylan Brito',       upline: 'chris', baseShop: false },

  { key: 'jack',      name: 'Jack Cabrera',      search: 'Jack Cabrera',      upline: 'dylan', baseShop: false },
  { key: 'nick',      name: 'Nicholas Segreti',  search: 'Nicholas Segreti',  upline: 'dylan', baseShop: false },
  { key: 'elizabeth', name: 'Elizabeth Gangale', search: 'Elizabeth Gangale', upline: 'dylan', baseShop: false },
  { key: 'steven',    name: 'Steven Sussman',    search: 'Steven Sussman',    upline: 'dylan', baseShop: false },

  { key: 'alain',     name: 'Alain Pierre',      search: 'Alain Pierre',      upline: 'jack',  baseShop: false },

  { key: 'christina', name: 'Christina Pacheco', search: 'Christina Pacheco', upline: 'nick',  baseShop: false },
  { key: 'jackson',   name: 'Jackson Kielty',    search: 'Jackson Kielty',    upline: 'nick',  baseShop: false },
  { key: 'karissa',   name: 'Karissa Seymour',   search: 'Karissa Seymour',   upline: 'nick',  baseShop: false },
  { key: 'samuel',    name: 'Samuel Diaz',       search: 'Samuel Diaz',       upline: 'nick',  baseShop: false },
  { key: 'shakira',   name: 'Shakira Anderson',  search: 'Shakira Anderson',  upline: 'nick',  baseShop: false },
  { key: 'william',   name: 'William Andia',     search: 'William Andia',     upline: 'nick',  baseShop: false },
];

const DUMP_ALL = process.argv.includes('--all');

// ── Matching ─────────────────────────────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// Score a member against a roster name. Higher = better. 0 = no match.
function score(person, member) {
  const parts = person.search.toLowerCase().split(/\s+/).filter(Boolean);
  const first = norm(parts[0]);
  const last  = norm(parts[parts.length - 1]);
  const haystacks = [member.nick, member.globalName, member.username].map(norm).filter(Boolean);

  let best = 0;
  for (const h of haystacks) {
    if (h === first + last) { best = Math.max(best, 100); continue; }        // exact
    if (h.includes(first) && h.includes(last)) { best = Math.max(best, 80); continue; } // both names
    if (last.length >= 4 && h.includes(last)) { best = Math.max(best, 50); continue; }  // surname only
    if (first.length >= 4 && h.includes(first)) best = Math.max(best, 20);              // first only (weak)
  }
  return best;
}

// ── Fetch every member via REST (paginated, 1000 at a time) ──────────────────
async function fetchAllMembers(rest, guildId) {
  const out = [];
  let after = '0';
  for (;;) {
    const batch = await rest.get(Routes.guildMembers(guildId), { query: new URLSearchParams({ limit: '1000', after }) });
    if (!batch.length) break;
    for (const m of batch) {
      out.push({
        id: m.user.id,
        username: m.user.username,
        globalName: m.user.global_name || '',
        nick: m.nick || '',
        bot: !!m.user.bot,
        display: m.nick || m.user.global_name || m.user.username,
      });
    }
    after = batch[batch.length - 1].user.id;
    if (batch.length < 1000) break;
  }
  return out.filter(m => !m.bot);
}

(async () => {
  const { DISCORD_TOKEN, GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !GUILD_ID) {
    console.error('Missing DISCORD_TOKEN or GUILD_ID in .env — this script uses the same .env as the bot.');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  let members;
  try {
    members = await fetchAllMembers(rest, GUILD_ID);
  } catch (err) {
    const msg = err && (err.message || String(err));
    console.error('\nFailed to fetch members:', msg);
    if (/missing access|intent|403/i.test(msg)) {
      console.error('\n→ This almost always means the SERVER MEMBERS INTENT is off.');
      console.error('  Discord Developer Portal → your app → Bot → Privileged Gateway Intents');
      console.error('  → enable "Server Members Intent" → Save → re-run this script.');
    }
    process.exit(1);
  }

  console.log(`\nPulled ${members.length} human member(s) from the server.\n`);

  if (DUMP_ALL) {
    console.log('FULL SERVER ROSTER');
    console.log('==================');
    members.slice().sort((a, b) => a.display.localeCompare(b.display))
      .forEach(m => console.log(`  ${m.display.padEnd(28)} ${m.id}   (@${m.username})`));
    console.log('');
  }

  // ── Match ──
  const resolved = {};   // key -> id
  const ambiguous = [];
  const missing = [];

  console.log('ROSTER MATCH');
  console.log('============');
  for (const p of ROSTER) {
    const scored = members.map(m => ({ m, s: score(p, m) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    const top = scored[0];
    const tied = scored.filter(x => top && x.s === top.s);

    if (!top || top.s < 50) {
      missing.push(p);
      console.log(`  ✗ ${p.name.padEnd(20)} not found in the server`);
    } else if (tied.length > 1) {
      ambiguous.push({ p, tied });
      console.log(`  ? ${p.name.padEnd(20)} AMBIGUOUS — ${tied.length} possible matches:`);
      tied.forEach(x => console.log(`        ${x.m.display}  ${x.m.id}  (@${x.m.username})`));
    } else {
      resolved[p.key] = top.m.id;
      const conf = top.s >= 80 ? '' : '   (weak match — double-check)';
      console.log(`  ✓ ${p.name.padEnd(20)} ${top.m.id}   as "${top.m.display}"${conf}`);
    }
  }

  if (ambiguous.length) {
    console.log('\n⚠ Ambiguous names above were SKIPPED. Narrow the `search` field for them');
    console.log('  (e.g. use their exact Discord username) and re-run.');
  }
  if (missing.length) {
    console.log(`\nℹ ${missing.length} person/people are not in the server yet — skipped, as they should be.`);
    console.log('  Add them with /teamassign once they join. With no sales, they change no totals.');
  }

  // Resolve an upline key to a real id (or the agency node).
  const uplineIdOf = (p) => (p.upline === 'OVERALL_AGENCY' ? 'OVERALL_AGENCY' : resolved[p.upline]);

  // Only emit people we found AND whose upline we found (can't nest under an unknown id).
  const emit = ROSTER.filter(p => resolved[p.key] && uplineIdOf(p));
  const blocked = ROSTER.filter(p => resolved[p.key] && !uplineIdOf(p));
  if (blocked.length) {
    console.log('\n⚠ Skipped (their leader is not in the server yet, so there is nothing to hang them under):');
    blocked.forEach(p => console.log(`     • ${p.name} → needs ${p.upline}`));
  }

  if (!emit.length) { console.log('\nNothing to output yet.\n'); return; }

  // ── Output 1: teams.js block ──
  console.log('\n\nPASTE-READY teams.js BLOCK');
  console.log('==========================');
  console.log('  // ── CHRIS GONZALEZ BASE SHOP ──');
  for (const p of emit) {
    const up = uplineIdOf(p);
    console.log(`  '${resolved[p.key]}': { name: '${p.name.replace(/'/g, "\\'")}', upline: '${up}', baseShop: ${p.baseShop} },`);
  }
  console.log('\n  (then: node check-teams.js  →  node seed-teams.js)');

  // ── Output 2: SQL ──
  console.log('\n\nSUPABASE SQL (writes straight to team_members — skips seed-teams.js)');
  console.log('=====================================================================');
  console.log('insert into team_members (user_id, name, upline_id, base_shop, is_virtual, is_master, updated_at)');
  console.log('values');
  const rows = emit.map(p =>
    `  ('${resolved[p.key]}', '${p.name.replace(/'/g, "''")}', '${uplineIdOf(p)}', ${p.baseShop}, false, null, now())`
  );
  console.log(rows.join(',\n'));
  console.log('on conflict (user_id) do update');
  console.log('  set name = excluded.name,');
  console.log('      upline_id = excluded.upline_id,');
  console.log('      base_shop = excluded.base_shop,');
  console.log('      updated_at = now();');
  console.log('');
  console.log('-- clear anyone we just placed out of the pending queue:');
  console.log(`delete from unassigned_producers where user_id in (${emit.map(p => `'${resolved[p.key]}'`).join(', ')});`);
  console.log('');
})();
