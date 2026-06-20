// src/database.js - Supabase version
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── Central Time boundary helpers ────────────────────────────────────────────
function getDayStart() {
  const realNow     = new Date();
  const centralFake = new Date(realNow.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const offsetMs    = realNow - centralFake;
  centralFake.setHours(0, 0, 0, 0);
  return new Date(centralFake.getTime() + offsetMs);
}

function getYesterdayStart() {
  const realNow     = new Date();
  const centralFake = new Date(realNow.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const offsetMs    = realNow - centralFake;
  centralFake.setDate(centralFake.getDate() - 1);
  centralFake.setHours(0, 0, 0, 0);
  return new Date(centralFake.getTime() + offsetMs);
}

function getWeekStart(prevWeek = false) {
  const realNow     = new Date();
  const centralFake = new Date(realNow.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const offsetMs    = realNow - centralFake;
  const day = centralFake.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  centralFake.setDate(centralFake.getDate() - daysFromMonday - (prevWeek ? 7 : 0));
  centralFake.setHours(0, 0, 0, 0);
  return new Date(centralFake.getTime() + offsetMs);
}

// ── Sales ─────────────────────────────────────────────────────────────────────

async function addSale({ userId, username, clientName, policyType, premium, carrier, notes }) {
  const safeUsername = (username && String(username).trim()) || `Agent_${userId}`;
  const { data, error } = await supabase.from('sales').insert([{
    user_id: userId, username: safeUsername, client_name: clientName,
    policy_type: policyType, premium, carrier: carrier || '', notes: notes || '',
  }]).select().single();
  if (error) throw error;
  return data;
}

async function getLeaderboard(period, prevWeek = false, prevDay = false) {
  let query = supabase.from('sales').select('user_id, username, premium');
  const now = new Date();
  if (period === 'daily') {
    if (prevDay) {
      // Yesterday's window: yesterday midnight → today midnight
      query = query
        .gte('created_at', getYesterdayStart().toISOString())
        .lt('created_at', getDayStart().toISOString());
    } else {
      const start = getDayStart();
      query = query.gte('created_at', start.toISOString());
    }
  } else if (period === 'weekly') {
    const start = getWeekStart(prevWeek);
    query = query.gte('created_at', start.toISOString());
    if (prevWeek) {
      // cap at this Monday midnight so current week sales don't bleed in
      query = query.lt('created_at', getWeekStart(false).toISOString());
    }
  } else if (period === 'monthly') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    query = query.gte('created_at', start.toISOString());
  }
  const { data, error } = await query;
  if (error) throw error;
  const map = {};
  for (const s of data) {
    if (!map[s.user_id]) map[s.user_id] = { user_id: s.user_id, username: s.username, total: 0, sales_count: 0 };
    map[s.user_id].total += parseFloat(s.premium);
    map[s.user_id].sales_count++;
  }
  return Object.values(map).sort((a, b) => b.total - a.total);
}

async function getMonthlyTotal() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('sales').select('premium').gte('created_at', start.toISOString());
  if (error) throw error;
  return data.reduce((sum, s) => sum + parseFloat(s.premium), 0);
}

// Returns a map of { userId: monthlyTotal } for all agents — used so daily/weekly
// leaderboards can show the correct monthly-based rank badge for each agent.
async function getMonthlyTotalsMap() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('sales')
    .select('user_id, premium')
    .gte('created_at', start.toISOString());
  if (error) return {};
  const map = {};
  for (const s of data) {
    map[s.user_id] = (map[s.user_id] || 0) + parseFloat(s.premium);
  }
  return map;
}

async function getUserStats(userId) {
  const now = new Date();
  const todayStart = getDayStart();
  const weekStart = getWeekStart();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('sales').select('premium, created_at').eq('user_id', userId);
  if (error) throw error;
  const daily   = data.filter(s => new Date(s.created_at) >= todayStart);
  const weekly  = data.filter(s => new Date(s.created_at) >= weekStart);
  const monthly = data.filter(s => new Date(s.created_at) >= monthStart);
  // Best day ever
  const byDay = {};
  for (const s of data) {
    const d = new Date(s.created_at).toDateString();
    byDay[d] = (byDay[d] || 0) + parseFloat(s.premium);
  }
  const bestDay = Math.max(0, ...Object.values(byDay));
  // Best week ever
  const byWeek = {};
  for (const s of data) {
    const d = new Date(s.created_at);
    const weekKey = `${d.getFullYear()}-W${Math.floor(d.getDate()/7)}`;
    byWeek[weekKey] = (byWeek[weekKey] || 0) + parseFloat(s.premium);
  }
  const bestWeek = Math.max(0, ...Object.values(byWeek));
  // Best month ever
  const byMonth = {};
  for (const s of data) {
    const d = new Date(s.created_at);
    const mk = `${d.getFullYear()}-${d.getMonth()}`;
    byMonth[mk] = (byMonth[mk] || 0) + parseFloat(s.premium);
  }
  const bestMonth = Math.max(0, ...Object.values(byMonth));
  return {
    daily_total:   daily.reduce((sum, s) => sum + parseFloat(s.premium), 0),
    daily_count:   daily.length,
    weekly_total:  weekly.reduce((sum, s) => sum + parseFloat(s.premium), 0),
    monthly_total: monthly.reduce((sum, s) => sum + parseFloat(s.premium), 0),
    monthly_count: monthly.length,
    total_ever:    data.reduce((sum, s) => sum + parseFloat(s.premium), 0),
    total_sales:   data.length,
    best_day:      bestDay,
    best_week:     bestWeek,
    best_month:    bestMonth,
  };
}

async function getTeamStats() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('sales').select('premium, created_at, user_id');
  if (error) throw error;
  const monthly = data.filter(s => new Date(s.created_at) >= monthStart);
  // Best day ever
  const byDay = {};
  for (const s of data) {
    const d = new Date(s.created_at).toDateString();
    byDay[d] = (byDay[d] || 0) + parseFloat(s.premium);
  }
  const bestDayAmount = Math.max(0, ...Object.values(byDay));
  const bestDayDate = Object.keys(byDay).find(k => byDay[k] === bestDayAmount) || 'N/A';
  return {
    total_sales_ever:   data.length,
    total_ap_ever:      data.reduce((sum, s) => sum + parseFloat(s.premium), 0),
    monthly_sales:      monthly.length,
    monthly_ap:         monthly.reduce((sum, s) => sum + parseFloat(s.premium), 0),
    avg_premium:        data.length ? data.reduce((sum, s) => sum + parseFloat(s.premium), 0) / data.length : 0,
    best_day_amount:    bestDayAmount,
    best_day_date:      bestDayDate,
    unique_agents:      new Set(data.map(s => s.user_id)).size,
  };
}

async function getUserTotalSales(userId) {
  const { data, error } = await supabase.from('sales').select('id').eq('user_id', userId);
  if (error) throw error;
  return data.length;
}

async function getDailySalesCount(userId) {
  const start = getDayStart();
  const { data, error } = await supabase.from('sales').select('id').eq('user_id', userId).gte('created_at', start.toISOString());
  if (error) throw error;
  return data.length;
}

// Returns total sales count across the ENTIRE team today — used for First Blood check
async function getTeamDailySalesCount() {
  const start = getDayStart();
  const { data, error } = await supabase.from('sales').select('id').gte('created_at', start.toISOString());
  if (error) throw error;
  return data.length;
}

// ── Challenge Records ─────────────────────────────────────────────────────────

// How many challenges has this user ISSUED today (cap is 3)
async function getDailyChallengeCount(userId) {
  const start = getDayStart();
  const { data, error } = await supabase.from('challenges')
    .select('id').eq('challenger_id', userId).gte('created_at', start.toISOString());
  if (error) return 0;
  return data.length;
}

// Check if challenger has already challenged this specific person today
async function getDailyChallengeWith(challengerId, challengeeId) {
  const start = getDayStart();
  const { data, error } = await supabase.from('challenges')
    .select('id')
    .eq('challenger_id', challengerId)
    .eq('challengee_id', challengeeId)
    .gte('created_at', start.toISOString());
  if (error) return null;
  return data[0] || null;
}

// Increment wins or losses for an agent in challenge_records
async function updateChallengeRecord(userId, username, isWin) {
  const { data: existing, error: selectError } = await supabase.from('challenge_records')
    .select('*').eq('user_id', userId).maybeSingle();

  if (selectError) {
    console.error(`[challenge_records] select failed for ${userId} (${username}):`, selectError.message || selectError);
    return;
  }

  if (existing) {
    const { error: updateError } = await supabase.from('challenge_records').update({
      username,
      wins:   existing.wins   + (isWin ? 1 : 0),
      losses: existing.losses + (isWin ? 0 : 1),
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
    if (updateError) {
      console.error(`[challenge_records] update failed for ${userId} (${username}):`, updateError.message || updateError);
    }
  } else {
    const { error: insertError } = await supabase.from('challenge_records').insert({
      user_id: userId, username,
      wins:   isWin ? 1 : 0,
      losses: isWin ? 0 : 1,
      updated_at: new Date().toISOString(),
    });
    if (insertError) {
      console.error(`[challenge_records] insert failed for ${userId} (${username}):`, insertError.message || insertError);
    }
  }
}

// Get all-time challenge standings sorted by wins
async function getChallengeStandings() {
  const { data, error } = await supabase.from('challenge_records')
    .select('*').order('wins', { ascending: false });
  if (error) {
    console.error('[challenge_records] getChallengeStandings failed:', error.message || error);
    return [];
  }
  return data || [];
}

async function getMonthlyTopSale() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('sales').select('premium, user_id, username').gte('created_at', start.toISOString()).order('premium', { ascending: false }).limit(1);
  if (error) throw error;
  return data[0] || null;
}

async function getRecentSales(limit = 5) {
  const { data, error } = await supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

async function deleteSale(saleId, userId) {
  const { data, error } = await supabase.from('sales').delete().eq('id', saleId).eq('user_id', userId).select();
  if (error) throw error;
  return { changes: data ? data.length : 0 };
}

async function adminDeleteSale(saleId) {
  const { data, error } = await supabase.from('sales').delete().eq('id', saleId).select();
  if (error) throw error;
  return { changes: data ? data.length : 0 };
}

// ── Goal ──────────────────────────────────────────────────────────────────────

async function getGoal() {
  const { data, error } = await supabase.from('settings').select('value').eq('key', 'monthly_goal').single();
  if (error || !data) return parseFloat(process.env.MONTHLY_GOAL || 250000);
  return parseFloat(data.value);
}

async function setGoal(amount) {
  await supabase.from('settings').upsert({ key: 'monthly_goal', value: String(amount) });
}

// ── Ranks ─────────────────────────────────────────────────────────────────────

function getRanks() {
  return [
    { id: 1, name: 'Voyager',       min_monthly: 0,      color: '#57F287', emoji: '🚀' },
    { id: 2, name: 'Trailblazer',   min_monthly: 5000,   color: '#3498DB', emoji: '⚔️' },
    { id: 3, name: 'Conqueror',     min_monthly: 10000,  color: '#9B59B6', emoji: '🛡️' },
    { id: 4, name: 'Odyssey Elite', min_monthly: 25000,  color: '#F1C40F', emoji: '👑' },
    { id: 5, name: 'Titan',         min_monthly: 50000,  color: '#E74C3C', emoji: '💎' },
    { id: 6, name: 'Legend',        min_monthly: 100000, color: '#FF6B00', emoji: '🏆' },
  ];
}

function getRankForAmount(amount) {
  const ranks = getRanks();
  let current = ranks[0];
  for (const rank of ranks) {
    if (amount >= rank.min_monthly) current = rank;
    else break;
  }
  return current;
}

// ── Edit Sale ────────────────────────────────────────────────────────────────

async function editSale(saleId, newPremium) {
  const { data, error } = await supabase.from('sales')
    .update({ premium: newPremium })
    .eq('id', saleId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getSaleById(saleId) {
  const { data, error } = await supabase.from('sales')
    .select('*')
    .eq('id', saleId)
    .single();
  if (error) return null;
  return data;
}

// ── Personal Goals ───────────────────────────────────────────────────────────

async function setPersonalGoal(userId, username, amount) {
  await supabase.from('settings').upsert({
    key: `personal_goal_${userId}`,
    value: JSON.stringify({ amount, username })
  });
}

async function getPersonalGoal(userId) {
  const { data, error } = await supabase.from('settings')
    .select('value')
    .eq('key', `personal_goal_${userId}`)
    .single();
  if (error || !data) return null;
  return JSON.parse(data.value);
}

async function getAllPersonalGoals() {
  const { data, error } = await supabase.from('settings')
    .select('key, value')
    .like('key', 'personal_goal_%');
  if (error || !data) return [];
  return data.map(row => ({
    user_id: row.key.replace('personal_goal_', ''),
    ...JSON.parse(row.value)
  }));
}

// ── Records ──────────────────────────────────────────────────────────────────

async function getAllTimeRecords() {
  const { data, error } = await supabase.from('settings')
    .select('key, value')
    .in('key', ['alltime_day_amount', 'alltime_day_user', 'alltime_day_username',
                 'alltime_week_amount', 'alltime_week_user', 'alltime_week_username',
                 'alltime_month_amount', 'alltime_month_user', 'alltime_month_username']);
  if (error) return {};
  const result = {};
  for (const row of data) result[row.key] = row.value;
  return result;
}

async function setAllTimeRecord(type, amount, userId, username) {
  const updates = [
    { key: `alltime_${type}_amount`, value: String(amount) },
    { key: `alltime_${type}_user`, value: userId },
    { key: `alltime_${type}_username`, value: username },
  ];
  for (const u of updates) {
    await supabase.from('settings').upsert(u);
  }
}

async function getMonthlyRecords() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('sales')
    .select('user_id, username, premium, created_at')
    .gte('created_at', start.toISOString());
  if (error || !data.length) return { bestDay: null, bestWeek: null };

  // Best day of month
  const byUserDay = {};
  for (const s of data) {
    const d = new Date(s.created_at).toDateString();
    const key = `${s.user_id}-${d}`;
    if (!byUserDay[key]) byUserDay[key] = { user_id: s.user_id, username: s.username, total: 0, date: d };
    byUserDay[key].total += parseFloat(s.premium);
  }
  const bestDay = Object.values(byUserDay).sort((a, b) => b.total - a.total)[0] || null;

  // Best week of month
  const byUserWeek = {};
  for (const s of data) {
    const d = new Date(s.created_at);
    const weekNum = Math.floor(d.getDate() / 7);
    const key = `${s.user_id}-W${weekNum}`;
    if (!byUserWeek[key]) byUserWeek[key] = { user_id: s.user_id, username: s.username, total: 0 };
    byUserWeek[key].total += parseFloat(s.premium);
  }
  const bestWeek = Object.values(byUserWeek).sort((a, b) => b.total - a.total)[0] || null;

  return { bestDay, bestWeek };
}

async function getUserDailyTotal(userId) {
  const start = getDayStart();
  const { data, error } = await supabase.from('sales')
    .select('premium')
    .eq('user_id', userId)
    .gte('created_at', start.toISOString());
  if (error) return 0;
  return data.reduce((sum, s) => sum + parseFloat(s.premium), 0);
}

async function getUserWeeklyTotal(userId) {
  const start = getWeekStart();
  const { data, error } = await supabase.from('sales')
    .select('premium')
    .eq('user_id', userId)
    .gte('created_at', start.toISOString());
  if (error) return 0;
  return data.reduce((sum, s) => sum + parseFloat(s.premium), 0);
}

// ── Challenges ───────────────────────────────────────────────────────────────

async function createChallenge(challengerId, challengerName, challengeeId, challengeeName) {
  const { data, error } = await supabase.from('challenges').insert([{
    challenger_id: challengerId,
    challenger_name: challengerName,
    challengee_id: challengeeId,
    challengee_name: challengeeName,
    status: 'active',
    created_at: new Date().toISOString(),
  }]).select().single();
  if (error) throw error;
  return data;
}

async function getActiveChallenge(userId) {
  const { data, error } = await supabase.from('challenges')
    .select('*')
    .or(`challenger_id.eq.${userId},challengee_id.eq.${userId}`)
    .eq('status', 'active')
    .single();
  if (error) return null;
  return data;
}

// Returns ALL active challenges for a user (they can have up to 3 at once)
async function getActiveChallenges(userId) {
  const { data, error } = await supabase.from('challenges')
    .select('*')
    .or(`challenger_id.eq.${userId},challengee_id.eq.${userId}`)
    .eq('status', 'active');
  if (error) return [];
  return data || [];
}

async function expireChallenges() {
  await supabase.from('challenges').update({ status: 'expired' }).eq('status', 'active');
}

// Call at 11:55pm — grabs daily totals BEFORE midnight reset, stores winner for morning announcement
async function determineChallengeWinners() {
  const { data, error } = await supabase.from('challenges').select('*').eq('status', 'active');
  if (error) {
    console.error('[challenges] determineChallengeWinners query failed:', error.message || error);
    return;
  }
  if (!data || !data.length) {
    console.log('[challenges] determineChallengeWinners: no active challenges found.');
    return;
  }

  const results = [];
  for (const challenge of data) {
    const challengerTotal = await getUserDailyTotal(challenge.challenger_id);
    const challengeeTotal = await getUserDailyTotal(challenge.challengee_id);
    if (challengerTotal === 0 && challengeeTotal === 0) continue; // nobody sold, skip

    const tie = challengerTotal === challengeeTotal;
    const winner = challengerTotal >= challengeeTotal
      ? { id: challenge.challenger_id, name: challenge.challenger_name, total: challengerTotal }
      : { id: challenge.challengee_id, name: challenge.challengee_name, total: challengeeTotal };
    const loser = challengerTotal >= challengeeTotal
      ? { id: challenge.challengee_id, name: challenge.challengee_name, total: challengeeTotal }
      : { id: challenge.challenger_id, name: challenge.challenger_name, total: challengerTotal };

    results.push({ winner, loser, tie });

    // Update all-time records — ties count as no change
    if (!tie) {
      await updateChallengeRecord(winner.id, winner.name, true);
      await updateChallengeRecord(loser.id, loser.name, false);
    }
  }

  if (results.length) {
    const { error: upsertError } = await supabase.from('settings').upsert({ key: 'pending_challenge_results', value: JSON.stringify(results) });
    if (upsertError) {
      console.error('[challenges] failed to save pending_challenge_results:', upsertError.message || upsertError);
    } else {
      console.log(`[challenges] determineChallengeWinners: resolved ${results.length} challenge(s).`);
    }
  } else {
    console.log('[challenges] determineChallengeWinners: active challenges found, but all had 0 sales for both sides — nothing to record.');
  }
}

async function getPendingChallengeResults() {
  const { data, error } = await supabase.from('settings').select('value').eq('key', 'pending_challenge_results').maybeSingle();
  if (error) {
    console.error('[challenges] getPendingChallengeResults failed:', error.message || error);
    return [];
  }
  if (!data) return [];
  try { return JSON.parse(data.value); } catch { return []; }
}

async function clearPendingChallengeResults() {
  await supabase.from('settings').delete().eq('key', 'pending_challenge_results');
}

// ── Anniversaries ─────────────────────────────────────────────────────────────

async function getFirstSaleDate(userId) {
  const { data, error } = await supabase.from('sales')
    .select('created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return new Date(data[0].created_at);
}

async function getAllAgentFirstSales() {
  const { data, error } = await supabase.from('sales')
    .select('user_id, username, created_at')
    .order('created_at', { ascending: true });
  if (error) return [];
  const seen = {};
  for (const s of data) {
    if (!seen[s.user_id]) seen[s.user_id] = s;
  }
  return Object.values(seen);
}

// ── Monthly champion ──────────────────────────────────────────────────────────

async function getMonthlyChampion() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('sales')
    .select('user_id, username, premium')
    .gte('created_at', start.toISOString());
  if (error || !data.length) return null;
  const map = {};
  for (const s of data) {
    if (!map[s.user_id]) map[s.user_id] = { user_id: s.user_id, username: s.username, total: 0 };
    map[s.user_id].total += parseFloat(s.premium);
  }
  return Object.values(map).sort((a, b) => b.total - a.total)[0];
}

async function getWeeklyMVP(prevWeek = false) {
  const weekStart = getWeekStart(prevWeek);
  let query = supabase.from('sales')
    .select('user_id, username, premium')
    .gte('created_at', weekStart.toISOString());
  if (prevWeek) {
    query = query.lt('created_at', getWeekStart(false).toISOString());
  }
  const { data, error } = await query;
  if (error || !data.length) return null;
  const map = {};
  for (const s of data) {
    if (!map[s.user_id]) map[s.user_id] = { user_id: s.user_id, username: s.username, total: 0, count: 0 };
    map[s.user_id].total += parseFloat(s.premium);
    map[s.user_id].count++;
  }
  return Object.values(map).sort((a, b) => b.total - a.total)[0];
}

// Returns { userId: bestSingleDayCount } for the current month (Central Time).
// Used to show persistent monthly milestone badges on all leaderboards.
// Badge = highest sales count hit in any single day this month.
async function getBestDailyBadgesMap() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('sales')
    .select('user_id, created_at')
    .gte('created_at', start.toISOString());
  if (error) return {};
  const dailyCounts = {};
  for (const s of data) {
    const date = new Date(s.created_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
    if (!dailyCounts[s.user_id]) dailyCounts[s.user_id] = {};
    dailyCounts[s.user_id][date] = (dailyCounts[s.user_id][date] || 0) + 1;
  }
  const bestMap = {};
  for (const [userId, dates] of Object.entries(dailyCounts)) {
    bestMap[userId] = Math.max(...Object.values(dates));
  }
  return bestMap;
}

// Returns the team's total AP for today (Central Time).
async function getTeamDailyTotal() {
  const start = getDayStart();
  const { data, error } = await supabase.from('sales')
    .select('premium')
    .gte('created_at', start.toISOString());
  if (error) return 0;
  return data.reduce((sum, s) => sum + parseFloat(s.premium), 0);
}

// Returns a Set of user IDs who have logged at least one sale every Mon–Fri
// in the same week at any point this month. Badge persists all month.
async function getHotWeekBadgesSet() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('sales')
    .select('user_id, created_at')
    .gte('created_at', start.toISOString());
  if (error) return new Set();

  // Group by user → week key → set of weekdays (Mon=1 … Fri=5)
  const userWeeks = {};
  for (const s of data) {
    const d = new Date(new Date(s.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    const daysFromMon = dow - 1;
    const mon = new Date(d);
    mon.setDate(d.getDate() - daysFromMon);
    const weekKey = mon.toDateString();
    if (!userWeeks[s.user_id]) userWeeks[s.user_id] = {};
    if (!userWeeks[s.user_id][weekKey]) userWeeks[s.user_id][weekKey] = new Set();
    userWeeks[s.user_id][weekKey].add(dow);
  }

  const hotWeekUsers = new Set();
  for (const [userId, weeks] of Object.entries(userWeeks)) {
    for (const days of Object.values(weeks)) {
      if (days.has(1) && days.has(2) && days.has(3) && days.has(4) && days.has(5)) {
        hotWeekUsers.add(userId);
        break;
      }
    }
  }
  return hotWeekUsers;
}

// Returns all currently active challenges across the whole team
async function getAllActiveChallenges() {
  const { data, error } = await supabase.from('challenges')
    .select('*')
    .eq('status', 'active');
  if (error) return [];
  return data || [];
}

// 🌱 New Producer — first sale within the last 30 days
async function getNewProducerSet() {
  const agents = await getAllAgentFirstSales();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const set = new Set();
  for (const a of agents) {
    if (new Date(a.created_at) >= cutoff) set.add(a.user_id);
  }
  return set;
}

// 🌅 First Sale of the Day — whoever logged the very first sale today
async function getEarlyBirdSet() {
  const start = getDayStart();
  const { data, error } = await supabase.from('sales')
    .select('user_id')
    .gte('created_at', start.toISOString())
    .order('created_at', { ascending: true })
    .limit(1);
  if (error || !data.length) return new Set();
  return new Set([data[0].user_id]);
}

// 💰 High Roller — logged a single sale over $3,000 this month
async function getHighRollerSet() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('sales')
    .select('user_id, premium')
    .gte('created_at', start.toISOString());
  if (error) return new Set();
  const set = new Set();
  for (const s of data) {
    if (parseFloat(s.premium) >= 3000) set.add(s.user_id);
  }
  return set;
}

// 🎖️ Reigning Champ — last month's #1 producer, wears badge all current month
async function getReigningChampionId() {
  const now = new Date();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('sales')
    .select('user_id, premium')
    .gte('created_at', lastMonthStart.toISOString())
    .lt('created_at', lastMonthEnd.toISOString());
  if (error || !data.length) return null;
  const totals = {};
  for (const s of data) {
    totals[s.user_id] = (totals[s.user_id] || 0) + parseFloat(s.premium);
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// Returns the highest single sale premium a user has ever logged (all time)
async function getPersonalBestSale(userId) {
  const { data, error } = await supabase.from('sales')
    .select('premium')
    .eq('user_id', userId)
    .order('premium', { ascending: false })
    .limit(1);
  if (error || !data.length) return 0;
  return parseFloat(data[0].premium);
}

// 🏋️ Showstopper — holds the biggest single sale of the month
async function getShowstopperId() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('sales')
    .select('user_id, premium')
    .gte('created_at', start.toISOString())
    .order('premium', { ascending: false })
    .limit(1);
  if (error || !data.length) return null;
  return data[0].user_id;
}

// ── Team hierarchy (Supabase-backed, live source of truth) ──────────────────────
const { createTree } = require('./team-logic');

async function getTeamMembersRaw() {
  const { data, error } = await supabase.from('team_members').select('*');
  if (error) { console.error('[team_members] load failed:', error.message || error); return []; }
  return data || [];
}

// Loads the live hierarchy from Supabase and returns a tree with all the helper
// methods (baseShopLeaders, getBaseShopOwner, masterLeaders, isAncestor, ...).
async function getTeamTree() {
  const rows = await getTeamMembersRaw();
  const map = {};
  for (const r of rows) {
    map[r.user_id] = {
      name: r.name || r.user_id,
      upline: r.upline_id || null,
      baseShop: !!r.base_shop,
      virtual: !!r.is_virtual,
      ...((r.is_master === null || r.is_master === undefined) ? {} : { master: r.is_master }),
    };
  }
  // Always guarantee the combined agency grouping node exists.
  if (!map['OVERALL_AGENCY']) {
    map['OVERALL_AGENCY'] = { name: 'Overall Agency', upline: null, virtual: true, master: true };
  }
  return createTree(map);
}

// Read-merge-write so partial edits never clobber other fields.
async function upsertTeamMember(fields) {
  const userId = fields.userId;
  const { data: existing } = await supabase.from('team_members').select('*').eq('user_id', userId).maybeSingle();
  const row = {
    user_id:    userId,
    name:       fields.name      !== undefined ? fields.name      : (existing ? existing.name      : userId),
    upline_id:  fields.uplineId  !== undefined ? fields.uplineId  : (existing ? existing.upline_id : null),
    base_shop:  fields.baseShop  !== undefined ? fields.baseShop  : (existing ? existing.base_shop : false),
    is_master:  fields.isMaster  !== undefined ? fields.isMaster  : (existing ? existing.is_master : null),
    is_virtual: fields.isVirtual !== undefined ? fields.isVirtual : (existing ? existing.is_virtual : false),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('team_members').upsert(row, { onConflict: 'user_id' });
  if (error) throw error;
  return row;
}

async function removeTeamMember(userId) {
  const { error } = await supabase.from('team_members').delete().eq('user_id', userId);
  if (error) throw error;
}

async function ensureAgencyNode(name) {
  const { data } = await supabase.from('team_members').select('user_id').eq('user_id', 'OVERALL_AGENCY').maybeSingle();
  if (!data) {
    await upsertTeamMember({ userId: 'OVERALL_AGENCY', name: name || 'Overall Agency', uplineId: null, baseShop: false, isMaster: true, isVirtual: true });
  }
}

// ── Unassigned producers queue (profile saved when an unplaced person logs a deal) ──
async function recordUnassignedProducer({ userId, name, avatarUrl }) {
  const { data: existing } = await supabase.from('unassigned_producers').select('deal_count').eq('user_id', userId).maybeSingle();
  const row = {
    user_id: userId,
    name: name || userId,
    avatar_url: avatarUrl || null,
    last_deal_at: new Date().toISOString(),
    deal_count: ((existing && existing.deal_count) || 0) + 1,
  };
  const { error } = await supabase.from('unassigned_producers').upsert(row, { onConflict: 'user_id' });
  if (error) throw error;
}

async function removeUnassignedProducer(userId) {
  const { error } = await supabase.from('unassigned_producers').delete().eq('user_id', userId);
  if (error) console.error('[unassigned_producers] remove failed:', error.message || error);
}

// ── Hires (recruiting) ──────────────────────────────────────────────────────────
// Same shape as sales, but the credit goes to the RECRUITER (recruiter_id = the
// upline's Discord id), since a brand-new hire usually has no Discord account yet.
// All Central-time windowing reuses the same helpers the sales boards use.

async function addHire({ recruitName, state, licensed, source, recruiterId, recruiterName, notes }) {
  const { data, error } = await supabase.from('hires').insert([{
    recruit_name: recruitName,
    state: state || '',
    licensed: !!licensed,
    source: source || '',
    recruiter_id: recruiterId,
    recruiter_name: (recruiterName && String(recruiterName).trim()) || recruiterId,
    notes: notes || '',
  }]).select().single();
  if (error) throw error;
  return data;
}

// Per-recruiter hire counts for a period (mirrors getLeaderboard).
async function getHireLeaderboard(period, prevWeek = false, prevDay = false) {
  let query = supabase.from('hires').select('recruiter_id, recruiter_name, created_at');
  const now = new Date();
  if (period === 'daily') {
    if (prevDay) {
      query = query
        .gte('created_at', getYesterdayStart().toISOString())
        .lt('created_at', getDayStart().toISOString());
    } else {
      query = query.gte('created_at', getDayStart().toISOString());
    }
  } else if (period === 'weekly') {
    query = query.gte('created_at', getWeekStart(prevWeek).toISOString());
    if (prevWeek) query = query.lt('created_at', getWeekStart(false).toISOString());
  } else if (period === 'monthly') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    query = query.gte('created_at', start.toISOString());
  }
  const { data, error } = await query;
  if (error) throw error;
  const map = {};
  for (const h of data) {
    if (!map[h.recruiter_id]) map[h.recruiter_id] = { recruiter_id: h.recruiter_id, recruiter_name: h.recruiter_name, count: 0 };
    map[h.recruiter_id].count++;
    if (h.recruiter_name) map[h.recruiter_id].recruiter_name = h.recruiter_name;
  }
  return Object.values(map).sort((a, b) => b.count - a.count);
}

// Per-source hire counts for a period (for the "Hires by Source" board line).
async function getHireSourceCounts(period, prevWeek = false, prevDay = false) {
  let query = supabase.from('hires').select('source, created_at');
  const now = new Date();
  if (period === 'daily') {
    if (prevDay) {
      query = query
        .gte('created_at', getYesterdayStart().toISOString())
        .lt('created_at', getDayStart().toISOString());
    } else {
      query = query.gte('created_at', getDayStart().toISOString());
    }
  } else if (period === 'weekly') {
    query = query.gte('created_at', getWeekStart(prevWeek).toISOString());
    if (prevWeek) query = query.lt('created_at', getWeekStart(false).toISOString());
  } else if (period === 'monthly') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    query = query.gte('created_at', start.toISOString());
  }
  const { data, error } = await query;
  if (error) throw error;
  const counts = {};
  for (const h of data) {
    const key = h.source || '';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// Team-wide hires this month (for the goal/progress bar).
async function getMonthlyHireTotal() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('hires').select('id').gte('created_at', start.toISOString());
  if (error) throw error;
  return data.length;
}

// One recruiter's daily / weekly / monthly / all-time hire counts (for the card).
async function getUserHireStats(recruiterId) {
  const now = new Date();
  const todayStart = getDayStart();
  const weekStart  = getWeekStart();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase.from('hires').select('created_at').eq('recruiter_id', recruiterId);
  if (error) throw error;
  const daily   = data.filter(h => new Date(h.created_at) >= todayStart);
  const weekly  = data.filter(h => new Date(h.created_at) >= weekStart);
  const monthly = data.filter(h => new Date(h.created_at) >= monthStart);
  return {
    daily_count:   daily.length,
    weekly_count:  weekly.length,
    monthly_count: monthly.length,
    total_count:   data.length,
  };
}

async function getHireGoal() {
  const { data, error } = await supabase.from('settings').select('value').eq('key', 'monthly_hire_goal').single();
  if (error || !data) return parseInt(process.env.MONTHLY_HIRE_GOAL || 100, 10);
  return parseInt(data.value, 10);
}

async function setHireGoal(count) {
  await supabase.from('settings').upsert({ key: 'monthly_hire_goal', value: String(count) });
}

module.exports = {
  addHire, getHireLeaderboard, getHireSourceCounts, getMonthlyHireTotal, getUserHireStats, getHireGoal, setHireGoal,
  getTeamTree, getTeamMembersRaw, upsertTeamMember, removeTeamMember, ensureAgencyNode,
  recordUnassignedProducer, removeUnassignedProducer,
  addSale, getLeaderboard, getMonthlyTotal, getMonthlyTotalsMap, getBestDailyBadgesMap, getUserStats, getTeamStats,
  getTeamDailyTotal, getHotWeekBadgesSet, getYesterdayStart,
  getNewProducerSet, getEarlyBirdSet, getHighRollerSet, getReigningChampionId, getShowstopperId, getPersonalBestSale,
  createChallenge, getActiveChallenge, getActiveChallenges, getAllActiveChallenges, expireChallenges,
  getDailyChallengeCount, getDailyChallengeWith, updateChallengeRecord, getChallengeStandings,
  determineChallengeWinners, getPendingChallengeResults, clearPendingChallengeResults,
  getAllAgentFirstSales, getMonthlyChampion, getWeeklyMVP,
  getAllTimeRecords, setAllTimeRecord, getMonthlyRecords,
  getUserDailyTotal, getUserWeeklyTotal,
  setPersonalGoal, getPersonalGoal, getAllPersonalGoals,
  editSale, getSaleById,
  getUserTotalSales, getDailySalesCount, getTeamDailySalesCount, getMonthlyTopSale,
  getRecentSales, deleteSale, adminDeleteSale, getGoal, setGoal,
  getRanks, getRankForAmount,
};
