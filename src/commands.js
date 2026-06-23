// src/commands.js
const {
  SlashCommandBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder,
} = require('discord.js');

const {
  getUserStats, getRankForAmount, getRecentSales, deleteSale,
  adminDeleteSale, getGoal, setGoal, getTeamStats,
  getAllActiveChallenges, getUserDailyTotal,
  determineChallengeWinners, getPendingChallengeResults, clearPendingChallengeResults,
} = require('./database');
const { buildLeaderboardEmbed, formatMoney } = require('./leaderboard');

// ── /sale ─────────────────────────────────────────────────────────────────────
// NOTE: Discord modals only support text inputs — no dropdowns inside a modal.
// Anything that should be a FIXED, pick-from-a-list value (Presentation Type,
// Carrier, Product) is a required slash-command option (a real Discord dropdown)
// chosen BEFORE the modal opens. Those three selections are encoded in the modal
// customId — "saleModal:<presentation>|<carrier>|<product>" — so handleSaleModal
// can read them on submit. The modal itself only collects the free-text fields
// that change every time (Lead Type, Submitted AP).
//
// To change the dropdown options later, edit ONLY the two arrays below — the
// command picks them up automatically. (Discord allows up to 25 choices each.)
const SALE_CARRIERS = [
  'Mutual of Omaha',
  'Transamerica',
  'United Home Life',
  'American Home Life',
  'AHL Patriot Series',
  'American Amicable',
  'Occidental',
  'Americo',
  'Foresters',
  'Banner',
  'SBLI',
  'NLG',
  'GPM',
  'Liberty Bankers',
];

const SALE_PRODUCTS = [
  'FEX',
  'Graded FEX',
  'Guaranteed Issue',
  'IUL',
  'TERM',
  'TERM ROP',
];

const saleCommand = {
  data: new SlashCommandBuilder()
    .setName('sale')
    .setDescription('Log a new insurance sale')
    .addStringOption(opt =>
      opt.setName('presentation_type')
        .setDescription('How was this policy presented?')
        .setRequired(true)
        .addChoices(
          { name: 'APT',            value: 'APT' },
          { name: 'One Call Close', value: 'One Call Close' },
          { name: 'In Home',        value: 'In Home' },
          { name: 'Follow Up',      value: 'Follow Up' },
        )
    )
    .addStringOption(opt =>
      opt.setName('carrier')
        .setDescription('Which carrier was the policy written with?')
        .setRequired(true)
        .addChoices(...SALE_CARRIERS.map(c => ({ name: c, value: c })))
    )
    .addStringOption(opt =>
      opt.setName('product')
        .setDescription('Which product type?')
        .setRequired(true)
        .addChoices(...SALE_PRODUCTS.map(p => ({ name: p, value: p })))
    ),
  async execute(interaction) {
    const presentationType = interaction.options.getString('presentation_type');
    const carrier          = interaction.options.getString('carrier');
    const product          = interaction.options.getString('product');
    // Encode all three fixed selections in the customId so they survive the
    // modal round-trip. None of the option values contain ':' or '|', so this
    // is safe to split back apart in handleSaleModal.
    const modal = new ModalBuilder()
      .setCustomId(`saleModal:${presentationType}|${carrier}|${product}`)
      .setTitle('Log New Sale - OFG');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('leadType').setLabel('Lead Type')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. A Lead, B Lead, Referral, D Lead')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('premium').setLabel('Submitted AP ($)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 2844')
          .setRequired(true)
      ),
    );
    await interaction.showModal(modal);
  },
};

// ── /leaderboard ──────────────────────────────────────────────────────────────
const leaderboardCommand = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('View the sales leaderboard')
    .addStringOption(opt => opt.setName('period').setDescription('Time period').setRequired(false)
      .addChoices(
        { name: 'Daily',      value: 'daily' },
        { name: 'Yesterday',  value: 'yesterday' },
        { name: 'Weekly',     value: 'weekly' },
        { name: 'Last Week',  value: 'lastweek' },
        { name: 'Monthly',    value: 'monthly' },
        { name: 'Last Month', value: 'lastmonth' },
      )),
  async execute(interaction) {
    await interaction.deferReply();
    const period = interaction.options.getString('period') || 'monthly';
    if (period === 'yesterday') {
      return interaction.editReply({ embeds: [await buildLeaderboardEmbed('daily', false, true)] });
    }
    if (period === 'lastweek') {
      return interaction.editReply({ embeds: [await buildLeaderboardEmbed('weekly', true, false)] });
    }
    if (period === 'lastmonth') {
      return interaction.editReply({ embeds: [await buildLeaderboardEmbed('monthly', false, false, true)] });
    }
    const embed = await buildLeaderboardEmbed(period);
    await interaction.editReply({ embeds: [embed] });
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
    const sales = await getRecentSales(30);
    if (sales.length === 0) return interaction.reply({ content: 'No sales logged yet!', ephemeral: true });
    let desc = '';
    sales.forEach((s, i) => {
      const date = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      desc += `**${i + 1}.** <@${s.user_id}> - ${formatMoney(s.premium)} - ${s.policy_type} - ${date} (ID: ${s.id})\n`;
    });
    // Split into chunks if too long for Discord
    const chunks = [];
    let current = '';
    for (const line of desc.split('\n')) {
      if ((current + line).length > 1900) { chunks.push(current); current = line + '\n'; }
      else current += line + '\n';
    }
    if (current) chunks.push(current);
    await interaction.reply({ embeds: [{ color: 0x3498DB, title: `Recent Sales (Last ${sales.length})`, description: chunks[0], footer: { text: 'OFG - Production Tracker' } }] });
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ embeds: [{ color: 0x3498DB, description: chunks[i] }] });
    }
  },
};

// ── /deletesale ───────────────────────────────────────────────────────────────
const deleteSaleCommand = {
  data: new SlashCommandBuilder().setName('deletesale').setDescription('Delete your own sale by ID')
    .addIntegerOption(opt => opt.setName('id').setDescription('Sale ID from /recentsales').setRequired(true)),
  async execute(interaction) {
    const saleId = interaction.options.getInteger('id');
    const result = await deleteSale(saleId, interaction.user.id);
    if (result.changes === 0) {
      return interaction.reply({ content: `Sale #${saleId} not found, or it isn't one of your sales.`, ephemeral: true });
    }
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
    const result = await adminDeleteSale(saleId);
    if (result.changes === 0) {
      return interaction.reply({ content: `Sale #${saleId} not found — nothing was deleted.`, ephemeral: true });
    }
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

// ── /challenge ────────────────────────────────────────────────────────────────
const { createChallenge, getActiveChallenge, getDailyChallengeCount, getDailyChallengeWith, getChallengeStandings } = require('./database');

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

    // 3 challenges max per day
    const dailyCount = await getDailyChallengeCount(interaction.user.id);
    if (dailyCount >= 3) {
      return interaction.reply({
        content: [
          ``,
          `⚔️ Challenge limit reached! ⚔️`,
          ``,
          `You've already issued **3 challenges** today — that's the daily max.`,
          `Come back tomorrow and run it back! 🔥`,
          ``,
        ].join('\n'),
        ephemeral: true,
      });
    }

    // Can't challenge the same person twice in one day
    const alreadyChallenged = await getDailyChallengeWith(interaction.user.id, target.id);
    if (alreadyChallenged) {
      return interaction.reply({
        content: `You already challenged <@${target.id}> today! Wait for the results tomorrow morning. ⏳`,
        ephemeral: true,
      });
    }

    await createChallenge(
      interaction.user.id,
      interaction.user.displayName || interaction.user.username,
      target.id,
      target.displayName || target.username
    );

    const remaining = 3 - (dailyCount + 1);
    await interaction.reply({
      content: [
        ``,
        `⚔️🔥 CHALLENGE ISSUED! 🔥⚔️`,
        ``,
        `<@${interaction.user.id}> just challenged <@${target.id}> to a sales battle!`,
        `Who closes more AP by end of day? 👀💰`,
        `May the best agent win! 💪`,
        ``,
        remaining > 0 ? `🎯 You have **${remaining}** challenge slot${remaining !== 1 ? 's' : ''} remaining today.` : `🎯 That's your 3rd challenge today — you're all in! 🔥`,
        ``,
      ].join('\n'),
    });
  },
};



// ── /standings ────────────────────────────────────────────────────────────────
const MEDALS = ['🥇', '🥈', '🥉'];

function buildStandingsEmbed(records) {
  if (!records || records.length === 0) {
    return {
      color: 0xFF6B35,
      title: '⚔️ OFG HEAD TO HEAD STANDINGS ⚔️',
      description: '*No challenges completed yet. Issue a `/challenge` and get on the board!*',
      footer: { text: 'OFG - Production Tracker' },
      timestamp: new Date().toISOString(),
    };
  }

  let desc = '';
  records.forEach((r, i) => {
    const total = r.wins + r.losses;
    const pct = total > 0 ? Math.round((r.wins / total) * 100) : 0;
    const medal = MEDALS[i] || `#${i + 1}`;
    desc += `${medal} **${r.username}** — ${r.wins}W-${r.losses}L *(${pct}% win rate)*\n`;
  });

  return {
    color: 0xFF6B35,
    title: '⚔️ OFG HEAD TO HEAD STANDINGS ⚔️',
    description: desc,
    footer: { text: 'OFG - Production Tracker • All-Time Record' },
    timestamp: new Date().toISOString(),
  };
}

const standingsCommand = {
  data: new SlashCommandBuilder()
    .setName('standings')
    .setDescription('View the OFG all-time head to head challenge standings'),
  async execute(interaction) {
    await interaction.deferReply();
    const records = await getChallengeStandings();
    await interaction.editReply({ embeds: [buildStandingsEmbed(records)] });
  },
};



// ── /mypersonalgoal ───────────────────────────────────────────────────────────
const { setPersonalGoal, getPersonalGoal, getAllPersonalGoals, getUserStats: getStats } = require('./database');

const myPersonalGoalCommand = {
  data: new SlashCommandBuilder()
    .setName('mypersonalgoal')
    .setDescription('Set your personal monthly AP goal (only you can see your progress)')
    .addIntegerOption(opt =>
      opt.setName('amount')
        .setDescription('Your personal goal in dollars e.g. 15000')
        .setRequired(true)
    ),
  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    const displayName = interaction.user.displayName || interaction.user.username;
    await setPersonalGoal(interaction.user.id, displayName, amount);

    const stats = await getStats(interaction.user.id);
    const current = stats?.monthly_total || 0;
    const pct = Math.min(Math.round((current / amount) * 100), 100);
    const filled = Math.round((pct / 100) * 20);
    const bar = '`' + '█'.repeat(filled) + '░'.repeat(20 - filled) + '`';
    const remaining = Math.max(0, amount - current);

    await interaction.reply({
      content: [
        ``,
        `🎯 Personal goal set to **$${amount.toLocaleString()}** for this month!`,
        ``,
        `Current: **$${current.toLocaleString()}** / **$${amount.toLocaleString()}**`,
        `${bar} ${pct}%`,
        remaining > 0 ? `**$${remaining.toLocaleString()}** to go — keep pushing! 💪` : `You already hit your personal goal! Set a higher one! 🔥`,
        ``,
        `Only you can see this message.`,
      ].join('\n'),
      ephemeral: true,
    });
  },
};

// ── /teamgoals ────────────────────────────────────────────────────────────────
const teamGoalsCommand = {
  data: new SlashCommandBuilder()
    .setName('teamgoals')
    .setDescription('See everyone on the team and their personal monthly goals'),
  async execute(interaction) {
    await interaction.deferReply();

    const goals = await getAllPersonalGoals();

    if (goals.length === 0) {
      return interaction.editReply({ content: 'No agents have set personal goals yet! Use `/mypersonalgoal` to set yours.' });
    }

    const { formatMoney } = require('./leaderboard');
    const { getRankForAmount } = require('./database');

    let desc = '';
    for (const goal of goals) {
      const stats = await getStats(goal.user_id);
      const current = stats?.monthly_total || 0;
      const pct = Math.min(Math.round((current / goal.amount) * 100), 100);
      const filled = Math.round((pct / 100) * 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
      const rank = getRankForAmount(current);
      const hit = current >= goal.amount ? ' ✅' : '';
      desc += `${rank.emoji} <@${goal.user_id}> — Goal: **${formatMoney(goal.amount)}** | At: **${formatMoney(current)}** | \`${bar}\` ${pct}%${hit}\n`;
    }

    const embed = {
      color: 0xF1C40F,
      title: '🎯 Team Personal Goals',
      description: desc,
      footer: { text: 'OFG - Production Tracker' },
      timestamp: new Date().toISOString(),
    };

    await interaction.editReply({ embeds: [embed] });
  },
};



// ── /editsale (admin only) ────────────────────────────────────────────────────
const { editSale, getSaleById } = require('./database');

const editSaleCommand = {
  data: new SlashCommandBuilder()
    .setName('editsale')
    .setDescription('Admin: Edit the AP amount of any sale by ID')
    .addIntegerOption(opt =>
      opt.setName('id')
        .setDescription('Sale ID (use /recentsales to find it)')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('amount')
        .setDescription('New AP amount in dollars e.g. 2500')
        .setRequired(true)
    ),
  async execute(interaction) {
    if (!interaction.member.permissions.has('ManageGuild')) {
      return interaction.reply({ content: 'You need Admin permissions to edit sales.', ephemeral: true });
    }

    const saleId = interaction.options.getInteger('id');
    const newAmount = interaction.options.getInteger('amount');

    const existing = await getSaleById(saleId);
    if (!existing) {
      return interaction.reply({ content: `Sale #${saleId} not found.`, ephemeral: true });
    }

    const { formatMoney } = require('./leaderboard');
    await editSale(saleId, newAmount);

    await interaction.reply({
      content: [
        `Sale #${saleId} updated!`,
        `Agent: <@${existing.user_id}>`,
        `Old amount: ${formatMoney(existing.premium)}`,
        `New amount: ${formatMoney(newAmount)}`,
      ].join('\n'),
      ephemeral: true,
    });
  },
};



// ── /myeditsale (own sales only) ──────────────────────────────────────────────
const myEditSaleCommand = {
  data: new SlashCommandBuilder()
    .setName('myeditsale')
    .setDescription('Edit the AP amount of your own sale by ID')
    .addIntegerOption(opt =>
      opt.setName('id')
        .setDescription('Sale ID (use /recentsales to find it)')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('amount')
        .setDescription('Correct AP amount in dollars e.g. 2500')
        .setRequired(true)
    ),
  async execute(interaction) {
    const saleId = interaction.options.getInteger('id');
    const newAmount = interaction.options.getInteger('amount');

    const existing = await getSaleById(saleId);
    if (!existing) {
      return interaction.reply({ content: `Sale #${saleId} not found.`, ephemeral: true });
    }

    if (existing.user_id !== interaction.user.id) {
      return interaction.reply({ content: `You can only edit your own sales.`, ephemeral: true });
    }

    const { formatMoney } = require('./leaderboard');
    await editSale(saleId, newAmount);

    await interaction.reply({
      content: [
        `Sale #${saleId} updated!`,
        `Old amount: ${formatMoney(existing.premium)}`,
        `New amount: ${formatMoney(newAmount)}`,
      ].join('\n'),
      ephemeral: true,
    });
  },
};

// ── /challenges ───────────────────────────────────────────────────────────────
const challengesCommand = {
  data: new SlashCommandBuilder()
    .setName('challenges')
    .setDescription('View all live challenge battles and current scores'),
  async execute(interaction) {
    await interaction.deferReply();

    const active = await getAllActiveChallenges();

    if (!active.length) {
      return interaction.editReply({
        embeds: [{
          color: 0xFF6B35,
          title: '⚔️ OFG LIVE CHALLENGE BOARD ⚔️',
          description: '*No active challenges right now.\nThink you can take someone down? Drop a `/challenge` and find out.* 👀',
          footer: { text: 'OFG - Production Tracker' },
          timestamp: new Date().toISOString(),
        }],
      });
    }

    const fields = [];
    for (const c of active) {
      const challengerTotal = await getUserDailyTotal(c.challenger_id);
      const challengeeTotal = await getUserDailyTotal(c.challengee_id);
      const tied    = challengerTotal === challengeeTotal;
      const leaderId = challengerTotal >= challengeeTotal ? c.challenger_id : c.challengee_id;
      const margin  = Math.abs(challengerTotal - challengeeTotal);

      const statusLine = tied
        ? `🤝 **TIED** — Anyone's game!`
        : `🔥 <@${leaderId}> leads by **${formatMoney(margin)}**`;

      fields.push({
        name: `⚔️ <@${c.challenger_id}> vs <@${c.challengee_id}>`,
        value: [
          `💰 <@${c.challenger_id}> — **${formatMoney(challengerTotal)}** AP`,
          `💰 <@${c.challengee_id}> — **${formatMoney(challengeeTotal)}** AP`,
          statusLine,
        ].join('\n'),
        inline: false,
      });
    }

    await interaction.editReply({
      embeds: [{
        color: 0xFF6B35,
        title: '⚔️ OFG LIVE CHALLENGE BOARD ⚔️',
        description: `**${active.length} active battle${active.length !== 1 ? 's' : ''} in progress.** Scores update live with every sale. 🔥`,
        fields,
        footer: { text: 'OFG - Production Tracker' },
        timestamp: new Date().toISOString(),
      }],
    });
  },
};

// ── /resolvechallenges (admin only, for testing) ────────────────────────────────
// Manually runs the same logic that normally fires automatically at 11:55pm Central.
// Tallies today's active challenges into challenge_records and queues results
// for the 9:30am announcement. Check the bot's console logs for [challenges] /
// [challenge_records] lines to see exactly what happened.
const resolveChallengesCommand = {
  data: new SlashCommandBuilder()
    .setName('resolvechallenges')
    .setDescription('Admin: manually resolve today\'s active challenges (for testing)'),
  async execute(interaction) {
    if (!interaction.member.permissions.has('ManageGuild')) {
      return interaction.reply({ content: 'You need Admin permissions to use this.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    await determineChallengeWinners();
    const pending = await getPendingChallengeResults();
    if (!pending.length) {
      return interaction.editReply({
        content: 'Ran the resolver — no results were queued. Either there are no active challenges right now, or both participants in every active challenge have $0 in sales today. Check the console for `[challenges]` / `[challenge_records]` log lines for details.',
      });
    }
    const summary = pending.map(r => {
      if (r.tie) return `🤝 <@${r.winner.id}> vs <@${r.loser.id}> — tied at ${formatMoney(r.winner.total)}`;
      return `🏆 <@${r.winner.id}> (${formatMoney(r.winner.total)}) beat <@${r.loser.id}> (${formatMoney(r.loser.total)})`;
    }).join('\n');
    await interaction.editReply({
      content: `Resolved ${pending.length} challenge(s):\n${summary}\n\nThese are now queued and will post in the sales channel at 9:30am, and \`/standings\` should reflect the updated wins/losses now. Run \`/standings\` to check, then \`/clearpendingchallenges\` if you don't want the 9:30am announcement to fire for this test run.`,
    });
  },
};

// ── /clearpendingchallenges (admin only, for testing) ──────────────────────────
const clearPendingChallengesCommand = {
  data: new SlashCommandBuilder()
    .setName('clearpendingchallenges')
    .setDescription('Admin: clear queued challenge results so they don\'t post at 9:30am'),
  async execute(interaction) {
    if (!interaction.member.permissions.has('ManageGuild')) {
      return interaction.reply({ content: 'You need Admin permissions to use this.', ephemeral: true });
    }
    await clearPendingChallengeResults();
    await interaction.reply({ content: 'Cleared any pending challenge results.', ephemeral: true });
  },
};

module.exports = {
  saleCommand, leaderboardCommand, myStatsCommand, teamStatsCommand,
  recentSalesCommand, deleteSaleCommand, removeSaleCommand, setGoalCommand,
  challengeCommand, standingsCommand, buildStandingsEmbed,
  myPersonalGoalCommand, teamGoalsCommand,
  editSaleCommand, myEditSaleCommand,
  challengesCommand,
  resolveChallengesCommand, clearPendingChallengesCommand,
};
