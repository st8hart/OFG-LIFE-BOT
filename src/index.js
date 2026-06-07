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
  console.log(`✅ OFG is online as ${c.user.tag}`);
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
        footer: { text: `${rank.emoji} ${rank.name} • OFG` },
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
      embed.setColor(0xFFD700);

      let intro = '';
      if (period === 'daily') {
        intro = [
          ``,
          `🌅 **A new day is here — but first, let's celebrate yesterday's grinders!**`,
          ``,
          `Every call made, every door knocked, every policy written — it all counts.`,
          `Here's how the team finished yesterday. Salute to everyone who put in the work! 💪`,
          ``,
        ].join('\n');
      } else if (period === 'weekly') {
        intro = [
          ``,
          `🏁 **The week is officially in the books!**`,
          ``,
          `Another week of grinding, closing, and building toward something great.`,
          `These are the final standings — shoutout to everyone who showed up and showed out! 🔥`,
          `The top of this board earned it. Let's go even harder next week! 💎`,
          ``,
        ].join('\n');
      } else if (period === 'monthly') {
        intro = [
          ``,
          `👑 **THE MONTH IS OFFICIALLY CLOSED!**`,
          ``,
          `What an incredible run. Month after month this team continues to prove`,
          `what's possible when you stay locked in and trust the process.`,
          ``,
          `🏆 Congratulations to everyone on this leaderboard — especially our top producers`,
          `who set the standard for what ELITE performance looks like at OFG!`,
          ``,
          `New month. Fresh start. New goals. Let's make it even bigger! 🚀🔥`,
          ``,
        ].join('\n');
      }

      await channel.send({ content: intro, embeds: [embed] });
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

  // Helper: get current hour in Central Time (UTC-5 standard, UTC-6 DST)
  // Railway runs UTC so we convert. CDT = UTC-5, CST = UTC-6
  const getCentralHour = () => {
    const now = new Date();
    // Use Intl to get accurate Central time including DST
    const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    return central.getHours();
  };

  const getCentralDay = () => {
    const now = new Date();
    const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    return central.getDay();
  };

  const getCentralDate = () => {
    const now = new Date();
    const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    return central.getDate();
  };

  // Daily leaderboard every 2 hours between 12pm and midnight Central
  setInterval(() => {
    const hour = getCentralHour();
    if (hour >= 12 && hour < 24) {
      postLeaderboard('daily');
    }
  }, 2 * 60 * 60 * 1000);

  // Check every minute for exact-time posts (8:00am, 8:30am etc)
  let lastPosted = {};
  setInterval(() => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const hour = now.getHours();
    const min = now.getMinutes();
    const day = now.getDay();
    const key = (label) => `${label}-${now.toDateString()}-${hour}-${min}`;

    // Weekly leaderboard at 9:00am Central every morning EXCEPT Monday (week just started)
    if (hour === 9 && min === 0 && day !== 1 && !lastPosted[key('weekly')]) {
      lastPosted[key('weekly')] = true;
      postLeaderboard('weekly');
    }

    // Monthly leaderboard on Mon, Wed, Fri at 10am Central
    if ((day === 1 || day === 3 || day === 5) && hour === 10 && min === 0 && !lastPosted[key('monthly')]) {
      lastPosted[key('monthly')] = true;
      postLeaderboard('monthly');
    }

    // 🔚 FINAL DAILY — post at 8:00am the next morning
    if (hour === 8 && min === 0 && !lastPosted[key('final-daily')]) {
      lastPosted[key('final-daily')] = true;
      postFinalLeaderboard('daily', '🔚 YESTERDAY'S FINAL DAILY LEADERBOARD');
    }

    // 🔚 FINAL WEEKLY — post at 8:00am every Monday
    if (day === 1 && hour === 8 && min === 0 && !lastPosted[key('final-weekly')]) {
      lastPosted[key('final-weekly')] = true;
      postFinalLeaderboard('weekly', '🔚 LAST WEEK'S FINAL WEEKLY LEADERBOARD');
    }

    // 🔚 FINAL MONTHLY — post at 8:00am on the 1st of each month
    if (now.getDate() === 1 && hour === 8 && min === 0 && !lastPosted[key('final-monthly')]) {
      lastPosted[key('final-monthly')] = true;
      postFinalLeaderboard('monthly', '🔚 LAST MONTH'S FINAL MONTHLY LEADERBOARD');
    }

  }, 60 * 1000); // check every minute for precision

  console.log('⏰ Leaderboards scheduled in Central Time: Daily(2hr 8am-midnight) Weekly(8:30am daily) Monthly(Mon/Wed/Fri 9am) + Finals at 8am next day');
}

client.login(process.env.DISCORD_TOKEN);
