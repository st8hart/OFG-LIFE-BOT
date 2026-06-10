// src/leaderboard.js
const { EmbedBuilder } = require('discord.js');
const { getLeaderboard, getMonthlyTotal, getMonthlyTotalsMap, getBestDailyBadgesMap, getRankForAmount, getGoal } = require('./database');

const MEDALS = ['🥇', '🥈', '🥉'];
const PERIOD_COLORS = {
  daily:   0x3498DB,
  weekly:  0x9B59B6,
  monthly: 0xF1C40F,
};

function getMilestoneEmoji(count) {
  if (count >= 8) return ' 🌌';
  if (count === 7) return ' 🌋';
  if (count === 6) return ' 🌊';
  if (count === 5) return ' ⛈️';
  if (count === 4) return ' 🍀';
  if (count === 3) return ' 🎩';
  if (count === 2) return ' 🔥';
  return '';
}

function buildProgressBar(current, goal, length = 20) {
  const pct = Math.min(current / goal, 1);
  const filled = Math.round(pct * length);
  const empty = length - filled;
  return '`' + '█'.repeat(filled) + '░'.repeat(empty) + '`' + ' ' + Math.round(pct * 100) + '%';
}

function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

async function getPeriodTotal(period, rows) {
  return rows.reduce((sum, r) => sum + r.total, 0);
}

async function buildLeaderboardEmbed(period, prevWeek = false) {
  const rows = await getLeaderboard(period, prevWeek);
  const monthlyTotal = await getMonthlyTotal();
  const currentGoal = await getGoal();
  const periodTotal = rows.reduce((sum, r) => sum + r.total, 0);
  const monthlyMap = await getMonthlyTotalsMap();
  // Best single-day count this month per user — milestone badge persists all month
  const badgeMap = await getBestDailyBadgesMap();

  const monthName = new Date().toLocaleString('en-US', { month: 'long' }).toUpperCase();
  const year = new Date().getFullYear();

  let title = '';
  if (period === 'daily')   title = `📅 OFG TODAY'S LEADERBOARD`;
  if (period === 'weekly')  title = prevWeek ? `📆 OFG LAST WEEK'S LEADERBOARD` : `📆 OFG THIS WEEK'S LEADERBOARD`;
  if (period === 'monthly') title = `🏆 OFG ${monthName} ${year} LEADERBOARD`;

  const color = PERIOD_COLORS[period] || 0xF1C40F;
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();

  // Period summary block
  if (period === 'daily') {
    embed.addFields({
      name: '📅 Today at a Glance',
      value: [
        `**Daily Total: ${formatMoney(periodTotal)}**`,
        ``,
        `🏆 Monthly Team Total: ${formatMoney(monthlyTotal)}`,
        `🎯 Monthly Goal: ${formatMoney(currentGoal)}`,
        `${buildProgressBar(monthlyTotal, currentGoal)}`,
      ].join('\n'),
      inline: false,
    });
  } else if (period === 'weekly') {
    embed.addFields({
      name: prevWeek ? '📆 Last Week at a Glance' : '📆 This Week at a Glance',
      value: [
        `**Weekly Total: ${formatMoney(periodTotal)}**`,
        ``,
        `🏆 Monthly Team Total: ${formatMoney(monthlyTotal)}`,
        `🎯 Monthly Goal: ${formatMoney(currentGoal)}`,
        `${buildProgressBar(monthlyTotal, currentGoal)}`,
      ].join('\n'),
      inline: false,
    });
  } else if (period === 'monthly') {
    embed.addFields({
      name: '📊 Monthly Team Progress',
      value: [
        `**Team Total: ${formatMoney(monthlyTotal)}**`,
        `🎯 Goal: ${formatMoney(currentGoal)}`,
        `${buildProgressBar(monthlyTotal, currentGoal)}`,
      ].join('\n'),
      inline: false,
    });
  }

  if (rows.length === 0) {
    embed.addFields({ name: '─────────────────────', value: '*No sales logged yet. Be the first!*', inline: false });
    embed.setFooter({ text: 'OFG - Production Tracker' });
    return embed;
  }

  const top5 = rows.slice(0, 5);
  const rest = rows.slice(5);

  let podiumText = '';
  top5.forEach((row, i) => {
    const rank = getRankForAmount(monthlyMap[row.user_id] || 0);
    const medal = MEDALS[i] || `#${i + 1}`;
    const streak = (period === 'daily' && row.sales_count >= 3) ? ' 🔥' : '';
    const milestone = getMilestoneEmoji(badgeMap[row.user_id] || 0);
    podiumText += `${medal} <@${row.user_id}> — **${formatMoney(row.total)}**${streak} · ${rank.emoji}${milestone} *(${row.sales_count} sale${row.sales_count !== 1 ? 's' : ''})*\n`;
  });

  embed.addFields({ name: '─────────────────────', value: podiumText, inline: false });

  if (rest.length > 0) {
    let restText = '';
    rest.forEach((row, i) => {
      const rank = getRankForAmount(monthlyMap[row.user_id] || 0);
      const streak = (period === 'daily' && row.sales_count >= 3) ? ' 🔥' : '';
      const milestone = getMilestoneEmoji(badgeMap[row.user_id] || 0);
      restText += `#${i + 6} <@${row.user_id}> — **${formatMoney(row.total)}**${streak} · ${rank.emoji}${milestone}\n`;
    });
    embed.addFields({ name: '─────────────────────', value: restText, inline: false });
  }

  // Badge legend — monthly leaderboard only
  if (period === 'monthly') {
    embed.addFields({
      name: '📊 Badge Guide',
      value: [
        `**Rank** · Based on monthly AP production`,
        `**Milestone** · Based on sales count this period`,
        `🔥 2 sales · 🎩 3 · 🍀 4 · ⛈️ 5 · 🌊 6 · 🌋 7 · 🌌 8+`,
      ].join('\n'),
      inline: false,
    });
  }

  embed.setFooter({ text: 'OFG - Production Tracker' });
  return embed;
}

module.exports = { buildLeaderboardEmbed, formatMoney };
