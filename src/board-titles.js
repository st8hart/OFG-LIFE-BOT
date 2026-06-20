// src/board-titles.js
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for EVERY leaderboard title, so the three boards stay
// congruent. Change an emoji here once and it updates everywhere.
//   • Lead emoji = system signature:  ⚔️ production · 👑 team · 🌱 recruiting
//   • Trailing emoji = the time period, identical across all three boards:
//       🔥 today · 🔄 yesterday · 🚀 this week · 🏁 last week · 💎 this month · 🏅 last month
//   • Production uses possessive wording ("TODAY'S"); team/recruiting use "— TODAY".
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM = {
  production: { sig: '⚔️', style: 'possessive', name: 'OFG' },
  team:       { sig: '👑', style: 'dash',       name: 'OFG TEAM LEADERBOARD' },
  recruiting: { sig: '🌱', style: 'dash',       name: 'OFG RECRUITING LEADERBOARD' },
};

// Trailing emoji per period — congruent across every board.
const PERIOD_SUFFIX = {
  today:     '🔥',
  yesterday: '🔄',
  thisweek:  '🚀',
  lastweek:  '🏁',
  thismonth: '💎',
  lastmonth: '🏅',
};

// Production possessive wording.
const POSSESSIVE = {
  today:     "TODAY'S",
  yesterday: "YESTERDAY'S",
  thisweek:  "THIS WEEK'S",
  lastweek:  "LAST WEEK'S",
};

// Team / recruiting "— WORD" wording.
const DASH_WORD = {
  today: 'TODAY', yesterday: 'YESTERDAY', thisweek: 'THIS WEEK', lastweek: 'LAST WEEK',
};

function monthLabel(prevMonth) {
  const d = new Date();
  const m = prevMonth ? new Date(d.getFullYear(), d.getMonth() - 1, 1) : d;
  return `${m.toLocaleString('en-US', { month: 'long' }).toUpperCase()} ${m.getFullYear()}`;
}

// ── Accent stripe color (the left bar on each embed) ──────────────────────────
// One color per system × period-view, so Today/Yesterday/This Week/Last Week/
// This Month/Last Month are all visually distinct. Fully editable: change any hex
// and only that one board+view updates. Defaults follow a logic you can keep or
// ignore — current views use the system's vivid hue, "previous" views (yesterday/
// last week) are muted, and the month views lean to milestone gold/bronze.
const BOARD_COLORS = {
  production: {
    today:     0x3498DB, // blue
    yesterday: 0x5D6D7E, // muted slate
    thisweek:  0x9B59B6, // purple
    lastweek:  0x76608A, // muted purple
    thismonth: 0xF1C40F, // gold
    lastmonth: 0xB7950B, // bronze
  },
  team: {
    today:     0x1ABC9C, // turquoise
    yesterday: 0x2980B9, // sapphire blue
    thisweek:  0xE67E22, // orange
    lastweek:  0xD35400, // pumpkin
    thismonth: 0xF1C40F, // gold
    lastmonth: 0x8E44AD, // amethyst
  },
  recruiting: {
    today:     0x2ECC71, // emerald
    yesterday: 0x8FB3A4, // muted sage
    thisweek:  0x1ABC9C, // teal
    lastweek:  0x7FA8A0, // muted teal
    thismonth: 0xF39C12, // amber
    lastmonth: 0xCA6F1E, // bronze
  },
};

function buildBoardColor(system, period, prevWeek = false, prevDay = false, prevMonth = false) {
  const key = periodKey(period, prevWeek, prevDay, prevMonth);
  const palette = BOARD_COLORS[system] || BOARD_COLORS.production;
  return (palette[key] != null) ? palette[key] : 0xF1C40F;
}

function periodKey(period, prevWeek, prevDay, prevMonth) {
  if (period === 'daily')   return prevDay   ? 'yesterday' : 'today';
  if (period === 'weekly')  return prevWeek  ? 'lastweek'  : 'thisweek';
  if (period === 'monthly') return prevMonth ? 'lastmonth' : 'thismonth';
  return 'today';
}

// system: 'production' | 'team' | 'recruiting'
function buildBoardTitle(system, period, prevWeek = false, prevDay = false, prevMonth = false) {
  const s = SYSTEM[system] || SYSTEM.production;
  const key = periodKey(period, prevWeek, prevDay, prevMonth);
  const suffix = PERIOD_SUFFIX[key] || '';

  let body;
  if (s.style === 'possessive') {
    // production: "OFG TODAY'S LEADERBOARD" / "OFG JUNE 2026 LEADERBOARD"
    body = period === 'monthly'
      ? `OFG ${monthLabel(prevMonth)} LEADERBOARD`
      : `OFG ${POSSESSIVE[key]} LEADERBOARD`;
  } else {
    // team / recruiting: "NAME — TODAY" / "NAME — JUNE 2026"
    const word = period === 'monthly' ? monthLabel(prevMonth) : DASH_WORD[key];
    body = `${s.name} — ${word}`;
  }
  return `${s.sig} ${body} ${suffix}`.trim();
}

module.exports = { buildBoardTitle, buildBoardColor, SYSTEM, PERIOD_SUFFIX, BOARD_COLORS };
