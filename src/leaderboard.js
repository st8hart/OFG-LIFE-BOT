// src/leaderboard.js
// Builds the formatted Discord embeds for leaderboards

const { EmbedBuilder } = require('discord.js');
const { getLeaderboard, getMonthlyTotal, getRankForAmount } = require('./database');

const { getGoal } = require('./database');

const MEDALS = ['🥇', '🥈', '🥉'];
const PERIOD_LABELS = {
  daily:   '📅 TODAY\'S',
  weekly:  '📆 THIS WEEK\'S',
  monthly: '🏆 ',
};
const PERIOD_COLORS = {
  daily:   0x3498DB,
  weekly:  0x9B59B6,
  monthly: 0xF1C40F,
};

function buildProgressBar(current, goal, length = 20) {
  const pct = Math.min(current / goal, 1);
  const filled = Math.round(pct * length);
  const empty = length - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `\`${bar}\` ${Math.round(pct * 100)}%`;
}

function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function buildLeaderboardEmbed(period) {
  const rows = getLeaderboard(period);
  const monthlyTotal = getMonthlyTotal();
  const monthName = new Date().toLocaleString('en-US', { month: 'long' }).toUpperCase();
  const year = new Date().getFullYear();
  const label = period === 'monthly' 
    ? `🏆 ${monthName} ${year}` 
    : (PERIOD_LABELS[period] || '🏆');
  const color = PERIOD_COLORS[period] || 0xF1C40F;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🏆 OFG LIFE ${label} LEADERBOARD`)
    .setTimestamp();

  // Monthly team progress (always shown)
  const currentGoal = getGoal();
  const progressBar = buildProgressBar(monthlyTotal, currentGoal);
  embed.addFields({
    name: `📊 Monthly Team Progress`,
    value: `**Team Total:** ${formatMoney(monthlyTotal)}\n**Goal:** ${formatMoney(currentGoal)}\n${progressBar}`,
    inline: false,
  });

  if (rows.length === 0) {
    embed.addFields({ name: '─────────────────────', value: '*No sales logged yet. Be the first!*', inline: false });
    return embed;
  }

  // Top 5 (podium) vs rest
  const top5 = rows.slice(0, 5);
  const rest = rows.slice(5);

  let podiumText = '';
  top5.forEach((row, i) => {
    const rank = getRankForAmount(row.total);
    const medal = MEDALS[i] || `#${i + 1}`;
    const rankBadge = `${rank.emoji} ${rank.name}`;
    podiumText += `${medal} <@${row.user_id}> — **${formatMoney(row.total)}** · ${rankBadge} *(${row.sales_count} sale${row.sales_count !== 1 ? 's' : ''})*\n`;
  });

  embed.addFields({ name: '─────────────────────', value: podiumText, inline: false });

  if (rest.length > 0) {
    let restText = '';
    rest.forEach((row, i) => {
      const rank = getRankForAmount(row.total);
      const rankBadge = `${rank.emoji} ${rank.name}`;
      restText += `#${i + 6} <@${row.user_id}> — **${formatMoney(row.total)}** · ${rankBadge}\n`;
    });
    embed.addFields({ name: '─────────────────────', value: restText, inline: false });
  }

  embed.setFooter({ text: 'OFG Life Bot • Production Tracker' });
  return embed;
}

function buildSaleAnnouncementEmbed(sale, userStats, rank) {
  const embed = new EmbedBuilder()
    .setColor(parseInt(rank.color.replace('#', ''), 16))
    .setTitle('💰 NEW SALE LOGGED!')
    .setDescription(`<@${sale.userId}> just closed a deal! 🎉`)
    .addFields(
      { name: '👤 Client',        value: sale.clientName,              inline: true },
      { name: '📋 Policy Type',   value: sale.policyType,              inline: true },
      { name: '💵 Premium',       value: formatMoney(sale.premium),    inline: true },
      { name: '🏢 Carrier',       value: sale.carrier || 'N/A',        inline: true },
      { name: '📊 Rank',          value: `${rank.emoji} ${rank.name}`, inline: true },
      { name: '📅 Monthly Total', value: formatMoney(userStats.monthly_total), inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'OFG Life Bot • Production Tracker' });

  if (sale.notes) {
    embed.addFields({ name: '📝 Notes', value: sale.notes, inline: false });
  }

  return embed;
}

module.exports = { buildLeaderboardEmbed, buildSaleAnnouncementEmbed, formatMoney };
