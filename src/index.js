// src/index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Events, Collection, REST, Routes, EmbedBuilder } = require('discord.js');
const {
  addSale, getUserStats, getRankForAmount, getMonthlyTotal, getGoal, setGoal, getTeamStats,
  getUserTotalSales, getDailySalesCount, getTeamDailySalesCount, getMonthlyTopSale, getPersonalBestSale,
  expireChallenges,
  determineChallengeWinners, getPendingChallengeResults, clearPendingChallengeResults, getAllAgentFirstSales,
  getChallengeStandings, getActiveChallenges, getHeadToHead,
  getMonthlyChampion, getWeeklyMVP,
  getAllTimeRecords, setAllTimeRecord, getMonthlyRecords,
  getUserDailyTotal, getUserWeeklyTotal,
  getTeamDailyTotal,
  getTeamTree, recordUnassignedProducer,
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
  challengesCommand,
  resolveChallengesCommand,
  clearPendingChallengesCommand,
} = require('./commands');
const { buildTeamLeaderboardEmbed, computeTeamMVPs, teamLeaderboardCommand, teamAssignCommand, teamRemoveCommand, teamSetupCommand } = require('./team-leaderboard');
const {
  buildRecruitingLeaderboardEmbed, computeRecruitingMVPs,
  addHireCommand, recruitingLeaderboardCommand, setHireGoalCommand,
  handleHireModal,
} = require('./recruiting-leaderboard');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Tracks producers we've already alerted about being unassigned (per bot session),
// so logging several deals while unplaced doesn't spam the channel.
const alertedUnassigned = new Set();

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
  challengesCommand,
  resolveChallengesCommand,
  clearPendingChallengesCommand,
  teamLeaderboardCommand,
  teamAssignCommand,
  teamRemoveCommand,
  teamSetupCommand,
  addHireCommand,
  recruitingLeaderboardCommand,
  setHireGoalCommand,
];
for (const cmd of commands) client.commands.set(cmd.data.name, cmd);

client.once(Events.ClientReady, async (c) => {
  console.log(`OFG Bot online as ${c.user.tag}`);
  // Auto-register slash commands on every startup, so new commands appear after a
  // deploy without needing to run deploy-commands.js by hand. Idempotent — Discord
  // just overwrites the existing guild command list each time.
  try {
    if (process.env.CLIENT_ID && process.env.GUILD_ID) {
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
      const body = commands.map(cmd => cmd.data.toJSON());
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body });
      console.log(`Registered ${body.length} slash commands`);
    } else {
      console.warn('CLIENT_ID / GUILD_ID not set — skipping auto command registration.');
    }
  } catch (err) {
    console.error('Command auto-registration failed:', err.message);
  }
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
  if (interaction.isModalSubmit() && interaction.customId.startsWith('addHireModal')) {
    await handleHireModal(interaction, client);
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

// ── Team Momentum System ──────────────────────────────────────────────────────
// Tracks which daily AP thresholds have already fired today (resets at midnight)
const firedMomentumThresholds = new Set();
let firedRecordWatch = false;

const MOMENTUM_MESSAGES = {
  20000:  () => `💨 THE BOARD IS MOVING! 💨\n\nOFG just crossed $20,000 in AP today.\nEngines are warm. Phones are ringing. Who's next? 🔥`,
  30000:  () => `⚡ $30K AND CLIMBING! ⚡\n\nOFG just crossed $30,000 in AP today.\nThirty thousand and the day is not even close to over.\nThis team does not slow down. Keep dialing. 💪`,
  40000:  () => `🔥 $40K ON THE BOARD! 🔥\n\nOFG just crossed $40,000 in AP today.\nForty thousand dollars of CLOSED business.\nThe momentum is REAL. Somebody keep it going. 👀`,
  50000:  () => `🚀 FIFTY THOUSAND DOLLARS! 🚀\n\nOFG just crossed $50,000 in AP today.\nHalfway to a legendary day and we are not done.\nThis is what a locked-in team looks like. 💎`,
  60000:  () => `💎 $60K — WE ARE ROLLING! 💎\n\nOFG just crossed $60,000 in AP today.\nSixty thousand. The board keeps stacking.\nAnybody sitting on the sideline needs to get IN. 🔥`,
  70000:  () => `👑 $70K AND THE DAY IS STILL OPEN! 👑\n\nOFG just crossed $70,000 in AP today.\nSeventy thousand dollars of closed business today alone.\nRare air. Not many teams on the planet doing this. 🚀`,
  80000:  () => `🌊 $80K — THE WAVE IS UNSTOPPABLE! 🌊\n\nOFG just crossed $80,000 in AP today.\nEighty thousand. Every single close on this board matters.\nWe are building something SPECIAL today. 💪👑`,
  90000:  () => `🌋 $90K — WE ARE ERUPTING! 🌋\n\nOFG just crossed $90,000 in AP today.\nNinety thousand dollars and the board is STILL burning.\nTen thousand away from six figures. Who wants to put us over? 👀🔥`,
  100000: () => `💥 SIX FIGURES IN A SINGLE DAY! 💥\n\nOFG just crossed $100,000 in AP today.\nOne hundred thousand dollars. TODAY.\nThis is what ELITE looks like. The whole industry wishes they were us right now. 🏆🌌`,
  110000: () => `🌌 $110,000. ONE DAY. OFG. 🌌\n\nWe just crossed $110,000 in AP today.\nThis is not a good day. This is not a great day.\nThis is an ALL-TIME day. Every single person who closed — you are the reason.\nThis is what we are built for. 👑`,
};

async function handleSaleModal(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    // Presentation / Carrier / Product are fixed dropdown picks encoded in the
    // customId as "saleModal:<presentation>|<carrier>|<product>". Only Lead Type
    // and AP come from the modal's text inputs.
    const encoded = interaction.customId.slice('saleModal:'.length);
    const [presentationType = 'Unknown', carrier = 'Unknown', product = 'Unknown'] = encoded.split('|');
    const leadType         = interaction.fields.getTextInputValue('leadType').trim();
    const premiumRaw       = interaction.fields.getTextInputValue('premium').trim();
    const premium = parseFloat(premiumRaw.replace(/[$,]/g, ''));
    if (isNaN(premium) || premium <= 0) {
      return interaction.editReply({ content: 'Invalid AP amount. Enter a number like 2844.' });
    }

  const displayName = interaction.member?.displayName
    || interaction.user?.globalName
    || interaction.user?.username
    || interaction.user?.tag
    || `Agent_${interaction.user.id}`;

  // Check if this is their first ever sale
  const totalSalesBefore = await getUserTotalSales(interaction.user.id);
  const isFirstEver = totalSalesBefore === 0;

  // Check if this is first sale of the day for ANYONE on the team
  const teamDailyCountBefore = await getTeamDailySalesCount();
  const isFirstOfDay = teamDailyCountBefore === 0;

  // Get current monthly top sale before adding
  const prevTopSale = await getMonthlyTopSale();

  // Capture personal bests BEFORE adding the sale so we can compare after
  const statsBefore    = await getUserStats(interaction.user.id);
  const prevBestSale   = await getPersonalBestSale(interaction.user.id);

  await addSale({
    userId: interaction.user.id,
    username: displayName || String(interaction.user.id),
    clientName: product,
    policyType: product,
    premium, carrier,
    notes: `Lead: ${leadType} | Presentation: ${presentationType}`,
  });

  // Alert leadership if this seller isn't placed under a base shop / leader yet.
  try {
    const tree = await getTeamTree();
    if (!tree.getBaseShopOwner(interaction.user.id)) {
      const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 256 });

      // Save / update their profile in Supabase so there's a record to act on.
      try {
        await recordUnassignedProducer({ userId: interaction.user.id, name: displayName, avatarUrl });
      } catch (e) { console.error('recordUnassignedProducer failed:', e.message); }

      // DM the leaders (once per session) with a nice card.
      if (!alertedUnassigned.has(interaction.user.id)) {
        alertedUnassigned.add(interaction.user.id);

        const alertEmbed = new EmbedBuilder()
          .setColor(0xE74C3C)
          .setTitle('🚦 New Producer Needs a Team')
          .setThumbnail(avatarUrl)
          .setDescription(`**${displayName}** just logged a deal but isn't placed under a base shop or leader yet. Let's get them assigned so their production rolls up to the right team. 💪`)
          .addFields(
            { name: '👤 Name', value: displayName, inline: true },
            { name: '🆔 Discord ID', value: `\`${interaction.user.id}\``, inline: true },
            { name: '👋 Mention', value: `<@${interaction.user.id}>`, inline: true },
            { name: '💵 Deal Logged', value: `${formatMoney(premium)}${carrier ? ' · ' + carrier : ''}`, inline: false },
            { name: '✅ Next Step', value: 'Run `/teamassign` to drop them under a **base shop** and a **leader**.', inline: false },
          )
          .setFooter({ text: 'OFG - Leadership Tracker' })
          .setTimestamp();

        const dmIds = (process.env.TEAM_ALERT_DM_USER_IDS || '')
          .split(',').map(s => s.trim()).filter(Boolean);

        if (dmIds.length) {
          for (const uid of dmIds) {
            try {
              const u = await client.users.fetch(uid);
              await u.send({ embeds: [alertEmbed] });
            } catch (e) { console.error(`Could not DM ${uid} (DMs off or bad id?):`, e.message); }
          }
        } else {
          const alertChannelId = process.env.TEAM_ALERT_CHANNEL_ID || process.env.SALES_CHANNEL_ID || process.env.LEADERBOARD_CHANNEL_ID;
          if (alertChannelId) {
            const alertChannel = await client.channels.fetch(alertChannelId);
            const rolePing = process.env.TEAM_ALERT_ROLE_ID ? `<@&${process.env.TEAM_ALERT_ROLE_ID}> ` : '';
            await alertChannel.send({ content: rolePing || undefined, embeds: [alertEmbed] });
          }
        }
      }
    }
  } catch (err) { console.error('Unassigned-producer alert failed:', err.message); }

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

      // ── CAREER AP MILESTONES (war room) — lifetime premium crossings ──
      // Fires once per threshold: only when the previous lifetime total was below
      // it and this sale pushes at/over it. Highest crossed wins (no double-post).
      const apMilestones = [
        { at: 1000000, msg: [
          `👑 CAREER MILESTONE — $1,000,000 · OFG HALL OF FAME! 👑`, ``,
          `<@${interaction.user.id}> just crossed **$1,000,000 in lifetime AP**! 💰💰💰`,
          `A MILLION dollars in premium written — legend status, etched into OFG history forever. 🏆🌟🔥`,
        ] },
        { at: 500000, msg: [
          `🔥 CAREER MILESTONE — HALF A MILLION! 🔥`, ``,
          `<@${interaction.user.id}> just crossed **$500,000 in lifetime AP**!`,
          `Halfway to a million. This is what relentless looks like. 👑💎`,
        ] },
        { at: 250000, msg: [
          `🌟 CAREER MILESTONE — QUARTER MILLION! 🌟`, ``,
          `<@${interaction.user.id}> just crossed **$250,000 in lifetime AP**!`,
          `A quarter-million in premium. Elite company. 🏆💪`,
        ] },
        { at: 100000, msg: [
          `💎 CAREER MILESTONE — SIX FIGURES! 💎`, ``,
          `<@${interaction.user.id}> just crossed **$100,000 in lifetime AP**!`,
          `Six figures of premium written. That's a real career taking shape. 👑🔥`,
        ] },
        { at: 50000, msg: [
          `🏆 CAREER MILESTONE — $50K CLUB! 🏆`, ``,
          `<@${interaction.user.id}> just crossed **$50,000 in lifetime AP**! 💰`,
          `The grind is paying off — and this is only the beginning. 🚀`,
        ] },
      ];
      const lifetimeAP = stats?.total_ever || 0;
      const prevAP = lifetimeAP - parseFloat(premium || 0);
      const crossedAP = apMilestones.find(m => prevAP < m.at && lifetimeAP >= m.at);
      if (crossedAP) {
        await channel.send(['', ...crossedAP.msg, ''].join('\n'));
      }

    } catch (err) {
      console.error('Sales channel error:', err.message);
    }
  }

  // Challenge updates — loop through ALL active challenges (user can have up to 3)
  const challenges = await getActiveChallenges(interaction.user.id);
  for (const challenge of challenges) {
    if (!salesChannelId) break;
    try {
      const ch = await client.channels.fetch(salesChannelId);
      const isChallenger = challenge.challenger_id === interaction.user.id;
      const opponentId = isChallenger ? challenge.challengee_id : challenge.challenger_id;
      const myStats = await getUserStats(interaction.user.id);
      const oppStats = await getUserStats(opponentId);
      const myTotal = myStats?.daily_total || 0;
      const oppTotal = oppStats?.daily_total || 0;
      const tied = myTotal === oppTotal;
      const leading = myTotal > oppTotal;
      await ch.send([
        ``,
        `⚔️ CHALLENGE UPDATE`,
        `<@${interaction.user.id}>: ${formatMoney(myTotal)} vs <@${opponentId}>: ${formatMoney(oppTotal)}`,
        tied    ? `It's TIED! Better close another one! 🔥` :
        leading ? `<@${interaction.user.id}> is in the LEAD! 🔥` :
                  `<@${opponentId}> is leading — time to close! 💪`,
        ``,
      ].join('\n'));
    } catch (err) { console.error('Challenge update error:', err.message); }
  }

  // Team momentum check — fires when daily AP crosses each $10k threshold
  if (salesChannelId) {
    try {
      const teamDaily = await getTeamDailyTotal();
      const thresholds = [20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000, 110000];
      const ch = await client.channels.fetch(salesChannelId);
      for (const threshold of thresholds) {
        if (teamDaily >= threshold && !firedMomentumThresholds.has(threshold)) {
          firedMomentumThresholds.add(threshold);
          await ch.send(MOMENTUM_MESSAGES[threshold]());
        }
      }

      // Record Watch — alert when team is within $5k of the all-time daily record
      if (!firedRecordWatch) {
        const teamStats = await getTeamStats();
        const record = parseFloat(teamStats.best_day_amount || 0);
        const gap = record - teamDaily;
        if (record > 0 && gap > 0 && gap <= 5000) {
          firedRecordWatch = true;
          await ch.send([
            ``,
            `🎯 RECORD WATCH! 🎯`,
            ``,
            `The team is within ${formatMoney(gap)} of an ALL-TIME daily record!`,
            ``,
            `📈 Team Today: ${formatMoney(teamDaily)}`,
            `🏆 All-Time Record: ${formatMoney(record)}`,
            ``,
            `Who is going to put us over the top? One more close and history is MADE. 🔥`,
            ``,
          ].join('\n'));
        }
      }
    } catch (err) { console.error('Momentum error:', err.message); }
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

  // ── Personal best notifications (ephemeral — only visible to the agent) ──────
  // Only fire for agents who have prior history (not their very first sale)
  const personalBests = [];

  if (totalSalesBefore > 0) {
    // Biggest single sale ever
    if (premium > prevBestSale) {
      personalBests.push([
        `🏆 NEW PERSONAL BEST SALE! 🏆`,
        ``,
        `${formatMoney(premium)} AP — that is your biggest single sale in your OFG career.`,
        `You just set a new bar for yourself.`,
        `Remember this feeling. Now go top it. 💎`,
      ].join('\n'));
    }

    // Biggest day ever — fires only the first time today crosses the previous record
    if (statsBefore.daily_total < statsBefore.best_day && stats.daily_total > statsBefore.best_day) {
      personalBests.push([
        `🌟 YOUR BEST DAY EVER! 🌟`,
        ``,
        `${formatMoney(stats.daily_total)} AP in a single day — a brand new personal record.`,
        `You just rewrote your own history today.`,
        `This is what showing up looks like. 🔥`,
      ].join('\n'));
    }

    // Biggest week ever
    if (statsBefore.weekly_total < statsBefore.best_week && stats.weekly_total > statsBefore.best_week) {
      personalBests.push([
        `🚀 YOUR BEST WEEK EVER! 🚀`,
        ``,
        `${formatMoney(stats.weekly_total)} AP this week — your biggest week at OFG.`,
        `You are not just growing. You are accelerating.`,
        `Keep this energy going. 💪`,
      ].join('\n'));
    }

    // Biggest month ever
    if (statsBefore.monthly_total < statsBefore.best_month && stats.monthly_total > statsBefore.best_month) {
      personalBests.push([
        `👑 YOUR BEST MONTH EVER — AND IT'S NOT OVER! 👑`,
        ``,
        `${formatMoney(stats.monthly_total)} AP this month is a new personal best for you.`,
        `You are outrunning your past self. That is what real growth looks like.`,
        `Finish this month the way you started it — relentless. 🌟`,
      ].join('\n'));
    }
  }

  await interaction.editReply({
    content: [
      `✅ Sale logged! ${formatMoney(premium)} AP`,
      `📊 Monthly: ${formatMoney(stats?.monthly_total)} · ${newRank.emoji} ${newRank.name}`,
      ...(personalBests.length ? [``, ...personalBests] : []),
    ].join('\n'),
  });

  } catch (err) {
    console.error('handleSaleModal error:', err);
    try {
      await interaction.editReply({ content: '❌ Something went wrong logging your sale. Please try again or contact an admin.' });
    } catch (_) {}
  }
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

  const postFinalLeaderboard = async (period, intro, prevWeek = false, prevDay = false) => {
    const channelId = process.env.LEADERBOARD_CHANNEL_ID;
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const embed = await buildLeaderboardEmbed(period, prevWeek, prevDay);
      embed.setColor(0xFFD700);
      await channel.send({ content: intro, embeds: [embed] });
    } catch (err) { console.error('Final leaderboard error:', err.message); }
  };

  // Team / leadership leaderboard poster. Uses TEAM_LEADERBOARD_CHANNEL_ID if set,
  // otherwise falls back to the same channel as the producer boards.
  const postTeamLeaderboard = async (period, intro = null, prevWeek = false, prevDay = false, final = false) => {
    const channelId = process.env.TEAM_LEADERBOARD_CHANNEL_ID || process.env.LEADERBOARD_CHANNEL_ID;
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const embed = await buildTeamLeaderboardEmbed(period, prevWeek, prevDay);
      if (final) embed.setColor(0xFFD700);
      await channel.send(intro ? { content: intro, embeds: [embed] } : { embeds: [embed] });
    } catch (err) { console.error('Team leaderboard error:', err.message); }
  };

  // Recruiting leaderboard poster — posts to the leaders channel (RECRUITING_CHANNEL_ID).
  const postRecruitingLeaderboard = async (period, intro = null, prevWeek = false, prevDay = false, final = false) => {
    const channelId = process.env.RECRUITING_CHANNEL_ID;
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const embed = await buildRecruitingLeaderboardEmbed(period, prevWeek, prevDay);
      if (final) embed.setColor(0xFFD700);
      await channel.send(intro ? { content: intro, embeds: [embed] } : { embeds: [embed] });
    } catch (err) { console.error('Recruiting leaderboard error:', err.message); }
  };

  // Weekend posting rule (shared by every recurring daily/weekly board):
  //   • Sunday  → no posts at all.
  //   • Saturday → posts stop after 6:00 PM (hour 18 is the last allowed).
  // Monthly recaps and Monday / 1st-of-month milestones are exempt (handled below).
  const weekendBlocked = (day, hour) => day === 0 || (day === 6 && hour > 18);

  // Daily every 2hrs 12pm-midnight Central.
  setInterval(() => {
    const centralNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const hour = centralNow.getHours();
    const day  = centralNow.getDay();
    if (hour < 12 || hour >= 24) return;
    if (weekendBlocked(day, hour)) return;
    postLeaderboard('daily');
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

    // Monthly champion — 1st at 8:40am (20 min after the month-closed post)
    if (now.getDate() === 1 && hour === 8 && min === 40 && !lastPosted[key('champion')]) {
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
      firedMomentumThresholds.clear();
      firedRecordWatch = false;
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
            // Overall series record between these two. At decisive close the
            // just-resolved duel is already tagged, so this INCLUDES last night.
            // (Ties don't change the record — status='tied' isn't counted.)
            const h2h = await getHeadToHead(result.winner.id, result.loser.id);
            let seriesLine = null;
            if (h2h.total > 0) {
              if (h2h.aWins === h2h.bWins) {
                seriesLine = `📊 Series: all even now, ${h2h.aWins}-${h2h.bWins}`;
              } else if (h2h.aWins > h2h.bWins) {
                // winner is ahead in the all-time series
                seriesLine = `📊 Series: <@${result.winner.id}> leads it ${h2h.aWins}-${h2h.bWins}`;
              } else {
                // winner took last night but still TRAILS overall — the needle line
                seriesLine = `📊 Series: <@${result.loser.id}> still owns this matchup ${h2h.bWins}-${h2h.aWins}`;
              }
            }

            if (result.tie) {
              await ch.send([
                ``,
                `⚔️🤝 CHALLENGE RESULT — IT'S A TIE! 🤝⚔️`,
                ``,
                `<@${result.winner.id}> vs <@${result.loser.id}> — both finished with **${formatMoney(result.winner.total)}** AP!`,
                ``,
                `Dead even. Both of you went to WAR yesterday — respect. 💪`,
                ...(seriesLine ? [seriesLine] : []),
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
                ...(seriesLine ? [``, seriesLine] : []),
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
    if (hour === 8 && min === 0 && day !== 1 && !weekendBlocked(day, hour) && !lastPosted[key('final-daily')]) {
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
      ].join('\n'), false, true); // prevDay=true so it shows yesterday's data
    }

    // Weekly at 9am except Monday
    if (hour === 9 && min === 0 && day !== 1 && !weekendBlocked(day, hour) && !lastPosted[key('weekly')]) {
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

    // New month personal goal reminder - 1st of month at 12:05pm (midday, its own moment
    // instead of stacking on top of the early-morning wake-up posts). Offset 5 min past
    // noon so it never collides with the Friday-only H2H Standings post at 12:00.
    if (now.getDate() === 1 && hour === 12 && min === 5 && !lastPosted[key('new-month-goals')]) {
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

    // Mid-month goal check — 15th at 12:00pm (noon), @everyone, war room.
    // Once-a-month milestone ping → exempt from the weekend rule (fires on the 15th
    // regardless of weekday).
    if (now.getDate() === 15 && hour === 12 && min === 0 && !lastPosted[key('mid-month-goals')]) {
      lastPosted[key('mid-month-goals')] = true;
      try {
        const salesChannelId = process.env.SALES_CHANNEL_ID;
        if (salesChannelId) {
          const ch = await client.channels.fetch(salesChannelId);
          const monthName = now.toLocaleString('en-US', { month: 'long' }).toUpperCase();
          await ch.send([
            `@everyone`,
            ``,
            `🎯🔥 MID-MONTH GOAL CHECK — ${monthName} 🔥🎯`,
            ``,
            `We're halfway through ${monthName} — time to make sure EVERYONE is locked in. 💪`,
            ``,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `❓ **HAVEN'T SET YOUR GOAL YET?**`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            ``,
            `If you haven't set your personal production goal for ${monthName}, do it RIGHT NOW:`,
            ``,
            `👉 \`/mypersonalgoal\``,
            ``,
            `Takes 10 seconds. Your goal stays private — only YOU see your progress — but it's what keeps you accountable when it counts. 🎯`,
            ``,
            `Already set yours? Then this is your mid-month gut check: on pace, or time to turn it up? 👀`,
            ``,
            `The team goal is **$${(await getGoal()).toLocaleString()}** — half the month's gone, let's finish ${monthName} on FIRE. 🔥👑`,
            ``,
          ].join('\n'));
        }
      } catch (err) { console.error('Mid-month goal reminder error:', err.message); }
    }

    // Final Monthly — 1st at 8:20am (20 min after the daily recap, so it lands as
    // its own moment instead of stacking right on top of "yesterday's results")
    if (now.getDate() === 1 && hour === 8 && min === 20 && !lastPosted[key('final-monthly')]) {
      lastPosted[key('final-monthly')] = true;
      postFinalLeaderboard('monthly', [
        ``,
        `🎉🔒👑 THE MONTH IS OFFICIALLY CLOSED! 👑🔒🎉`,
        ``,
        `🔥💪 What an INCREDIBLE run! Month after month, this team keeps proving`,
        `what's possible when you stay locked in and trust the process. 🚀`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `🏆✨ CONGRATULATIONS to everyone on this leaderboard — especially our`,
        `top producers who set the standard for what ELITE performance looks like at OFG! ✨🏆`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `🚪➡️🚀 New month. Fresh start. New goals.`,
        `Let's make it even BIGGER! 📈🔥👑`,
        ``,
      ].join('\n'));
    }

    // ── TEAM / LEADERSHIP LEADERBOARDS ──────────────────────────────────────────
    // Intraday team board — 1pm / 5pm / 9pm Central (in the gaps the producer board leaves)
    if ([13, 17, 21].includes(hour) && min === 0 && !weekendBlocked(day, hour) && !lastPosted[key('team-daily')]) {
      lastPosted[key('team-daily')] = true;
      postTeamLeaderboard('daily');
    }

    // Team daily recap — 8:02am, 2 min after producer final daily (skips Monday, like producer)
    if (hour === 8 && min === 2 && day !== 1 && !weekendBlocked(day, hour) && !lastPosted[key('team-final-daily')]) {
      lastPosted[key('team-final-daily')] = true;
      postTeamLeaderboard('daily', `🏪 **OFG TEAM RECAP — YESTERDAY'S RESULTS** 🏪`, false, true, true);
    }

    // Team weekly — 9:02am, 2 min after producer weekly (not Monday)
    if (hour === 9 && min === 2 && day !== 1 && !weekendBlocked(day, hour) && !lastPosted[key('team-weekly')]) {
      lastPosted[key('team-weekly')] = true;
      postTeamLeaderboard('weekly');
    }

    // Team final weekly — Monday 8:02am, 2 min after producer final weekly
    if (day === 1 && hour === 8 && min === 2 && !lastPosted[key('team-final-weekly')]) {
      lastPosted[key('team-final-weekly')] = true;
      postTeamLeaderboard('weekly', `🏪 **OFG TEAM RECAP — LAST WEEK LOCKED IN** 🏪`, true, false, true);
    }

    // Team monthly — Mon/Wed/Fri 10:02am, 2 min after producer monthly
    if ((day === 1 || day === 3 || day === 5) && hour === 10 && min === 2 && !lastPosted[key('team-monthly')]) {
      lastPosted[key('team-monthly')] = true;
      postTeamLeaderboard('monthly');
    }

    // Team final monthly — 1st at 8:28am, after the daily team recap has had room to breathe
    if (now.getDate() === 1 && hour === 8 && min === 28 && !lastPosted[key('team-final-monthly')]) {
      lastPosted[key('team-final-monthly')] = true;
      postTeamLeaderboard('monthly', `🏛️ **OFG TEAM RECAP — THE MONTH IS CLOSED** 🏛️`, false, false, true);
    }

    // Top Base Shop of the WEEK — Monday 8:07am, right after the team weekly board.
    if (day === 1 && hour === 8 && min === 7 && !lastPosted[key('team-baseshop-week')]) {
      lastPosted[key('team-baseshop-week')] = true;
      try {
        const channelId = process.env.TEAM_LEADERBOARD_CHANNEL_ID || process.env.LEADERBOARD_CHANNEL_ID;
        if (channelId) {
          const ch = await client.channels.fetch(channelId);
          const { baseShop } = await computeTeamMVPs('weekly', true, false); // last week
          if (baseShop) {
            const shop = baseShop.isMention ? `<@${baseShop.id}>'s Base Shop` : `**${baseShop.name}'s Base Shop**`;
            await ch.send([
              ``,
              `🏆 TOP BASE SHOP OF THE WEEK 🏆`,
              ``,
              `One shop out-produced them all last week...`,
              ``,
              `🏢 ${shop} — **${formatMoney(baseShop.total)} AP**`,
              `That's what a team firing on all cylinders looks like. 👑🔥`,
              ``,
              `Who's taking the crown next week? 💪`,
              ``,
            ].join('\n'));
          }
        }
      } catch (err) { console.error('Team base shop (week) error:', err.message); }
    }

    // Base Shop of the MONTH — 1st at 8:48am, its own moment after the team monthly recap.
    if (now.getDate() === 1 && hour === 8 && min === 48 && !lastPosted[key('team-baseshop-month')]) {
      lastPosted[key('team-baseshop-month')] = true;
      try {
        const channelId = process.env.TEAM_LEADERBOARD_CHANNEL_ID || process.env.LEADERBOARD_CHANNEL_ID;
        if (channelId) {
          const ch = await client.channels.fetch(channelId);
          const { baseShop } = await computeTeamMVPs('monthly', false, true); // last month
          if (baseShop) {
            const shop = baseShop.isMention ? `<@${baseShop.id}>'s Base Shop` : `**${baseShop.name}'s Base Shop**`;
            await ch.send([
              ``,
              `👑🏆 BASE SHOP OF THE MONTH 🏆👑`,
              ``,
              `After a full month of grinding, one shop stood above the rest...`,
              ``,
              `🏢 ${shop} — **${formatMoney(baseShop.total)} AP**`,
              `Total domination. This is what leadership produces. 💎🔥`,
              ``,
              `New month, new battle — who's next? 💪`,
              ``,
            ].join('\n'));
          }
        }
      } catch (err) { console.error('Team base shop (month) error:', err.message); }
    }

    // ── RECRUITING LEADERBOARDS (leaders channel) ───────────────────────────────
    // Same recap cadence as production, posted to RECRUITING_CHANNEL_ID. Recaps
    // only — no every-2-hours intraday posts.
    // Daily recap — 8am (yesterday's hires), skips Monday
    if (hour === 8 && min === 0 && day !== 1 && !weekendBlocked(day, hour) && !lastPosted[key('recruit-final-daily')]) {
      lastPosted[key('recruit-final-daily')] = true;
      postRecruitingLeaderboard('daily', [
        ``,
        `🌱🔥 YESTERDAY'S RECRUITING RESULTS ARE IN! 🔥🌱`,
        ``,
        `While others were watching, OFG was BUILDING. 🏗️💪`,
        `Every conversation, every interview, every contract signed — it all COUNTS.`,
        ``,
        `⬇️ Here's who grew the empire yesterday. Salute to everyone recruiting! 🫡`,
        ``,
      ].join('\n'), false, true, true);
    }

    // Weekly — 9am, skips Monday
    if (hour === 9 && min === 0 && day !== 1 && !weekendBlocked(day, hour) && !lastPosted[key('recruit-weekly')]) {
      lastPosted[key('recruit-weekly')] = true;
      postRecruitingLeaderboard('weekly');
    }

    // Final weekly — Monday 8am (last week locked in)
    if (day === 1 && hour === 8 && min === 0 && !lastPosted[key('recruit-final-weekly')]) {
      lastPosted[key('recruit-final-weekly')] = true;
      postRecruitingLeaderboard('weekly', [
        ``,
        `🚨🏁 THE RECRUITING WEEK IS LOCKED IN! 🏁🚨`,
        ``,
        `Seven days of building, interviewing, and zero excuses — THIS board shows who grew their empire. 🌱💪`,
        ``,
        `👑 FINAL RECRUITING STANDINGS — officially LOCKED IN. 👑`,
        ``,
        `Now reload. The empire never stops growing. 🏗️🔥`,
        ``,
      ].join('\n'), true, false, true);
    }

    // Recruiting MVPs — Monday 8:05am, leaders channel (mirrors the producer Weekly MVP).
    if (day === 1 && hour === 8 && min === 5 && !lastPosted[key('recruit-mvp')]) {
      lastPosted[key('recruit-mvp')] = true;
      try {
        const channelId = process.env.RECRUITING_CHANNEL_ID;
        if (channelId) {
          const ch = await client.channels.fetch(channelId);
          const { individual, baseShop } = await computeRecruitingMVPs('weekly', true, false); // last week
          if (individual) {
            await ch.send([
              ``,
              `👑 RECRUITING MVP OF THE WEEK 👑`,
              ``,
              `After a full week of building, one recruiter stood above the rest...`,
              ``,
              `🌱 <@${individual.id}> — **${individual.count} hire${individual.count === 1 ? '' : 's'} this week!**`,
              `${individual.rankEmoji} ${individual.rankName} — absolutely ELITE recruiting!`,
              ``,
              `Let's keep that same energy this week! 🔥`,
              ``,
            ].join('\n'));
          }
          if (baseShop) {
            const shopLabel = baseShop.isMention ? `<@${baseShop.id}>'s Base Shop` : `**${baseShop.name}'s Base Shop**`;
            await ch.send([
              ``,
              `🏆 TOP BASE SHOP OF THE WEEK 🏆`,
              ``,
              `One shop out-recruited them all last week...`,
              ``,
              `🏢 ${shopLabel} — **${baseShop.count} hire${baseShop.count === 1 ? '' : 's'}!**`,
              `That's a team that builds together. 🌱👑`,
              ``,
              `Who's taking the crown next week? 🔥`,
              ``,
            ].join('\n'));
          }
        }
      } catch (err) { console.error('Recruiting MVP error:', err.message); }
    }

    // Monthly — Mon/Wed/Fri 10am
    if ((day === 1 || day === 3 || day === 5) && hour === 10 && min === 0 && !lastPosted[key('recruit-monthly')]) {
      lastPosted[key('recruit-monthly')] = true;
      postRecruitingLeaderboard('monthly');
    }

    // Final monthly — 1st at 8:34am, its own moment after the daily recruiting recap
    if (now.getDate() === 1 && hour === 8 && min === 34 && !lastPosted[key('recruit-final-monthly')]) {
      lastPosted[key('recruit-final-monthly')] = true;
      postRecruitingLeaderboard('monthly', `🌱 **OFG RECRUITING RECAP — THE MONTH IS CLOSED** 🌱`, false, false, true);
    }

    // Recruiter of the Month + Recruiting Base Shop of the Month — 1st at 8:54am,
    // leaders channel (mirrors the producer Monthly Champion + team Base Shop of the Month).
    if (now.getDate() === 1 && hour === 8 && min === 54 && !lastPosted[key('recruit-month-crowns')]) {
      lastPosted[key('recruit-month-crowns')] = true;
      try {
        const channelId = process.env.RECRUITING_CHANNEL_ID;
        if (channelId) {
          const ch = await client.channels.fetch(channelId);
          const { individual, baseShop } = await computeRecruitingMVPs('monthly', false, true); // last month
          if (individual) {
            await ch.send([
              ``,
              `👑🏆 RECRUITER OF THE MONTH CROWNED! 🏆👑`,
              ``,
              `After a full month of building, one recruiter stood above everyone...`,
              ``,
              `CONGRATULATIONS to <@${individual.id}>!`,
              `🌱 ${individual.count} hire${individual.count === 1 ? '' : 's'} this month`,
              `${individual.rankEmoji} ${individual.rankName}`,
              ``,
              `You didn't just recruit — you built the future of OFG. 🏗️🔥`,
              `Reigning champ until someone takes the crown. 👑`,
              ``,
            ].join('\n'));
          }
          if (baseShop) {
            const shop = baseShop.isMention ? `<@${baseShop.id}>'s Base Shop` : `**${baseShop.name}'s Base Shop**`;
            await ch.send([
              ``,
              `👑🏆 RECRUITING BASE SHOP OF THE MONTH 🏆👑`,
              ``,
              `After a full month of building, one shop out-recruited them all...`,
              ``,
              `🏢 ${shop} — **${baseShop.count} hire${baseShop.count === 1 ? '' : 's'}!**`,
              `Total domination. That's a team that builds together. 🌱👑`,
              ``,
              `New month, new battle — who's next? 🔥`,
              ``,
            ].join('\n'));
          }
        }
      } catch (err) { console.error('Recruiting month crowns error:', err.message); }
    }

  }, 60 * 1000);

  console.log('OFG Leaderboards scheduled in Central Time');
}

client.login(process.env.DISCORD_TOKEN);
