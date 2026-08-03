// src/index.js
require('dotenv').config();
const crypto = require('crypto');
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
  getSaleById, claimSaleAnnouncement, releaseSaleAnnouncement,
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
const { syncAllMembers } = require('./member-sync');
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

  // One immediate member sync on startup (then automatically every day at
  // 3:07am) so a fresh deploy pulls everyone into team_members right away — the
  // OFG Hub can then match/link anyone. No terminal, no laptop. Fire-and-forget
  // so it never delays the bot coming online.
  (async () => {
    try {
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
      const r = await syncAllMembers({ rest, guildId: process.env.GUILD_ID });
      console.log(`[member-sync] startup: scanned ${r.scanned}, added ${r.added} (auto-placed ${r.placedUnderRecruiter} under their recruiter, ${r.adopted || 0} into a held spot)`);
    } catch (err) { console.error('Member sync (startup) error:', err.message); }
  })();
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

// ── Monthly "biggest of the month" announcement floors ────────────────────────
// The biggest-sale / biggest-day / biggest-week-of-the-month records are always
// tracked accurately underneath (they're computed live from the sales data).
// These floors ONLY gate the celebratory CALL-OUT, so the start of a fresh month
// doesn't blast "🏅 biggest day of the month!" for tiny early numbers when the
// bar is basically zero. A shout-out fires only once the number BOTH beats the
// prior monthly best AND clears the floor below — so it goes quiet early, kicks
// in mid-month as real production stacks up, and keeps marking new highs from
// there. Edit these to taste; they're the only line you touch.
const MONTHLY_RECORD_FLOORS = {
  sale: 3500,   // biggest single sale of the month
  day:  5000,   // biggest sales day of the month
  week: 15000,  // biggest sales week of the month
};

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
    // Presentation / Carrier / Product / Lead Type are fixed dropdown picks
    // encoded in the customId as
    //   "saleModal:<presentation>|<carrier>|<product>|<leadType>"
    // Only AP comes from the modal's text input. (Older sales submitted before
    // Lead Type became a dropdown had a 3-part customId — the fallback below
    // keeps those from crashing if one is somehow still in flight.)
    const encoded = interaction.customId.slice('saleModal:'.length);
    const [presentationType = 'Unknown', carrier = 'Unknown', product = 'Unknown', leadTypeRaw = 'Unknown'] = encoded.split('|');
    const leadType         = String(leadTypeRaw).trim() || 'Unknown';
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


  const sale = await addSale({
    userId: interaction.user.id,
    username: displayName || String(interaction.user.id),
    clientName: product,
    policyType: product,
    premium, carrier,
    notes: `Lead: ${leadType} | Presentation: ${presentationType}`,
  });

  const { stats, newRank, personalBests } = await runSaleAnnouncements({
    userId: interaction.user.id, displayName, saleId: sale?.id ?? null,
    carrier, product, leadType, presentationType, premium,
  });


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


// ── The sale pipeline ─────────────────────────────────────────────────────────
// Everything that happens once a sale row exists: the alert embed, the milestone
// shoutout, whale/first-blood/rank-up/record calls, challenge scores, team
// momentum, the goal auto-bump, and the agent's private personal bests.
//
// It lives out here rather than inside the /sale handler because /sale is not
// the only way a sale gets written any more — the OFG Hub's CRM writes straight
// to the same table, and a sale that lands without this running is a sale the
// board never celebrates. One function, both doors, no second copy of the
// milestone ladder to drift.
//
// It takes a row that ALREADY EXISTS and `saleId` is how the before-and-after
// comparisons stay honest: every "was this their first ever / the biggest of
// the month / their best day" read excludes that one row, so the answer is what
// it would have been a moment before the insert. Two agents closing in the same
// second get the right answers this way, which the old read-then-insert order
// could not promise.
//
// Returns what the caller needs to reply with; it sends nothing to the caller
// itself. Personal bests come back as strings because /sale shows them
// privately in its reply and the hub path DMs them instead.
async function runSaleAnnouncements({ userId, displayName, saleId, carrier, product, leadType, presentationType, premium, progress }) {
  let avatarUrl = null;
  try { avatarUrl = (await client.users.fetch(userId)).displayAvatarURL({ extension: 'png', size: 256 }); } catch (_) {}

  // Check if this is their first ever sale
  const totalSalesBefore = await getUserTotalSales(userId, saleId);
  const isFirstEver = totalSalesBefore === 0;

  // Check if this is first sale of the day for ANYONE on the team
  const teamDailyCountBefore = await getTeamDailySalesCount(saleId);
  const isFirstOfDay = teamDailyCountBefore === 0;

  // Get current monthly top sale before adding
  const prevTopSale = await getMonthlyTopSale(saleId);

  // Capture personal bests BEFORE adding the sale so we can compare after
  const statsBefore    = await getUserStats(userId, saleId);
  const prevBestSale   = await getPersonalBestSale(userId, saleId);

  // Alert leadership if this seller isn't placed under a base shop / leader yet.
  try {
    const tree = await getTeamTree();
    if (!tree.getBaseShopOwner(userId)) {
      // Save / update their profile in Supabase so there's a record to act on.
      try {
        await recordUnassignedProducer({ userId, name: displayName, avatarUrl });
      } catch (e) { console.error('recordUnassignedProducer failed:', e.message); }

      // DM the leaders (once per session) with a nice card.
      if (!alertedUnassigned.has(userId)) {
        alertedUnassigned.add(userId);

        const alertEmbed = new EmbedBuilder()
          .setColor(0xE74C3C)
          .setTitle('🚦 New Producer Needs a Team')
          .setThumbnail(avatarUrl)
          .setDescription(`**${displayName}** just logged a deal but isn't placed under a base shop or leader yet. Let's get them assigned so their production rolls up to the right team. 💪`)
          .addFields(
            { name: '👤 Name', value: displayName, inline: true },
            { name: '🆔 Discord ID', value: `\`${userId}\``, inline: true },
            { name: '👋 Mention', value: `<@${userId}>`, inline: true },
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

  const stats = await getUserStats(userId);
  const prevMonthlyTotal = (stats?.monthly_total || 0) - premium;
  const prevRank = getRankForAmount(prevMonthlyTotal);
  const newRank = getRankForAmount(stats?.monthly_total || 0);
  const leveledUp = prevRank.name !== newRank.name;

  const dailyCount = await getDailySalesCount(userId);
  const isHotStreak = dailyCount >= 3;

  // `progress` is an optional out-param: the caller's own object, stamped the
  // moment the SALE ALERT reaches the channel. /sale doesn't pass one.
  //
  // The hub's door does, because it has to answer the hub, and the hub only
  // posts its fallback embed when it hears that nothing went out. Everything
  // below runs inside catches that log and carry on — right for /sale, where a
  // Discord hiccup must never fail the interaction or lose the row, but it means
  // a swallowed failure is indistinguishable from a success from the outside.
  //
  // It has to be an out-param rather than a return value: the pipeline can also
  // throw AFTER the alert posted (getActiveChallenges and getGoal below are not
  // inside a catch), and a return value is gone by the time that lands in the
  // door's catch — where it is the difference between the hub staying quiet and
  // the hub posting a second alert for the same sale.
  //
  // This one send is the right thing to report on: if it throws the rest of the
  // block is skipped too, and it is precisely the message the hub's fallback
  // would replace — so "not stamped" means "post yours", with no risk of two.
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
      if (progress) progress.alertPosted = true;

      // Shoutout fires separately at 3+ sales
      if (milestone?.shoutout) {
        await channel.send(milestone.shoutout(userId));
      }

      // Whale alert for sales over $3000
      if (premium >= 3000) {
        await channel.send([
          ``,
          `🐳🚨 WHALE ALERT! 🚨🐳`,
          ``,
          `<@${userId}> just landed a ${formatMoney(premium)} AP sale!`,
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
          `<@${userId}> just logged their FIRST EVER SALE at OFG!`,
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
          `<@${userId}> just opened the board today with ${formatMoney(premium)} AP!`,
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
          `<@${userId}> just leveled up to ${newRank.emoji} ${newRank.name}!`,
          `From ${prevRank.emoji} ${prevRank.name} to ${newRank.emoji} ${newRank.name} - LETS GO! 🔥`,
          ``,
        ].join('\n'));
      }

      // Biggest single sale of the month (only shout it out once it clears the floor)
      if ((!prevTopSale || premium > parseFloat(prevTopSale.premium)) && premium >= MONTHLY_RECORD_FLOORS.sale) {
        await channel.send([
          ``,
          `💥 BIGGEST MONTHLY SALE! 💥`,
          ``,
          `<@${userId}> just set the record for the biggest sale of the month with ${formatMoney(premium)} AP!`,
          `Can anyone top it before the month ends? 🔥`,
          ``,
        ].join('\n'));
      }

      // Check daily total record for this month
      const myDailyTotal = await getUserDailyTotal(userId);
      const { bestDay: monthBestDay, bestWeek: monthBestWeek } = await getMonthlyRecords();
      if ((!monthBestDay || myDailyTotal > monthBestDay.total) && myDailyTotal >= MONTHLY_RECORD_FLOORS.day) {
        await channel.send([
          ``,
          `🏅 BIGGEST SALES DAY THIS MONTH! 🏅`,
          ``,
          `<@${userId}> just had the biggest sales day of the month with ${formatMoney(myDailyTotal)} AP today!`,
          `That is the day to beat! 🔥`,
          ``,
        ].join('\n'));
      }

      // Check weekly total record for this month
      const myWeeklyTotal = await getUserWeeklyTotal(userId);
      if ((!monthBestWeek || myWeeklyTotal > monthBestWeek.total) && myWeeklyTotal >= MONTHLY_RECORD_FLOORS.week) {
        await channel.send([
          ``,
          `🏅 BIGGEST SALES WEEK THIS MONTH! 🏅`,
          ``,
          `<@${userId}> just had the biggest sales week of the month with ${formatMoney(myWeeklyTotal)} AP this week!`,
          `The weekly bar has been raised! 💪🔥`,
          ``,
        ].join('\n'));
      }

      // All time records check
      const records = await getAllTimeRecords();

      // All time biggest day
      if (myDailyTotal > parseFloat(records.alltime_day_amount || 0)) {
        const prev = records.alltime_day_username ? `Previous record: ${formatMoney(records.alltime_day_amount)} by ${records.alltime_day_username}` : 'First all time record set!';
        await setAllTimeRecord('day', myDailyTotal, userId, displayName);
        await channel.send([
          ``,
          `🌟 ALL TIME DAILY RECORD BROKEN! 🌟`,
          ``,
          `<@${userId}> just had the BIGGEST SALES DAY in OFG history with ${formatMoney(myDailyTotal)} AP in a single day!`,
          `That is an OFG LEGEND performance! 🏆🔥`,
          prev,
          ``,
        ].join('\n'));
      }

      // All time biggest week
      if (myWeeklyTotal > parseFloat(records.alltime_week_amount || 0)) {
        const prev = records.alltime_week_username ? `Previous record: ${formatMoney(records.alltime_week_amount)} by ${records.alltime_week_username}` : 'First all time record set!';
        await setAllTimeRecord('week', myWeeklyTotal, userId, displayName);
        await channel.send([
          ``,
          `🌟 ALL TIME WEEKLY RECORD BROKEN! 🌟`,
          ``,
          `<@${userId}> just had the BIGGEST SALES WEEK in OFG history with ${formatMoney(myWeeklyTotal)} AP this week!`,
          `Absolutely UNSTOPPABLE! 🏆🔥`,
          prev,
          ``,
        ].join('\n'));
      }

      // All time biggest month
      const myMonthlyTotal = stats?.monthly_total || 0;
      if (myMonthlyTotal > parseFloat(records.alltime_month_amount || 0)) {
        const prev = records.alltime_month_username ? `Previous record: ${formatMoney(records.alltime_month_amount)} by ${records.alltime_month_username}` : 'First all time record set!';
        await setAllTimeRecord('month', myMonthlyTotal, userId, displayName);
        await channel.send([
          ``,
          `🌟 ALL TIME MONTHLY RECORD BROKEN! 🌟`,
          ``,
          `<@${userId}> just had the BIGGEST SALES MONTH in OFG history with ${formatMoney(myMonthlyTotal)} AP!`,
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
          `<@${userId}> just crossed **$1,000,000 in lifetime AP**! 💰💰💰`,
          `A MILLION dollars in premium written — legend status, etched into OFG history forever. 🏆🌟🔥`,
        ] },
        { at: 500000, msg: [
          `🔥 CAREER MILESTONE — HALF A MILLION! 🔥`, ``,
          `<@${userId}> just crossed **$500,000 in lifetime AP**!`,
          `Halfway to a million. This is what relentless looks like. 👑💎`,
        ] },
        { at: 250000, msg: [
          `🌟 CAREER MILESTONE — QUARTER MILLION! 🌟`, ``,
          `<@${userId}> just crossed **$250,000 in lifetime AP**!`,
          `A quarter-million in premium. Elite company. 🏆💪`,
        ] },
        { at: 100000, msg: [
          `💎 CAREER MILESTONE — SIX FIGURES! 💎`, ``,
          `<@${userId}> just crossed **$100,000 in lifetime AP**!`,
          `Six figures of premium written. That's a real career taking shape. 👑🔥`,
        ] },
        { at: 50000, msg: [
          `🏆 CAREER MILESTONE — $50K CLUB! 🏆`, ``,
          `<@${userId}> just crossed **$50,000 in lifetime AP**! 💰`,
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
  const challenges = await getActiveChallenges(userId);
  for (const challenge of challenges) {
    if (!salesChannelId) break;
    try {
      const ch = await client.channels.fetch(salesChannelId);
      const isChallenger = challenge.challenger_id === userId;
      const opponentId = isChallenger ? challenge.challengee_id : challenge.challenger_id;
      const myStats = await getUserStats(userId);
      const oppStats = await getUserStats(opponentId);
      const myTotal = myStats?.daily_total || 0;
      const oppTotal = oppStats?.daily_total || 0;
      const tied = myTotal === oppTotal;
      const leading = myTotal > oppTotal;
      await ch.send([
        ``,
        `⚔️ CHALLENGE UPDATE`,
        `<@${userId}>: ${formatMoney(myTotal)} vs <@${opponentId}>: ${formatMoney(oppTotal)}`,
        tied    ? `It's TIED! Better close another one! 🔥` :
        leading ? `<@${userId}> is in the LEAD! 🔥` :
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

  return { stats, newRank, personalBests };
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

  const postFinalLeaderboard = async (period, intro, prevWeek = false, prevDay = false, prevMonth = false) => {
    const channelId = process.env.LEADERBOARD_CHANNEL_ID;
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const embed = await buildLeaderboardEmbed(period, prevWeek, prevDay, prevMonth);
      embed.setColor(0xFFD700);
      await channel.send({ content: intro, embeds: [embed] });
    } catch (err) { console.error('Final leaderboard error:', err.message); }
  };

  // Team / leadership leaderboard poster. Uses TEAM_LEADERBOARD_CHANNEL_ID if set,
  // otherwise falls back to the same channel as the producer boards.
  const postTeamLeaderboard = async (period, intro = null, prevWeek = false, prevDay = false, final = false, prevMonth = false) => {
    const channelId = process.env.TEAM_LEADERBOARD_CHANNEL_ID || process.env.LEADERBOARD_CHANNEL_ID;
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const embed = await buildTeamLeaderboardEmbed(period, prevWeek, prevDay, prevMonth);
      if (final) embed.setColor(0xFFD700);
      await channel.send(intro ? { content: intro, embeds: [embed] } : { embeds: [embed] });
    } catch (err) { console.error('Team leaderboard error:', err.message); }
  };

  // Recruiting leaderboard poster — posts to the leaders channel (RECRUITING_CHANNEL_ID).
  const postRecruitingLeaderboard = async (period, intro = null, prevWeek = false, prevDay = false, final = false, prevMonth = false) => {
    const channelId = process.env.RECRUITING_CHANNEL_ID;
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const embed = await buildRecruitingLeaderboardEmbed(period, prevWeek, prevDay, prevMonth);
      if (final) embed.setColor(0xFFD700);
      await channel.send(intro ? { content: intro, embeds: [embed] } : { embeds: [embed] });
    } catch (err) { console.error('Recruiting leaderboard error:', err.message); }
  };

  // Weekend posting rule (shared by every recurring daily/weekly board):
  //   • Sunday  → no posts at all.
  //   • Saturday → posts stop after 6:00 PM (hour 18 is the last allowed).
  // Monthly recaps and Monday / 1st-of-month milestones are exempt (handled below).
  const weekendBlocked = (day, hour) => day === 0 || (day === 6 && hour > 18);

  // Intraday daily boards are posted as INDIVIDUAL + TEAM pairs at 12/3/6/9pm
  // Central — see the paired block in the minute-checker below. (The old every-2-
  // hours individual-only timer was removed so the two boards always travel
  // together and there are fewer messages through the day.)

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
        const champion = await getMonthlyChampion(true); // true = crown LAST month, not the new one
        const channelId = process.env.SALES_CHANNEL_ID;
        if (champion && channelId) {
          const ch = await client.channels.fetch(channelId);
          const rank = getRankForAmount(champion.total);
          const closedMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
            .toLocaleString('en-US', { month: 'long' }).toUpperCase();
          await ch.send([
            ``,
            `👑🏆 ${closedMonth} CHAMPION CROWNED! 🏆👑`,
            ``,
            `After an entire month of competition, one agent came out on TOP!`,
            ``,
            `CONGRATULATIONS to <@${champion.user_id}>!`,
            ``,
            `💰 ${formatMoney(champion.total)} AP last month`,
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

    // ── Daily MEMBER SYNC — 3:07am Central ──────────────────────────────────
    // Make sure EVERYONE in the Discord is in team_members so the OFG Hub can
    // match/link anyone (not just people who've produced). Only ADDS newcomers;
    // never touches placed leaders; never deletes. Runs on the server, so it's
    // fully automatic — no terminal, no laptop. Idempotent, so a restart that
    // re-runs it is harmless.
    if (hour === 3 && min === 7 && !lastPosted[key('member-sync')]) {
      lastPosted[key('member-sync')] = true;
      try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        const r = await syncAllMembers({ rest, guildId: process.env.GUILD_ID });
        console.log(`[member-sync] daily: scanned ${r.scanned}, added ${r.added} (auto-placed ${r.placedUnderRecruiter} under their recruiter, ${r.adopted || 0} into a held spot)`);
      } catch (err) { console.error('Member sync error:', err.message); }
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

    // ── GOAL-SETTING PUSH: three reminders to open the month ────────────────────
    //   #1  1st, 12:05pm — the welcome. Sets the tone, no @everyone.
    //   #2  1st,  5:30pm — end of day one, @everyone.
    //   #3  2nd, 11:00am — last call, @everyone, catches the stragglers.
    // All three are once-a-month milestone pings, so they're exempt from the
    // weekend rule and fire on the 1st/2nd regardless of weekday (same precedent
    // as the 15th mid-month check).

    // #1 — 1st of month at 12:05pm (midday, its own moment instead of stacking on
    // top of the early-morning wake-up posts). Offset 5 min past noon so it never
    // collides with the Friday-only H2H Standings post at 12:00.
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

    // #2 — 1st of month at 5:30pm. Day one is closing; catch everyone who saw the
    // noon post, meant to set it, and got busy. 17:30 is clear of the intraday
    // board pairs (12/3/6/10pm on the hour).
    if (now.getDate() === 1 && hour === 17 && min === 30 && !lastPosted[key('new-month-goals-2')]) {
      lastPosted[key('new-month-goals-2')] = true;
      try {
        const salesChannelId = process.env.SALES_CHANNEL_ID;
        if (salesChannelId) {
          const ch = await client.channels.fetch(salesChannelId);
          const monthName = now.toLocaleString('en-US', { month: 'long' }).toUpperCase();
          await ch.send([
            `@everyone`,
            ``,
            `🎯⏰ DAY ONE CHECK — IS YOUR ${monthName} GOAL SET? ⏰🎯`,
            ``,
            `The month is a few hours old and the board is already open. 📊`,
            ``,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            ``,
            `If you haven't locked in your personal production goal yet, do it before you log off tonight:`,
            ``,
            `👉 \`/mypersonalgoal\``,
            ``,
            `Ten seconds. Stays private — only YOU see your progress. But it's the difference between HOPING this month goes well and DECIDING it will. 🎯`,
            ``,
            `Team goal for ${monthName}: **$${(await getGoal()).toLocaleString()}** — everybody in. 🔥👑`,
            ``,
          ].join('\n'));
        }
      } catch (err) { console.error('Day-one goal reminder error:', err.message); }
    }

    // #3 — 2nd of month at 11:00am. Last call before the mid-month check on the
    // 15th. Clear of the 9:30 challenge results and the 10:00/10:02 monthly boards.
    if (now.getDate() === 2 && hour === 11 && min === 0 && !lastPosted[key('new-month-goals-3')]) {
      lastPosted[key('new-month-goals-3')] = true;
      try {
        const salesChannelId = process.env.SALES_CHANNEL_ID;
        if (salesChannelId) {
          const ch = await client.channels.fetch(salesChannelId);
          const monthName = now.toLocaleString('en-US', { month: 'long' }).toUpperCase();
          await ch.send([
            `@everyone`,
            ``,
            `🚨🎯 LAST CALL — ${monthName} GOALS 🚨🎯`,
            ``,
            `Day two. Some of you are already on the board putting up numbers. 📈`,
            ``,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            ``,
            `If your goal still isn't set, this is the last reminder you'll get until the 15th:`,
            ``,
            `👉 \`/mypersonalgoal\``,
            ``,
            `The floor is **$15,000** — that's the standard every writer is held to, not the target. Aim past it. 💪`,
            ``,
            `Don't let the month get going without a number on it. Set it now. 👑`,
            ``,
          ].join('\n'));
        }
      } catch (err) { console.error('Day-two goal reminder error:', err.message); }
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
      ].join('\n'), false, false, true); // prevMonth — recap the month that just closed
    }

    // ── TEAM / LEADERSHIP LEADERBOARDS ──────────────────────────────────────────
    // Intraday daily PAIR — individual board immediately followed by the team board,
    // at 12pm / 3pm / 6pm / 10pm Central. One clean "here's today so far" moment each
    // time instead of the two boards scattered separately through the afternoon.
    // (Weekend rule still applies: none on Sunday; on Saturday the 10pm pair is
    // blocked since posts stop after 6pm.)
    if ([12, 15, 18, 22].includes(hour) && min === 0 && !weekendBlocked(day, hour) && !lastPosted[key('daily-pair')]) {
      lastPosted[key('daily-pair')] = true;
      await postLeaderboard('daily');      // individual first
      await postTeamLeaderboard('daily');  // team right after, back to back
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

    // Team final weekly — Monday 8:07am, #3 in the weekly recap sequence.
    // Order in the leaderboard channel: individual weekly board (8:00) → Weekly MVP
    // (8:05) → this team board (8:07) → Base Shop of the Week (8:09, the finale).
    if (day === 1 && hour === 8 && min === 7 && !lastPosted[key('team-final-weekly')]) {
      lastPosted[key('team-final-weekly')] = true;
      postTeamLeaderboard('weekly', `🏪 **OFG TEAM RECAP — LAST WEEK LOCKED IN** 🏪`, true, false, true);
    }

    // Team monthly — Mon/Wed/Fri 10:02am, 2 min after producer monthly
    if ((day === 1 || day === 3 || day === 5) && hour === 10 && min === 2 && !lastPosted[key('team-monthly')]) {
      lastPosted[key('team-monthly')] = true;
      postTeamLeaderboard('monthly');
    }

    // Team final monthly — 1st at 8:44am, #3 in the monthly recap sequence.
    // Order in the leaderboard channel: individual monthly board (8:20) → Monthly
    // Champion (8:40) → this team board (8:44) → Base Shop of the Month (8:48, finale).
    if (now.getDate() === 1 && hour === 8 && min === 44 && !lastPosted[key('team-final-monthly')]) {
      lastPosted[key('team-final-monthly')] = true;
      postTeamLeaderboard('monthly', `🏛️ **OFG TEAM RECAP — THE MONTH IS CLOSED** 🏛️`, false, false, true, true); // final + prevMonth
    }

    // Top Base Shop of the WEEK — Monday 8:09am, the finale after the team weekly board.
    if (day === 1 && hour === 8 && min === 9 && !lastPosted[key('team-baseshop-week')]) {
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

    // Base Shop of the MONTH — 1st at 8:48am, the finale right after the team monthly board.
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
      postRecruitingLeaderboard('monthly', [
        ``,
        `🌱🔒👑 THE RECRUITING MONTH IS OFFICIALLY CLOSED! 👑🔒🌱`,
        ``,
        `🏗️💪 What an INCREDIBLE run! Month after month, this team keeps proving`,
        `what's possible when you stay locked in and keep building the future. 🚀`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `🏆✨ CONGRATULATIONS to everyone on this board — especially our top`,
        `recruiters who set the standard for what ELITE recruiting looks like at OFG! ✨🏆`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `🚪➡️🚀 New month. Fresh start. New goals.`,
        `Let's build it even BIGGER! 📈🔥🌱`,
        ``,
      ].join('\n'), false, false, true, true); // final + prevMonth
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
              `🌱 ${individual.count} hire${individual.count === 1 ? '' : 's'} last month`,
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

// ── The hub's door ────────────────────────────────────────────────────────────
// The OFG Hub's CRM writes sales straight into the same `sales` table. Until
// now the hub also posted its own copy of the alert embed, which meant the row
// landed on every leaderboard but the board never reacted to it: no Hat Trick,
// no First Blood, no whale, no rank up, no challenge score. Discord will not
// let one bot run another bot's slash command, so /sale could never be the
// answer.
//
// This is the answer instead: the hub says "row 1234 exists", and the bot runs
// the same pipeline /sale runs. Every announcement is genuinely Apollo's,
// because it IS Apollo — same process, same code, same channel.
//
// The hub does not get to describe the sale. It passes an id and nothing else;
// every value announced is read back out of the row. A caller that could name
// its own monthly total is a caller that could lie about it in a public feed.
//
// Requires HUB_SHARED_SECRET set here and the same value on the hub. Without
// it the door stays shut and the hub keeps posting its own plain embed.
/**
 * Constant-time secret check.
 *
 * `!==` on strings stops at the first differing byte, so how long a rejection
 * takes leaks how much of the secret was right — enough, over enough tries, to
 * walk it out a character at a time. The value living between two Railway
 * services is an argument for it being hard to reach, not for it being cheap to
 * guess once somebody has the URL, and this endpoint makes the bot post to the
 * whole team.
 */
function hubSecretMatches(provided) {
  const expected = process.env.HUB_SHARED_SECRET || '';
  if (!expected) return false;
  const given = Buffer.from(String(provided || ''), 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (given.length !== want.length) {
    // Compare something of the right shape anyway, so a wrong LENGTH doesn't
    // come back measurably faster than a wrong value.
    crypto.timingSafeEqual(want, want);
    return false;
  }
  return crypto.timingSafeEqual(given, want);
}

function startHubListener() {
  const port = process.env.PORT || 3000;
  if (!process.env.HUB_SHARED_SECRET) {
    console.warn('[hub] HUB_SHARED_SECRET not set — the door answers 503 and the hub posts its own embed.');
  }

  require('http').createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, ready: client.isReady() });
    if (req.method !== 'POST' || req.url !== '/hub/sale-announce') return send(404, { error: 'not found' });

    // 503, not 401: an unset secret is this service not being wired up yet, and
    // the hub reads 503 as "nothing was posted" and falls back to its own embed.
    // 401 would mean the same thing to the hub, but it would also mean "somebody
    // knocked with the wrong key", which is worth being able to tell apart.
    if (!process.env.HUB_SHARED_SECRET) return send(503, { error: 'HUB_SHARED_SECRET not set on the bot' });
    if (!hubSecretMatches(req.headers['x-hub-secret'])) {
      console.warn('[hub] rejected a call with a bad secret');
      return send(401, { error: 'bad secret' });
    }
    if (!client.isReady()) return send(503, { error: 'bot still starting' });

    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4096) return send(413, { error: 'too big' });
    }

    let salesId;
    try { salesId = Number(JSON.parse(body || '{}').salesId); } catch { return send(400, { error: 'bad json' }); }
    if (!Number.isFinite(salesId) || salesId <= 0) return send(400, { error: 'salesId required' });

    let claimed = false;
    const progress = { alertPosted: false };
    try {
      const sale = await getSaleById(salesId);
      if (!sale) return send(404, { error: 'sale not found' });

      // A retry after a slow-but-successful call must not double-announce, and
      // the retry most likely to arrive is the one after a redeploy — so the
      // claim is taken in the database rather than in a per-process Set, which
      // a restart would forget at exactly the wrong moment. Claimed BEFORE
      // anything is posted; see claimSaleAnnouncement in database.js.
      claimed = await claimSaleAnnouncement(salesId);
      if (!claimed) {
        // 200, not an error: the sale HAS been announced, which is all the hub
        // wanted. Anything else would send it off to post a duplicate.
        return send(200, { ok: true, announced: false, reason: 'already announced' });
      }

      // The name on the row is whatever the hub's roster last wrote. Apollo's
      // alerts have always used the Discord nickname — which in this server
      // carries upline and state — so that is what this uses too.
      let displayName = sale.username;
      try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(sale.user_id);
        displayName = member?.displayName || displayName;
      } catch (_) {}

      const notes = sale.notes || '';
      const { personalBests } = await runSaleAnnouncements({
        progress,
        userId: sale.user_id,
        displayName: displayName || `Agent_${sale.user_id}`,
        saleId: sale.id,
        carrier: sale.carrier || 'Unknown',
        product: sale.policy_type || 'Unknown',
        leadType: (notes.match(/Lead:\s*([^|]+)/)?.[1] || 'Unknown').trim(),
        presentationType: (notes.match(/Presentation:\s*([^|]+)/)?.[1] || 'Unknown').trim(),
        premium: parseFloat(sale.premium) || 0,
      });

      // The pipeline swallows Discord failures by design — a hiccup must never
      // cost the row. That is right for /sale and wrong here: a silent 200 tells
      // the hub the sale was announced and stops it posting its own embed, so
      // the sale ends up with NO message from either side. That is the one thing
      // the spec says can never happen (17-APOLLO-SALE-HOOK.md, VERIFY #7).
      //
      // 503 is the code the hub reads as "the door didn't open, nothing was
      // posted" — it falls back to its own embed and the board still hears about
      // the sale, plainly. The claim goes back so a retry isn't locked out.
      if (!progress.alertPosted) {
        console.error(`[hub] sale ${salesId}: the alert never reached the channel — telling the hub to post its own`);
        if (claimed) {
          try { await releaseSaleAnnouncement(salesId); }
          catch (e) { console.error('[hub] could not release the claim:', e.message); }
        }
        return send(503, { error: 'the sale alert did not reach the channel' });
      }

      // /sale shows these privately in its reply. There is no reply here, so
      // they go by DM — the agent still hears it, nobody else does.
      if (personalBests.length) {
        try {
          const user = await client.users.fetch(sale.user_id);
          await user.send(personalBests.join('\n\n'));
        } catch (e) { console.error('[hub] personal-best DM failed:', e.message); }
      }

      console.log(`[hub] announced sale ${salesId} for ${displayName}`);
      send(200, { ok: true, announced: true });
    } catch (err) {
      console.error('[hub] announce failed:', err);

      // 503 or 500, and the difference is whether the alert already went out.
      //
      // The hub falls back to its own embed on 503 and stays quiet on anything
      // else (discordSales.js:281). Both behaviours are right, for different
      // failures. A database blip in the lookup or the claim means nothing was
      // posted, so silence would lose the sale's announcement entirely — 503,
      // fall back. But the pipeline can also throw after the alert is already in
      // the channel (getActiveChallenges and getGoal sit outside a catch), and
      // there 503 would put a second alert for one sale in a public feed. That
      // is the case 500 exists for: we may have posted, so don't post again.
      if (progress.alertPosted) return send(500, { error: err.message });

      // Nothing went out — let a retry through, and only release a claim THIS
      // request took, so a failed lookup can't hand back a claim a concurrent
      // request is still announcing on.
      if (claimed) {
        try { await releaseSaleAnnouncement(salesId); }
        catch (e) { console.error('[hub] could not release the claim:', e.message); }
      }
      send(503, { error: err.message });
    }
  }).listen(port, () => console.log(`[hub] listening on ${port}`));
}

// Before login, not after. Railway health-checks the port as soon as the deploy
// starts, and the Discord gateway handshake is slow enough — and, with a bad
// token, permanently enough — to fail that check and roll the deploy back. The
// door itself answers 503 until the client is ready, which the hub reads as
// "not now" and falls back to its own embed.
startHubListener();

client.login(process.env.DISCORD_TOKEN);

// Exported for the smoke test in the hub repo; nothing in the bot imports this.
module.exports = { runSaleAnnouncements };
