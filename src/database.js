// src/database.js
// SQLite database - stores everything locally, no external service needed

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'sales.db'));

// ── Create tables ─────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sales (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT    NOT NULL,
    username    TEXT    NOT NULL,
    client_name TEXT    NOT NULL,
    policy_type TEXT    NOT NULL,
    premium     REAL    NOT NULL,
    carrier     TEXT,
    notes       TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rank_roles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    min_monthly REAL    NOT NULL,
    color       TEXT    NOT NULL,
    emoji       TEXT    NOT NULL,
    discord_role_id TEXT
  );
`);

// ── Seed default ranks if empty ───────────────────────────────────────────────
const rankCount = db.prepare('SELECT COUNT(*) as c FROM rank_roles').get();
if (rankCount.c === 0) {
  const insert = db.prepare(
    'INSERT INTO rank_roles (name, min_monthly, color, emoji, discord_role_id) VALUES (?, ?, ?, ?, ?)'
  );
  insert.run('Rookie',           0,      '#57F287', '🟢', null);
  insert.run('Producer',         5000,   '#3498DB', '🔵', null);
  insert.run('Senior Producer',  15000,  '#9B59B6', '🟣', null);
  insert.run('Executive',        30000,  '#F1C40F', '🟡', null);
  insert.run('Elite',            50000,  '#E74C3C', '🔴', null);
}

// ── Sale queries ──────────────────────────────────────────────────────────────

function addSale({ userId, username, clientName, policyType, premium, carrier, notes }) {
  return db.prepare(`
    INSERT INTO sales (user_id, username, client_name, policy_type, premium, carrier, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, username, clientName, policyType, premium, carrier || '', notes || '');
}

function getLeaderboard(period) {
  let dateFilter = '';
  if (period === 'daily')   dateFilter = "AND date(created_at) = date('now')";
  if (period === 'weekly')  dateFilter = "AND created_at >= datetime('now', '-7 days')";
  if (period === 'monthly') dateFilter = "AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')";

  return db.prepare(`
    SELECT
      user_id,
      username,
      SUM(premium)  AS total,
      COUNT(*)      AS sales_count
    FROM sales
    WHERE 1=1 ${dateFilter}
    GROUP BY user_id
    ORDER BY total DESC
  `).all();
}

function getMonthlyTotal() {
  return db.prepare(`
    SELECT COALESCE(SUM(premium), 0) AS total
    FROM sales
    WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get().total;
}

function getUserStats(userId) {
  return db.prepare(`
    SELECT
      SUM(CASE WHEN date(created_at) = date('now') THEN premium ELSE 0 END)                            AS daily_total,
      SUM(CASE WHEN created_at >= datetime('now','-7 days') THEN premium ELSE 0 END)                   AS weekly_total,
      SUM(CASE WHEN strftime('%Y-%m',created_at) = strftime('%Y-%m','now') THEN premium ELSE 0 END)    AS monthly_total,
      COUNT(CASE WHEN strftime('%Y-%m',created_at) = strftime('%Y-%m','now') THEN 1 END)               AS monthly_count
    FROM sales
    WHERE user_id = ?
  `).get(userId);
}

function getRanks() {
  return db.prepare('SELECT * FROM rank_roles ORDER BY min_monthly ASC').all();
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
  return db.prepare(`
    SELECT * FROM sales ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

function deleteSale(saleId, userId) {
  // Only allow users to delete their own sales (admins bypass this in the command)
  return db.prepare('DELETE FROM sales WHERE id = ? AND user_id = ?').run(saleId, userId);
}

module.exports = {
  addSale,
  getLeaderboard,
  getMonthlyTotal,
  getUserStats,
  getRanks,
  getRankForAmount,
  getRecentSales,
  deleteSale,
  db,
};
