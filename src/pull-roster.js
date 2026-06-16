// src/pull-roster.js
// ─────────────────────────────────────────────────────────────────────────────
// Pull everyone who has ever logged a sale out of Supabase, so you don't have to
// hunt for Discord ids by hand. The bot already stored each person's real Discord
// id (user_id) and name when they logged business.
//
//   Run:  node pull-roster.js
//
// Uses the SAME .env as the bot (SUPABASE_URL / SUPABASE_KEY). It prints:
//   1. A production summary (name, id, total AP, # sales) sorted biggest first —
//      so the leaders are obvious at the top.
//   2. Paste-ready teams.js lines for everyone NOT already in teams.js, each with
//      their production in a comment so you can decide their team as you go.
//
// Then you just: paste the lines into teams.js, set each person's `upline` and
// `baseShop`, and run `node check-teams.js` to confirm.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const team = require('./teams');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

(async () => {
  // Pull all sales (paginated — Supabase caps at 1000 rows per request).
  let from = 0, page = 1000, rows = [];
  while (true) {
    const { data, error } = await supabase
      .from('sales')
      .select('user_id, username, premium, created_at')
      .order('created_at', { ascending: true })
      .range(from, from + page - 1);
    if (error) { console.error('Supabase query failed:', error.message || error); process.exit(1); }
    rows = rows.concat(data);
    if (data.length < page) break;
    from += page;
  }

  if (!rows.length) { console.log('No sales found yet — nobody to pull.'); return; }

  // Aggregate per person. Use the most recent username we've seen for them.
  const people = {};
  for (const s of rows) {
    if (!people[s.user_id]) people[s.user_id] = { id: s.user_id, name: s.username, total: 0, count: 0, last: s.created_at };
    const p = people[s.user_id];
    p.total += parseFloat(s.premium);
    p.count++;
    if (s.created_at >= p.last) { p.last = s.created_at; p.name = s.username; }
  }
  const list = Object.values(people).sort((a, b) => b.total - a.total);

  // ── Summary ──
  console.log('\nPRODUCERS WHO HAVE LOGGED BUSINESS (biggest first)');
  console.log('====================================================');
  for (const p of list) {
    const known = team.getPerson(p.id) ? '  ✓ already in teams.js' : '';
    console.log(`${money(p.total).padStart(12)}  ${String(p.count).padStart(3)} sales   ${p.name}   (${p.id})${known}`);
  }

  // ── Paste-ready lines for the unassigned ──
  const unassigned = list.filter(p => !team.getPerson(p.id));
  console.log('\n\nPASTE-READY LINES FOR teams.js (people not yet assigned)');
  console.log('=========================================================');
  if (!unassigned.length) {
    console.log('Everyone with sales is already in teams.js. Nothing to add.');
  } else {
    console.log('// Set each one\'s `upline` (who is above them) and `baseShop` (true if they');
    console.log('// have their own base shop, false if they are a producer):\n');
    for (const p of unassigned) {
      const safeName = String(p.name).replace(/'/g, "\\'");
      console.log(`  '${p.id}': { name: '${safeName}', upline: 'OVERALL_AGENCY', baseShop: false },   // ${money(p.total)} · ${p.count} sales`);
    }
  }
  console.log('');
})();
