// src/database.js - Supabase version
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── Sales ─────────────────────────────────────────────────────────────────────

async function addSale({ userId, username, clientName, policyType, premium, carrier, notes }) {
  const { data, error } = await supabase.from('sales').insert([{
    user_id: userId, username, client_name: clientName,
    policy_type: policyType, premium, carrier: carrier || '', notes: notes || '',
  }]).select().single();
  if (error) throw error;
  return data;
}

async function getLeaderboard(period) {
  let query = supabase.from('sales').select('user_id, username, premium');
  const now = new Date();
  if (period === 'daily') {
    const start = new Date(now); start.setHours(0,0,0,0);
    query = query.gte('created_at', start.toISOString());
  } else if (period === 'weekly') {
    const start = new Date(now - 7 * 24 * 60 * 60 * 1000);
    query = query.gte('created_at', start.toISOString());
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

async function getUserStats(userId) {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000);
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
  const start = new Date(); start.setHours(0,0,0,0);
  const { data, error } = await supabase.from('sales').select('id').eq('user_id', userId).gte('created_at', start.toISOString());
  if (error) throw error;
  return data.length;
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
  const { error } = await supabase.from('sales').delete().eq('id', saleId).eq('user_id', userId);
  if (error) throw error;
  return { changes: 1 };
}

async function adminDeleteSale(saleId) {
  const { error } = await supabase.from('sales').delete().eq('id', saleId);
  if (error) throw error;
  return { changes: 1 };
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
  const start = new Date(); start.setHours(0,0,0,0);
  const { data, error } = await supabase.from('sales')
    .select('premium')
    .eq('user_id', userId)
    .gte('created_at', start.toISOString());
  if (error) return 0;
  return data.reduce((sum, s) => sum + parseFloat(s.premium), 0);
}

async function getUserWeeklyTotal(userId) {
  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
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

async function expireChallenges() {
  await supabase.from('challenges').update({ status: 'expired' }).eq('status', 'active');
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

async function getWeeklyMVP() {
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase.from('sales')
    .select('user_id, username, premium')
    .gte('created_at', weekStart.toISOString());
  if (error || !data.length) return null;
  const map = {};
  for (const s of data) {
    if (!map[s.user_id]) map[s.user_id] = { user_id: s.user_id, username: s.username, total: 0, count: 0 };
    map[s.user_id].total += parseFloat(s.premium);
    map[s.user_id].count++;
  }
  return Object.values(map).sort((a, b) => b.total - a.total)[0];
}

module.exports = {
  addSale, getLeaderboard, getMonthlyTotal, getUserStats, getTeamStats,
  createChallenge, getActiveChallenge, expireChallenges,
  getAllAgentFirstSales, getMonthlyChampion, getWeeklyMVP,
  getAllTimeRecords, setAllTimeRecord, getMonthlyRecords,
  getUserDailyTotal, getUserWeeklyTotal,
  setPersonalGoal, getPersonalGoal, getAllPersonalGoals,
  editSale, getSaleById,
  getUserTotalSales, getDailySalesCount, getMonthlyTopSale,
  getRecentSales, deleteSale, adminDeleteSale, getGoal, setGoal,
  getRanks, getRankForAmount,
};
