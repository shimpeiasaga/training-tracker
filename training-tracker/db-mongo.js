// MongoDB Atlas を使ったデータ保存(Renderの再デプロイ・スリープでデータが消えないようにするため)
// 環境変数 MONGODB_URI が設定されている時だけ使われる(db.js が自動で切り替える)
const { MongoClient } = require('mongodb');
const { MAX_MEMBER_MEDIA } = require('./stats');

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
  // expiresを過ぎたセッションをMongo側が自動で削除してくれる(TTLインデックス)
  await db.collection('sessions').createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
  await db.collection('media').createIndex({ memberId: 1 });
  await migrateLegacyVideos(db);
}

// 旧形式(会員ごとにvideos配列を埋め込んでいた)から、独立したmediaコレクションへの移行(初回のみ、以後は空振りするだけ)
async function migrateLegacyVideos(db) {
  const usersWithVideos = await db.collection('users').find({ videos: { $exists: true, $ne: [] } }).toArray();
  for (const u of usersWithVideos) {
    for (const v of u.videos || []) {
      const id = await nextSeq('media');
      await db.collection('media').insertOne({
        _id: id,
        memberId: u._id,
        type: 'video',
        title: v.title,
        url: v.url,
        createdAt: v.createdAt,
      });
    }
    await db.collection('users').updateOne({ _id: u._id }, { $unset: { videos: '' } });
  }
}

// --- ログインセッション(Renderがスリープ・再起動してもログイン状態を保つためDBに保存する) ---
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30日

async function createSession(id, user) {
  const db = await getDb();
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await db.collection('sessions').insertOne({ _id: id, user, expires });
}

async function getSession(id) {
  if (!id) return null;
  const db = await getDb();
  const s = await db.collection('sessions').findOne({ _id: id });
  if (!s) return null;
  if (s.expires.getTime() < Date.now()) return null;
  return { user: s.user, expires: s.expires.getTime() };
}

async function destroySession(id) {
  const db = await getDb();
  await db.collection('sessions').deleteOne({ _id: id });
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
  return { id: doc._id, userId: doc.userId, date: doc.date, note: doc.note || '' };
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

// 会員ごとの動画・画像(合わせて最大MAX_MEMBER_MEDIA件、独立したコレクションとして保存する)
function mapMedia(doc) {
  if (!doc) return undefined;
  return {
    id: doc._id,
    memberId: doc.memberId,
    type: doc.type,
    title: doc.title,
    url: doc.url,
    imageData: doc.imageData,
    mimeType: doc.mimeType,
    note: doc.note || '',
    createdAt: doc.createdAt,
  };
}

async function getMediaForMember(memberId) {
  const db = await getDb();
  const docs = await db
    .collection('media')
    .find({ memberId: Number(memberId) })
    .sort({ _id: 1 })
    .toArray();
  return docs.map(mapMedia);
}

async function addMemberMedia(memberId, { type, title, url, imageData, mimeType, note, createdAt }) {
  const db = await getDb();
  const user = await db.collection('users').findOne({ _id: Number(memberId) });
  if (!user) throw new Error('会員が見つかりません');
  const existingCount = await db.collection('media').countDocuments({ memberId: Number(memberId) });
  if (existingCount >= MAX_MEMBER_MEDIA) {
    throw new Error(`動画・画像は合わせて最大${MAX_MEMBER_MEDIA}件までです`);
  }
  const id = await nextSeq('media');
  const doc = { _id: id, memberId: Number(memberId), type, title, url, imageData, mimeType, note, createdAt };
  await db.collection('media').insertOne(doc);
  return mapMedia(doc);
}

async function removeMemberMedia(memberId, mediaId) {
  const db = await getDb();
  await db.collection('media').deleteOne({ _id: Number(mediaId), memberId: Number(memberId) });
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

// トレーニング内容のメモ(セット数・回数など)を後から追加・編集する。本人のチェックインのみ対象
async function updateCheckinNote(userId, date, note) {
  const db = await getDb();
  const result = await db.collection('checkins').updateOne({ userId: Number(userId), date }, { $set: { note } });
  if (result.matchedCount === 0) throw new Error('チェックインが見つかりません');
}

async function getAllCheckins() {
  const db = await getDb();
  const docs = await db.collection('checkins').find({}).toArray();
  return docs.map(mapCheckin);
}

// --- 管理者⇔会員の個別メッセージ ---
function mapMessage(doc) {
  if (!doc) return undefined;
  return { id: doc._id, memberId: doc.memberId, senderRole: doc.senderRole, senderName: doc.senderName, body: doc.body, createdAt: doc.createdAt };
}

async function getMessagesForMember(memberId) {
  const db = await getDb();
  const docs = await db
    .collection('messages')
    .find({ memberId: Number(memberId) })
    .sort({ _id: 1 })
    .toArray();
  return docs.map(mapMessage);
}

async function addMessage({ memberId, senderRole, senderName, body, createdAt }) {
  const db = await getDb();
  const id = await nextSeq('messages');
  const doc = { _id: id, memberId: Number(memberId), senderRole, senderName, body, createdAt };
  await db.collection('messages').insertOne(doc);
  return mapMessage(doc);
}

// 送った本人だけが自分のメッセージを削除できる
async function deleteMessage(messageId, requesterRole, requesterId) {
  const db = await getDb();
  const msg = await db.collection('messages').findOne({ _id: Number(messageId) });
  if (!msg) throw new Error('メッセージが見つかりません');
  if (msg.senderRole !== requesterRole) {
    throw new Error('このメッセージを削除する権限がありません');
  }
  if (requesterRole === 'member' && msg.memberId !== Number(requesterId)) {
    throw new Error('このメッセージを削除する権限がありません');
  }
  await db.collection('messages').deleteOne({ _id: Number(messageId) });
}

// --- 会員向け掲示板(会員が投稿、返信できるのは管理者のみ) ---
function mapPost(doc) {
  if (!doc) return undefined;
  return {
    id: doc._id,
    authorId: doc.authorId,
    authorName: doc.authorName,
    body: doc.body,
    createdAt: doc.createdAt,
    replies: doc.replies || [],
  };
}

async function getBoardPosts() {
  const db = await getDb();
  const docs = await db.collection('posts').find({}).sort({ _id: -1 }).toArray();
  return docs.map(mapPost);
}

async function addBoardPost({ authorId, authorName, body, createdAt }) {
  const db = await getDb();
  const id = await nextSeq('posts');
  const doc = { _id: id, authorId: Number(authorId), authorName, body, createdAt, replies: [] };
  await db.collection('posts').insertOne(doc);
  return mapPost(doc);
}

async function addBoardReply({ postId, adminName, body, createdAt }) {
  const db = await getDb();
  const id = await nextSeq('replies');
  const reply = { id, adminName, body, createdAt };
  await db.collection('posts').updateOne({ _id: Number(postId) }, { $push: { replies: reply } });
  return reply;
}

// 投稿者本人だけが自分の投稿を削除できる
async function deleteBoardPost(postId, authorId) {
  const db = await getDb();
  const post = await db.collection('posts').findOne({ _id: Number(postId) });
  if (!post) throw new Error('投稿が見つかりません');
  if (post.authorId !== Number(authorId)) {
    throw new Error('この投稿を削除する権限がありません');
  }
  await db.collection('posts').deleteOne({ _id: Number(postId) });
}

// --- バックアップ / 復元 ---
async function exportRaw() {
  const db = await getDb();
  const users = await db.collection('users').find({}).toArray();
  const checkins = await db.collection('checkins').find({}).toArray();
  const messages = await db.collection('messages').find({}).toArray();
  const posts = await db.collection('posts').find({}).toArray();
  const media = await db.collection('media').find({}).toArray();
  const usersCounter = await db.collection('counters').findOne({ _id: 'users' });
  const checkinsCounter = await db.collection('counters').findOne({ _id: 'checkins' });
  const messagesCounter = await db.collection('counters').findOne({ _id: 'messages' });
  const postsCounter = await db.collection('counters').findOne({ _id: 'posts' });
  const repliesCounter = await db.collection('counters').findOne({ _id: 'replies' });
  const mediaCounter = await db.collection('counters').findOne({ _id: 'media' });
  const data = {
    users: users.map((u) => ({
      id: u._id,
      name: u.name,
      username: u.username,
      passwordHash: u.passwordHash,
      role: u.role,
      rewardsGiven: u.rewardsGiven || 0,
    })),
    checkins: checkins.map((c) => ({ id: c._id, userId: c.userId, date: c.date, note: c.note || '' })),
    messages: messages.map((m) => ({
      id: m._id,
      memberId: m.memberId,
      senderRole: m.senderRole,
      senderName: m.senderName,
      body: m.body,
      createdAt: m.createdAt,
    })),
    posts: posts.map((p) => ({
      id: p._id,
      authorId: p.authorId,
      authorName: p.authorName,
      body: p.body,
      createdAt: p.createdAt,
      replies: p.replies || [],
    })),
    media: media.map((m) => ({
      id: m._id,
      memberId: m.memberId,
      type: m.type,
      title: m.title,
      url: m.url,
      imageData: m.imageData,
      mimeType: m.mimeType,
      note: m.note || '',
      createdAt: m.createdAt,
    })),
    nextUserId: (usersCounter ? usersCounter.seq : 0) + 1,
    nextCheckinId: (checkinsCounter ? checkinsCounter.seq : 0) + 1,
    nextMessageId: (messagesCounter ? messagesCounter.seq : 0) + 1,
    nextPostId: (postsCounter ? postsCounter.seq : 0) + 1,
    nextReplyId: (repliesCounter ? repliesCounter.seq : 0) + 1,
    nextMediaId: (mediaCounter ? mediaCounter.seq : 0) + 1,
  };
  return JSON.stringify(data, null, 2);
}

async function importRaw(jsonStr) {
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed.users) || !Array.isArray(parsed.checkins)) {
    throw new Error('バックアップファイルの形式が正しくありません');
  }
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];
  const media = Array.isArray(parsed.media) ? parsed.media : [];
  const db = await getDb();
  await db.collection('users').deleteMany({});
  await db.collection('checkins').deleteMany({});
  await db.collection('messages').deleteMany({});
  await db.collection('posts').deleteMany({});
  await db.collection('media').deleteMany({});
  if (parsed.users.length) {
    await db.collection('users').insertMany(
      parsed.users.map((u) => ({
        _id: u.id,
        name: u.name,
        username: u.username,
        passwordHash: u.passwordHash,
        role: u.role,
        rewardsGiven: u.rewardsGiven || 0,
        // 旧形式のバックアップ(会員に埋め込みのvideos配列)が来た場合はmediaコレクションへ変換して復元する
      }))
    );
  }
  if (parsed.checkins.length) {
    await db.collection('checkins').insertMany(
      parsed.checkins.map((c) => ({ _id: c.id, userId: c.userId, date: c.date, note: c.note || '' }))
    );
  }
  const legacyMediaFromUsers = parsed.users.flatMap((u) =>
    (u.videos || []).map((v) => ({ id: v.id, memberId: u.id, type: 'video', title: v.title, url: v.url, createdAt: v.createdAt }))
  );
  const allMedia = media.length ? media : legacyMediaFromUsers;
  if (allMedia.length) {
    await db.collection('media').insertMany(
      allMedia.map((m) => ({
        _id: m.id,
        memberId: m.memberId,
        type: m.type || 'video',
        title: m.title,
        url: m.url,
        imageData: m.imageData,
        mimeType: m.mimeType,
        note: m.note || '',
        createdAt: m.createdAt,
      }))
    );
  }
  if (messages.length) {
    await db.collection('messages').insertMany(
      messages.map((m) => ({
        _id: m.id,
        memberId: m.memberId,
        senderRole: m.senderRole,
        senderName: m.senderName,
        body: m.body,
        createdAt: m.createdAt,
      }))
    );
  }
  if (posts.length) {
    await db.collection('posts').insertMany(
      posts.map((p) => ({
        _id: p.id,
        authorId: p.authorId,
        authorName: p.authorName,
        body: p.body,
        createdAt: p.createdAt,
        replies: p.replies || [],
      }))
    );
  }
  const maxUserId = parsed.users.reduce((m, u) => Math.max(m, u.id), 0);
  const maxCheckinId = parsed.checkins.reduce((m, c) => Math.max(m, c.id), 0);
  const maxMessageId = messages.reduce((m, x) => Math.max(m, x.id), 0);
  const maxPostId = posts.reduce((m, x) => Math.max(m, x.id), 0);
  const maxReplyId = posts.flatMap((p) => (p.replies || []).map((r) => r.id)).reduce((m, id) => Math.max(m, id), 0);
  const maxMediaId = allMedia.reduce((m, x) => Math.max(m, x.id), 0);
  await db.collection('counters').updateOne({ _id: 'users' }, { $set: { seq: maxUserId } }, { upsert: true });
  await db.collection('counters').updateOne({ _id: 'checkins' }, { $set: { seq: maxCheckinId } }, { upsert: true });
  await db.collection('counters').updateOne({ _id: 'messages' }, { $set: { seq: maxMessageId } }, { upsert: true });
  await db.collection('counters').updateOne({ _id: 'posts' }, { $set: { seq: maxPostId } }, { upsert: true });
  await db.collection('counters').updateOne({ _id: 'replies' }, { $set: { seq: maxReplyId } }, { upsert: true });
  await db.collection('counters').updateOne({ _id: 'media' }, { $set: { seq: maxMediaId } }, { upsert: true });
}

module.exports = {
  backend: 'mongo',
  ensureIndexes,
  createSession,
  getSession,
  destroySession,
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
  updateCheckinNote,
  getAllCheckins,
  incrementRewardsGiven,
  getMediaForMember,
  addMemberMedia,
  removeMemberMedia,
  getMessagesForMember,
  addMessage,
  deleteMessage,
  getBoardPosts,
  addBoardPost,
  addBoardReply,
  deleteBoardPost,
  exportRaw,
  importRaw,
};
