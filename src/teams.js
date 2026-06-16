// src/teams.js
// ─────────────────────────────────────────────────────────────────────────────
// TEAM / LEADERSHIP HIERARCHY CONFIG
//
// This is the ONLY file you edit when the org chart changes. The two team
// leaderboards are derived entirely from the single tree below.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE TWO BOARDS
//   • MASTER AGENCY = a leader's ENTIRE downline, every level — including any
//     sub-team that has its own base shop. "Their total."
//   • BASE SHOP     = that same leader's shop MINUS any sub-team that has its own
//     base shop. When someone gets their own base shop, their whole total comes
//     OUT of their upline's base shop, but STAYS in the upline's Master Agency.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONLY QUESTION PER PERSON: do they have a base shop? yes / no.
//   baseShop: true   → has their own base shop (their own line on the Base Shop
//                      board; their total is pulled out of their upline's shop).
//   baseShop: false  → a producer; their production rolls up into their upline's
//                      base shop. (Leaving baseShop off entirely also means "no".)
//
// HOW TO ADD A TEAM
//   1. Add the leader:   'LEADER_ID': { name: 'Jane', upline: 'OWNER_ID', baseShop: true }
//   2. Add producers:    'PROD_ID':   { name: 'John', upline: 'LEADER_ID', baseShop: false }
//
// HOW TO ADD A TEAM *UNDER* A TEAM (any depth — 3, 4, 5 levels...)
//   The tree is just "who is directly above me" (`upline`). To go deeper, point
//   each new leader's upline at the leader right above them. Example, 3 deep:
//
//     'ORION_ID':  { name: 'Orion',  upline: 'OVERALL_AGENCY', baseShop: true }, // top of the leg
//     'MARIA_ID':  { name: 'Maria',  upline: 'ORION_ID',       baseShop: true }, // Orion promoted her
//     'DEVON_ID':  { name: 'Devon',  upline: 'MARIA_ID',       baseShop: true }, // Maria promoted him
//     'PROD_ID':   { name: 'Sam',    upline: 'DEVON_ID',       baseShop: false }, // a producer under Devon
//
//   With that chain, everything cascades automatically:
//     BASE SHOP board   → Orion = his shop only (Maria's leg removed)
//                         Maria = her shop only (Devon's leg removed)
//                         Devon = his shop (his producers)
//     MASTER AGENCY board → Orion  = Orion + Maria + Devon + everyone under them
//                           Maria  = Maria + Devon + everyone under them
//                           (Devon only appears here once HE has a base shop under him)
//   You never touch Orion or Maria when you add Devon — adding the deeper leg
//   reshapes the boards above it on its own.
//
// GETTING A DISCORD ID
//   Discord → Settings → Advanced → enable "Developer Mode", then right-click a
//   member → "Copy User ID". Same id stored in the sales table.
//
// FIELDS
//   name     – display label (shown if the id can't be @mentioned yet)
//   upline   – Discord id of the person directly above (or a grouping node)
//   baseShop – true = has own base shop; false / omitted = producer
//   master   – (optional) true = force a Master Agency line; false = never show one
//   virtual  – (optional) true = a grouping node, not a real person (no sales,
//              never shown on the Base Shop board)
// ─────────────────────────────────────────────────────────────────────────────

const TEAM = {
  // ── OVERALL AGENCY (You + Zach Hart, combined into ONE master line) ──
  'OVERALL_AGENCY': { name: 'Overall Agency (You & Zach Hart)', upline: null, virtual: true, master: true },

  // ── Agency owners — each runs a direct base shop, but on the Master board they
  //    are merged into the single Overall Agency line above (master: false). ──
  'YOUR_DISCORD_ID':      { name: 'You',       upline: 'OVERALL_AGENCY', baseShop: true, master: false },
  'ZACH_HART_DISCORD_ID': { name: 'Zach Hart', upline: 'OVERALL_AGENCY', baseShop: true, master: false },

  // ── Teams (each its own base shop). Change `upline` to nest one under another. ──
  'SEBASTIAN_HART_DISCORD_ID': { name: 'Sebastian Hart (Direct)', upline: 'OVERALL_AGENCY', baseShop: true },
  'AUSTIN_TIMMONS_DISCORD_ID': { name: 'Austin Timmons (Direct)', upline: 'OVERALL_AGENCY', baseShop: true },
  'ORION_MOORE_DISCORD_ID':      { name: 'Orion Moore',      upline: 'OVERALL_AGENCY', baseShop: true },
  'ZACH_DENHA_DISCORD_ID':       { name: 'Zach Denha',       upline: 'OVERALL_AGENCY', baseShop: true },
  'AUSTIN_GREEN_DISCORD_ID':     { name: 'Austin Green',     upline: 'OVERALL_AGENCY', baseShop: true },
  'ASHLEY_GUNDERSON_DISCORD_ID': { name: 'Ashley Gunderson', upline: 'OVERALL_AGENCY', baseShop: true },
  'ASHLEE_GULDEN_DISCORD_ID':    { name: 'Ashlee Gulden',    upline: 'OVERALL_AGENCY', baseShop: true },

  // ── PRODUCERS (roll up into their leader's base shop) ──
  // 'PRODUCER_1_DISCORD_ID': { name: 'Producer One', upline: 'ORION_MOORE_DISCORD_ID', baseShop: false },
};

function getPerson(id) { return TEAM[id] || null; }

// All hierarchy rules live in team-logic.js (one copy, shared with the live
// Supabase tree). teams.js just supplies the static seed data + these helpers
// bound to it, so check-teams.js / pull-roster.js keep working unchanged.
const { createTree } = require('./team-logic');
const _tree = createTree(TEAM);

module.exports = Object.assign(
  { TEAM, createTree, getPerson },
  {
    isBaseShopLeader: _tree.isBaseShopLeader,
    isAncestor:       _tree.isAncestor,
    getBaseShopOwner: _tree.getBaseShopOwner,
    baseShopLeaders:  _tree.baseShopLeaders,
    hasSubTeam:       _tree.hasSubTeam,
    masterLeaders:    _tree.masterLeaders,
  }
);
