// src/index.js
// Main entry point — starts the bot and wires everything together

require('dotenv').config();
const { Client, GatewayIntentBits, Events, Collection } = require('discord.js');
const { addSale, getUserStats, getRankForAmount } = require('./database');
const { buildSaleAnnouncementEmbed, buildLeaderboardEmbed } = require('./leaderboard');
const {
  saleCommand,
  leaderboardCommand,
  myStatsCommand,
  recentSalesCommand,
  deleteSaleCommand,
} = require('./commands');

// ── Client setup ──────────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Register commands in a Map for easy lookup
client.commands = new Collection();
const commands = [saleCommand, leaderboardCommand, myStatsCommand, recentSalesCommand, deleteSaleCommand];
for (const cmd of commands) {
  client.commands.set(cmd.data.name, cmd);
}

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Vivid Life Bot is online as ${c.user.tag}`);
  console.log(`📊 Serving ${c.guilds.cache.size} server(s)`);

  // Post leaderboard every day at midnight (server time)
  scheduleLeaderboard(client);
});

// ── Slash command handler ─────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error in /${interaction.commandName}:`, err);
      const msg = { content: '❌ Something went wrong. Please try again.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg);
      } else {
        await interaction.reply(msg);
      }
    }
    return;
  }

  // Handle modal submissions
  if (interaction.isModalSubmit() && interaction.customId === 'saleModal') {
    await handleSaleModal(interaction);
  }
});

// ── Modal submission handler ──────────────────────────────────────────────────
async function handleSaleModal(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const clientName = interaction.fields.getTextInputValue('clientName').trim();
  const policyType = interaction.fields.getTextInputValue('policyType').trim();
  const premiumRaw = interaction.fields.getTextInputValue('premium').trim();
  const carrier    = interaction.fields.getTextInputValue('carrier').trim();
  const notes      = interaction.fields.getTextInputValue('notes').trim();

  // Validate premium
  const premium = parseFloat(premiumRaw.replace(/[$,]/g, ''));
  if (isNaN(premium) || premium <= 0) {
    return interaction.editReply({ content: '❌ Invalid premium amount. Please enter a number like `1200`.' });
  }

  // Save to DB
  const result = addSale({
    userId:     interaction.user.id,
    username:   interaction.user.username,
    clientName,
    policyType,
    premium,
    carrier,
    notes,
  });

  // Get updated stats + rank
  const stats = getUserStats(interaction.user.id);
  const rank  = getRankForAmount(stats?.monthly_total || 0);

  const sale = {
    userId: interaction.user.id,
    clientName,
    policyType,
    premium,
    carrier,
    notes,
  };

  // Post announcement to sales channel
  const salesChannelId = process.env.SALES_CHANNEL_ID;
  if (salesChannelId) {
    try {
      const channel = await client.channels.fetch(salesChannelId);
      const announcementEmbed = buildSaleAnnouncementEmbed(sale, stats, rank);
      await channel.send({ embeds: [announcementEmbed] });
    } catch (err) {
      console.error('Could not post to sales channel:', err.message);
    }
  }

  // Confirm to the user (ephemeral)
  await interaction.editReply({
    content: `✅ Sale logged! **$${premium.toLocaleString()}** premium for ${clientName}.\nYour monthly total: **$${(stats?.monthly_total || 0).toLocaleString()}** · Rank: ${rank.emoji} ${rank.name}`,
  });
}

// ── Scheduled daily leaderboard ───────────────────────────────────────────────
function scheduleLeaderboard(client) {
  const post = async () => {
    const channelId = process.env.LEADERBOARD_CHANNEL_ID;
    if (!channelId) return;

    try {
      const channel = await client.channels.fetch(channelId);

      // Post all three periods
      for (const period of ['daily', 'weekly', 'monthly']) {
        const embed = buildLeaderboardEmbed(period);
        await channel.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error('Scheduled leaderboard error:', err.message);
    }
  };

  // Calculate ms until next midnight
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight - now;

  // First post at midnight, then every 24 hours
  setTimeout(() => {
    post();
    setInterval(post, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);

  console.log(`⏰ Daily leaderboard scheduled (next post in ${Math.round(msUntilMidnight / 60000)} minutes)`);
}

// ── Login ─────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
