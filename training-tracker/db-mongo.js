// MongoDB Atlas を使ったデータ保存(Renderの再デプロイ・スリープでデータが消えないようにするため)
// 環境変数 MONGODB_URI が設定されている時だけ使われる(db.js が自動で切り替える)
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
let clientPromise = null;

function getClient() {
  if (!uri) {
    throw new Error('MONGODB_URI が設定されていません。Renderの環境変数を確認してください。');
  }
  if (!clientPromise) {
    // family: 4 で IPv4 接続を強制する(Renderなど一部のホスティング環境でIPv6経由だと
    // MongoDB AtlasとのTLSハンドシェイクが失敗する既知の問題への対策)
    const client = new MongoClient(uri, {
      family: 4,
      serverSelectionTimeoutMS: 20000,
    });
    clientPromise = client.connect().then(() => {
      console.log('MongoDB Atlas に接続しました');
      return client;
    }).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

async function getDb() {
  const client = await getClient();
  return client.db('training_tracker');
}

async function ensureIndexes() {
  const db = await getDb();
  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  await db.collection('checkins').createIndex({ userId: 1, date: 1 });
}

// counters コレクションでオートインクリメントの整数IDを発行する
async function nextSeq(name) {
  const db = await getDb();
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  // ドライバのバージョンによって戻り値の形が違うことがあるので両対応
  const doc = result && result.value !== undefined ? result.value : result;
  return doc.seq;
}

function mapUser(doc) {
  if (!doc) return undefined;
  return {
    id: doc._id,
    name: doc.name,
    username: doc.username,
    passwordHash: doc.passwordHash,
    role: doc.role,
    rewardsGiven: doc.rewardsGiven || 0,
  };
}

function mapCheckin(doc) {
  if (!doc) return undefined;
  return { id: doc._id, userId: doc.userId, date: doc.date };
}

// --- users ---
async function getUserByUsername(username) {
  const db = await getDb();
  const doc = await db.collection('users').findOne({ username });
  return mapUser(doc);
}

async function getUserById(id) {
  const db = await getDb();
  const doc = await db.collection('users').findOne({ _id: Number(id) });
  return mapUser(doc);
}

async function getAllMembers() {
  const db = await getDb();
  const docs = await db.collection('users').find({ role: 'member' }).toArray();
  return docs.map(mapUser);
}

async function createUser({ name, username, passwordHash, role }) {
  const db = await getDb();
  const id = await nextSeq('users');
  const doc = { _id: id, name, username, passwordHash, role, rewardsGiven: 0 };
  await db.collection('users').insertOne(doc);
  return mapUser(doc);
}

async function incrementRewardsGiven(id) {
  const db = await getDb();
  await db.collection('users').updateOne({ _id: Number(id) }, { $inc: { rewardsGiven: 1 } });
  return getUserById(id);
}

async function updateUserPassword(id, passwordHash) {
  const db = await getDb();
  await db.collection('users').updateOne({ _id: Number(id) }, { $set: { passwordHash } });
  return getUserById(id);
}

async function deleteUser(id) {
  const db = await getDb();
  await db.collection('users').deleteOne({ _id: Number(id) });
  await db.collection('checkins').deleteMany({ userId: Number(id) });
}

// --- checkins ---
async function getCheckinsForUser(userId) {
  const db = await getDb();
  const docs = await db
    .collection('checkins')
    .find({ userId: Number(userId) })
    .sort({ date: 1 })
    .toArray();
  return docs.map(mapCheckin);
}

async function hasCheckinForDate(userId, date) {
  const db = await getDb();
  const doc = await db.collection('checkins').findOne({ userId: Number(userId), date });
  return !!doc;
}

async function addCheckin(userId, date) {
  const db = await getDb();
  const exists = await hasCheckinForDate(userId, date);
  if (exists) return;
  const id = await nextSeq('checkins');
  await db.collection('checkins').insertOne({ _id: id, userId: Number(userId), date });
}

async function removeCheckin(userId, date) {
  const db = await getDb();
  await db.collection('checkins').deleteOne({ userId: Number(userId), date });
}

async function getAllCheckins() {
  const db = await getDb();
  const docs = await db.collection('checkins').find({}).toArray();
  return docs.map(mapCheckin);
}

// --- バックアップ / 復元 ---
async function exportRaw() {
  const db = await getDb();
  const users = await db.collection('users').find({}).toArray();
  const checkins = await db.collection('checkins').find({}).toArray();
  const usersCounter = await db.collection('counters').findOne({ _id: 'users' });
  const checkinsCounter = await db.collection('counters').findOne({ _id: 'checkins' });
  const data = {
    users: users.map((u) => ({
      id: u._id,
      name: u.name,
      username: u.username,
      passwordHash: u.passwordHash,
      role: u.role,
      rewardsGiven: u.rewardsGiven || 0,
    })),
    checkins: checkins.map((c) => ({ id: c._id, userId: c.userId, date: c.date })),
    nextUserId: (usersCounter ? usersCounter.seq : 0) + 1,
    nextCheckinId: (checkinsCounter ? checkinsCounter.seq : 0) + 1,
  };
  return JSON.stringify(data, null, 2);
}

async function importRaw(jsonStr) {
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed.users) || !Array.isArray(parsed.checkins)) {
    throw new Error('バックアップファイルの形式が正しくありません');
  }
  const db = await getDb();
  await db.collection('users').deleteMany({});
  await db.collection('checkins').deleteMany({});
  if (parsed.users.length) {
    await db.collection('users').insertMany(
      parsed.users.map((u) => ({
        _id: u.id,
        name: u.name,
        username: u.username,
        passwordHash: u.passwordHash,
        role: u.role,
        rewardsGiven: u.rewardsGiven || 0,
      }))
    );
  }
  if (parsed.checkins.length) {
    await db.collection('checkins').insertMany(parsed.checkins.map((c) => ({ _id: c.id, userId: c.userId, date: c.date })));
  }
  const maxUserId = parsed.users.reduce((m, u) => Math.max(m, u.id), 0);
  const maxCheckinId = parsed.checkins.reduce((m, c) => Math.max(m, c.id), 0);
  await db.collection('counters').updateOne({ _id: 'users' }, { $set: { seq: maxUserId } }, { upsert: true });
  await db.collection('counters').updateOne({ _id: 'checkins' }, { $set: { seq: maxCheckinId } }, { upsert: true });
}

module.exports = {
  backend: 'mongo',
  ensureIndexes,
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
