// src/index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Events, Collection } = require('discord.js');
const { addSale, getUserStats, getRankForAmount, getMonthlyTotal, getGoal, setGoal } = require('./database');
const { buildLeaderboardEmbed, formatMoney } = require('./leaderboard');
const {
  saleCommand,
  leaderboardCommand,
  myStatsCommand,
  recentSalesCommand,
  deleteSaleCommand,
  setGoalCommand,
} = require('./commands');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();
const commands = [saleCommand, leaderboardCommand, myStatsCommand, recentSalesCommand, deleteSaleCommand, setGoalCommand];
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

  // Check if monthly total has hit or exceeded the goal → auto-increment by $50k
  const currentGoal = getGoal();
  const monthlyTotal = getMonthlyTotal();
  if (monthlyTotal >= currentGoal) {
    const newGoal = currentGoal + 50000;
    setGoal(newGoal);
    const salesChannelId2 = process.env.SALES_CHANNEL_ID;
    if (salesChannelId2) {
      try {
        const ch = await client.channels.fetch(salesChannelId2);
        await ch.send([
          `🎉🏆 **GOAL CRUSHED! $${currentGoal.toLocaleString()} ACHIEVED!** 🏆🎉`,
          ``,
          `🚀 The team has blown past the goal! Time to level up!`,
          `🆕 **New Monthly Goal: $${newGoal.toLocaleString()}**`,
          ``,
          `Let's get it! 💪🔥`,
        ].join('\n'));
      } catch (err) {
        console.error('Goal announcement error:', err.message);
      }
    }
  }

  await interaction.editReply({
    content: `✅ Sale logged! **${formatMoney(premium)}** AP.\nMonthly total: **${formatMoney(stats?.monthly_total)}** · ${rank.emoji} ${rank.name}`,
  });
}

// ── Scheduled leaderboards ────────────────────────────────────────────────────
function scheduleLeaderboards(client) {
  const postFinalLeaderboard = async (period, title) => {
    const channelId = process.env.LEADERBOARD_CHANNEL_ID;
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const embed = buildLeaderboardEmbed(period);
      embed.setTitle(`${title} — ${embed.data.title}`);
      embed.setColor(0xFF4500);
      await channel.send({ content: `🚨 **${title}** — Final standings before reset!`, embeds: [embed] });
      console.log(`⏰ Posted ${title}`);
    } catch (err) {
      console.error('Final leaderboard error:', err.message);
    }
  };

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

  // Check every hour for scheduled and end-of-period posts
  setInterval(() => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();    // 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
    const date = now.getDate();

    // Monthly leaderboard on Mon, Wed, Fri at 9am
    if ((day === 1 || day === 3 || day === 5) && hour === 9) {
      postLeaderboard('monthly');
    }

    // 🔚 END OF DAY — Final daily leaderboard at 11pm every night
    if (hour === 23) {
      postFinalLeaderboard('daily', '🔚 FINAL DAILY LEADERBOARD');
    }

    // 🔚 END OF WEEK — Final weekly leaderboard at 11pm every Sunday
    if (day === 0 && hour === 23) {
      postFinalLeaderboard('weekly', '🔚 FINAL WEEKLY LEADERBOARD');
    }

    // 🔚 END OF MONTH — Check if tomorrow is the 1st (last day of month at 11pm)
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (tomorrow.getDate() === 1 && hour === 23) {
      postFinalLeaderboard('monthly', '🔚 FINAL MONTHLY LEADERBOARD');
    }

  }, 60 * 60 * 1000); // check every hour

  console.log('⏰ Leaderboards scheduled: Daily(2hr) Weekly(8hr) Monthly(Mon/Wed/Fri 9am) + End-of-period finals');
}

client.login(process.env.DISCORD_TOKEN);
