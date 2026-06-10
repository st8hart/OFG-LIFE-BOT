// src/index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Events, Collection } = require('discord.js');
const {
  addSale, getUserStats, getRankForAmount, getMonthlyTotal, getGoal, setGoal,
  getUserTotalSales, getDailySalesCount, getTeamDailySalesCount, getMonthlyTopSale,
  getActiveChallenge, expireChallenges,
  determineChallengeWinners, getPendingChallengeResults, clearPendingChallengeResults, getAllAgentFirstSales,
  getChallengeStandings,
  getMonthlyChampion, getWeeklyMVP,
  getAllTimeRecords, setAllTimeRecord, getMonthlyRecords,
  getUserDailyTotal, getUserWeeklyTotal,
} = require('./database');
const { buildLeaderboardEmbed, formatMoney } = require('./leaderboard');
const {
  saleCommand, leaderboardCommand, myStatsCommand, teamStatsCommand,
  recentSalesCommand, deleteSaleCommand, removeSaleCommand, setGoalCommand,
  challengeCommand,
  standingsCommand,
  buildStandingsEmbed,
  myPersonalGoalCommand,
  teamGoalsCommand,
  editSaleCommand,
  myEditSaleCommand,
} = require('./commands');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();
const commands = [
  saleCommand, leaderboardCommand, myStatsCommand, teamStatsCommand,
  recentSalesCommand, deleteSaleCommand, removeSaleCommand, setGoalCommand,
  challengeCommand,
  standingsCommand,
  myPersonalGoalCommand,
  teamGoalsCommand,
  editSaleCommand,
  myEditSaleCommand,
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
  if (interaction.isModalSubmit() && interaction.customId.startsWith('saleModal')) {
    await handleSaleModal(interaction);
  }
});

// ── Daily sale milestone system ───────────────────────────────────────────────
// line: shown inside the sale alert embed for all milestones (2+)
// shoutout: separate channel message fired at 3+ only
function getSalesMilestone(count) {
  if (count >= 8) return {
    line: `🌌 SUPERNOVA — ${count} SALES TODAY! 🌌`,
    shoutout: (id) => [
      ``,
      `🌌 SUPERNOVA! 🌌`,
      ``,
      `<@${id}> just logged sale #${count} today.`,
      `Eight closes in a single day. A SUPERNOVA — the brightest explosion in the universe.`,
      `We are not just watching a great day. We are watching OFG HISTORY.`,
      `Tag someone who needs to see this. 👑`,
      ``,
    ].join('\n'),
  };
  if (count === 7) return {
    line: `🌋 VOLCANIC FIRESTORM — 7 SALES TODAY! 🌋`,
    shoutout: (id) => [
      ``,
      `🌋 VOLCANIC FIRESTORM! 🌋`,
      ``,
      `<@${id}> just dropped sale #7 today.`,
      `Seven. In ONE day. The mountain did not stop erupting — neither are they.`,
      `This is elite level production. Someone CHALLENGE this. 👀🔥`,
      ``,
    ].join('\n'),
  };
  if (count === 6) return {
    line: `🌊 TIDAL WAVE OF AP — 6 SALES TODAY! 🌊`,
    shoutout: (id) => [
      ``,
      `🌊 TIDAL WAVE OF AP! 🌊`,
      ``,
      `<@${id}> just crashed through sale #6 today.`,
      `Six closes. The wave started small — now it is WIPING OUT the board.`,
      `Get out of the way or get on the board. 💰`,
      ``,
    ].join('\n'),
  };
  if (count === 5) return {
    line: `⛈️ AP THUNDERSTORM — 5 SALES TODAY! ⛈️`,
    shoutout: (id) => [
      ``,
      `⛈️ AP THUNDERSTORM! ⛈️`,
      ``,
      `<@${id}> just hit sale #5 today and the forecast says CLOSING SEASON.`,
      `Five policies written. The storm is HERE and it is not stopping. ⚡`,
      ``,
    ].join('\n'),
  };
  if (count === 4) return {
    line: `🍀 FOUR LEAF CLOVER — 4 SALES TODAY! 🍀`,
    shoutout: (id) => [
      ``,
      `🍀 FOUR LEAF CLOVER! 🍀`,
      ``,
      `<@${id}> just locked in sale #4 today.`,
      `Some people find luck. This one MAKES it. Keep stacking. 💪`,
      ``,
    ].join('\n'),
  };
  if (count === 3) return {
    line: `🎩 HAT TRICK — 3 SALES TODAY! 🎩`,
    shoutout: (id) => [
      ``,
      `🎩 HAT TRICK! 🎩`,
      ``,
      `<@${id}> just dropped their 3rd sale of the day — and the board knows it.`,
      `Three closes. One day. Zero excuses. Who's next? 🔥`,
      ``,
    ].join('\n'),
  };
  if (count === 2) return {
    line: `🔥 HEATING UP — 2 SALES TODAY! 🔥`,
    shoutout: null,
  };
  return null;
}

async function handleSaleModal(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const carrier          = interaction.fields.getTextInputValue('carrier').trim();
  const product          = interaction.fields.getTextInputValue('product').trim();
  const leadType         = interaction.fields.getTextInputValue('leadType').trim();
  const presentationType = interaction.customId.split(':')[1] || 'Unknown';
  const premiumRaw       = interaction.fields.getTextInputValue('premium').trim();
  const premium = parseFloat(premiumRaw.replace(/[$,]/g, ''));
  if (isNaN(premium) || premium <= 0) {
    return interaction.editReply({ content: 'Invalid AP amount. Enter a number like 2844.' });
  }

  const displayName = interaction.user.displayName || interaction.user.username;

  // Check if this is their first ever sale
  const totalSalesBefore = await getUserTotalSales(interaction.user.id);
  const isFirstEver = totalSalesBefore === 0;

  // Check if this is first sale of the day for ANYONE on the team
  const teamDailyCountBefore = await getTeamDailySalesCount();
  const isFirstOfDay = teamDailyCountBefore === 0;

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

      const milestone = getSalesMilestone(dailyCount);

      // Main sale alert
      const embed = {
        color: 0xFF4500,
        description: [
          `🚨🔥 SALE ALERT - ${displayName} 🔥🚨`,
          ``,
          ...(milestone ? [milestone.line, ``] : []),
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

      // Shoutout fires separately at 3+ sales
      if (milestone?.shoutout) {
        await channel.send(milestone.shoutout(interaction.user.id));
      }

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

  const postFinalLeaderboard = async (period, intro, prevWeek = false) => {
    const channelId = process.env.LEADERBOARD_CHANNEL_ID;
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const embed = await buildLeaderboardEmbed(period, prevWeek);
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
        const mvp = await getWeeklyMVP(true); // true = look at last week, not this new week
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

    // Determine challenge winners at 11:55pm BEFORE daily totals reset at midnight
    if (hour === 23 && min === 55 && !lastPosted[key('challenge-winners')]) {
      lastPosted[key('challenge-winners')] = true;
      try { await determineChallengeWinners(); } catch (err) { console.error('Challenge winner error:', err.message); }
    }

    // Post challenge results at 9:30am — after anniversaries, clean gap before monthly
    if (hour === 9 && min === 30 && !lastPosted[key('challenge-results')]) {
      lastPosted[key('challenge-results')] = true;
      try {
        const results = await getPendingChallengeResults();
        const channelId = process.env.SALES_CHANNEL_ID;
        if (results.length && channelId) {
          const ch = await client.channels.fetch(channelId);
          for (const result of results) {
            if (result.tie) {
              await ch.send([
                ``,
                `⚔️🤝 CHALLENGE RESULT — IT'S A TIE! 🤝⚔️`,
                ``,
                `<@${result.winner.id}> vs <@${result.loser.id}> — both finished with **${formatMoney(result.winner.total)}** AP!`,
                ``,
                `Dead even. Both of you went to WAR yesterday — respect. 💪`,
                `Rematch? Run it back. 🔥`,
                ``,
              ].join('\n'));
            } else {
              await ch.send([
                ``,
                `⚔️🏆 CHALLENGE RESULT IS IN! 🏆⚔️`,
                ``,
                `Yesterday's battle has been decided...`,
                ``,
                `👑 WINNER: <@${result.winner.id}> — **${formatMoney(result.winner.total)}** AP`,
                `😤 Runner Up: <@${result.loser.id}> — **${formatMoney(result.loser.total)}** AP`,
                ``,
                `That's what it looks like when you CLOSE under pressure. Bow out or run it back! 🔥`,
                ``,
              ].join('\n'));
            }
          }
          await clearPendingChallengeResults();
        }
      } catch (err) { console.error('Challenge results post error:', err.message); }
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

    // Final Daily at 8am — skip Monday (too hectic with weekly announcements)
    if (hour === 8 && min === 0 && day !== 1 && !lastPosted[key('final-daily')]) {
      lastPosted[key('final-daily')] = true;
      postFinalLeaderboard('daily', [
        ``,
        `🌅🔥 YESTERDAY'S RESULTS ARE IN! 🔥🌅`,
        ``,
        `While others were sleeping, OFG was CLOSING. 😤💰`,
        `Every call picked up, every objection crushed, every policy written — it all COUNTS.`,
        ``,
        `⬇️ Here's how the team FINISHED yesterday. Salute to everyone who put in work! 🫡`,
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

    // ⚔️ Friday 12pm — Weekly Head to Head Standings
    if (day === 5 && hour === 12 && min === 0 && !lastPosted[key('h2h-standings')]) {
      lastPosted[key('h2h-standings')] = true;
      try {
        const channelId = process.env.SALES_CHANNEL_ID;
        if (channelId) {
          const ch = await client.channels.fetch(channelId);
          const records = await getChallengeStandings();
          await ch.send([
            ``,
            `🚨⚔️ OFG HEAD TO HEAD STANDINGS ⚔️🚨`,
            ``,
            `The battlefield report is in! Here's who has been DOMINATING the challenge board! 💪🔥`,
            `Every W was EARNED. Every L is motivation. Who's climbing the ranks? 👀`,
            ``,
            `Think you can move up? Drop a \`/challenge\` and handle your business! 👊`,
            ``,
          ].join('\n'));
          await ch.send({ embeds: [buildStandingsEmbed(records)] });
        }
      } catch (err) { console.error('H2H standings post error:', err.message); }
    }

    // Final Weekly Monday 8am — uses prevWeek=true so it shows last week, not this new week
    if (day === 1 && hour === 8 && min === 0 && !lastPosted[key('final-weekly')]) {
      lastPosted[key('final-weekly')] = true;
      postFinalLeaderboard('weekly', [
        ``,
        `🚨🏁 THE WEEK HAS BEEN DECIDED! 🏁🚨`,
        ``,
        `Seven days of calls, closes, and zero excuses — and THIS board shows exactly who showed up! 💪🔥`,
        ``,
        `👑 FINAL WEEKLY STANDINGS — officially LOCKED IN. 👑`,
        ``,
        `Bow to the top of this board. Every dollar on it was EARNED. 🫡🏆`,
        `Now shake it off, reload, and come back HUNGRY. The board resets — the grind NEVER does. 💥`,
        ``,
      ].join('\n'), true);
    }

    // New month personal goal reminder - 1st of month at 7am
    if (now.getDate() === 1 && hour === 7 && min === 0 && !lastPosted[key('new-month-goals')]) {
      lastPosted[key('new-month-goals')] = true;
      try {
        const salesChannelId = process.env.SALES_CHANNEL_ID;
        if (salesChannelId) {
          const ch = await client.channels.fetch(salesChannelId);
          const monthName = now.toLocaleString('en-US', { month: 'long' }).toUpperCase();
          await ch.send([
            ``,
            `🎉🎊 WELCOME TO ${monthName}! 🎊🎉`,
            ``,
            `A brand new month means a brand new opportunity to level up!`,
            `Last month is in the books — this month we go BIGGER. 🚀`,
            ``,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `🎯 **SET YOUR PERSONAL GOAL FOR ${monthName}!**`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            ``,
            `Every agent needs to set their personal production goal for the month.`,
            `Type the command below and enter your target AP:`,
            ``,
            `👉 \`/mypersonalgoal\``,
            ``,
            `Your goal is private — only YOU can see your personal progress.`,
            `But the team can see everyone is locked in and ready to go! 💪`,
            ``,
            `The team monthly goal is **$${(await getGoal()).toLocaleString()}** — lets CRUSH it together! 🔥`,
            ``,
            `New month. Fresh start. No excuses. Lets GET IT! 👑`,
            ``,
          ].join('\n'));
        }
      } catch (err) { console.error('New month goal reminder error:', err.message); }
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
