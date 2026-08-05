// 外部依存パッケージなし(Node.js標準機能のみ)で動くサーバー
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

const MIME = { '.css': 'text/css', '.js': 'application/javascript' };

// 初回起動時に管理者アカウントがなければ自動で作る
// (Renderなどshellが使えないホスティング環境でも、npm run seedを手動実行しなくて済むように)
function ensureDefaultAdmin() {
  if (!db.getUserByUsername('admin')) {
    db.createUser({
      name: '管理者',
      username: 'admin',
      passwordHash: crypto.hashPassword('admin123'),
      role: 'admin',
    });
    console.log('初回起動: 管理者アカウントを自動作成しました (username: admin / password: admin123)');
    console.log('※ ログイン後、必ずパスワードを変更してください');
  }
}
ensureDefaultAdmin();

function sendHtml(res, status, html, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders });
  res.end(html);
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { Location: location, ...extraHeaders });
  res.end();
}

function getCurrentSession(req) {
  const cookies = sess.parseCookies(req);
  return { sid: cookies.sid, session: sess.getSession(cookies.sid) };
}

// 今月のチェック回数で会員をランキングする(同点は同順位)
function computeMonthlyRanking() {
  const list = db.getAllMembers().map((m) => {
    const checkins = db.getCheckinsForUser(m.id).map((c) => c.date);
    return { id: m.id, name: m.name, count: stats.currentMonthCount(checkins) };
  });
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
  if (method === 'GET' && (pathname === '/style.css')) {
    return serveStatic(req, res, pathname);
  }

  const { sid, session } = getCurrentSession(req);
  const user = session ? session.user : null;

  // --- ログイン画面 ---
  if (method === 'GET' && pathname === '/login') {
    if (user) return redirect(res, '/');
    return sendHtml(res, 200, views.loginPage(url.searchParams.get('error')));
  }

  if (method === 'POST' && pathname === '/login') {
    const body = await parseBody(req);
    const u = db.getUserByUsername((body.username || '').trim());
    if (!u || !crypto.verifyPassword(body.password || '', u.passwordHash)) {
      return sendHtml(res, 200, views.loginPage('ユーザー名またはパスワードが違います'));
    }
    const newSid = sess.createSession({ id: u.id, name: u.name, username: u.username, role: u.role });
    return redirect(res, '/', { 'Set-Cookie': sess.cookieHeader(newSid, 60 * 60 * 24 * 30) });
  }

  if (method === 'POST' && pathname === '/logout') {
    if (sid) sess.destroySession(sid);
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
    const checkins = db.getCheckinsForUser(user.id).map((c) => c.date);
    const today = stats.todayStr();
    const streak = stats.currentStreak(checkins);
    const celebrate = url.searchParams.get('celebrate') === '1';
    const rewardCelebrate = celebrate && url.searchParams.get('reward') === '1';
    return sendHtml(
      res,
      200,
      views.memberPage({
        userName: user.name,
        today,
        checkedToday: checkins.includes(today),
        streak,
        weekCount: stats.thisWeekCount(checkins),
        grid: stats.dailyGrid(checkins, 56),
        weekly: stats.weeklySeries(checkins, 8),
        monthCount: stats.currentMonthCount(checkins),
        monthGoal: stats.MONTHLY_GOAL,
        monthlyStreak: stats.currentMonthlyStreak(checkins),
        rewardMonths: stats.REWARD_MONTHS,
        badges: stats.streakBadges(streak),
        nextBadge: stats.nextStreakBadge(streak),
        ranked: computeMonthlyRanking(),
        userId: user.id,
        celebrate,
        milestoneBadge: celebrate ? stats.justUnlockedBadge(streak) : null,
        rewardCelebrate,
        checkinDates: checkins,
      })
    );
  }

  if (pathname === '/member/checkin' && method === 'POST') {
    const today = stats.todayStr();
    const alreadyChecked = db.hasCheckinForDate(user.id, today);
    if (alreadyChecked) {
      db.removeCheckin(user.id, today);
      return redirect(res, '/member');
    }

    const beforeCheckins = db.getCheckinsForUser(user.id).map((c) => c.date);
    const monthCountBefore = stats.currentMonthCount(beforeCheckins);

    db.addCheckin(user.id, today);

    const afterCheckins = db.getCheckinsForUser(user.id).map((c) => c.date);
    const monthCountAfter = stats.currentMonthCount(afterCheckins);
    const monthlyStreakAfter = stats.currentMonthlyStreak(afterCheckins);
    // ちょうど今月の目標(10回)に到達し、かつそれが3ヶ月ごとの特典ラインに乗った瞬間かどうか
    const justHitMonthlyGoal = monthCountBefore < stats.MONTHLY_GOAL && monthCountAfter >= stats.MONTHLY_GOAL;
    const justEarnedReward = justHitMonthlyGoal && monthlyStreakAfter > 0 && monthlyStreakAfter % stats.REWARD_MONTHS === 0;

    return redirect(res, `/member?celebrate=1${justEarnedReward ? '&reward=1' : ''}`);
  }

  if (pathname === '/member/password' && method === 'POST') {
    const body = await parseBody(req);
    if (body.newPassword && body.newPassword.length >= 4) {
      db.updateUserPassword(user.id, crypto.hashPassword(body.newPassword));
    }
    return redirect(res, '/member');
  }

  // --- 管理者ページ ---
  if (pathname.startsWith('/admin')) {
    if (user.role !== 'admin') {
      res.writeHead(403);
      return res.end('権限がありません');
    }

    if (pathname === '/admin' && method === 'GET') {
      const members = db.getAllMembers().map((m) => {
        const checkins = db.getCheckinsForUser(m.id).map((c) => c.date);
        const streak = stats.currentStreak(checkins);
        const monthlyStreak = stats.currentMonthlyStreak(checkins);
        const earned = stats.rewardsEarned(monthlyStreak);
        const given = m.rewardsGiven || 0;
        const unlockedBadges = stats.streakBadges(streak).filter((b) => b.achieved);
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
      });
      const allCheckins = db.getAllCheckins().map((c) => c.date);
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
          ranked: computeMonthlyRanking(),
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
      if (db.getUserByUsername(username.trim())) {
        return redirect(res, '/admin?error=' + encodeURIComponent('そのユーザー名は既に使われています'));
      }
      db.createUser({
        name: name.trim(),
        username: username.trim(),
        passwordHash: crypto.hashPassword(password),
        role: 'member',
      });
      return redirect(res, '/admin?message=' + encodeURIComponent(name.trim() + ' さんを追加しました'));
    }

    let match = pathname.match(/^\/admin\/members\/(\d+)\/delete$/);
    if (match && method === 'POST') {
      db.deleteUser(match[1]);
      return redirect(res, '/admin?message=' + encodeURIComponent('削除しました'));
    }

    match = pathname.match(/^\/admin\/members\/(\d+)\/reset-password$/);
    if (match && method === 'POST') {
      const body = await parseBody(req);
      if (body.newPassword && body.newPassword.length >= 4) {
        db.updateUserPassword(match[1], crypto.hashPassword(body.newPassword));
        return redirect(res, '/admin?message=' + encodeURIComponent('パスワードを再設定しました'));
      }
      return redirect(res, '/admin?error=' + encodeURIComponent('パスワードは4文字以上にしてください'));
    }

    match = pathname.match(/^\/admin\/members\/(\d+)\/reward$/);
    if (match && method === 'POST') {
      db.incrementRewardsGiven(match[1]);
      return redirect(res, '/admin?message=' + encodeURIComponent('特典を渡した記録を追加しました'));
    }

    if (pathname === '/admin/backup' && method === 'GET') {
      const raw = db.exportRaw();
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
        db.importRaw(file.content.toString('utf8'));
        return redirect(res, '/admin?message=' + encodeURIComponent('バックアップからデータを復元しました'));
      } catch (err) {
        return redirect(res, '/admin?error=' + encodeURIComponent('復元に失敗しました。ファイルの形式を確認してください'));
      }
    }

    match = pathname.match(/^\/admin\/member\/(\d+)$/);
    if (match && method === 'GET') {
      const member = db.getUserById(match[1]);
      if (!member || member.role !== 'member') {
        res.writeHead(404);
        return res.end('会員が見つかりません');
      }
      const checkins = db.getCheckinsForUser(member.id).map((c) => c.date);
      const memberStreak = stats.currentStreak(checkins);
      const monthlyStreak = stats.currentMonthlyStreak(checkins);
      const earned = stats.rewardsEarned(monthlyStreak);
      const given = member.rewardsGiven || 0;
      return sendHtml(
        res,
        200,
        views.adminMemberPage({
          member,
          streak: memberStreak,
          weekCount: stats.thisWeekCount(checkins),
          total: checkins.length,
          grid: stats.dailyGrid(checkins, 84),
          weekly: stats.weeklySeries(checkins, 12),
          monthCount: stats.currentMonthCount(checkins),
          monthlyStreak,
          monthlySeries: stats.monthlySeries(checkins, 6),
          rewardsEarned: earned,
          rewardsGiven: given,
          rewardsPending: Math.max(0, earned - given),
          badges: stats.streakBadges(memberStreak),
          checkinDates: checkins,
        })
      );
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`training-tracker running at http://localhost:${PORT}`);
});
