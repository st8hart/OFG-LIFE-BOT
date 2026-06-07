// src/commands.js
const {
  SlashCommandBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder,
} = require('discord.js');

const {
  getUserStats, getRankForAmount, getRecentSales, deleteSale,
  adminDeleteSale, getGoal, setGoal, getTeamStats,
} = require('./database');
const { buildLeaderboardEmbed, formatMoney } = require('./leaderboard');

// ── /sale ─────────────────────────────────────────────────────────────────────
const saleCommand = {
  data: new SlashCommandBuilder().setName('sale').setDescription('Log a new insurance sale'),
  async execute(interaction) {
    const modal = new ModalBuilder().setCustomId('saleModal').setTitle('Log New Sale - OFG');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('carrier').setLabel('Carrier').setStyle(TextInputStyle.Short).setPlaceholder('e.g. Mutual of Omaha, MOO').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('product').setLabel('Product').setStyle(TextInputStyle.Short).setPlaceholder('e.g. IUL, Term Life, Final Expense').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('leadType').setLabel('Lead Type').setStyle(TextInputStyle.Short).setPlaceholder('e.g. A Lead, B Lead, Referral').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('presentationType').setLabel('Presentation Type').setStyle(TextInputStyle.Short).setPlaceholder('e.g. APT, Drop-In, Virtual').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('premium').setLabel('Submitted AP ($)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 2844').setRequired(true)),
    );
    await interaction.showModal(modal);
  },
};

// ── /leaderboard ──────────────────────────────────────────────────────────────
const leaderboardCommand = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('View the sales leaderboard')
    .addStringOption(opt => opt.setName('period').setDescription('Time period').setRequired(false)
      .addChoices({ name: 'Daily', value: 'daily' }, { name: 'Weekly', value: 'weekly' }, { name: 'Monthly', value: 'monthly' })),
  async execute(interaction) {
    const period = interaction.options.getString('period') || 'monthly';
    const embed = await buildLeaderboardEmbed(period);
    await interaction.reply({ embeds: [embed] });
  },
};

// ── /mystats ──────────────────────────────────────────────────────────────────
const myStatsCommand = {
  data: new SlashCommandBuilder().setName('mystats').setDescription('View your personal production stats'),
  async execute(interaction) {
    const stats = await getUserStats(interaction.user.id);
    const rank = getRankForAmount(stats?.monthly_total || 0);
    const nextRanks = require('./database').getRanks();
    const currentRankIdx = nextRanks.findIndex(r => r.name === rank.name);
    const nextRank = nextRanks[currentRankIdx + 1];
    const toNextRank = nextRank ? nextRank.min_monthly - (stats?.monthly_total || 0) : 0;

    const embed = {
      color: parseInt((rank.color || '#57F287').replace('#', ''), 16),
      title: `📊 ${interaction.user.displayName || interaction.user.username} - Production Stats`,
      fields: [
        { name: 'Today',          value: formatMoney(stats?.daily_total),   inline: true },
        { name: 'This Week',      value: formatMoney(stats?.weekly_total),  inline: true },
        { name: 'This Month',     value: formatMoney(stats?.monthly_total), inline: true },
        { name: 'Monthly Sales',  value: `${stats?.monthly_count || 0} policies`, inline: true },
        { name: 'Current Rank',   value: `${rank.emoji} ${rank.name}`,      inline: true },
        { name: 'To Next Rank',   value: nextRank ? `${formatMoney(toNextRank)} to ${nextRank.emoji} ${nextRank.name}` : 'MAX RANK!', inline: true },
        { name: 'Best Day Ever',  value: formatMoney(stats?.best_day),      inline: true },
        { name: 'Best Week Ever', value: formatMoney(stats?.best_week),     inline: true },
        { name: 'Best Month Ever',value: formatMoney(stats?.best_month),    inline: true },
        { name: 'All Time AP',    value: formatMoney(stats?.total_ever),    inline: true },
        { name: 'All Time Sales', value: `${stats?.total_sales || 0} policies`, inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'OFG - Production Tracker' },
    };
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

// ── /teamstats ────────────────────────────────────────────────────────────────
const teamStatsCommand = {
  data: new SlashCommandBuilder().setName('teamstats').setDescription('View overall team production stats'),
  async execute(interaction) {
    const stats = await getTeamStats();
    const embed = {
      color: 0xF1C40F,
      title: 'OFG Team Stats',
      fields: [
        { name: 'This Month AP',     value: formatMoney(stats.monthly_ap),       inline: true },
        { name: 'This Month Sales',  value: `${stats.monthly_sales} policies`,   inline: true },
        { name: 'Active Agents',     value: `${stats.unique_agents}`,            inline: true },
        { name: 'All Time AP',       value: formatMoney(stats.total_ap_ever),    inline: true },
        { name: 'All Time Sales',    value: `${stats.total_sales_ever} policies`,inline: true },
        { name: 'Avg Premium',       value: formatMoney(stats.avg_premium),      inline: true },
        { name: 'Best Day Ever',     value: `${formatMoney(stats.best_day_amount)} on ${stats.best_day_date}`, inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'OFG - Production Tracker' },
    };
    await interaction.reply({ embeds: [embed] });
  },
};

// ── /recentsales ──────────────────────────────────────────────────────────────
const recentSalesCommand = {
  data: new SlashCommandBuilder().setName('recentsales').setDescription('View the 5 most recent sales'),
  async execute(interaction) {
    const sales = await getRecentSales(5);
    if (sales.length === 0) return interaction.reply({ content: 'No sales logged yet!', ephemeral: true });
    let desc = '';
    sales.forEach((s, i) => {
      const date = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      desc += `**${i + 1}.** <@${s.user_id}> - ${formatMoney(s.premium)} - ${s.policy_type} - ${date} (ID: ${s.id})\n`;
    });
    await interaction.reply({ embeds: [{ color: 0x3498DB, title: 'Recent Sales', description: desc, footer: { text: 'OFG - Production Tracker' } }] });
  },
};

// ── /deletesale ───────────────────────────────────────────────────────────────
const deleteSaleCommand = {
  data: new SlashCommandBuilder().setName('deletesale').setDescription('Delete your own sale by ID')
    .addIntegerOption(opt => opt.setName('id').setDescription('Sale ID from /recentsales').setRequired(true)),
  async execute(interaction) {
    const saleId = interaction.options.getInteger('id');
    await deleteSale(saleId, interaction.user.id);
    await interaction.reply({ content: `Sale #${saleId} deleted.`, ephemeral: true });
  },
};

// ── /removesale (admin only) ──────────────────────────────────────────────────
const removeSaleCommand = {
  data: new SlashCommandBuilder().setName('removesale').setDescription('Admin: Remove any sale by ID')
    .addIntegerOption(opt => opt.setName('id').setDescription('Sale ID to remove').setRequired(true)),
  async execute(interaction) {
    if (!interaction.member.permissions.has('ManageGuild')) {
      return interaction.reply({ content: 'You need Admin permissions to use this.', ephemeral: true });
    }
    const saleId = interaction.options.getInteger('id');
    await adminDeleteSale(saleId);
    await interaction.reply({ content: `Sale #${saleId} removed by admin.`, ephemeral: true });
  },
};

// ── /setgoal ──────────────────────────────────────────────────────────────────
const setGoalCommand = {
  data: new SlashCommandBuilder().setName('setgoal').setDescription('Set the monthly team production goal')
    .addIntegerOption(opt => opt.setName('amount').setDescription('Goal amount in dollars').setRequired(true)),
  async execute(interaction) {
    if (!interaction.member.permissions.has('ManageGuild')) {
      return interaction.reply({ content: 'You need Admin permissions to set the goal.', ephemeral: true });
    }
    const amount = interaction.options.getInteger('amount');
    await setGoal(amount);
    await interaction.reply({ content: `Monthly goal set to **$${amount.toLocaleString()}**!` });
  },
};

module.exports = {
  saleCommand, leaderboardCommand, myStatsCommand, teamStatsCommand,
  recentSalesCommand, deleteSaleCommand, removeSaleCommand, setGoalCommand,
};

// ── /challenge ────────────────────────────────────────────────────────────────
const { createChallenge, getActiveChallenge } = require('./database');

const challengeCommand = {
  data: new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Challenge another agent to see who closes more today!')
    .addUserOption(opt => opt.setName('agent').setDescription('Who do you want to challenge?').setRequired(true)),
  async execute(interaction) {
    const target = interaction.options.getUser('agent');
    if (target.id === interaction.user.id) {
      return interaction.reply({ content: 'You cannot challenge yourself!', ephemeral: true });
    }
    const existing = await getActiveChallenge(interaction.user.id);
    if (existing) {
      return interaction.reply({ content: 'You already have an active challenge today!', ephemeral: true });
    }
    await createChallenge(
      interaction.user.id,
      interaction.user.displayName || interaction.user.username,
      target.id,
      target.displayName || target.username
    );
    await interaction.reply({
      content: [
        ``,
        `⚔️ CHALLENGE ISSUED! ⚔️`,
        ``,
        `<@${interaction.user.id}> just challenged <@${target.id}> to a sales battle!`,
        `Who closes more AP by end of day? 👀🔥`,
        `May the best agent win! 💪`,
        ``,
      ].join('\n'),
    });
  },
};

module.exports.challengeCommand = challengeCommand;
