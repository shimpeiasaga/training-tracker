// 超シンプルなJSONファイルDB(会員20人程度の小規模利用を想定)
// 自分のPCで動かす場合はこちらが使われる(MONGODB_URIが無い時のデフォルト)
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [], checkins: [], nextUserId: 1, nextCheckinId: 1 }, null, 2));
  }
}

function load() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- users ---
function getUserByUsername(username) {
  return load().users.find(u => u.username === username);
}

function getUserById(id) {
  return load().users.find(u => u.id === Number(id));
}

function getAllMembers() {
  return load().users.filter(u => u.role === 'member');
}

function createUser({ name, username, passwordHash, role }) {
  const data = load();
  const user = { id: data.nextUserId++, name, username, passwordHash, role, rewardsGiven: 0 };
  data.users.push(user);
  save(data);
  return user;
}

// 特典を1回渡した記録を追加する
function incrementRewardsGiven(id) {
  const data = load();
  const user = data.users.find((u) => u.id === Number(id));
  if (user) {
    user.rewardsGiven = (user.rewardsGiven || 0) + 1;
    save(data);
  }
  return user;
}

function updateUserPassword(id, passwordHash) {
  const data = load();
  const user = data.users.find(u => u.id === Number(id));
  if (user) {
    user.passwordHash = passwordHash;
    save(data);
  }
  return user;
}

function deleteUser(id) {
  const data = load();
  data.users = data.users.filter(u => u.id !== Number(id));
  data.checkins = data.checkins.filter(c => c.userId !== Number(id));
  save(data);
}

// --- checkins ---
function getCheckinsForUser(userId) {
  return load().checkins.filter(c => c.userId === Number(userId)).sort((a, b) => a.date.localeCompare(b.date));
}

function hasCheckinForDate(userId, date) {
  return load().checkins.some(c => c.userId === Number(userId) && c.date === date);
}

function addCheckin(userId, date) {
  const data = load();
  const exists = data.checkins.some(c => c.userId === Number(userId) && c.date === date);
  if (!exists) {
    data.checkins.push({ id: data.nextCheckinId++, userId: Number(userId), date });
    save(data);
  }
}

function removeCheckin(userId, date) {
  const data = load();
  data.checkins = data.checkins.filter(c => !(c.userId === Number(userId) && c.date === date));
  save(data);
}

function getAllCheckins() {
  return load().checkins;
}

// --- バックアップ / 復元 ---
function exportRaw() {
  ensureDataFile();
  return fs.readFileSync(DATA_FILE, 'utf8');
}

function importRaw(jsonStr) {
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed.users) || !Array.isArray(parsed.checkins)) {
    throw new Error('バックアップファイルの形式が正しくありません');
  }
  if (typeof parsed.nextUserId !== 'number') {
    parsed.nextUserId = parsed.users.reduce((max, u) => Math.max(max, u.id + 1), 1);
  }
  if (typeof parsed.nextCheckinId !== 'number') {
    parsed.nextCheckinId = parsed.checkins.reduce((max, c) => Math.max(max, c.id + 1), 1);
  }
  save(parsed);
}

module.exports = {
  backend: 'file',
  getUserByUsername,
  getUserById,
  getAllMembers,
  createUser,
  updateUserPassword,
  deleteUser,
  getCheckinsForUser,
  hasCheckinForDate,
  addCheckin,
  removeCheckin,
  getAllCheckins,
  incrementRewardsGiven,
  exportRaw,
  importRaw,
};
