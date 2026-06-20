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

module.exports = { buildBoardTitle, SYSTEM, PERIOD_SUFFIX };
