// 外部フレームワークなしで動くサーバー(データ保存はdb.jsが自動でファイル/MongoDBを切り替える)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const db = require('./db');
const stats = require('./stats');
const crypto = require('./crypto-utils');
const sess = require('./session');
const parseBody = require('./body');
const parseMultipart = require('./multipart');
const views = require('./views');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = { '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png' };
const STATIC_PATHS = new Set(['/style.css', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']);

// 初回起動時に管理者アカウントがなければ自動で作る
// (Renderなどshellが使えないホスティング環境でも、npm run seedを手動実行しなくて済むように)
async function ensureDefaultAdmin() {
  const existing = await db.getUserByUsername('admin');
  if (!existing) {
    await db.createUser({
      name: '管理者',
      username: 'admin',
      passwordHash: crypto.hashPassword('admin123'),
      role: 'admin',
    });
    console.log('初回起動: 管理者アカウントを自動作成しました (username: admin / password: admin123)');
    console.log('※ ログイン後、必ずパスワードを変更してください');
  }
}

function sendHtml(res, status, html, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders });
  res.end(html);
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { Location: location, ...extraHeaders });
  res.end();
}

async function getCurrentSession(req) {
  const cookies = sess.parseCookies(req);
  const session = await db.getSession(cookies.sid);
  return { sid: cookies.sid, session };
}

// カレンダーで表示する月を決める(?month=YYYY-MM、未来の月は指定されても今月に丸める)
function resolveViewMonth(url) {
  const current = stats.monthKey(stats.todayStr());
  const requested = url.searchParams.get('month');
  if (requested && /^\d{4}-\d{2}$/.test(requested) && requested <= current) {
    return requested;
  }
  return current;
}

// 今月のチェック回数で会員をランキングする(同点は同順位)
async function computeMonthlyRanking() {
  const members = await db.getAllMembers();
  const list = await Promise.all(
    members.map(async (m) => {
      const checkins = (await db.getCheckinsForUser(m.id)).map((c) => c.date);
      return { id: m.id, name: m.name, count: stats.currentMonthCount(checkins) };
    })
  );
  return stats.rankMembers(list);
}

function serveStatic(req, res, pathname) {
  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // 静的ファイル
  if (method === 'GET' && STATIC_PATHS.has(pathname)) {
    return serveStatic(req, res, pathname);
  }

  const { sid, session } = await getCurrentSession(req);
  const user = session ? session.user : null;

  // --- ログイン画面 ---
  if (method === 'GET' && pathname === '/login') {
    if (user) return redirect(res, '/');
    return sendHtml(res, 200, views.loginPage(url.searchParams.get('error')));
  }

  if (method === 'POST' && pathname === '/login') {
    const body = await parseBody(req);
    const u = await db.getUserByUsername((body.username || '').trim());
    if (!u || !crypto.verifyPassword(body.password || '', u.passwordHash)) {
      return sendHtml(res, 200, views.loginPage('ユーザー名またはパスワードが違います'));
    }
    const newSid = sess.generateSessionId();
    await db.createSession(newSid, { id: u.id, name: u.name, username: u.username, role: u.role });
    return redirect(res, '/', { 'Set-Cookie': sess.cookieHeader(newSid, 60 * 60 * 24 * 30) });
  }

  if (method === 'POST' && pathname === '/logout') {
    if (sid) await db.destroySession(sid);
    return redirect(res, '/login', { 'Set-Cookie': sess.clearCookieHeader() });
  }

  // ここから先はログイン必須
  if (!user) {
    return redirect(res, '/login');
  }

  if (method === 'GET' && pathname === '/') {
    return redirect(res, user.role === 'admin' ? '/admin' : '/member');
  }

  // --- 会員ページ ---
  if (pathname === '/member' && method === 'GET') {
    const checkinRecords = await db.getCheckinsForUser(user.id);
    const checkins = checkinRecords.map((c) => c.date);
    const today = stats.todayStr();
    const streak = stats.currentStreak(checkins);
    const totalDays = checkins.length; // バッジは連続日数ではなく累計実施日数で判定する
    const celebrate = url.searchParams.get('celebrate') === '1';
    const rewardCelebrate = celebrate && url.searchParams.get('reward') === '1';
    const viewMonth = resolveViewMonth(url);
    const currentMonth = stats.monthKey(today);
    const hasUnreadMessages = await db.hasUnreadMessages(user.id, 'member');
    const memberMessages = await db.getMessagesForMember(user.id);
    if (hasUnreadMessages) await db.markMessagesRead(user.id, 'member');
    return sendHtml(
      res,
      200,
      views.memberPage({
        hasUnreadMessages,
        userName: user.name,
        today,
        checkedToday: checkins.includes(today),
        streak,
        totalDays,
        weekCount: stats.thisWeekCount(checkins),
        grid: stats.monthCalendar(checkins, viewMonth),
        monthKeyForGrid: viewMonth,
        prevMonthKey: stats.addMonths(viewMonth, -1),
        nextMonthKey: viewMonth < currentMonth ? stats.addMonths(viewMonth, 1) : null,
        calendarBasePath: '/member',
        weekly: stats.weeklySeries(checkins, 8),
        monthCount: stats.currentMonthCount(checkins),
        monthGoal: stats.MONTHLY_GOAL,
        monthlyStreak: stats.currentMonthlyStreak(checkins),
        rewardMonths: stats.REWARD_MONTHS,
        badges: stats.streakBadges(totalDays),
        nextBadge: stats.nextStreakBadge(totalDays),
        ranked: await computeMonthlyRanking(),
        userId: user.id,
        celebrate,
        milestoneBadge: celebrate ? stats.justUnlockedBadge(totalDays) : null,
        rewardCelebrate,
        checkinDates: checkins,
        checkinRecords,
        badgeLog: stats.badgeUnlockLog(checkins),
        messages: memberMessages,
        media: await db.getMediaForMember(user.id),
      })
    );
  }

  if (pathname === '/member/messages' && method === 'POST') {
    const body = await parseBody(req);
    const text = (body.body || '').trim();
    if (text) {
      await db.addMessage({
        memberId: user.id,
        senderRole: 'member',
        senderName: user.name,
        body: text,
        createdAt: stats.nowStr(),
      });
    }
    return redirect(res, '/member#messages');
  }

  let memberMsgDeleteMatch = pathname.match(/^\/member\/messages\/(\d+)\/delete$/);
  if (memberMsgDeleteMatch && method === 'POST') {
    try {
      await db.deleteMessage(memberMsgDeleteMatch[1], 'member', user.id);
    } catch (err) {
      res.writeHead(403);
      return res.end('権限がありません');
    }
    return redirect(res, '/member#messages');
  }

  // --- 会員向け掲示板(誰でも投稿できる、返信できるのは管理者のみ) ---
  if (pathname === '/board' && method === 'GET') {
    return sendHtml(
      res,
      200,
      views.boardPage({
        posts: await db.getBoardPosts(),
        userRole: user.role,
        userName: user.name,
        userId: user.id,
        error: url.searchParams.get('error'),
      })
    );
  }

  if (pathname === '/board/post' && method === 'POST') {
    const body = await parseBody(req);
    const text = (body.body || '').trim();
    if (text) {
      await db.addBoardPost({ authorId: user.id, authorName: user.name, body: text, createdAt: stats.nowStr() });
    }
    return redirect(res, '/board');
  }

  let boardMatch = pathname.match(/^\/board\/(\d+)\/reply$/);
  if (boardMatch && method === 'POST') {
    if (user.role !== 'admin') {
      res.writeHead(403);
      return res.end('権限がありません');
    }
    const body = await parseBody(req);
    const text = (body.body || '').trim();
    if (text) {
      await db.addBoardReply({ postId: boardMatch[1], adminName: user.name, body: text, createdAt: stats.nowStr() });
    }
    return redirect(res, '/board');
  }

  let boardDeleteMatch = pathname.match(/^\/board\/(\d+)\/delete$/);
  if (boardDeleteMatch && method === 'POST') {
    try {
      await db.deleteBoardPost(boardDeleteMatch[1], user.id);
    } catch (err) {
      res.writeHead(403);
      return res.end('権限がありません');
    }
    return redirect(res, '/board');
  }

  if (pathname === '/member/checkin' && method === 'POST') {
    const today = stats.todayStr();
    const alreadyChecked = await db.hasCheckinForDate(user.id, today);
    if (alreadyChecked) {
      await db.removeCheckin(user.id, today);
      return redirect(res, '/member');
    }

    const beforeCheckins = (await db.getCheckinsForUser(user.id)).map((c) => c.date);
    const monthCountBefore = stats.currentMonthCount(beforeCheckins);

    await db.addCheckin(user.id, today);

    const afterCheckins = (await db.getCheckinsForUser(user.id)).map((c) => c.date);
    const monthCountAfter = stats.currentMonthCount(afterCheckins);
    const monthlyStreakAfter = stats.currentMonthlyStreak(afterCheckins);
    // ちょうど今月の目標(10回)に到達し、かつそれが3ヶ月ごとの特典ラインに乗った瞬間かどうか
    const justHitMonthlyGoal = monthCountBefore < stats.MONTHLY_GOAL && monthCountAfter >= stats.MONTHLY_GOAL;
    const justEarnedReward = justHitMonthlyGoal && monthlyStreakAfter > 0 && monthlyStreakAfter % stats.REWARD_MONTHS === 0;

    return redirect(res, `/member?celebrate=1${justEarnedReward ? '&reward=1' : ''}`);
  }

  let checkinNoteMatch = pathname.match(/^\/member\/checkins\/(\d{4}-\d{2}-\d{2})\/note$/);
  if (checkinNoteMatch && method === 'POST') {
    const body = await parseBody(req);
    const note = (body.note || '').trim().slice(0, 300);
    try {
      await db.updateCheckinNote(user.id, checkinNoteMatch[1], note);
    } catch (err) {
      // チェックインが存在しない日付を指定された場合などは何もせず戻る
    }
    return redirect(res, '/member#history');
  }

  if (pathname === '/member/password' && method === 'GET') {
    return sendHtml(
      res,
      200,
      views.memberPasswordPage({
        userName: user.name,
        error: url.searchParams.get('error'),
        message: url.searchParams.get('message'),
      })
    );
  }

  if (pathname === '/member/password' && method === 'POST') {
    const body = await parseBody(req);
    if (body.newPassword && body.newPassword.length >= 4) {
      await db.updateUserPassword(user.id, crypto.hashPassword(body.newPassword));
      return redirect(res, '/member/password?message=' + encodeURIComponent('パスワードを変更しました'));
    }
    return redirect(res, '/member/password?error=' + encodeURIComponent('パスワードは4文字以上にしてください'));
  }

  // --- 管理者ページ ---
  if (pathname.startsWith('/admin')) {
    if (user.role !== 'admin') {
      res.writeHead(403);
      return res.end('権限がありません');
    }

    if (pathname === '/admin' && method === 'GET') {
      const allMembers = await db.getAllMembers();
      const members = await Promise.all(
        allMembers.map(async (m) => {
          const checkins = (await db.getCheckinsForUser(m.id)).map((c) => c.date);
          const streak = stats.currentStreak(checkins);
          const monthlyStreak = stats.currentMonthlyStreak(checkins);
          const earned = stats.rewardsEarned(monthlyStreak);
          const given = m.rewardsGiven || 0;
          const unlockedBadges = stats.streakBadges(checkins.length).filter((b) => b.achieved);
          const topBadge = unlockedBadges.length ? unlockedBadges[unlockedBadges.length - 1] : null;
          return {
            id: m.id,
            name: m.name,
            username: m.username,
            streak,
            weekCount: stats.thisWeekCount(checkins),
            total: checkins.length,
            lastDate: checkins.length ? checkins[checkins.length - 1] : null,
            monthCount: stats.currentMonthCount(checkins),
            monthGoal: stats.MONTHLY_GOAL,
            monthlyStreak,
            rewardsEarned: earned,
            rewardsGiven: given,
            rewardsPending: Math.max(0, earned - given),
            badgeIcon: topBadge ? topBadge.icon : null,
            badgeLabel: topBadge ? topBadge.label : null,
          };
        })
      );
      const allCheckins = (await db.getAllCheckins()).map((c) => c.date);
      const memberCount = members.length || 1;
      const teamWeekly = stats.weeklySeries(allCheckins, 8).map((w) => ({
        weekStart: w.weekStart,
        avg: Math.round((w.count / memberCount) * 10) / 10,
      }));
      return sendHtml(
        res,
        200,
        views.adminPage({
          members,
          teamWeekly,
          unreadMembers: await db.getMembersWithUnreadMessages(),
          ranked: await computeMonthlyRanking(),
          error: url.searchParams.get('error'),
          message: url.searchParams.get('message'),
        })
      );
    }

    if (pathname === '/admin/members' && method === 'POST') {
      const body = await parseBody(req);
      const { name, username, password } = body;
      if (!name || !username || !password) {
        return redirect(res, '/admin?error=' + encodeURIComponent('すべての項目を入力してください'));
      }
      if (await db.getUserByUsername(username.trim())) {
        return redirect(res, '/admin?error=' + encodeURIComponent('そのユーザー名は既に使われています'));
      }
      await db.createUser({
        name: name.trim(),
        username: username.trim(),
        passwordHash: crypto.hashPassword(password),
        role: 'member',
      });
      return redirect(res, '/admin?message=' + encodeURIComponent(name.trim() + ' さんを追加しました'));
    }

    let match = pathname.match(/^\/admin\/members\/(\d+)\/delete$/);
    if (match && method === 'POST') {
      await db.deleteUser(match[1]);
      return redirect(res, '/admin?message=' + encodeURIComponent('削除しました'));
    }

    match = pathname.match(/^\/admin\/members\/(\d+)\/reset-password$/);
    if (match && method === 'POST') {
      const body = await parseBody(req);
      if (body.newPassword && body.newPassword.length >= 4) {
        await db.updateUserPassword(match[1], crypto.hashPassword(body.newPassword));
        return redirect(res, '/admin?message=' + encodeURIComponent('パスワードを再設定しました'));
      }
      return redirect(res, '/admin?error=' + encodeURIComponent('パスワードは4文字以上にしてください'));
    }

    match = pathname.match(/^\/admin\/members\/(\d+)\/reward$/);
    if (match && method === 'POST') {
      await db.incrementRewardsGiven(match[1]);
      return redirect(res, '/admin?message=' + encodeURIComponent('特典を渡した記録を追加しました'));
    }

    match = pathname.match(/^\/admin\/members\/(\d+)\/messages$/);
    if (match && method === 'POST') {
      const body = await parseBody(req);
      const text = (body.body || '').trim();
      if (text) {
        await db.addMessage({
          memberId: match[1],
          senderRole: 'admin',
          senderName: user.name,
          body: text,
          createdAt: stats.nowStr(),
        });
      }
      return redirect(res, `/admin/member/${match[1]}#messages`);
    }

    match = pathname.match(/^\/admin\/members\/(\d+)\/messages\/(\d+)\/delete$/);
    if (match && method === 'POST') {
      try {
        await db.deleteMessage(match[2], 'admin', user.id);
      } catch (err) {
        res.writeHead(403);
        return res.end('権限がありません');
      }
      return redirect(res, `/admin/member/${match[1]}#messages`);
    }

    match = pathname.match(/^\/admin\/members\/(\d+)\/media\/video$/);
    if (match && method === 'POST') {
      const body = await parseBody(req);
      const title = (body.title || '').trim();
      const videoUrl = (body.url || '').trim();
      const note = (body.note || '').trim();
      if (title && videoUrl) {
        try {
          await db.addMemberMedia(match[1], { type: 'video', title, url: videoUrl, note, createdAt: stats.nowStr() });
        } catch (err) {
          return redirect(res, `/admin/member/${match[1]}?error=${encodeURIComponent(err.message)}#video`);
        }
      }
      return redirect(res, `/admin/member/${match[1]}#video`);
    }

    match = pathname.match(/^\/admin\/members\/(\d+)\/media\/image$/);
    if (match && method === 'POST') {
      const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
      const ALLOWED_TYPES = { 'image/jpeg': true, 'image/png': true, 'image/webp': true, 'image/gif': true };
      const EXT_TYPE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
      try {
        const { fields, files } = await parseMultipart(req);
        const title = (fields.title || '').trim();
        const note = (fields.note || '').trim();
        const file = files.image;
        if (!title || !file || !file.content || !file.content.length) {
          return redirect(res, `/admin/member/${match[1]}?error=${encodeURIComponent('タイトルと画像ファイルを指定してください')}#video`);
        }
        if (file.content.length > MAX_IMAGE_BYTES) {
          return redirect(res, `/admin/member/${match[1]}?error=${encodeURIComponent('画像は5MBまでです')}#video`);
        }
        const ext = (file.filename.split('.').pop() || '').toLowerCase();
        const mimeType = ALLOWED_TYPES[file.contentType] ? file.contentType : EXT_TYPE[ext];
        if (!mimeType) {
          return redirect(res, `/admin/member/${match[1]}?error=${encodeURIComponent('対応していない画像形式です(jpg/png/webp/gifのみ)')}#video`);
        }
        await db.addMemberMedia(match[1], {
          type: 'image',
          title,
          imageData: file.content.toString('base64'),
          mimeType,
          note,
          createdAt: stats.nowStr(),
        });
      } catch (err) {
        return redirect(res, `/admin/member/${match[1]}?error=${encodeURIComponent(err.message || '画像の登録に失敗しました')}#video`);
      }
      return redirect(res, `/admin/member/${match[1]}#video`);
    }

    match = pathname.match(/^\/admin\/members\/(\d+)\/media\/html$/);
    if (match && method === 'POST') {
      const MAX_HTML_BYTES = 500 * 1024; // 500KB(呼吸法ツールなどの自己完結HTML想定)
      try {
        const { fields, files } = await parseMultipart(req);
        const title = (fields.title || '').trim();
        const file = files.htmlFile;
        if (!title || !file || !file.content || !file.content.length) {
          return redirect(res, `/admin/member/${match[1]}?error=${encodeURIComponent('タイトルとHTMLファイルを指定してください')}#video`);
        }
        if (file.content.length > MAX_HTML_BYTES) {
          return redirect(res, `/admin/member/${match[1]}?error=${encodeURIComponent('HTMLファイルは500KBまでです')}#video`);
        }
        const ext = (file.filename.split('.').pop() || '').toLowerCase();
        if (ext !== 'html' && ext !== 'htm') {
          return redirect(res, `/admin/member/${match[1]}?error=${encodeURIComponent('.htmlファイルのみアップロードできます')}#video`);
        }
        await db.addMemberMedia(match[1], {
          type: 'html',
          title,
          htmlContent: file.content.toString('utf8'),
          note: (fields.note || '').trim(),
          createdAt: stats.nowStr(),
        });
      } catch (err) {
        return redirect(res, `/admin/member/${match[1]}?error=${encodeURIComponent(err.message || 'HTMLツールの登録に失敗しました')}#video`);
      }
      return redirect(res, `/admin/member/${match[1]}#video`);
    }

    match = pathname.match(/^\/admin\/members\/(\d+)\/media\/(\d+)\/delete$/);
    if (match && method === 'POST') {
      await db.removeMemberMedia(match[1], match[2]);
      return redirect(res, `/admin/member/${match[1]}#video`);
    }

    match = pathname.match(/^\/admin\/members\/(\d+)\/media\/(\d+)\/note$/);
    if (match && method === 'POST') {
      const body = await parseBody(req);
      const note = (body.note || '').trim();
      try {
        await db.updateMemberMediaNote(match[1], match[2], note);
      } catch (err) {
        // 対象が見つからない場合などは何もせず戻る
      }
      return redirect(res, `/admin/member/${match[1]}#video`);
    }

    // --- 素材ライブラリ(会員に配る前の動画・画像をまとめて置いておく場所) ---
    if (pathname === '/admin/library' && method === 'GET') {
      return sendHtml(
        res,
        200,
        views.adminLibraryPage({
          library: await db.getLibrary(),
          error: url.searchParams.get('error'),
        })
      );
    }

    if (pathname === '/admin/library/video' && method === 'POST') {
      const body = await parseBody(req);
      const title = (body.title || '').trim();
      const videoUrl = (body.url || '').trim();
      if (title && videoUrl) {
        try {
          await db.addLibraryItem({ type: 'video', title, url: videoUrl, createdAt: stats.nowStr() });
        } catch (err) {
          return redirect(res, `/admin/library?error=${encodeURIComponent(err.message)}`);
        }
      }
      return redirect(res, '/admin/library');
    }

    if (pathname === '/admin/library/image' && method === 'POST') {
      const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
      const ALLOWED_TYPES = { 'image/jpeg': true, 'image/png': true, 'image/webp': true, 'image/gif': true };
      const EXT_TYPE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
      try {
        const { fields, files } = await parseMultipart(req);
        const title = (fields.title || '').trim();
        const file = files.image;
        if (!title || !file || !file.content || !file.content.length) {
          return redirect(res, `/admin/library?error=${encodeURIComponent('タイトルと画像ファイルを指定してください')}`);
        }
        if (file.content.length > MAX_IMAGE_BYTES) {
          return redirect(res, `/admin/library?error=${encodeURIComponent('画像は5MBまでです')}`);
        }
        const ext = (file.filename.split('.').pop() || '').toLowerCase();
        const mimeType = ALLOWED_TYPES[file.contentType] ? file.contentType : EXT_TYPE[ext];
        if (!mimeType) {
          return redirect(res, `/admin/library?error=${encodeURIComponent('対応していない画像形式です(jpg/png/webp/gifのみ)')}`);
        }
        await db.addLibraryItem({
          type: 'image',
          title,
          imageData: file.content.toString('base64'),
          mimeType,
          createdAt: stats.nowStr(),
        });
      } catch (err) {
        return redirect(res, `/admin/library?error=${encodeURIComponent(err.message || '画像の登録に失敗しました')}`);
      }
      return redirect(res, '/admin/library');
    }

    if (pathname === '/admin/library/html' && method === 'POST') {
      const MAX_HTML_BYTES = 500 * 1024; // 500KB(呼吸法ツールなどの自己完結HTML想定)
      try {
        const { fields, files } = await parseMultipart(req);
        const title = (fields.title || '').trim();
        const file = files.htmlFile;
        if (!title || !file || !file.content || !file.content.length) {
          return redirect(res, `/admin/library?error=${encodeURIComponent('タイトルとHTMLファイルを指定してください')}`);
        }
        if (file.content.length > MAX_HTML_BYTES) {
          return redirect(res, `/admin/library?error=${encodeURIComponent('HTMLファイルは500KBまでです')}`);
        }
        const ext = (file.filename.split('.').pop() || '').toLowerCase();
        if (ext !== 'html' && ext !== 'htm') {
          return redirect(res, `/admin/library?error=${encodeURIComponent('.htmlファイルのみアップロードできます')}`);
        }
        await db.addLibraryItem({
          type: 'html',
          title,
          htmlContent: file.content.toString('utf8'),
          createdAt: stats.nowStr(),
        });
      } catch (err) {
        return redirect(res, `/admin/library?error=${encodeURIComponent(err.message || 'HTMLツールの登録に失敗しました')}`);
      }
      return redirect(res, '/admin/library');
    }

    match = pathname.match(/^\/admin\/library\/(\d+)\/delete$/);
    if (match && method === 'POST') {
      await db.removeLibraryItem(match[1]);
      return redirect(res, '/admin/library');
    }

    match = pathname.match(/^\/admin\/members\/(\d+)\/media\/from-library\/(\d+)$/);
    if (match && method === 'POST') {
      const body = await parseBody(req);
      const note = (body.note || '').trim();
      try {
        await db.assignLibraryItemToMember(match[1], match[2], note, stats.nowStr());
      } catch (err) {
        return redirect(res, `/admin/member/${match[1]}?error=${encodeURIComponent(err.message)}#video`);
      }
      return redirect(res, `/admin/member/${match[1]}#video`);
    }

    if (pathname === '/admin/backup' && method === 'GET') {
      const raw = await db.exportRaw();
      const filename = `training-tracker-backup-${stats.todayStr()}.json`;
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      return res.end(raw);
    }

    if (pathname === '/admin/restore' && method === 'POST') {
      try {
        const { files } = await parseMultipart(req);
        const file = files.backupFile;
        if (!file || !file.content || !file.content.length) {
          return redirect(res, '/admin?error=' + encodeURIComponent('復元するファイルを選択してください'));
        }
        await db.importRaw(file.content.toString('utf8'));
        return redirect(res, '/admin?message=' + encodeURIComponent('バックアップからデータを復元しました'));
      } catch (err) {
        return redirect(res, '/admin?error=' + encodeURIComponent('復元に失敗しました。ファイルの形式を確認してください'));
      }
    }

    match = pathname.match(/^\/admin\/member\/(\d+)$/);
    if (match && method === 'GET') {
      const member = await db.getUserById(match[1]);
      if (!member || member.role !== 'member') {
        res.writeHead(404);
        return res.end('会員が見つかりません');
      }
      const checkinRecords = await db.getCheckinsForUser(member.id);
      const checkins = checkinRecords.map((c) => c.date);
      const memberStreak = stats.currentStreak(checkins);
      const monthlyStreak = stats.currentMonthlyStreak(checkins);
      const earned = stats.rewardsEarned(monthlyStreak);
      const given = member.rewardsGiven || 0;
      const viewMonth = resolveViewMonth(url);
      const currentMonth = stats.monthKey(stats.todayStr());
      const hadUnreadMessages = await db.hasUnreadMessages(member.id, 'admin');
      const adminViewMessages = await db.getMessagesForMember(member.id);
      if (hadUnreadMessages) await db.markMessagesRead(member.id, 'admin');
      return sendHtml(
        res,
        200,
        views.adminMemberPage({
          member,
          hadUnreadMessages,
          streak: memberStreak,
          weekCount: stats.thisWeekCount(checkins),
          total: checkins.length,
          grid: stats.monthCalendar(checkins, viewMonth),
          monthKeyForGrid: viewMonth,
          prevMonthKey: stats.addMonths(viewMonth, -1),
          nextMonthKey: viewMonth < currentMonth ? stats.addMonths(viewMonth, 1) : null,
          calendarBasePath: `/admin/member/${member.id}`,
          weekly: stats.weeklySeries(checkins, 12),
          monthCount: stats.currentMonthCount(checkins),
          monthlyStreak,
          monthlySeries: stats.monthlySeries(checkins, 6),
          rewardsEarned: earned,
          rewardsGiven: given,
          rewardsPending: Math.max(0, earned - given),
          badges: stats.streakBadges(checkins.length),
          checkinDates: checkins,
          checkinRecords,
          badgeLog: stats.badgeUnlockLog(checkins),
          messages: adminViewMessages,
          media: await db.getMediaForMember(member.id),
          library: await db.getLibrary(),
          videoError: url.searchParams.get('error'),
        })
      );
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

(async () => {
  try {
    if (typeof db.ensureIndexes === 'function') {
      await db.ensureIndexes();
    }
    await ensureDefaultAdmin();
    server.listen(PORT, () => {
      console.log(`training-tracker running at http://localhost:${PORT} (backend: ${db.backend})`);
    });
  } catch (err) {
    console.error('起動に失敗しました:', err.message);
    process.exit(1);
  }
})();
