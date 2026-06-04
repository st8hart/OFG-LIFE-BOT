// src/commands.js
// All slash command definitions and handlers

const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');

const { addSale, getUserStats, getRankForAmount, getRecentSales, deleteSale } = require('./database');
const { buildLeaderboardEmbed, buildSaleAnnouncementEmbed, formatMoney } = require('./leaderboard');

// ── /sale ─────────────────────────────────────────────────────────────────────
// Opens a modal form for logging a new sale
const saleCommand = {
  data: new SlashCommandBuilder()
    .setName('sale')
    .setDescription('Log a new insurance sale 💰'),

  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('saleModal')
      .setTitle('Log New Sale — Vivid Life');

    const clientName = new TextInputBuilder()
      .setCustomId('clientName')
      .setLabel('Client Full Name')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('John Smith')
      .setRequired(true);

    const policyType = new TextInputBuilder()
      .setCustomId('policyType')
      .setLabel('Policy Type')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. Term Life, Whole Life, IUL, Final Expense')
      .setRequired(true);

    const premium = new TextInputBuilder()
      .setCustomId('premium')
      .setLabel('Annual Premium Amount ($)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 1200')
      .setRequired(true);

    const carrier = new TextInputBuilder()
      .setCustomId('carrier')
      .setLabel('Carrier / Insurance Company')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. Mutual of Omaha, Transamerica')
      .setRequired(false);

    const notes = new TextInputBuilder()
      .setCustomId('notes')
      .setLabel('Notes (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Any additional details...')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(clientName),
      new ActionRowBuilder().addComponents(policyType),
      new ActionRowBuilder().addComponents(premium),
      new ActionRowBuilder().addComponents(carrier),
      new ActionRowBuilder().addComponents(notes),
    );

    await interaction.showModal(modal);
  },
};

// ── /leaderboard ──────────────────────────────────────────────────────────────
const leaderboardCommand = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the sales leaderboard 🏆')
    .addStringOption(opt =>
      opt.setName('period')
        .setDescription('Time period')
        .setRequired(false)
        .addChoices(
          { name: '📅 Daily',   value: 'daily'   },
          { name: '📆 Weekly',  value: 'weekly'  },
          { name: '🏆 Monthly', value: 'monthly' },
        )
    ),

  async execute(interaction) {
    const period = interaction.options.getString('period') || 'monthly';
    const embed = buildLeaderboardEmbed(period);
    await interaction.reply({ embeds: [embed] });
  },
};

// ── /mystats ──────────────────────────────────────────────────────────────────
const myStatsCommand = {
  data: new SlashCommandBuilder()
    .setName('mystats')
    .setDescription('View your personal production stats 📊'),

  async execute(interaction) {
    const stats = getUserStats(interaction.user.id);
    const rank = getRankForAmount(stats?.monthly_total || 0);

    const embed = {
      color: parseInt((rank.color || '#57F287').replace('#', ''), 16),
      title: `📊 Stats for ${interaction.user.displayName}`,
      fields: [
        { name: '📅 Today',        value: formatMoney(stats?.daily_total),   inline: true },
        { name: '📆 This Week',    value: formatMoney(stats?.weekly_total),  inline: true },
        { name: '🏆 This Month',   value: formatMoney(stats?.monthly_total), inline: true },
        { name: '📋 Monthly Sales',value: `${stats?.monthly_count || 0} policies`, inline: true },
        { name: '🎖️ Current Rank', value: `${rank.emoji} ${rank.name}`,      inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Vivid Life Bot • Production Tracker' },
    };

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

// ── /recentsales ──────────────────────────────────────────────────────────────
const recentSalesCommand = {
  data: new SlashCommandBuilder()
    .setName('recentsales')
    .setDescription('View the 5 most recent sales logged 📋'),

  async execute(interaction) {
    const sales = getRecentSales(5);

    if (sales.length === 0) {
      return interaction.reply({ content: 'No sales logged yet!', ephemeral: true });
    }

    let desc = '';
    sales.forEach((s, i) => {
      const date = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      desc += `**${i + 1}.** <@${s.user_id}> — ${formatMoney(s.premium)} · ${s.policy_type} · ${date}\n`;
    });

    const embed = {
      color: 0x3498DB,
      title: '📋 Recent Sales',
      description: desc,
      footer: { text: 'Vivid Life Bot • Production Tracker' },
    };

    await interaction.reply({ embeds: [embed] });
  },
};

// ── /deletesale ───────────────────────────────────────────────────────────────
const deleteSaleCommand = {
  data: new SlashCommandBuilder()
    .setName('deletesale')
    .setDescription('Delete a sale by ID (your own sales only)')
    .addIntegerOption(opt =>
      opt.setName('id')
        .setDescription('Sale ID (use /recentsales to find it)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const saleId = interaction.options.getInteger('id');
    const result = deleteSale(saleId, interaction.user.id);

    if (result.changes === 0) {
      return interaction.reply({
        content: '❌ Sale not found or you don\'t have permission to delete it.',
        ephemeral: true,
      });
    }

    await interaction.reply({ content: `✅ Sale #${saleId} deleted.`, ephemeral: true });
  },
};

module.exports = {
  saleCommand,
  leaderboardCommand,
  myStatsCommand,
  recentSalesCommand,
  deleteSaleCommand,
};
