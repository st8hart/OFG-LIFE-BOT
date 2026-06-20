// src/team-leaderboard.js
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
  getLeaderboard, getMonthlyTotal, getGoal,
  getTeamTree, upsertTeamMember, removeTeamMember, ensureAgencyNode, removeUnassignedProducer,
} = require('./database');
const { buildBoardTitle, buildBoardColor } = require('./board-titles');

const MEDALS = ['🥇', '🥈', '🥉'];
const PERIOD_COLORS = { daily: 0x1ABC9C, weekly: 0xE67E22, monthly: 0xF1C40F };

function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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

function rankLines(tree, entries) {
  return entries.map((e, i) => {
    const medal = MEDALS[i] || `#${i + 1}`;
    return `${medal} ${label(tree, e.id)} — **${formatMoney(e.total)}**`;
  });
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

// BASE SHOP rollup: each person's production goes to their nearest base-shop
// leader. Promoted sub-teams drop out of the parent's shop automatically.
function rollupBaseShop(tree, personal) {
  const totals = {};
  for (const id of tree.baseShopLeaders()) totals[id] = 0;
  for (const [userId, total] of Object.entries(personal)) {
    const owner = tree.getBaseShopOwner(userId);
    if (owner == null) continue;
    totals[owner] = (totals[owner] || 0) + total;
  }
  return Object.entries(totals).map(([id, total]) => ({ id, total }))
    .filter(e => e.total > 0).sort((a, b) => b.total - a.total);
}

// MASTER AGENCY rollup: each leader's line = their ENTIRE subtree, all levels.
function rollupMaster(tree, personal) {
  const userIds = Object.keys(personal);
  return tree.masterLeaders().map(m => {
    let total = 0;
    for (const u of userIds) if (tree.isAncestor(m, u)) total += personal[u];
    return { id: m, total };
  }).filter(e => e.total > 0).sort((a, b) => b.total - a.total);
}

async function buildTeamLeaderboardEmbed(period, prevWeek = false, prevDay = false, prevMonth = false) {
  const tree = await getTeamTree();
  const rows = await getLeaderboard(period, prevWeek, prevDay, prevMonth);
  const personal = {};
  for (const r of rows) personal[r.user_id] = (personal[r.user_id] || 0) + r.total;
  const periodTotal = Object.values(personal).reduce((s, v) => s + v, 0);

  const baseEntries   = rollupBaseShop(tree, personal);
  const masterEntries = rollupMaster(tree, personal);

  const title = buildBoardTitle('team', period, prevWeek, prevDay, prevMonth);

  const embed = new EmbedBuilder().setColor(buildBoardColor('team', period, prevWeek, prevDay, prevMonth)).setTitle(title).setTimestamp();

  // Summary header — period total + agency (monthly) total + goal, like the producer boards
  const monthlyTotal = await getMonthlyTotal(prevMonth);
  const goal = await getGoal();
  if (period === 'daily') {
    embed.addFields({
      name: prevDay ? '📅 Yesterday at a Glance' : '📅 Today at a Glance',
      value: [
        `**Daily Total: ${formatMoney(periodTotal)}**`,
        ``,
        `🏆 Monthly Team Total: ${formatMoney(monthlyTotal)}`,
        `🎯 Monthly Goal: ${formatMoney(goal)}`,
        buildProgressBar(monthlyTotal, goal),
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
        `🎯 Monthly Goal: ${formatMoney(goal)}`,
        buildProgressBar(monthlyTotal, goal),
      ].join('\n'),
      inline: false,
    });
  } else if (period === 'monthly') {
    embed.addFields({
      name: '📊 Agency Total',
      value: [
        `**Team Total: ${formatMoney(monthlyTotal)}**`,
        `🎯 Goal: ${formatMoney(goal)}`,
        buildProgressBar(monthlyTotal, goal),
      ].join('\n'),
      inline: false,
    });
  }

  // Master Agency on top, Base Shop below.
  if (masterEntries.length) {
    for (const f of chunkFields(rankLines(tree, masterEntries), '🏛️ Master Agency · 💵 Production')) embed.addFields(f);
  } else {
    embed.addFields({ name: '🏛️ Master Agency · 💵 Production', value: '*No production logged yet for this period.*', inline: false });
  }
  // Visual divider between the Master Agency and Base Shop sections (same message)
  embed.addFields({ name: '\u200b', value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', inline: false });

  if (baseEntries.length) {
    for (const f of chunkFields(rankLines(tree, baseEntries), '🏢 Base Shop · 💵 Production')) embed.addFields(f);
  } else {
    embed.addFields({ name: '🏢 Base Shop · 💵 Production', value: '*No production logged yet for this period.*', inline: false });
  }

  embed.setFooter({ text: 'OFG - Leadership Tracker' });
  return embed;
}

// ── Render the live tree as text (for /teamsetup) ───────────────────────────────
function renderTreeText(tree) {
  const map = tree.map;
  const ids = Object.keys(map);
  const childrenOf = (parent) => ids.filter(id => map[id].upline === parent);
  const tags = (id) => {
    const t = [];
    if (map[id].virtual) t.push('grouping');
    if (tree.masterLeaders().includes(id)) t.push('Master');
    if (tree.isBaseShopLeader(id)) t.push('Base Shop');
    if (!map[id].virtual && !tree.isBaseShopLeader(id)) t.push('Producer');
    return t.join(' · ');
  };
  const lines = [];
  const walk = (id, prefix, isLast, isRoot) => {
    const branch = isRoot ? '' : (isLast ? '└─ ' : '├─ ');
    lines.push(`${prefix}${branch}${map[id].name}  [${tags(id)}]`);
    const kids = childrenOf(id);
    const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
    kids.forEach((k, i) => walk(k, childPrefix, i === kids.length - 1, false));
  };
  const roots = ids.filter(id => map[id].upline === null);
  if (!roots.length) return '_No team members set up yet. Use `/teamassign` to start._';
  roots.forEach((r, i) => walk(r, '', i === roots.length - 1, true));
  return '```\n' + lines.join('\n') + '\n```';
}

function isAdmin(interaction) {
  return interaction.member && interaction.member.permissions && interaction.member.permissions.has('ManageGuild');
}
function displayNameOf(interaction, optionName) {
  const m = interaction.options.getMember(optionName);
  const u = interaction.options.getUser(optionName);
  return (m && m.displayName) || (u && (u.globalName || u.username)) || (u && u.id) || 'Unknown';
}

// ── /teamleaderboard ────────────────────────────────────────────────────────────
const teamLeaderboardCommand = {
  data: new SlashCommandBuilder()
    .setName('teamleaderboard')
    .setDescription('View the team / leadership leaderboard')
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
    await interaction.deferReply();
    const period = interaction.options.getString('period') || 'monthly';
    if (period === 'yesterday') return interaction.editReply({ embeds: [await buildTeamLeaderboardEmbed('daily', false, true)] });
    if (period === 'lastweek')  return interaction.editReply({ embeds: [await buildTeamLeaderboardEmbed('weekly', true, false)] });
    if (period === 'lastmonth') return interaction.editReply({ embeds: [await buildTeamLeaderboardEmbed('monthly', false, false, true)] });
    await interaction.editReply({ embeds: [await buildTeamLeaderboardEmbed(period)] });
  },
};

// ── /teamassign ─────────────────────────────────────────────────────────────────
// Place a person: set who they report to + whether they have their own base shop.
const teamAssignCommand = {
  data: new SlashCommandBuilder()
    .setName('teamassign')
    .setDescription('Assign a person to a team (admin)')
    .addUserOption(opt => opt.setName('member').setDescription('The person to place').setRequired(true))
    .addStringOption(opt => opt.setName('baseshop').setDescription('Do they have their OWN base shop?').setRequired(true)
      .addChoices({ name: 'Yes — own base shop', value: 'yes' }, { name: 'No — producer', value: 'no' }))
    .addUserOption(opt => opt.setName('leader').setDescription('Their leader (leave empty = directly under the agency)').setRequired(false)),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'You need Admin permissions to use this.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.options.getUser('member');
    const memberName = displayNameOf(interaction, 'member');
    const baseShop = interaction.options.getString('baseshop') === 'yes';
    const leader = interaction.options.getUser('leader');

    await ensureAgencyNode();
    let uplineId = 'OVERALL_AGENCY';
    let leaderNote = 'directly under the Overall Agency';

    if (leader) {
      if (leader.id === member.id) return interaction.editReply({ content: 'Someone cannot be their own leader.' });
      uplineId = leader.id;
      leaderNote = `under ${displayNameOf(interaction, 'leader')}`;
      const tree = await getTeamTree();
      if (!tree.getPerson(leader.id)) {
        // Leader isn't in the chart yet — add them as a base shop under the agency.
        await upsertTeamMember({ userId: leader.id, name: displayNameOf(interaction, 'leader'), uplineId: 'OVERALL_AGENCY', baseShop: true });
        leaderNote += ' (added them as a new base shop under the agency — re-run /teamassign on them if they belong elsewhere)';
      }
    }

    await upsertTeamMember({ userId: member.id, name: memberName, uplineId, baseShop });
    await removeUnassignedProducer(member.id); // they're placed now — clear from the pending queue
    await interaction.editReply({
      content: `✅ ${memberName} placed ${leaderNote}, ${baseShop ? 'WITH their own base shop' : 'as a producer'}.\nRun \`/teamsetup\` to see the full tree.`,
    });
  },
};

// ── /teamremove ─────────────────────────────────────────────────────────────────
const teamRemoveCommand = {
  data: new SlashCommandBuilder()
    .setName('teamremove')
    .setDescription('Remove a person from the team hierarchy (admin)')
    .addUserOption(opt => opt.setName('member').setDescription('The person to remove').setRequired(true)),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'You need Admin permissions to use this.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const member = interaction.options.getUser('member');
    await removeTeamMember(member.id);
    await interaction.editReply({ content: `✅ Removed <@${member.id}> from the team hierarchy. (Their sales still count on the producer board.)` });
  },
};

// ── /teamsetup ──────────────────────────────────────────────────────────────────
const teamSetupCommand = {
  data: new SlashCommandBuilder()
    .setName('teamsetup')
    .setDescription('Show the current team hierarchy as the bot sees it (admin)'),
  async execute(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: 'You need Admin permissions to use this.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const tree = await getTeamTree();
    const text = renderTreeText(tree);
    const masters = tree.masterLeaders().map(id => tree.getPerson(id).name).join(', ') || '—';
    const shops = tree.baseShopLeaders().map(id => tree.getPerson(id).name).join(', ') || '—';
    const body = [
      '**OFG TEAM STRUCTURE (live)**',
      text,
      `🏛️ **Master Agency board:** ${masters}`,
      `🏪 **Base Shop board:** ${shops}`,
    ].join('\n');
    // Discord message cap is 2000 chars — trim if the tree is huge.
    await interaction.editReply({ content: body.length > 1990 ? body.slice(0, 1980) + '\n…(truncated)' : body });
  },
};

module.exports = {
  buildTeamLeaderboardEmbed, formatMoney,
  teamLeaderboardCommand, teamAssignCommand, teamRemoveCommand, teamSetupCommand,
};
