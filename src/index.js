// src/index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Events, Collection } = require('discord.js');
const { addSale, getUserStats, getRankForAmount } = require('./database');
const { buildLeaderboardEmbed, formatMoney } = require('./leaderboard');
const {
  saleCommand,
  leaderboardCommand,
  myStatsCommand,
  recentSalesCommand,
  deleteSaleCommand,
} = require('./commands');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();
const commands = [saleCommand, leaderboardCommand, myStatsCommand, recentSalesCommand, deleteSaleCommand];
for (const cmd of commands) client.commands.set(cmd.data.name, cmd);

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
  console.log(`✅ OFG Life Bot is online as ${c.user.tag}`);
  scheduleLeaderboards(client);
});

// ── Slash commands ────────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      const msg = { content: '❌ Something went wrong.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
      else await interaction.reply(msg);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'saleModal') {
    await handleSaleModal(interaction);
  }
});

// ── Modal handler ─────────────────────────────────────────────────────────────
async function handleSaleModal(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const carrier          = interaction.fields.getTextInputValue('carrier').trim();
  const product          = interaction.fields.getTextInputValue('product').trim();
  const leadType         = interaction.fields.getTextInputValue('leadType').trim();
  const presentationType = interaction.fields.getTextInputValue('presentationType').trim();
  const premiumRaw       = interaction.fields.getTextInputValue('premium').trim();

  const premium = parseFloat(premiumRaw.replace(/[$,]/g, ''));
  if (isNaN(premium) || premium <= 0) {
    return interaction.editReply({ content: '❌ Invalid AP amount. Enter a number like `2844`.' });
  }

  addSale({
    userId:     interaction.user.id,
    username:   interaction.user.displayName || interaction.user.username,
    clientName: product, // store product as clientName for compatibility
    policyType: product,
    premium,
    carrier,
    notes: `Lead: ${leadType} | Presentation: ${presentationType}`,
  });

  const stats = getUserStats(interaction.user.id);
  const rank  = getRankForAmount(stats?.monthly_total || 0);

  // Post to sales channel
  const salesChannelId = process.env.SALES_CHANNEL_ID;
  if (salesChannelId) {
    try {
      const channel = await client.channels.fetch(salesChannelId);

      const embed = {
        color: 0xFF4500,
        description: [
          `🚨🔥 **SALE ALERT — ${interaction.user.displayName || interaction.user.username}** 🔥🚨`,
          ``,
          `🏢 **Carrier:** ${carrier}`,
          `💰 **Product:** ${product}`,
          `📞 **Lead Type:** ${leadType}`,
          `📅 **Presentation Type:** ${presentationType}`,
          `💵 **Submitted AP:** ${formatMoney(premium)}`,
          `━━━━━━━━━━━━━━━━━━`,
          `📅 **Daily Total:** ${formatMoney(stats?.daily_total)}`,
          `📈 **Weekly Total:** ${formatMoney(stats?.weekly_total)}`,
          `🏆 **Monthly Total:** ${formatMoney(stats?.monthly_total)}`,
        ].join('\n'),
        footer: { text: `${rank.emoji} ${rank.name} • OFG Life Bot` },
        timestamp: new Date().toISOString(),
      };

      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error('Could not post to sales channel:', err.message);
    }
  }

  await interaction.editReply({
    content: `✅ Sale logged! **${formatMoney(premium)}** AP.\nMonthly total: **${formatMoney(stats?.monthly_total)}** · ${rank.emoji} ${rank.name}`,
  });
}

// ── Scheduled leaderboards ────────────────────────────────────────────────────
function scheduleLeaderboards(client) {
  const postLeaderboard = async (period) => {
    const channelId = process.env.LEADERBOARD_CHANNEL_ID;
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const embed = buildLeaderboardEmbed(period);
      await channel.send({ embeds: [embed] });
      console.log(`⏰ Auto-posted ${period} leaderboard at`, new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Leaderboard post error:', err.message);
    }
  };

  // Daily leaderboard every 2 hours
  setInterval(() => postLeaderboard('daily'), 2 * 60 * 60 * 1000);

  // Weekly leaderboard every 8 hours
  setInterval(() => postLeaderboard('weekly'), 8 * 60 * 60 * 1000);

  // Monthly leaderboard on Mon, Wed, Fri
  setInterval(() => {
    const day = new Date().getDay(); // 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
    if (day === 1 || day === 3 || day === 5) {
      const hour = new Date().getHours();
      if (hour === 9) postLeaderboard('monthly'); // posts at 9am on Mon/Wed/Fri
    }
  }, 60 * 60 * 1000); // check every hour

  console.log('⏰ Leaderboards scheduled: Daily(2hr) Weekly(8hr) Monthly(Mon/Wed/Fri 9am)');
}

client.login(process.env.DISCORD_TOKEN);
