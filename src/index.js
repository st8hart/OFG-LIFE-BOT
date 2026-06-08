// src/index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Events, Collection } = require('discord.js');
const {
  addSale, getUserStats, getRankForAmount, getMonthlyTotal, getGoal, setGoal,
  getUserTotalSales, getDailySalesCount, getMonthlyTopSale,
  getActiveChallenge, expireChallenges, getAllAgentFirstSales,
  getMonthlyChampion, getWeeklyMVP,
  getAllTimeRecords, setAllTimeRecord, getMonthlyRecords,
  getUserDailyTotal, getUserWeeklyTotal,
} = require('./database');
const { buildLeaderboardEmbed, formatMoney } = require('./leaderboard');
const {
  saleCommand, leaderboardCommand, myStatsCommand, teamStatsCommand,
  recentSalesCommand, deleteSaleCommand, removeSaleCommand, setGoalCommand,
  challengeCommand,
} = require('./commands');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();
const commands = [
  saleCommand, leaderboardCommand, myStatsCommand, teamStatsCommand,
  recentSalesCommand, deleteSaleCommand, removeSaleCommand, setGoalCommand,
  challengeCommand,
];
for (const cmd of commands) client.commands.set(cmd.data.name, cmd);

client.once(Events.ClientReady, (c) => {
  console.log(`OFG Bot online as ${c.user.tag}`);
  scheduleLeaderboards(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try { await command.execute(interaction); }
    catch (err) {
      console.error(err);
      const msg = { content: 'Something went wrong.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
      else await interaction.reply(msg);
    }
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId === 'saleModal') {
    await handleSaleModal(interaction);
  }
});

async function handleSaleModal(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const carrier          = interaction.fields.getTextInputValue('carrier').trim();
  const product          = interaction.fields.getTextInputValue('product').trim();
  const leadType         = interaction.fields.getTextInputValue('leadType').trim();
  const presentationType = interaction.fields.getTextInputValue('presentationType').trim();
  const premiumRaw       = interaction.fields.getTextInputValue('premium').trim();
  const premium = parseFloat(premiumRaw.replace(/[$,]/g, ''));
  if (isNaN(premium) || premium <= 0) {
    return interaction.editReply({ content: 'Invalid AP amount. Enter a number like 2844.' });
  }

  const displayName = interaction.user.displayName || interaction.user.username;

  // Check if this is their first ever sale
  const totalSalesBefore = await getUserTotalSales(interaction.user.id);
  const isFirstEver = totalSalesBefore === 0;

  // Check if this is first sale of the day for anyone
  const dailyCountBefore = await getDailySalesCount(interaction.user.id);
  const isFirstOfDay = dailyCountBefore === 0;

  // Get current monthly top sale before adding
  const prevTopSale = await getMonthlyTopSale();

  await addSale({
    userId: interaction.user.id,
    username: displayName,
    clientName: product,
    policyType: product,
    premium, carrier,
    notes: `Lead: ${leadType} | Presentation: ${presentationType}`,
  });

  const stats = await getUserStats(interaction.user.id);
  const prevMonthlyTotal = (stats?.monthly_total || 0) - premium;
  const prevRank = getRankForAmount(prevMonthlyTotal);
  const newRank = getRankForAmount(stats?.monthly_total || 0);
  const leveledUp = prevRank.name !== newRank.name;

  const dailyCount = await getDailySalesCount(interaction.user.id);
  const isHotStreak = dailyCount >= 3;

  const salesChannelId = process.env.SALES_CHANNEL_ID;
  if (salesChannelId) {
    try {
      const channel = await client.channels.fetch(salesChannelId);

      // Main sale alert
      const streakBadge = isHotStreak ? ' 🔥🔥🔥 HOT STREAK' : '';
      const embed = {
        color: 0xFF4500,
        description: [
          `🚨🔥 SALE ALERT - ${displayName}${streakBadge} 🔥🚨`,
          ``,
          `🏢 Carrier: ${carrier}`,
          `💰 Product: ${product}`,
          `📞 Lead Type: ${leadType}`,
          `📅 Presentation Type: ${presentationType}`,
          `💵 Submitted AP: ${formatMoney(premium)}`,
          `━━━━━━━━━━━━━━━━━━`,
          `📅 Daily Total: ${formatMoney(stats?.daily_total)}`,
          `📈 Weekly Total: ${formatMoney(stats?.weekly_total)}`,
          `🏆 Monthly Total: ${formatMoney(stats?.monthly_total)}`,
        ].join('\n'),
        footer: { text: `${newRank.emoji} ${newRank.name} - OFG` },
        timestamp: new Date().toISOString(),
      };
      await channel.send({ embeds: [embed] });

      // Whale alert for sales over $3000
      if (premium >= 3000) {
        await channel.send([
          ``,
          `🐳🚨 WHALE ALERT! 🚨🐳`,
          ``,
          `<@${interaction.user.id}> just landed a ${formatMoney(premium)} AP sale!`,
          `That is a BIG one! Keep it going! 💰💰💰`,
          ``,
        ].join('\n'));
      }

      // First ever sale shoutout
      if (isFirstEver) {
        await channel.send([
          ``,
          `🎊✨ WELCOME TO THE BOARD! ✨🎊`,
          ``,
          `<@${interaction.user.id}> just logged their FIRST EVER SALE at OFG!`,
          `${formatMoney(premium)} AP to kick things off - the journey begins NOW!`,
          `Welcome to the team! 🚀`,
          ``,
        ].join('\n'));
      }

      // First sale of the day
      if (isFirstOfDay) {
        await channel.send([
          ``,
          `🌅 FIRST BLOOD! 🌅`,
          ``,
          `<@${interaction.user.id}> just opened the board today with ${formatMoney(premium)} AP!`,
          `The hunt is ON. Who is next? 🔥`,
          ``,
        ].join('\n'));
      }

      // Rank up announcement
      if (leveledUp) {
        await channel.send([
          ``,
          `⬆️🎉 RANK UP! 🎉⬆️`,
          ``,
          `<@${interaction.user.id}> just leveled up to ${newRank.emoji} ${newRank.name}!`,
          `From ${prevRank.emoji} ${prevRank.name} to ${newRank.emoji} ${newRank.name} - LETS GO! 🔥`,
          ``,
        ].join('\n'));
      }

      // Biggest single sale of the month
      if (!prevTopSale || premium > parseFloat(prevTopSale.premium)) {
        await channel.send([
          ``,
          `💥 BIGGEST MONTHLY SALE! 💥`,
          ``,
          `<@${interaction.user.id}> just set the record for the biggest sale of the month with ${formatMoney(premium)} AP!`,
          `Can anyone top it before the month ends? 🔥`,
          ``,
        ].join('\n'));
      }

      // Check daily total record for this month
      const myDailyTotal = await getUserDailyTotal(interaction.user.id);
      const { bestDay: monthBestDay, bestWeek: monthBestWeek } = await getMonthlyRecords();
      if (!monthBestDay || myDailyTotal > monthBestDay.total) {
        await channel.send([
          ``,
          `🏅 BIGGEST SALES DAY THIS MONTH! 🏅`,
          ``,
          `<@${interaction.user.id}> just had the biggest sales day of the month with ${formatMoney(myDailyTotal)} AP today!`,
          `That is the day to beat! 🔥`,
          ``,
        ].join('\n'));
      }

      // Check weekly total record for this month
      const myWeeklyTotal = await getUserWeeklyTotal(interaction.user.id);
      if (!monthBestWeek || myWeeklyTotal > monthBestWeek.total) {
        await channel.send([
          ``,
          `🏅 BIGGEST SALES WEEK THIS MONTH! 🏅`,
          ``,
          `<@${interaction.user.id}> just had the biggest sales week of the month with ${formatMoney(myWeeklyTotal)} AP this week!`,
          `The weekly bar has been raised! 💪🔥`,
          ``,
        ].join('\n'));
      }

      // All time records check
      const records = await getAllTimeRecords();

      // All time biggest day
      if (myDailyTotal > parseFloat(records.alltime_day_amount || 0)) {
        const prev = records.alltime_day_username ? `Previous record: ${formatMoney(records.alltime_day_amount)} by ${records.alltime_day_username}` : 'First all time record set!';
        await setAllTimeRecord('day', myDailyTotal, interaction.user.id, displayName);
        await channel.send([
          ``,
          `🌟 ALL TIME DAILY RECORD BROKEN! 🌟`,
          ``,
          `<@${interaction.user.id}> just had the BIGGEST SALES DAY in OFG history with ${formatMoney(myDailyTotal)} AP in a single day!`,
          `That is an OFG LEGEND performance! 🏆🔥`,
          prev,
          ``,
        ].join('\n'));
      }

      // All time biggest week
      if (myWeeklyTotal > parseFloat(records.alltime_week_amount || 0)) {
        const prev = records.alltime_week_username ? `Previous record: ${formatMoney(records.alltime_week_amount)} by ${records.alltime_week_username}` : 'First all time record set!';
        await setAllTimeRecord('week', myWeeklyTotal, interaction.user.id, displayName);
        await channel.send([
          ``,
          `🌟 ALL TIME WEEKLY RECORD BROKEN! 🌟`,
          ``,
          `<@${interaction.user.id}> just had the BIGGEST SALES WEEK in OFG history with ${formatMoney(myWeeklyTotal)} AP this week!`,
          `Absolutely UNSTOPPABLE! 🏆🔥`,
          prev,
          ``,
        ].join('\n'));
      }

      // All time biggest month
      const myMonthlyTotal = stats?.monthly_total || 0;
      if (myMonthlyTotal > parseFloat(records.alltime_month_amount || 0)) {
        const prev = records.alltime_month_username ? `Previous record: ${formatMoney(records.alltime_month_amount)} by ${records.alltime_month_username}` : 'First all time record set!';
        await setAllTimeRecord('month', myMonthlyTotal, interaction.user.id, displayName);
        await channel.send([
          ``,
          `🌟 ALL TIME MONTHLY RECORD BROKEN! 🌟`,
          ``,
          `<@${interaction.user.id}> just had the BIGGEST SALES MONTH in OFG history with ${formatMoney(myMonthlyTotal)} AP!`,
          `This is what LEGEND status looks like at OFG! 👑🏆🔥`,
          prev,
          ``,
        ].join('\n'));
      }

    } catch (err) {
      console.error('Sales channel error:', err.message);
    }
  }

  // Challenge update
  const challenge = await getActiveChallenge(interaction.user.id);
  if (challenge && salesChannelId) {
    try {
      const ch = await client.channels.fetch(salesChannelId);
      const isChallenger = challenge.challenger_id === interaction.user.id;
      const opponentId = isChallenger ? challenge.challengee_id : challenge.challenger_id;
      const myStats = await getUserStats(interaction.user.id);
      const oppStats = await getUserStats(opponentId);
      const myTotal = myStats?.daily_total || 0;
      const oppTotal = oppStats?.daily_total || 0;
      const leading = myTotal > oppTotal;
      await ch.send([
        ``,
        `⚔️ CHALLENGE UPDATE`,
        `<@${interaction.user.id}>: ${formatMoney(myTotal)} vs <@${opponentId}>: ${formatMoney(oppTotal)}`,
        leading ? `<@${interaction.user.id}> is in the LEAD! 🔥` : `<@${opponentId}> is leading - time to close! 💪`,
        ``,
      ].join('\n'));
    } catch (err) { console.error('Challenge update error:', err.message); }
  }

  // Goal auto-increment
  const currentGoal = await getGoal();
  const monthlyTotal = await getMonthlyTotal();
  if (monthlyTotal >= currentGoal) {
    const newGoal = currentGoal + 50000;
    await setGoal(newGoal);
    if (salesChannelId) {
      try {
        const ch = await client.channels.fetch(salesChannelId);
        await ch.send([
          ``,
          `🎉🏆 GOAL CRUSHED! $${currentGoal.toLocaleString()} ACHIEVED! 🏆🎉`,
          ``,
          `The team has blown past the goal! Time to level up!`,
          `New Monthly Goal: $${newGoal.toLocaleString()}`,
          ``,
          `Lets get it! 💪🔥`,
          ``,
        ].join('\n'));
      } catch (err) { console.error('Goal error:', err.message); }
    }
  }

  await interaction.editReply({
    content: `Sale logged! ${formatMoney(premium)} AP. Monthly: ${formatMoney(stats?.monthly_total)} - ${newRank.emoji} ${newRank.name}`,
  });
}

function getCentralHour() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })).getHours();
}

function scheduleLeaderboards(client) {
  const postLeaderboard = async (period) => {
    const channelId = process.env.LEADERBOARD_CHANNEL_ID;
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const embed = await buildLeaderboardEmbed(period);
      await channel.send({ embeds: [embed] });
    } catch (err) { console.error('Leaderboard error:', err.message); }
  };

  const postFinalLeaderboard = async (period, intro) => {
    const channelId = process.env.LEADERBOARD_CHANNEL_ID;
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const embed = await buildLeaderboardEmbed(period);
      embed.setColor(0xFFD700);
      await channel.send({ content: intro, embeds: [embed] });
    } catch (err) { console.error('Final leaderboard error:', err.message); }
  };

  // Daily every 2hrs 12pm-midnight Central
  setInterval(() => {
    const hour = getCentralHour();
    if (hour >= 12 && hour < 24) postLeaderboard('daily');
  }, 2 * 60 * 60 * 1000);

  // Minute checker for exact times
  let lastPosted = {};
  setInterval(async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const hour = now.getHours();
    const min = now.getMinutes();
    const day = now.getDay();
    const key = (label) => `${label}-${now.toDateString()}-${hour}-${min}`;

    // Weekly MVP every Monday at 8:05am
    if (day === 1 && hour === 8 && min === 5 && !lastPosted[key('mvp')]) {
      lastPosted[key('mvp')] = true;
      try {
        const mvp = await getWeeklyMVP();
        const channelId = process.env.SALES_CHANNEL_ID;
        if (mvp && channelId) {
          const ch = await client.channels.fetch(channelId);
          const rank = getRankForAmount(mvp.total);
          await ch.send([
            ``,
            `👑 WEEKLY MVP ANNOUNCEMENT 👑`,
            ``,
            `After a full week of grinding, one agent stood above the rest...`,
            ``,
            `🏆 <@${mvp.user_id}> - ${formatMoney(mvp.total)} AP this week!`,
            `${rank.emoji} ${rank.name} - absolutely ELITE performance!`,
            ``,
            `Lets keep that same energy this week! 🔥`,
            ``,
          ].join('\n'));
        }
      } catch (err) { console.error('MVP error:', err.message); }
    }

    // Monthly champion on 1st at 8:05am
    if (now.getDate() === 1 && hour === 8 && min === 5 && !lastPosted[key('champion')]) {
      lastPosted[key('champion')] = true;
      try {
        const champion = await getMonthlyChampion();
        const channelId = process.env.SALES_CHANNEL_ID;
        if (champion && channelId) {
          const ch = await client.channels.fetch(channelId);
          const rank = getRankForAmount(champion.total);
          await ch.send([
            ``,
            `👑🏆 MONTHLY CHAMPION CROWNED! 🏆👑`,
            ``,
            `After an entire month of competition, one agent came out on TOP!`,
            ``,
            `CONGRATULATIONS to <@${champion.user_id}>!`,
            ``,
            `💰 ${formatMoney(champion.total)} AP this month`,
            `${rank.emoji} ${rank.name} - LEGENDARY performance!`,
            ``,
            `Tag your teammates - show them what ELITE looks like at OFG! 🔥🔥🔥`,
            ``,
          ].join('\n'));
        }
      } catch (err) { console.error('Champion error:', err.message); }
    }

    // Reset challenges at midnight
    if (hour === 0 && min === 0 && !lastPosted[key('reset-challenges')]) {
      lastPosted[key('reset-challenges')] = true;
      try { await expireChallenges(); } catch (err) { console.error('Challenge reset error:', err.message); }
    }

    // Sale anniversaries - check every day at 9:05am
    if (hour === 9 && min === 5 && !lastPosted[key('anniversaries')]) {
      lastPosted[key('anniversaries')] = true;
      try {
        const agents = await getAllAgentFirstSales();
        const channelId = process.env.SALES_CHANNEL_ID;
        if (channelId) {
          const ch = await client.channels.fetch(channelId);
          for (const agent of agents) {
            const firstDate = new Date(agent.created_at);
            const today = new Date();
            if (
              firstDate.getMonth() === today.getMonth() &&
              firstDate.getDate() === today.getDate() &&
              firstDate.getFullYear() !== today.getFullYear()
            ) {
              const years = today.getFullYear() - firstDate.getFullYear();
              await ch.send([
                ``,
                `🎂🎉 SALES ANNIVERSARY! 🎉🎂`,
                ``,
                `On this day ${years} year${years !== 1 ? 's' : ''} ago, <@${agent.user_id}> logged their very first sale at OFG!`,
                ``,
                `From day one to now - look how far you have come! 🚀`,
                `Happy anniversary and heres to many more closes! 💎`,
                ``,
              ].join('\n'));
            }
          }
        }
      } catch (err) { console.error('Anniversary error:', err.message); }
    }

    // Final Daily at 8am
    if (hour === 8 && min === 0 && !lastPosted[key('final-daily')]) {
      lastPosted[key('final-daily')] = true;
      postFinalLeaderboard('daily', [
        ``,
        `A new day is here - lets celebrate yesterday grinders!`,
        `Every call made, every door knocked, every policy written - it all counts.`,
        `Here is how the team finished yesterday. Salute to everyone who put in the work!`,
        ``,
      ].join('\n'));
    }

    // Weekly at 9am except Monday
    if (hour === 9 && min === 0 && day !== 1 && !lastPosted[key('weekly')]) {
      lastPosted[key('weekly')] = true;
      postLeaderboard('weekly');
    }

    // Monthly on Mon/Wed/Fri at 10am
    if ((day === 1 || day === 3 || day === 5) && hour === 10 && min === 0 && !lastPosted[key('monthly')]) {
      lastPosted[key('monthly')] = true;
      postLeaderboard('monthly');
    }

    // Final Weekly Monday 8am
    if (day === 1 && hour === 8 && min === 0 && !lastPosted[key('final-weekly')]) {
      lastPosted[key('final-weekly')] = true;
      postFinalLeaderboard('weekly', [
        ``,
        `The week is officially in the books!`,
        `Another week of grinding, closing, and building toward something great.`,
        `These are the final standings - shoutout to everyone who showed up and showed out!`,
        `The top of this board earned it. Lets go even harder next week!`,
        ``,
      ].join('\n'));
    }

    // Final Monthly on 1st at 8am
    if (now.getDate() === 1 && hour === 8 && min === 0 && !lastPosted[key('final-monthly')]) {
      lastPosted[key('final-monthly')] = true;
      postFinalLeaderboard('monthly', [
        ``,
        `THE MONTH IS OFFICIALLY CLOSED!`,
        `What an incredible run. Month after month this team continues to prove`,
        `whats possible when you stay locked in and trust the process.`,
        ``,
        `Congratulations to everyone on this leaderboard - especially our top producers`,
        `who set the standard for what ELITE performance looks like at OFG!`,
        ``,
        `New month. Fresh start. New goals. Lets make it even bigger!`,
        ``,
      ].join('\n'));
    }

  }, 60 * 1000);

  console.log('OFG Leaderboards scheduled in Central Time');
}

client.login(process.env.DISCORD_TOKEN);
