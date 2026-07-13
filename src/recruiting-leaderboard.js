// src/recruiting-leaderboard.js
// ─────────────────────────────────────────────────────────────────────────────
// The recruiting clone of the production system. Counts HIRES instead of AP.
//   • /addhire        — dropdowns (upline + licensed) → modal (name + state) →
//                       posts a "New Hire Alert" card in the leaders channel.
//   • /recruitingleaderboard — Top Recruiters + Master Agency + Base Shop boards.
//   • /sethiregoal    — set the monthly team hire goal (default 100).
//
// Rollups reuse the SAME live team tree (team_members) as production, so a hire's
// credit climbs the exact same three rungs: recruiter → base shop → master agency.
// ─────────────────────────────────────────────────────────────────────────────
const {
  EmbedBuilder, SlashCommandBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');
const {
  getTeamTree,
  addHire, getHireLeaderboard, getHireSourceCounts, getMonthlyHireTotal, getUserHireStats, getHireGoal, setHireGoal,
  getRecruiterRankForCount, getMonthlyRecruitCountsMap, getReigningRecruiterId, getBestRecruitingDayMap, getRecruiterDailyCount,
  getTeamDailyHireCount, getAllTimeHireRecords, setAllTimeHireRecord,
} = require('./database');
const { buildBoardTitle, buildBoardColor } = require('./board-titles');

const MEDALS = ['🥇', '🥈', '🥉'];
const PERIOD_COLORS = { daily: 0x1ABC9C, weekly: 0x2ECC71, monthly: 0x27AE60 };
const CARD_COLOR = 0x2ECC71;

// Hire source categories. Add/rename here and in the /addhire choices below to keep
// the dropdown and the card labels in sync. Order here = display order on the board.
const SOURCE_LABELS = {
  personal:        'Personal',
  urs:             'URS',
  starting_10:     'Starting 10',
  paid_recruiting: 'Paid Recruiting',
};
function sourceLabel(value) {
  return SOURCE_LABELS[value] || (value ? String(value) : '—');
}

// "Personal 8 · URS 11 · Starting 10 14 · Paid Recruiting 22" for the board.
function buildSourceLine(counts) {
  const parts = [];
  for (const key of Object.keys(SOURCE_LABELS)) {
    const c = counts[key] || 0;
    if (c > 0) parts.push(`${SOURCE_LABELS[key]}: **${c}**`);
  }
  let other = 0;
  for (const [k, v] of Object.entries(counts)) if (!(k in SOURCE_LABELS)) other += v;
  if (other > 0) parts.push(`Other: **${other}**`);
  return parts.length ? parts.join(' · ') : null;
}

function formatHires(n) {
  n = Number(n || 0);
  return `${n} hire${n === 1 ? '' : 's'}`;
}

// ── Recruiting badges (all emoji swappable here) ──────────────────────────────
// Best single-day hire count this month → a flair next to the recruiter.
function bestDayEmoji(count) {
  if (count >= 10) return '🌌';
  if (count >= 9)  return '🚀';
  if (count >= 8)  return '☄️';
  if (count >= 7)  return '⚡';
  if (count >= 6)  return '🔥';
  if (count >= 5)  return '💥';
  if (count >= 4)  return '🧨';
  if (count >= 3)  return '🎆';
  if (count >= 2)  return '🎇';
  return '';
}
// Team badge by MONTHLY hires — shown on base shop & master agency lines.
// Deliberately avoids 🥇🥈🥉 (those are the 1st/2nd/3rd podium markers on every
// board line) and the cosmic best-day glyphs, so nothing reads as a position.
function teamBadgeEmoji(monthlyHires) {
  if (monthlyHires >= 500) return '⚜️';
  if (monthlyHires >= 400) return '🔱';
  if (monthlyHires >= 300) return '💎';
  if (monthlyHires >= 200) return '🏆';
  if (monthlyHires >= 100) return '💠';
  if (monthlyHires >= 50)  return '🏵️';
  if (monthlyHires >= 25)  return '🛡️';
  return '';
}
// Multi-hire-in-a-day blast (2+ hires logged by the same recruiter today).
// Escalating tiers — the more they sign in one day, the louder it gets.
function multiHireBlast(uplineId, count) {
  if (count < 2) return null;
  let header, line;
  if (count === 2) {
    header = '🎇 DOUBLE UP! 🎇';
    line = `<@${uplineId}> just signed their **2nd recruit today** — two in one day is how you build. 🌱`;
  } else if (count === 3) {
    header = '🎆 HAT TRICK! 🎆';
    line = `<@${uplineId}> is locked in — **3 recruits today!** The empire is growing by the hour. 🏗️🔥`;
  } else if (count === 4) {
    header = '🧨 RECRUITING RAMPAGE! 🧨';
    line = `<@${uplineId}> just logged their **4th recruit today** — a one-person talent machine. 🚀`;
  } else if (count <= 6) {
    header = '💥 ON A HEATER! 💥';
    line = `<@${uplineId}> is UNREAL — **${count} recruits today!** Somebody check the water over there. 🌱🔥`;
  } else if (count <= 9) {
    header = '⚡ ABSOLUTELY UNSTOPPABLE! ⚡';
    line = `<@${uplineId}> just hit **${count} recruits in a single day.** This is a recruiting clinic. 🏛️👑`;
  } else {
    header = '🌌 GODMODE ACTIVATED! 🌌';
    line = `<@${uplineId}> has signed **${count} recruits TODAY.** We may never see this again — bow down. 🌎🏆🔥`;
  }
  return ['', header, '', line, ''].join('\n');
}

// @mention real Discord ids; show the stored name for virtual/grouping nodes.
function label(tree, id) {
  if (/^\d{5,}$/.test(id)) return `<@${id}>`;
  const p = tree.getPerson(id);
  return p ? `**${p.name}**` : String(id);
}

function buildProgressBar(current, goal, length = 20) {
  const pct = goal > 0 ? Math.min(current / goal, 1) : 0;
  const filled = Math.round(pct * length);
  return '`' + '█'.repeat(filled) + '░'.repeat(length - filled) + '`' + ' ' + Math.round(pct * 100) + '%';
}

// Split lines into <1024-char embed fields (Discord's hard limit).
function chunkFields(lines, headerName) {
  const chunks = [];
  let cur = '';
  for (const line of lines) {
    const l = line + '\n';
    if ((cur + l).length > 1000) { chunks.push(cur); cur = l; }
    else cur += l;
  }
  if (cur) chunks.push(cur);
  return chunks.map((value, i) => ({ name: i === 0 ? headerName : '\u200b', value, inline: false }));
}

// Team lines (master agency / base shop). monthlyTotals maps id → monthly hires
// so the escalating team badge reflects the MONTH, not just the shown period.
function rankLines(tree, entries, monthlyTotals = {}) {
  return entries.map((e, i) => {
    const medal = MEDALS[i] || `#${i + 1}`;
    const badge = teamBadgeEmoji(monthlyTotals[e.id] || 0);
    return `${medal} ${label(tree, e.id)} — **${formatHires(e.total)}**${badge ? ' ' + badge : ''}`;
  });
}

// Top Recruiters. Rank emoji + 🎖️ reigning + best-day flair all key off MONTHLY
// numbers (passed in), so a daily/weekly board still shows the recruiter's standing.
function topRecruiterLines(rows, monthlyMap = {}, reigningId = null, bestDayMap = {}) {
  return rows.map((e, i) => {
    const medal = MEDALS[i] || `#${i + 1}`;
    const rank  = getRecruiterRankForCount(monthlyMap[e.recruiter_id] || 0);
    const reign = reigningId && reigningId === e.recruiter_id ? '🎖️' : '';
    const best  = bestDayEmoji(bestDayMap[e.recruiter_id] || 0);
    const flair = `${rank.emoji}${reign}${best}`;
    return `${medal} <@${e.recruiter_id}> — **${formatHires(e.count)}** ${flair}`;
  });
}

// BASE SHOP rollup: each recruiter's hires go to their nearest base-shop owner.
function rollupBaseShop(tree, personal) {
  const totals = {};
  for (const id of tree.baseShopLeaders()) totals[id] = 0;
  for (const [userId, count] of Object.entries(personal)) {
    const owner = tree.getBaseShopOwner(userId);
    if (owner == null) continue;
    totals[owner] = (totals[owner] || 0) + count;
  }
  return Object.entries(totals).map(([id, total]) => ({ id, total }))
    .filter(e => e.total > 0).sort((a, b) => b.total - a.total);
}

// MASTER AGENCY rollup: each master leader's line = their ENTIRE subtree.
function rollupMaster(tree, personal) {
  const userIds = Object.keys(personal);
  return tree.masterLeaders().map(m => {
    let total = 0;
    for (const u of userIds) if (tree.isAncestor(m, u)) total += personal[u];
    return { id: m, total };
  }).filter(e => e.total > 0).sort((a, b) => b.total - a.total);
}

// Nearest base-shop owner at/above an id (for the hire card).
function baseShopLabelFor(tree, id) {
  const owner = tree.getBaseShopOwner(id);
  if (!owner) return '—';
  const p = tree.getPerson(owner);
  return p ? p.name : (/^\d{5,}$/.test(owner) ? `<@${owner}>` : String(owner));
}

// Nearest master-agency line at/above an id (for the hire card).
function masterLabelFor(tree, id) {
  const masters = new Set(tree.masterLeaders());
  let cur = id;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (masters.has(cur)) {
      const p = tree.getPerson(cur);
      return p ? p.name : (/^\d{5,}$/.test(cur) ? `<@${cur}>` : String(cur));
    }
    const p = tree.getPerson(cur);
    if (!p) break;
    cur = p.upline;
  }
  return '—';
}

// ── Recruiting board embed (Top Recruiters + Master Agency + Base Shop) ──────────
async function buildRecruitingLeaderboardEmbed(period, prevWeek = false, prevDay = false, prevMonth = false) {
  const tree = await getTeamTree();
  const rows = await getHireLeaderboard(period, prevWeek, prevDay, prevMonth);
  const personal = {};
  for (const r of rows) personal[r.recruiter_id] = (personal[r.recruiter_id] || 0) + r.count;
  const periodTotal = Object.values(personal).reduce((s, v) => s + v, 0);

  const baseEntries   = rollupBaseShop(tree, personal);
  const masterEntries = rollupMaster(tree, personal);

  // Monthly numbers drive every badge (rank, team badge, reigning, best-day) so the
  // flair is consistent across daily/weekly/monthly boards. Historical (prev*) views
  // suppress reigning + best-day, matching how the production board behaves.
  const historical = prevWeek || prevDay || prevMonth;
  const monthlyMap = await getMonthlyRecruitCountsMap(prevMonth);
  const reigningId = historical ? null : await getReigningRecruiterId();
  const bestDayMap = historical ? {} : await getBestRecruitingDayMap();

  // Roll the monthly personal map up the same tree so team lines show a monthly badge.
  const monthlyBase = {};
  for (const e of rollupBaseShop(tree, monthlyMap)) monthlyBase[e.id] = e.total;
  const monthlyMaster = {};
  for (const e of rollupMaster(tree, monthlyMap)) monthlyMaster[e.id] = e.total;

  const title = buildBoardTitle('recruiting', period, prevWeek, prevDay, prevMonth);

  const embed = new EmbedBuilder().setColor(buildBoardColor('recruiting', period, prevWeek, prevDay, prevMonth)).setTitle(title).setTimestamp();

  const monthlyTotal = await getMonthlyHireTotal(prevMonth);
  const goal = await getHireGoal();

  if (period === 'daily') {
    embed.addFields({
      name: prevDay ? '📅 Yesterday at a Glance' : '📅 Today at a Glance',
      value: [
        `**Daily Hires: ${periodTotal}**`,
        ``,
        `🌱 Monthly Team Hires: ${monthlyTotal}`,
        `🎯 Monthly Goal: ${goal} hires`,
        buildProgressBar(monthlyTotal, goal),
      ].join('\n'),
      inline: false,
    });
  } else if (period === 'weekly') {
    embed.addFields({
      name: prevWeek ? '📆 Last Week at a Glance' : '📆 This Week at a Glance',
      value: [
        `**Weekly Hires: ${periodTotal}**`,
        ``,
        `🌱 Monthly Team Hires: ${monthlyTotal}`,
        `🎯 Monthly Goal: ${goal} hires`,
        buildProgressBar(monthlyTotal, goal),
      ].join('\n'),
      inline: false,
    });
  } else if (period === 'monthly') {
    embed.addFields({
      name: '📊 Monthly Recruiting Progress',
      value: [
        `**Team Hires: ${monthlyTotal}**`,
        `🎯 Goal: ${goal} hires`,
        buildProgressBar(monthlyTotal, goal),
      ].join('\n'),
      inline: false,
    });
  }

  // Hires by Source (reflects the period being shown)
  const sourceCounts = await getHireSourceCounts(period, prevWeek, prevDay, prevMonth);
  const sourceLine = buildSourceLine(sourceCounts);
  if (sourceLine) {
    embed.addFields({ name: '🔗 Hires by Source', value: sourceLine, inline: false });
  }

  // Top Recruiters (individual)
  if (rows.length) {
    for (const f of chunkFields(topRecruiterLines(rows, monthlyMap, reigningId, bestDayMap), '🏆 Top Recruiters')) embed.addFields(f);
  } else {
    embed.addFields({ name: '🏆 Top Recruiters', value: '*No hires logged yet for this period.*', inline: false });
  }

  embed.addFields({ name: '\u200b', value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', inline: false });

  // Master Agency
  if (masterEntries.length) {
    for (const f of chunkFields(rankLines(tree, masterEntries, monthlyMaster), '🏛️ Master Agency · 🌱 Hires')) embed.addFields(f);
  } else {
    embed.addFields({ name: '🏛️ Master Agency · 🌱 Hires', value: '*No hires logged yet for this period.*', inline: false });
  }

  embed.addFields({ name: '\u200b', value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', inline: false });

  // Base Shop
  if (baseEntries.length) {
    for (const f of chunkFields(rankLines(tree, baseEntries, monthlyBase), '🏢 Base Shop · 🌱 Hires')) embed.addFields(f);
  } else {
    embed.addFields({ name: '🏢 Base Shop · 🌱 Hires', value: '*No hires logged yet for this period.*', inline: false });
  }

  // Badge guide — monthly board only, keeps daily/weekly clean.
  if (period === 'monthly') {
    embed.addFields({
      name: '📖 Badge Guide',
      value: [
        `**Recruiter Rank** · hires this month`,
        `🎯 Recruiter 0+ · 🧲 Talent Scout 5+ · 🏗️ Builder 10+`,
        `🏰 Founder 25+ · 💪 Kingmaker 50+ · 🌎 Empire Architect 100+`,
        ``,
        `**Best Recruiting Day** · 🎇 2 · 🎆 3 · 🧨 4 · 💥 5 · 🔥 6 · ⚡ 7 · ☄️ 8 · 🚀 9 · 🌌 10+`,
        `**Team Badge** · monthly hires · 🛡️ 25 · 🏵️ 50 · 💠 100 · 🏆 200 · 💎 300 · 🔱 400 · ⚜️ 500+`,
        `🎖️ **Reigning Recruiter** — last month's #1`,
      ].join('\n'),
      inline: false,
    });
  }

  embed.setFooter({ text: 'OFG - Recruiting Tracker' });
  return embed;
}

// ── The "New Hire Alert" card (mirrors the sale alert card) ──────────────────────
function buildHireCard({ name, uplineId, state, licensed, source, stats, baseShopLabel, masterLabel }) {
  return {
    color: CARD_COLOR,
    description: [
      `🚨🌱 NEW HIRE ALERT — ${name} 🌱🚨`,
      ``,
      `🧭 Direct Upline: <@${uplineId}>`,
      `📍 State: ${state}`,
      `📋 Status: ${licensed ? '✅ Licensed' : '❌ Unlicensed'}`,
      `🔗 Source: ${sourceLabel(source)}`,
      `━━━━━━━━━━━━━━━━━━`,
      `📊 <@${uplineId}>'s Recruiting`,
      `📅 Daily Hires: ${stats.daily_count}`,
      `📈 Weekly Hires: ${stats.weekly_count}`,
      `🏆 Monthly Hires: ${stats.monthly_count}`,
      `🌟 Total Hires: ${stats.total_count}`,
      `━━━━━━━━━━━━━━━━━━`,
      `🏢 Base Shop: ${baseShopLabel}`,
      `🏛️ Master Agency: ${masterLabel}`,
    ].join('\n'),
    footer: { text: 'OFG - Recruiting Tracker' },
    timestamp: new Date().toISOString(),
  };
}

// ── /addhire ─────────────────────────────────────────────────────────────────────
// Dropdowns (upline + licensed) are chosen first; the modal then captures the
// free-text fields. Selections ride along in the modal customId so the submit
// handler can read them (Discord modals can't hold user-pickers or dropdowns).
const addHireCommand = {
  data: new SlashCommandBuilder()
    .setName('addhire')
    .setDescription('Log a new hire')
    .addUserOption(opt => opt.setName('upline').setDescription('Direct upline (who recruited them)').setRequired(true))
    .addStringOption(opt => opt.setName('licensed').setDescription('Are they licensed?').setRequired(true)
      .addChoices({ name: 'Licensed', value: 'licensed' }, { name: 'Unlicensed', value: 'unlicensed' }))
    .addStringOption(opt => opt.setName('source').setDescription('Where did this hire come from?').setRequired(true)
      .addChoices(
        { name: 'Personal',        value: 'personal' },
        { name: 'URS',             value: 'urs' },
        { name: 'Starting 10',     value: 'starting_10' },
        { name: 'Paid Recruiting', value: 'paid_recruiting' },
      )),
  async execute(interaction) {
    const upline = interaction.options.getUser('upline');
    const licensed = interaction.options.getString('licensed');
    const source = interaction.options.getString('source');
    const modal = new ModalBuilder()
      .setCustomId(`addHireModal:${upline.id}:${licensed}:${source}`)
      .setTitle('Log New Hire - OFG');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('New Hire Name')
          .setStyle(TextInputStyle.Short).setPlaceholder('e.g. Marcus Bell').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('state').setLabel('State')
          .setStyle(TextInputStyle.Short).setPlaceholder('e.g. Texas').setRequired(true)
      ),
    );
    await interaction.showModal(modal);
  },
};

async function handleHireModal(interaction, client) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const parts = interaction.customId.split(':');
    const uplineId = parts[1];
    const licensed = (parts[2] || 'unlicensed') === 'licensed';
    const source = parts[3] || '';
    const name  = interaction.fields.getTextInputValue('name').trim();
    const state = interaction.fields.getTextInputValue('state').trim();

    // Resolve the upline's display name for the DB record (card uses the mention).
    let uplineName = uplineId;
    try {
      const m = await interaction.guild.members.fetch(uplineId);
      uplineName = m.displayName || m.user.globalName || m.user.username || uplineId;
    } catch (_) {
      try { const u = await client.users.fetch(uplineId); uplineName = u.globalName || u.username || uplineId; } catch (__) {}
    }

    const hireResult = await addHire({
      recruitName: name, state, licensed, source,
      recruiterId: uplineId, recruiterName: uplineName,
      notes: `Logged by ${interaction.user.id}`,
    });
    // Already on the books (logged in the hub or a prior /addhire) — skip the
    // card + celebrations so nothing double-counts or double-announces.
    if (hireResult?.duplicate) {
      return interaction.editReply({
        content: `⚠️ **${name}** is already logged as a hire — I skipped it so it doesn't double-count. If this is genuinely a different person with the same name, add them from the hub Hire Log.`,
      });
    }

    const stats = await getUserHireStats(uplineId);
    const tree  = await getTeamTree();
    const baseShopLabel = baseShopLabelFor(tree, uplineId);
    const masterLabel   = masterLabelFor(tree, uplineId);

    const card = buildHireCard({ name, uplineId, state, licensed, source, stats, baseShopLabel, masterLabel });

    const channelId = process.env.RECRUITING_CHANNEL_ID;
    if (channelId) {
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.send({ embeds: [card] });

        // ── Celebrations (leaders channel) ────────────────────────────────────
        // stats.monthly_count already includes the hire we just logged.
        const monthlyCount = stats.monthly_count;

        // 1) FIRST BLOOD — the very first hire logged team-wide today.
        const teamToday = await getTeamDailyHireCount();
        if (teamToday === 1) {
          await channel.send([
            ``,
            `🌱 FIRST BLOOD! 🌱`,
            ``,
            `<@${uplineId}> just put the **first recruit on the board today** — welcome **${name}** to OFG!`,
            `The hunt for talent is ON. Who's next? 🏗️🔥`,
            ``,
          ].join('\n'));
        }

        // 2) RANK UP — crossed a tier (5 / 10 / 25 / 50 / 100).
        const before = getRecruiterRankForCount(monthlyCount - 1);
        const after  = getRecruiterRankForCount(monthlyCount);
        if (after.id > before.id) {
          await channel.send([
            ``,
            `⬆️🌱 RANK UP! 🌱⬆️`,
            ``,
            `<@${uplineId}> just leveled up to ${after.emoji} **${after.name}**!`,
            `From ${before.emoji} ${before.name} to ${after.emoji} ${after.name} — the empire grows! 🔥`,
            `*(${monthlyCount} recruits this month and climbing.)*`,
            ``,
          ].join('\n'));
        }

        // 3) MULTI-HIRE BLAST — 2+ hires logged by this recruiter today.
        const dailyCount = await getRecruiterDailyCount(uplineId);
        const blast = multiHireBlast(uplineId, dailyCount);
        if (blast) await channel.send(blast);

        // 4) ALL-TIME HIRE RECORDS — biggest day / week / month ever (mirrors the
        //    producer all-time record posts). stats already includes this hire.
        const hireRecords = await getAllTimeHireRecords();

        if (stats.daily_count > parseInt(hireRecords.alltime_hireday_count || 0, 10)) {
          const prev = hireRecords.alltime_hireday_username
            ? `Previous record: ${hireRecords.alltime_hireday_count} hires by ${hireRecords.alltime_hireday_username}`
            : 'First all-time record set!';
          await setAllTimeHireRecord('day', stats.daily_count, uplineId, uplineName);
          await channel.send([
            ``,
            `🌟 ALL-TIME RECRUITING DAY RECORD BROKEN! 🌟`,
            ``,
            `<@${uplineId}> just had the BIGGEST RECRUITING DAY in OFG history — **${stats.daily_count} hires in a single day!**`,
            `That's empire-builder status. 🏗️👑🔥`,
            prev,
            ``,
          ].join('\n'));
        }

        if (stats.weekly_count > parseInt(hireRecords.alltime_hireweek_count || 0, 10)) {
          const prev = hireRecords.alltime_hireweek_username
            ? `Previous record: ${hireRecords.alltime_hireweek_count} hires by ${hireRecords.alltime_hireweek_username}`
            : 'First all-time record set!';
          await setAllTimeHireRecord('week', stats.weekly_count, uplineId, uplineName);
          await channel.send([
            ``,
            `🌟 ALL-TIME RECRUITING WEEK RECORD BROKEN! 🌟`,
            ``,
            `<@${uplineId}> just posted the BIGGEST RECRUITING WEEK in OFG history — **${stats.weekly_count} hires this week!**`,
            `Absolutely UNSTOPPABLE. 🌱🔥`,
            prev,
            ``,
          ].join('\n'));
        }

        if (stats.monthly_count > parseInt(hireRecords.alltime_hiremonth_count || 0, 10)) {
          const prev = hireRecords.alltime_hiremonth_username
            ? `Previous record: ${hireRecords.alltime_hiremonth_count} hires by ${hireRecords.alltime_hiremonth_username}`
            : 'First all-time record set!';
          await setAllTimeHireRecord('month', stats.monthly_count, uplineId, uplineName);
          await channel.send([
            ``,
            `🌟 ALL-TIME RECRUITING MONTH RECORD BROKEN! 🌟`,
            ``,
            `<@${uplineId}> just built the BIGGEST RECRUITING MONTH in OFG history — **${stats.monthly_count} hires!**`,
            `This is what LEGEND status looks like at OFG. 🌎👑🏆`,
            prev,
            ``,
          ].join('\n'));
        }

        // 5) CAREER HIRE MILESTONES (leaders chat) — lifetime recruit crossings.
        //    total_count includes this hire, so equality = the moment they cross it.
        const HIRE_MILESTONES = {
          25: [
            `🌱 RECRUITING MILESTONE — 25 CAREER HIRES! 🌱`, ``,
            `<@${uplineId}> just brought their **25th recruit** into OFG!`,
            `A foundation is being built — the empire starts here. 🏗️`,
          ],
          50: [
            `🛡️ RECRUITING MILESTONE — 50 CAREER HIRES! 🛡️`, ``,
            `<@${uplineId}> just signed their **50th career recruit**!`,
            `Half a hundred builders brought in. That's real leadership. 💪🌱`,
          ],
          100: [
            `💠 RECRUITING MILESTONE — 100 CAREER HIRES! 💠`, ``,
            `<@${uplineId}> just hit **100 career recruits**!`,
            `A full century of talent. Empire-architect territory. 🏛️👑`,
          ],
          250: [
            `🏆 RECRUITING MILESTONE — 250 CAREER HIRES! 🏆`, ``,
            `<@${uplineId}> just crossed **250 career recruits**!`,
            `A quarter-thousand builders recruited. Absolutely elite. 🌎🔥`,
          ],
          500: [
            `💎 RECRUITING MILESTONE — 500 CAREER HIRES! 💎`, ``,
            `<@${uplineId}> just reached **500 career recruits**!`,
            `Five hundred lives changed. That's a dynasty being built. 👑🏗️`,
          ],
          1000: [
            `👑 RECRUITING MILESTONE — 1,000 CAREER HIRES · OFG HALL OF FAME! 👑`, ``,
            `<@${uplineId}> just signed their **1,000th career recruit**! 🌌`,
            `One THOUSAND builders brought into OFG — legend status, written into history forever. 🏆🌎🔥`,
          ],
        };
        if (HIRE_MILESTONES[stats.total_count]) {
          await channel.send(['', ...HIRE_MILESTONES[stats.total_count], ''].join('\n'));
        }

        // 6) AUTO-GROW GOAL — team total crossed the monthly goal → bump +25.
        const monthlyTeamTotal = await getMonthlyHireTotal();
        let goal = await getHireGoal();
        if (monthlyTeamTotal >= goal) {
          let newGoal = goal;
          while (monthlyTeamTotal >= newGoal) newGoal += 25;
          await setHireGoal(newGoal);
          await channel.send(
            `🎉🌱 **GOAL CRUSHED!** The team blew past **${goal} recruits** this month! ` +
            `New target: **${newGoal}** — let's run it up! 🚀`
          );
        }
      } catch (e) { console.error('Hire card / celebration post error:', e.message); }
    }

    await interaction.editReply({
      content: `✅ Logged **${name}** under <@${uplineId}> — ${licensed ? 'Licensed' : 'Unlicensed'}, ${state}, via ${sourceLabel(source)}.`,
    });
  } catch (err) {
    console.error('handleHireModal error:', err);
    try { await interaction.editReply({ content: 'Something went wrong logging that hire.' }); } catch (_) {}
  }
}

// ── /recruitingleaderboard ────────────────────────────────────────────────────────
const recruitingLeaderboardCommand = {
  data: new SlashCommandBuilder()
    .setName('recruitingleaderboard')
    .setDescription('View the recruiting / hiring leaderboard')
    .addStringOption(opt => opt.setName('period').setDescription('Time period').setRequired(false)
      .addChoices(
        { name: 'Daily',      value: 'daily' },
        { name: 'Yesterday',  value: 'yesterday' },
        { name: 'Weekly',     value: 'weekly' },
        { name: 'Last Week',  value: 'lastweek' },
        { name: 'Monthly',    value: 'monthly' },
        { name: 'Last Month', value: 'lastmonth' },
      )),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const period = interaction.options.getString('period') || 'monthly';
    if (period === 'yesterday') return interaction.editReply({ embeds: [await buildRecruitingLeaderboardEmbed('daily', false, true)] });
    if (period === 'lastweek')  return interaction.editReply({ embeds: [await buildRecruitingLeaderboardEmbed('weekly', true, false)] });
    if (period === 'lastmonth') return interaction.editReply({ embeds: [await buildRecruitingLeaderboardEmbed('monthly', false, false, true)] });
    await interaction.editReply({ embeds: [await buildRecruitingLeaderboardEmbed(period)] });
  },
};

// ── /sethiregoal ──────────────────────────────────────────────────────────────────
const setHireGoalCommand = {
  data: new SlashCommandBuilder()
    .setName('sethiregoal')
    .setDescription('Set the monthly team hire goal (admin)')
    .addIntegerOption(opt => opt.setName('count').setDescription('Goal number of hires for the month').setRequired(true)),
  async execute(interaction) {
    const isAdmin = interaction.member && interaction.member.permissions && interaction.member.permissions.has('ManageGuild');
    if (!isAdmin) return interaction.reply({ content: 'You need Admin permissions to use this.', ephemeral: true });
    const count = interaction.options.getInteger('count');
    if (!Number.isFinite(count) || count <= 0) return interaction.reply({ content: 'Enter a positive number like 100.', ephemeral: true });
    await setHireGoal(count);
    await interaction.reply({ content: `✅ Monthly hire goal set to **${count} hires**.`, ephemeral: true });
  },
};

// ── Recruiting MVPs (individual + base shop) for a period ────────────────────────
// period 'weekly' (default) for the Monday MVP; period 'monthly' for the 1st-of-month
// crowns. Default args reproduce the original weekly behavior.
async function computeRecruitingMVPs(period = 'weekly', prevWeek = false, prevMonth = false) {
  const tree = await getTeamTree();
  const rows = await getHireLeaderboard(period, prevWeek, false, prevMonth);
  // Weekly MVP rank reflects the recruiter's CURRENT monthly standing; the monthly
  // crown ranks off the month's own total (current month is empty on the 1st).
  const monthlyMap = period === 'monthly' ? null : await getMonthlyRecruitCountsMap(false);

  let individual = null;
  if (rows.length) {
    const top = rows[0];
    const basis = period === 'monthly' ? top.count : (monthlyMap[top.recruiter_id] || 0);
    const rank = getRecruiterRankForCount(basis);
    individual = { id: top.recruiter_id, count: top.count, rankEmoji: rank.emoji, rankName: rank.name };
  }

  const personal = {};
  for (const r of rows) personal[r.recruiter_id] = (personal[r.recruiter_id] || 0) + r.count;
  const baseEntries = rollupBaseShop(tree, personal);
  let baseShop = null;
  if (baseEntries.length) {
    const top = baseEntries[0];
    const p = tree.getPerson(top.id);
    baseShop = {
      id: top.id,
      count: top.total,
      name: p ? p.name : String(top.id),
      isMention: /^\d{5,}$/.test(top.id),
    };
  }
  return { individual, baseShop };
}

module.exports = {
  buildRecruitingLeaderboardEmbed, buildHireCard, handleHireModal, computeRecruitingMVPs,
  addHireCommand, recruitingLeaderboardCommand, setHireGoalCommand,
};
