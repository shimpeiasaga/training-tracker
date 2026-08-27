// 超シンプルなJSONファイルDB(会員20人程度の小規模利用を想定)
// 自分のPCで動かす場合はこちらが使われる(MONGODB_URIが無い時のデフォルト)
const fs = require('fs');
const path = require('path');
const { MAX_MEMBER_MEDIA, MAX_LIBRARY_ITEMS } = require('./stats');

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
          sessions: [],
          media: [],
          library: [],
          nextUserId: 1,
          nextCheckinId: 1,
          nextMessageId: 1,
          nextPostId: 1,
          nextReplyId: 1,
          nextMediaId: 1,
          nextLibraryId: 1,
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
  if (!Array.isArray(data.sessions)) data.sessions = [];
  if (!Array.isArray(data.media)) data.media = [];
  if (!Array.isArray(data.library)) data.library = [];
  if (typeof data.nextMessageId !== 'number') data.nextMessageId = 1;
  if (typeof data.nextPostId !== 'number') data.nextPostId = 1;
  if (typeof data.nextReplyId !== 'number') data.nextReplyId = 1;
  if (typeof data.nextMediaId !== 'number') {
    data.nextMediaId = data.media.reduce((max, m) => Math.max(max, m.id + 1), 1);
  }
  if (typeof data.nextLibraryId !== 'number') {
    data.nextLibraryId = data.library.reduce((max, m) => Math.max(max, m.id + 1), 1);
  }
  // 旧形式(会員ごとにvideos配列を埋め込んでいた)から、独立したmedia一覧への移行(初回のみ)
  let migrated = false;
  data.users.forEach((u) => {
    if (Array.isArray(u.videos) && u.videos.length) {
      u.videos.forEach((v) => {
        data.media.push({
          id: data.nextMediaId++,
          memberId: u.id,
          type: 'video',
          title: v.title,
          url: v.url,
          createdAt: v.createdAt,
        });
      });
      migrated = true;
    }
    if (Array.isArray(u.videos)) delete u.videos;
  });
  if (migrated) save(data);
  return data;
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- ログインセッション(サーバー再起動をまたいでもログイン状態を保つためファイルに保存する) ---
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30日

function createSession(id, user) {
  const data = load();
  const now = Date.now();
  // ついでに期限切れの古いセッションを掃除しておく
  data.sessions = (data.sessions || []).filter((s) => s.expires >= now);
  data.sessions.push({ id, user, expires: now + SESSION_TTL_MS });
  save(data);
}

function getSession(id) {
  if (!id) return null;
  const s = (load().sessions || []).find((x) => x.id === id);
  if (!s) return null;
  if (s.expires < Date.now()) return null;
  return { user: s.user, expires: s.expires };
}

function destroySession(id) {
  const data = load();
  data.sessions = (data.sessions || []).filter((s) => s.id !== id);
  save(data);
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

// 会員ごとの動画・画像(合わせて最大MAX_MEMBER_MEDIA件、独立した一覧として保存する)
function getMediaForMember(memberId) {
  return load()
    .media.filter((m) => m.memberId === Number(memberId))
    .sort((a, b) => a.id - b.id);
}

function addMemberMedia(memberId, { type, title, url, imageData, mimeType, htmlContent, note, createdAt }) {
  const data = load();
  const user = data.users.find((u) => u.id === Number(memberId));
  if (!user) throw new Error('会員が見つかりません');
  const existing = data.media.filter((m) => m.memberId === Number(memberId));
  if (existing.length >= MAX_MEMBER_MEDIA) {
    throw new Error(`動画・画像は合わせて最大${MAX_MEMBER_MEDIA}件までです`);
  }
  const item = { id: data.nextMediaId++, memberId: Number(memberId), type, title, url, imageData, mimeType, htmlContent, note, createdAt };
  data.media.push(item);
  save(data);
  return item;
}

function removeMemberMedia(memberId, mediaId) {
  const data = load();
  data.media = data.media.filter((m) => !(m.id === Number(mediaId) && m.memberId === Number(memberId)));
  save(data);
}

// 動画・画像のセット数・回数メモを後から編集する(管理者のみ)
function updateMemberMediaNote(memberId, mediaId, note) {
  const data = load();
  const item = data.media.find((m) => m.id === Number(mediaId) && m.memberId === Number(memberId));
  if (!item) throw new Error('動画・画像が見つかりません');
  item.note = note;
  save(data);
  return item;
}

// --- 素材ライブラリ(会員に配る前の動画・画像を管理者がまとめて置いておく場所) ---
function getLibrary() {
  return load()
    .library.slice()
    .sort((a, b) => b.id - a.id);
}

function addLibraryItem({ type, title, url, imageData, mimeType, htmlContent, createdAt }) {
  const data = load();
  if (data.library.length >= MAX_LIBRARY_ITEMS) {
    throw new Error(`素材ライブラリは最大${MAX_LIBRARY_ITEMS}件までです`);
  }
  const item = { id: data.nextLibraryId++, type, title, url, imageData, mimeType, htmlContent, createdAt };
  data.library.push(item);
  save(data);
  return item;
}

function removeLibraryItem(libraryId) {
  const data = load();
  data.library = data.library.filter((m) => m.id !== Number(libraryId));
  save(data);
}

// ライブラリの素材を、指定した会員の動画・画像一覧にコピーする(ライブラリ側は残る)
function assignLibraryItemToMember(memberId, libraryId, note, createdAt) {
  const data = load();
  const user = data.users.find((u) => u.id === Number(memberId));
  if (!user) throw new Error('会員が見つかりません');
  const libItem = data.library.find((m) => m.id === Number(libraryId));
  if (!libItem) throw new Error('素材が見つかりません');
  const existing = data.media.filter((m) => m.memberId === Number(memberId));
  if (existing.length >= MAX_MEMBER_MEDIA) {
    throw new Error(`動画・画像は合わせて最大${MAX_MEMBER_MEDIA}件までです`);
  }
  const item = {
    id: data.nextMediaId++,
    memberId: Number(memberId),
    type: libItem.type,
    title: libItem.title,
    url: libItem.url,
    imageData: libItem.imageData,
    mimeType: libItem.mimeType,
    htmlContent: libItem.htmlContent,
    note: note || '',
    createdAt,
  };
  data.media.push(item);
  save(data);
  return item;
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

// トレーニング内容のメモ(セット数・回数など)を後から追加・編集する。本人のチェックインのみ対象
function updateCheckinNote(userId, date, note) {
  const data = load();
  const c = data.checkins.find((c) => c.userId === Number(userId) && c.date === date);
  if (!c) throw new Error('チェックインが見つかりません');
  c.note = note;
  save(data);
  return c;
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

// readerRoleから見て「相手」が送った未読メッセージがあるか(会員ページ・管理者の会員詳細ページの通知に使う)
function hasUnreadMessages(memberId, readerRole) {
  const otherRole = readerRole === 'admin' ? 'member' : 'admin';
  return load().messages.some(
    (m) => m.memberId === Number(memberId) && m.senderRole === otherRole && m.read === false
  );
}

// readerRoleから見て「相手」が送った未読メッセージを全て既読にする(会員ページ・管理者の会員詳細ページを開いた時に呼ぶ)
function markMessagesRead(memberId, readerRole) {
  const otherRole = readerRole === 'admin' ? 'member' : 'admin';
  const data = load();
  let changed = false;
  data.messages.forEach((m) => {
    if (m.memberId === Number(memberId) && m.senderRole === otherRole && m.read === false) {
      m.read = true;
      changed = true;
    }
  });
  if (changed) save(data);
}

// 管理者ダッシュボード用: 未読(会員発信)メッセージがある会員の一覧
function getMembersWithUnreadMessages() {
  const data = load();
  const memberIds = new Set(
    data.messages.filter((m) => m.senderRole === 'member' && m.read === false).map((m) => m.memberId)
  );
  return data.users.filter((u) => memberIds.has(u.id)).map((u) => ({ id: u.id, name: u.name }));
}

function addMessage({ memberId, senderRole, senderName, body, createdAt }) {
  const data = load();
  const message = { id: data.nextMessageId++, memberId: Number(memberId), senderRole, senderName, body, createdAt, read: false };
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
  if (!Array.isArray(parsed.media)) parsed.media = [];
  if (typeof parsed.nextMediaId !== 'number') {
    parsed.nextMediaId = parsed.media.reduce((max, m) => Math.max(max, m.id + 1), 1);
  }
  if (!Array.isArray(parsed.library)) parsed.library = [];
  if (typeof parsed.nextLibraryId !== 'number') {
    parsed.nextLibraryId = parsed.library.reduce((max, m) => Math.max(max, m.id + 1), 1);
  }
  save(parsed);
}

module.exports = {
  backend: 'file',
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
  updateMemberMediaNote,
  getLibrary,
  addLibraryItem,
  removeLibraryItem,
  assignLibraryItemToMember,
  getMessagesForMember,
  hasUnreadMessages,
  markMessagesRead,
  getMembersWithUnreadMessages,
  addMessage,
  deleteMessage,
  getBoardPosts,
  addBoardPost,
  addBoardReply,
  deleteBoardPost,
  exportRaw,
  importRaw,
};
