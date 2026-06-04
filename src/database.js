// src/database.js
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'sales.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      sales: [],
      nextId: 1,
      ranks: [
        { id: 1, name: 'Voyager',       min_monthly: 0,      color: '#57F287', emoji: '🚀' },
        { id: 2, name: 'Trailblazer',   min_monthly: 5000,   color: '#3498DB', emoji: '⚔️' },
        { id: 3, name: 'Conqueror',     min_monthly: 10000,  color: '#9B59B6', emoji: '🛡️' },
        { id: 4, name: 'Odyssey Elite', min_monthly: 25000,  color: '#F1C40F', emoji: '👑' },
        { id: 5, name: 'Titan',         min_monthly: 50000,  color: '#E74C3C', emoji: '💎' },
        { id: 6, name: 'Legend',        min_monthly: 100000, color: '#FF6B00', emoji: '🏆' },
      ]
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function now() {
  return new Date().toISOString();
}

function addSale({ userId, username, clientName, policyType, premium, carrier, notes }) {
  const db = loadDB();
  const sale = {
    id: db.nextId++,
    user_id: userId,
    username,
    client_name: clientName,
    policy_type: policyType,
    premium,
    carrier: carrier || '',
    notes: notes || '',
    created_at: now(),
  };
  db.sales.push(sale);
  saveDB(db);
  return sale;
}

function getLeaderboard(period) {
  const db = loadDB();
  const nowDate = new Date();

  const filtered = db.sales.filter(s => {
    const d = new Date(s.created_at);
    if (period === 'daily') {
      return d.toDateString() === nowDate.toDateString();
    } else if (period === 'weekly') {
      const weekAgo = new Date(nowDate - 7 * 24 * 60 * 60 * 1000);
      return d >= weekAgo;
    } else if (period === 'monthly') {
      return d.getFullYear() === nowDate.getFullYear() && d.getMonth() === nowDate.getMonth();
    }
    return true;
  });

  const map = {};
  for (const s of filtered) {
    if (!map[s.user_id]) map[s.user_id] = { user_id: s.user_id, username: s.username, total: 0, sales_count: 0 };
    map[s.user_id].total += s.premium;
    map[s.user_id].sales_count++;
  }

  return Object.values(map).sort((a, b) => b.total - a.total);
}

function getMonthlyTotal() {
  const db = loadDB();
  const nowDate = new Date();
  return db.sales
    .filter(s => {
      const d = new Date(s.created_at);
      return d.getFullYear() === nowDate.getFullYear() && d.getMonth() === nowDate.getMonth();
    })
    .reduce((sum, s) => sum + s.premium, 0);
}

function getUserStats(userId) {
  const db = loadDB();
  const nowDate = new Date();
  const weekAgo = new Date(nowDate - 7 * 24 * 60 * 60 * 1000);

  const userSales = db.sales.filter(s => s.user_id === userId);
  return {
    daily_total:   userSales.filter(s => new Date(s.created_at).toDateString() === nowDate.toDateString()).reduce((sum, s) => sum + s.premium, 0),
    weekly_total:  userSales.filter(s => new Date(s.created_at) >= weekAgo).reduce((sum, s) => sum + s.premium, 0),
    monthly_total: userSales.filter(s => { const d = new Date(s.created_at); return d.getFullYear() === nowDate.getFullYear() && d.getMonth() === nowDate.getMonth(); }).reduce((sum, s) => sum + s.premium, 0),
    monthly_count: userSales.filter(s => { const d = new Date(s.created_at); return d.getFullYear() === nowDate.getFullYear() && d.getMonth() === nowDate.getMonth(); }).length,
  };
}

function getRanks() {
  return loadDB().ranks;
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

function getRecentSales(limit = 5) {
  const db = loadDB();
  return db.sales.slice(-limit).reverse();
}

function deleteSale(saleId, userId) {
  const db = loadDB();
  const idx = db.sales.findIndex(s => s.id === saleId && s.user_id === userId);
  if (idx === -1) return { changes: 0 };
  db.sales.splice(idx, 1);
  saveDB(db);
  return { changes: 1 };
}

module.exports = { addSale, getLeaderboard, getMonthlyTotal, getUserStats, getRanks, getRankForAmount, getRecentSales, deleteSale };
