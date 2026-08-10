// 超シンプルなJSONファイルDB(会員20人程度の小規模利用を想定)
// 自分のPCで動かす場合はこちらが使われる(MONGODB_URIが無い時のデフォルト)
const fs = require('fs');
const path = require('path');
const { MAX_MEMBER_VIDEOS } = require('./stats');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          users: [],
          checkins: [],
          messages: [],
          posts: [],
          nextUserId: 1,
          nextCheckinId: 1,
          nextMessageId: 1,
          nextPostId: 1,
          nextReplyId: 1,
          nextVideoId: 1,
        },
        null,
        2
      )
    );
  }
}

function load() {
  ensureDataFile();
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  // 古いバックアップ/データファイルにも新しい項目が無くても動くようにする
  if (!Array.isArray(data.messages)) data.messages = [];
  if (!Array.isArray(data.posts)) data.posts = [];
  if (typeof data.nextMessageId !== 'number') data.nextMessageId = 1;
  if (typeof data.nextPostId !== 'number') data.nextPostId = 1;
  if (typeof data.nextReplyId !== 'number') data.nextReplyId = 1;
  if (typeof data.nextVideoId !== 'number') data.nextVideoId = 1;
  return data;
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

// 会員ごとの動画(タイトル+URL、最大MAX_MEMBER_VIDEOS本)
function addMemberVideo(id, { title, url, createdAt }) {
  const data = load();
  const user = data.users.find((u) => u.id === Number(id));
  if (!user) throw new Error('会員が見つかりません');
  if (!Array.isArray(user.videos)) user.videos = [];
  if (user.videos.length >= MAX_MEMBER_VIDEOS) {
    throw new Error(`動画は最大${MAX_MEMBER_VIDEOS}本までです`);
  }
  const video = { id: data.nextVideoId++, title, url, createdAt };
  user.videos.push(video);
  save(data);
  return video;
}

function removeMemberVideo(id, videoId) {
  const data = load();
  const user = data.users.find((u) => u.id === Number(id));
  if (user && Array.isArray(user.videos)) {
    user.videos = user.videos.filter((v) => v.id !== Number(videoId));
    save(data);
  }
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

// --- 管理者⇔会員の個別メッセージ ---
function getMessagesForMember(memberId) {
  return load()
    .messages.filter((m) => m.memberId === Number(memberId))
    .sort((a, b) => a.id - b.id);
}

function addMessage({ memberId, senderRole, senderName, body, createdAt }) {
  const data = load();
  const message = { id: data.nextMessageId++, memberId: Number(memberId), senderRole, senderName, body, createdAt };
  data.messages.push(message);
  save(data);
  return message;
}

// 送った本人だけが自分のメッセージを削除できる
function deleteMessage(messageId, requesterRole, requesterId) {
  const data = load();
  const msg = data.messages.find((m) => m.id === Number(messageId));
  if (!msg) throw new Error('メッセージが見つかりません');
  if (msg.senderRole !== requesterRole) {
    throw new Error('このメッセージを削除する権限がありません');
  }
  if (requesterRole === 'member' && msg.memberId !== Number(requesterId)) {
    throw new Error('このメッセージを削除する権限がありません');
  }
  data.messages = data.messages.filter((m) => m.id !== Number(messageId));
  save(data);
}

// --- 会員向け掲示板(会員が投稿、返信できるのは管理者のみ) ---
function getBoardPosts() {
  return load()
    .posts.slice()
    .sort((a, b) => b.id - a.id);
}

function addBoardPost({ authorId, authorName, body, createdAt }) {
  const data = load();
  const post = { id: data.nextPostId++, authorId: Number(authorId), authorName, body, createdAt, replies: [] };
  data.posts.push(post);
  save(data);
  return post;
}

function addBoardReply({ postId, adminName, body, createdAt }) {
  const data = load();
  const post = data.posts.find((p) => p.id === Number(postId));
  if (!post) throw new Error('投稿が見つかりません');
  if (!Array.isArray(post.replies)) post.replies = [];
  const reply = { id: data.nextReplyId++, adminName, body, createdAt };
  post.replies.push(reply);
  save(data);
  return reply;
}

// 投稿者本人だけが自分の投稿を削除できる
function deleteBoardPost(postId, authorId) {
  const data = load();
  const post = data.posts.find((p) => p.id === Number(postId));
  if (!post) throw new Error('投稿が見つかりません');
  if (post.authorId !== Number(authorId)) {
    throw new Error('この投稿を削除する権限がありません');
  }
  data.posts = data.posts.filter((p) => p.id !== Number(postId));
  save(data);
}

// --- バックアップ / 復元 ---
function exportRaw() {
  return JSON.stringify(load(), null, 2);
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
  if (!Array.isArray(parsed.messages)) parsed.messages = [];
  if (!Array.isArray(parsed.posts)) parsed.posts = [];
  if (typeof parsed.nextMessageId !== 'number') {
    parsed.nextMessageId = parsed.messages.reduce((max, m) => Math.max(max, m.id + 1), 1);
  }
  if (typeof parsed.nextPostId !== 'number') {
    parsed.nextPostId = parsed.posts.reduce((max, p) => Math.max(max, p.id + 1), 1);
  }
  if (typeof parsed.nextReplyId !== 'number') {
    const allReplyIds = parsed.posts.flatMap((p) => (p.replies || []).map((r) => r.id));
    parsed.nextReplyId = allReplyIds.length ? Math.max(...allReplyIds) + 1 : 1;
  }
  if (typeof parsed.nextVideoId !== 'number') {
    const allVideoIds = parsed.users.flatMap((u) => (u.videos || []).map((v) => v.id));
    parsed.nextVideoId = allVideoIds.length ? Math.max(...allVideoIds) + 1 : 1;
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
  addMemberVideo,
  removeMemberVideo,
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
