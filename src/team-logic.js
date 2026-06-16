// src/team-logic.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure hierarchy math. Works on any map of the shape:
//   { '<id>': { name, upline, baseShop, master?, virtual? }, ... }
// Used by both the file-based config (teams.js / check-teams.js) and the live
// Supabase-backed tree (database.getTeamTree). One copy of the rules, no drift.
// ─────────────────────────────────────────────────────────────────────────────

function createTree(map) {
  const safe = map || {};

  const getPerson = (id) => safe[id] || null;

  const isBaseShopLeader = (id) => {
    const p = safe[id];
    if (!p || p.virtual) return false;
    return p.baseShop === true;
  };

  const isAncestor = (ancestorId, personId) => {
    let cur = personId;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      if (cur === ancestorId) return true;
      seen.add(cur);
      const p = safe[cur];
      if (!p) break;
      cur = p.upline;
    }
    return false;
  };

  const getBaseShopOwner = (id) => {
    let cur = id;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (isBaseShopLeader(cur)) return cur;
      const p = safe[cur];
      if (!p) return null;
      cur = p.upline;
    }
    return null;
  };

  const baseShopLeaders = () => Object.keys(safe).filter(isBaseShopLeader);

  const hasSubTeam = (id) => baseShopLeaders().some(o => o !== id && isAncestor(id, o));

  const masterLeaders = () => {
    const set = new Set();
    for (const id of Object.keys(safe)) if (safe[id].master === true) set.add(id);
    for (const id of baseShopLeaders()) {
      if (safe[id].master === false) continue;
      if (hasSubTeam(id)) set.add(id);
    }
    return Array.from(set);
  };

  return { map: safe, getPerson, isBaseShopLeader, isAncestor, getBaseShopOwner, baseShopLeaders, hasSubTeam, masterLeaders };
}

module.exports = { createTree };
