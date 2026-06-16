// src/check-teams.js
// ─────────────────────────────────────────────────────────────────────────────
// Verify your team setup WITHOUT running the bot. Reads teams.js only — no
// Discord token, no Supabase, no sales data needed.
//
//   Run:  node check-teams.js
//
// It prints the org chart the way the bot reads it, shows what each board will
// list, and warns about anything that isn't ready (placeholder ids, typos in an
// upline, loops). When there are no warnings and the tree matches your real
// org, you're good to deploy.
// ─────────────────────────────────────────────────────────────────────────────

const team = require('./teams');
const TEAM = team.TEAM;

const isRealId = (id) => /^\d{15,20}$/.test(id);          // a real Discord id
const warnings = [];

// ── Structural validation ────────────────────────────────────────────────────
const ids = Object.keys(TEAM);

// 1) placeholder ids still in place
for (const id of ids) {
  if (TEAM[id].virtual) continue;            // grouping nodes (e.g. OVERALL_AGENCY) are fine
  if (!isRealId(id)) warnings.push(`"${TEAM[id].name}" still has a placeholder id (${id}). Replace it with their real Discord user id.`);
}

// 2) uplines that point at someone who doesn't exist
for (const id of ids) {
  const up = TEAM[id].upline;
  if (up !== null && !TEAM[up]) warnings.push(`"${TEAM[id].name}" has upline "${up}", but no one with that id exists in the file (typo?).`);
}

// 3) loops in the chain
for (const id of ids) {
  let cur = id, seen = new Set();
  while (cur && TEAM[cur]) {
    if (seen.has(cur)) { warnings.push(`Loop detected in the upline chain around "${TEAM[id].name}". An upline points back into itself.`); break; }
    seen.add(cur); cur = TEAM[cur].upline;
  }
}

// ── Build the tree ───────────────────────────────────────────────────────────
const childrenOf = (parent) => ids.filter(id => TEAM[id].upline === parent);

function roleTags(id) {
  const tags = [];
  if (TEAM[id].virtual) tags.push('grouping node');
  if (team.masterLeaders().includes(id)) tags.push('Master Agency');
  if (team.isBaseShopLeader(id)) tags.push('Base Shop');
  if (!TEAM[id].virtual && !team.isBaseShopLeader(id)) tags.push('Producer');
  return tags.join(' · ');
}

function printNode(id, prefix, isLast, isRoot) {
  const branch = isRoot ? '' : (isLast ? '└─ ' : '├─ ');
  const flag = (!TEAM[id].virtual && !isRealId(id)) ? '   ⚠ id not set' : '';
  console.log(`${prefix}${branch}${TEAM[id].name}   [${roleTags(id)}]${flag}`);
  const kids = childrenOf(id);
  const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
  kids.forEach((k, i) => printNode(k, childPrefix, i === kids.length - 1, false));
}

console.log('\nOFG TEAM STRUCTURE — as the bot reads teams.js');
console.log('================================================\n');
const roots = ids.filter(id => TEAM[id].upline === null);
roots.forEach((r, i) => printNode(r, '', i === roots.length - 1, true));

// ── Board previews ───────────────────────────────────────────────────────────
console.log('\n🏛️  MASTER AGENCY board will list:');
team.masterLeaders().forEach(id => console.log(`     • ${TEAM[id].name}`));

console.log('\n🏪  BASE SHOP board will list:');
team.baseShopLeaders().forEach(id => {
  const members = ids.filter(m => team.getBaseShopOwner(m) === id && m !== id && !TEAM[m].virtual)
                     .map(m => TEAM[m].name);
  const extra = members.length ? `  (+ ${members.join(', ')})` : '';
  console.log(`     • ${TEAM[id].name}${extra}`);
});

// ── Result ───────────────────────────────────────────────────────────────────
console.log('\n------------------------------------------------');
if (warnings.length === 0) {
  console.log('✅ No problems found. If the tree above matches your real org, you are ready to deploy.');
} else {
  console.log(`⚠ ${warnings.length} thing(s) to fix before the boards will track real production:\n`);
  warnings.forEach(w => console.log(`   • ${w}`));
  console.log('\n(Placeholder warnings are expected until you paste in real Discord ids.)');
}
console.log('');
