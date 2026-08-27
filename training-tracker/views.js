// HTMLをテンプレートエンジンなしで生成する(外部依存なし)
const { MONTHLY_GOAL, REWARD_MONTHS, MAX_MEMBER_MEDIA, MAX_LIBRARY_ITEMS } = require('./stats');
const CHART_JS = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// YouTubeのURL(watch/短縮/shorts/埋め込み)から埋め込み用URLを作る。YouTube以外はnull
function youtubeEmbedUrl(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

// 動画1本ぶんのプレーヤー(YouTubeなら埋め込み、それ以外はリンク表示)
function videoPlayerHtml(video) {
  const embedUrl = youtubeEmbedUrl(video.url);
  if (embedUrl) {
    return `<div class="video-embed"><iframe src="${escapeHtml(embedUrl)}" title="${escapeHtml(video.title)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  return `<p style="font-size:0.9rem;"><a href="${escapeHtml(video.url)}" target="_blank" rel="noopener">動画を開く &rarr;</a></p>`;
}

// 画像1枚ぶんの表示(base64で保存した画像データをそのまま埋め込む)
function imageDisplayHtml(item) {
  return `<img class="media-image" src="data:${escapeHtml(item.mimeType)};base64,${item.imageData}" alt="${escapeHtml(item.title)}">`;
}

// 番号表示用(①②③...)。MAX_MEMBER_MEDIAが10件までなので⑩まであれば足りる
const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

// 会員ごとの動画・画像一覧(合わせて最大MAX_MEMBER_MEDIA件、deletable=trueで削除・メモ編集フォーム付き)
function mediaListHtml(media, { deletable = false, memberId } = {}) {
  if (!media || !media.length) {
    return '<p style="font-size:0.85rem;color:var(--muted);margin:0;">まだ動画・画像は登録されていません</p>';
  }
  const items = media
    .map(
      (v, i) => `
      <div class="video-item">
        <div class="video-item-head">
          <h4>${CIRCLED_NUMS[i] || i + 1} ${escapeHtml(v.title)}</h4>
          ${
            deletable
              ? `<form method="POST" action="/admin/members/${memberId}/media/${v.id}/delete" onsubmit="return confirm('削除しますか?');">
                  <button class="btn danger" type="submit">削除</button>
                </form>`
              : ''
          }
        </div>
        ${v.note ? `<p class="media-note">${escapeHtml(v.note)}</p>` : ''}
        ${
          deletable
            ? `<details class="history-note-edit" style="margin-bottom:8px;">
                <summary>${v.note ? 'セット数・回数を編集' : 'セット数・回数を追加'}</summary>
                <form method="POST" action="/admin/members/${memberId}/media/${v.id}/note" class="inline-form">
                  <div class="form-row">
                    <input type="text" name="note" maxlength="200" value="${escapeHtml(v.note || '')}" placeholder="例: 3セット×10回">
                  </div>
                  <button class="btn" type="submit">保存</button>
                </form>
              </details>`
            : ''
        }
        ${v.type === 'image' ? imageDisplayHtml(v) : videoPlayerHtml(v)}
      </div>`
    )
    .join('');
  return `<div class="video-list">${items}</div>`;
}

// 素材ライブラリの一覧表示。mode='manage'は削除ボタン付き(ライブラリ管理画面用)、
// mode='pick'は会員に追加するための小さいフォーム付き(会員詳細画面の選択欄用)
function libraryListHtml(library, { mode = 'manage', memberId } = {}) {
  if (!library || !library.length) {
    return '<p style="font-size:0.85rem;color:var(--muted);margin:0;">まだライブラリに素材がありません</p>';
  }
  const items = library
    .map(
      (v) => `
      <div class="video-item">
        <div class="video-item-head">
          <h4>${v.type === 'image' ? '📷' : '🎥'} ${escapeHtml(v.title)}</h4>
          ${
            mode === 'manage'
              ? `<form method="POST" action="/admin/library/${v.id}/delete" onsubmit="return confirm('ライブラリから削除しますか?(会員に既に追加済みの分は残ります)');">
                  <button class="btn danger" type="submit">削除</button>
                </form>`
              : ''
          }
        </div>
        ${
          mode === 'pick'
            ? `<form method="POST" action="/admin/members/${memberId}/media/from-library/${v.id}" class="inline-form" style="margin-bottom:10px;">
                <div class="form-row" style="flex:2;">
                  <input type="text" name="note" maxlength="200" placeholder="セット数・回数(任意) 例: 3セット×10回">
                </div>
                <button class="btn primary" type="submit">この会員に追加</button>
              </form>`
            : ''
        }
        ${v.type === 'image' ? imageDisplayHtml(v) : videoPlayerHtml(v)}
      </div>`
    )
    .join('');
  return `<div class="video-list">${items}</div>`;
}

function layout({ title, body, script = '', topbar = '' }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/style.css">
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#2563eb">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="オンライン運動元気倶楽部">
${script ? `<script src="${CHART_JS}"></script>` : ''}
</head>
<body>
${topbar}
<div class="container">
${body}
</div>
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}

function topbar(label, showLogout = true, showSiteTitle = false) {
  return `<div class="topbar">
    <span class="brand">
      ${showSiteTitle ? `<span style="display:block;font-size:0.72rem;font-weight:400;opacity:0.85;line-height:1.4;">オンライン運動元気倶楽部</span>` : ''}
      <span style="display:block;">${label}</span>
    </span>
    <div class="topbar-actions">
      <a href="/board">💬 みんなの掲示板</a>
      ${showLogout ? `<form method="POST" action="/logout"><button type="submit">ログアウト</button></form>` : ''}
    </div>
  </div>`;
}

function loginPage(error) {
  return layout({
    title: 'ログイン | オンライン運動元気倶楽部',
    topbar: '',
    body: `
    <div class="login-wrap">
      <div class="card login-card">
        <h1>オンライン運動元気倶楽部</h1>
        ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
        <form method="POST" action="/login">
          <div class="form-row">
            <label>ユーザー名</label>
            <input type="text" name="username" required autofocus>
          </div>
          <div class="form-row">
            <label>パスワード</label>
            <input type="password" name="password" required>
          </div>
          <button class="btn primary" style="width:100%;padding:12px;" type="submit">ログイン</button>
        </form>
      </div>
    </div>`,
  }).replace('<body>', '<body style="display:flex;min-height:100vh;">').replace('<div class="container">', '<div class="container" style="width:100%;display:flex;align-items:center;justify-content:center;">');
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
// カレンダーのヘッダー表示専用(月曜始まり)。formatDateJa等はgetUTCDay()の並び(日曜始まり)のままでよいので別配列にする
const WEEKDAY_HEADER_MON_START = ['月', '火', '水', '木', '金', '土', '日'];

// 月間カレンダー表示(曜日ヘッダー付き、月曜始まり)。gridはstats.monthCalendar()の出力(nullは空白セル)
function gridHtml(grid) {
  const head = WEEKDAY_HEADER_MON_START.map(
    (w, i) => `<div class="day-head ${i === 5 ? 'sat' : ''} ${i === 6 ? 'sun' : ''}">${w}</div>`
  ).join('');
  const cells = grid
    .map((c) => {
      if (!c) return '<div class="day empty"></div>';
      const weekendCls = c.dow === 0 ? 'sun' : c.dow === 6 ? 'sat' : '';
      return `<div class="day ${c.checked ? 'checked' : ''} ${weekendCls}" title="${c.date}"><span class="daynum">${c.day}</span></div>`;
    })
    .join('');
  return `<div class="grid-head">${head}</div><div class="grid">${cells}</div>`;
}

// "2026-08-02" -> "8月2日(日)"
function formatDateJa(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const weekday = WEEKDAY_JA[d.getUTCDay()];
  return `${month}月${day}日(${weekday})`;
}

// "2026-08" -> "2026年8月"
function formatMonthJa(mKey) {
  const [y, m] = mKey.split('-').map(Number);
  return `${y}年${m}月`;
}

// カレンダーの前月/翌月ナビゲーション(翌月が無い=今月なら翌月ボタンは無効表示)
function calendarNavHtml(basePath, prevMonthKey, nextMonthKey) {
  const prev = `<a class="btn" href="${basePath}?month=${prevMonthKey}">&laquo; 前月</a>`;
  const next = nextMonthKey
    ? `<a class="btn" href="${basePath}?month=${nextMonthKey}">翌月 &raquo;</a>`
    : `<button class="btn" type="button" disabled>翌月 &raquo;</button>`;
  return `<div class="calendar-nav">${prev}${next}</div>`;
}

// 実施した日を新しい順に一覧表示する(「何月何日にできたか」がひと目で分かるように)
// checkinRecords: [{date, note}, ...]。editable=trueだと各行にメモの追加・編集フォームを出す(本人のみ)
function historyListHtml(checkinRecords, { limit = 30, editable = false } = {}) {
  if (!checkinRecords.length) {
    return '<p style="font-size:0.85rem;color:var(--muted);margin:0;">まだ記録がありません</p>';
  }
  const sortedDesc = [...checkinRecords].sort((a, b) => b.date.localeCompare(a.date));
  const shown = sortedDesc.slice(0, limit);
  const items = shown
    .map((c) => {
      const note = c.note || '';
      return `
      <li>
        <div class="history-row">
          <span>${formatDateJa(c.date)}</span>
          ${note ? `<div class="history-note">${escapeHtml(note)}</div>` : ''}
          ${
            editable
              ? `<details class="history-note-edit">
                  <summary>${note ? 'メモを編集' : 'メモを追加(自由記入)'}</summary>
                  <form method="POST" action="/member/checkins/${c.date}/note" class="inline-form">
                    <div class="form-row">
                      <textarea name="note" rows="2" maxlength="300" placeholder="例: スクワット3セット×10回、ベンチプレス...">${escapeHtml(note)}</textarea>
                    </div>
                    <button class="btn" type="submit">保存</button>
                  </form>
                </details>`
              : ''
          }
        </div>
      </li>`;
    })
    .join('');
  const more = sortedDesc.length > limit ? `<p style="font-size:0.8rem;color:var(--muted);margin:8px 0 0;">他${sortedDesc.length - limit}件</p>` : '';
  return `<ul class="history-list">${items}</ul>${more}`;
}

// 獲得ランクのログ("いつ達成したか"の一覧、新しい順)
function badgeLogHtml(badgeLog) {
  if (!badgeLog.length) {
    return '<p style="font-size:0.85rem;color:var(--muted);margin:0;">まだ獲得したランクはありません</p>';
  }
  const sorted = [...badgeLog].sort((a, b) => b.unlockedDate.localeCompare(a.unlockedDate));
  const items = sorted
    .map(
      (b) =>
        `<li>${b.icon} <strong>${escapeHtml(b.label)}</strong> にランクアップ! <span style="color:var(--muted);">(${formatDateJa(b.unlockedDate)})</span></li>`
    )
    .join('');
  return `<ul class="history-list">${items}</ul>`;
}

// 管理者⇔会員のメッセージスレッド
// viewerRole: このページを見ている人の役割('admin'|'member')。自分が送信したメッセージにだけ削除ボタンを出す
// deleteBasePath: 削除フォームの送信先のベースパス(末尾に "/{メッセージID}/delete" を付けて使う)
function messageThreadHtml(messages, { viewerRole, deleteBasePath } = {}) {
  if (!messages.length) {
    return '<p style="font-size:0.85rem;color:var(--muted);margin:0 0 12px;">まだメッセージはありません</p>';
  }
  const items = messages
    .map(
      (m) => `
      <div class="msg-bubble ${m.senderRole === 'admin' ? 'from-admin' : 'from-member'}">
        <div class="msg-meta">
          <span>${escapeHtml(m.senderName)} ・ ${escapeHtml(m.createdAt)}</span>
          ${
            viewerRole && deleteBasePath && m.senderRole === viewerRole
              ? `<form method="POST" action="${deleteBasePath}/${m.id}/delete" style="display:inline;" onsubmit="return confirm('このメッセージを削除しますか？');">
                  <button class="btn danger" type="submit" style="padding:0 6px;font-size:0.68rem;margin-left:6px;">削除</button>
                </form>`
              : ''
          }
        </div>
        <div class="msg-body">${escapeHtml(m.body)}</div>
      </div>`
    )
    .join('');
  return `<div class="msg-thread">${items}</div>`;
}

function badgeRowHtml(badges) {
  return `<div class="badge-row">${badges
    .map(
      (b) => `
      <div class="badge-item ${b.achieved ? 'unlocked' : ''}" title="${escapeHtml(b.label)}(${b.days}日)">
        <span class="icon">${b.icon}</span>
        <span class="label">${escapeHtml(b.label)}<br>${b.days}日</span>
      </div>`
    )
    .join('')}</div>`;
}

function leaderboardHtml(ranked, currentUserId, limit = 3) {
  const top = ranked.slice(0, limit);
  const meInTop = top.some((r) => r.id === currentUserId);
  const me = ranked.find((r) => r.id === currentUserId);
  const rows = top
    .map(
      (r) => `
      <li class="rank-${r.rank} ${r.id === currentUserId ? 'me' : ''}">
        <span class="rank">${r.rank}</span>
        <span class="name">${escapeHtml(r.name)}${r.id === currentUserId ? ' (あなた)' : ''}</span>
        <span class="count">${r.count}回</span>
      </li>`
    )
    .join('');
  const meRow =
    !meInTop && me
      ? `<li class="me" style="border-top:2px dashed var(--border);margin-top:4px;">
          <span class="rank">${me.rank}</span>
          <span class="name">${escapeHtml(me.name)} (あなた)</span>
          <span class="count">${me.count}回</span>
        </li>`
      : '';
  return `<ul class="leaderboard">${rows}${meRow}</ul>`;
}

// 紙吹雪を降らせる、外部ライブラリ不要のお祝い演出
// gold=trueだと特典獲得用の豪華な配色・多めの量になる
function confettiScript(gold = false) {
  const colors = gold
    ? ['#ffd700', '#ffb703', '#f4a261', '#e9c46a', '#fff3b0']
    : ['#3b82f6', '#1d4ed8', '#ffb703', '#f4a261', '#e76f51', '#8ecae6'];
  const count = gold ? 80 : 40;
  return `
    (function() {
      const colors = ${JSON.stringify(colors)};
      for (let i = 0; i < ${count}; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + 'vw';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDuration = (2 + Math.random() * 1.5) + 's';
        piece.style.animationDelay = (Math.random() * ${gold ? '0.8' : '0.4'}) + 's';
        document.body.appendChild(piece);
        setTimeout(() => piece.remove(), 4000);
      }
    })();
  `;
}

function monthlyProgressHtml({ monthCount, monthGoal, monthlyStreak, rewardMonths }) {
  const pct = Math.min(100, Math.round((monthCount / monthGoal) * 100));
  const achieved = monthCount >= monthGoal;
  const monthsToNextReward = achieved ? rewardMonths - (monthlyStreak % rewardMonths || rewardMonths) : null;
  return `
    <div class="stat-row">
      <div class="stat-box"><div class="num">${monthCount}/${monthGoal}</div><div class="label">今月の実施回数</div></div>
      <div class="stat-box"><div class="num">${monthlyStreak}</div><div class="label">目標達成 連続月数</div></div>
    </div>
    <div style="background:var(--border);border-radius:8px;height:14px;overflow:hidden;margin-bottom:10px;">
      <div style="background:${achieved ? 'var(--primary)' : 'var(--primary-light)'};height:100%;width:${pct}%;"></div>
    </div>
    <p style="font-size:0.85rem;color:var(--muted);margin:0;">
      ${
        achieved
          ? monthsToNextReward === 0
            ? '今月で目標達成! 3ヶ月継続の特典ラインに到達しました 🎉'
            : `今月の目標は達成済みです。あと${monthsToNextReward}ヶ月継続で特典がもらえます。`
          : `今月あと${Math.max(0, monthGoal - monthCount)}回で目標達成です。`
      }
    </p>`;
}

function memberPage({
  userName,
  today,
  checkedToday,
  streak,
  totalDays,
  weekCount,
  grid,
  monthKeyForGrid,
  prevMonthKey,
  nextMonthKey,
  calendarBasePath,
  weekly,
  monthCount,
  monthGoal,
  monthlyStreak,
  rewardMonths,
  badges,
  nextBadge,
  ranked,
  userId,
  celebrate,
  milestoneBadge,
  rewardCelebrate,
  checkinDates,
  checkinRecords,
  badgeLog,
  messages,
  media,
  hasUnreadMessages,
}) {
  const script = `
    ${celebrate ? confettiScript(rewardCelebrate) : ''}`;

  const celebrateBanner = celebrate
    ? `<div class="celebrate-banner ${rewardCelebrate ? 'reward' : ''}">
        ${
          rewardCelebrate
            ? `🎁 特典ゲット!<div class="sub">月${MONTHLY_GOAL}回を${REWARD_MONTHS}ヶ月連続で達成しました。管理者に伝えて特典を受け取ってください!</div>`
            : milestoneBadge
            ? `${milestoneBadge.icon} バッジ「${escapeHtml(milestoneBadge.label)}」を獲得しました!<div class="sub">累計${milestoneBadge.days}日達成です、この調子!</div>`
            : `🎉 今日もチェック完了!<div class="sub">連続${streak}日目、いい調子です</div>`
        }
      </div>`
    : '';

  const unreadBanner = hasUnreadMessages
    ? `<a href="#messages" class="notice-banner">📩 アドバイザーから新着メッセージがあります</a>`
    : '';

  return layout({
    title: 'マイページ | オンライン運動元気倶楽部',
    topbar: topbar(`${escapeHtml(userName)} さん`, true, true),
    script,
    body: `
    ${unreadBanner}
    ${celebrateBanner}

    <div class="card" id="video">
      <h3>${escapeHtml(userName)}さんの専用トレーニング</h3>
      ${mediaListHtml(media)}
    </div>

    <div class="card">
      <h3>バッジコレクション</h3>
      ${badgeRowHtml(badges)}
      <p style="font-size:0.85rem;color:var(--muted);margin:10px 0 0;">
        ${nextBadge ? `次のバッジ「${nextBadge.icon} ${escapeHtml(nextBadge.label)}」まであと累計${nextBadge.days - totalDays}日` : 'すべてのバッジを獲得しました!すごい継続力です 👑'}
      </p>
    </div>

    <div class="card">
      <h2>今日のトレーニング (${today})</h2>
      <form method="POST" action="/member/checkin">
        <button class="checkin-btn ${checkedToday ? 'checked' : ''}" type="submit">
          ${checkedToday ? '✓ 完了しました(取り消す)' : 'トレーニング完了をチェック'}
        </button>
      </form>
    </div>

    <div class="card">
      <h3>今月の目標(月${monthGoal}回 × 3ヶ月継続で特典)</h3>
      ${monthlyProgressHtml({ monthCount, monthGoal, monthlyStreak, rewardMonths })}
    </div>

    <div class="card">
      <div class="stat-row">
        <div class="stat-box"><div class="num">${streak}</div><div class="label">連続日数</div></div>
        <div class="stat-box"><div class="num">${weekCount}/7</div><div class="label">今週の実施回数</div></div>
      </div>
      <h3>${formatMonthJa(monthKeyForGrid)}のカレンダー</h3>
      ${calendarNavHtml(calendarBasePath, prevMonthKey, nextMonthKey)}
      ${gridHtml(grid)}
    </div>

    <div class="card" id="history">
      <h3>実施した日</h3>
      <p style="font-size:0.8rem;color:var(--muted);margin:0 0 8px;">日付をタップすると、セット数・回数などのメモを追加・編集できます</p>
      ${historyListHtml(checkinRecords, { editable: true })}
    </div>

    <div class="card">
      <h3>🎖 ランクアップ履歴</h3>
      ${badgeLogHtml(badgeLog)}
    </div>

    <div class="card">
      <h3>🏆 今月のランキング(上位3名掲載)</h3>
      ${leaderboardHtml(ranked, userId)}
    </div>

    <div class="card" id="messages">
      <h3>📩 アドバイザーとのメッセージ</h3>
      ${messageThreadHtml(messages, { viewerRole: 'member', deleteBasePath: '/member/messages' })}
      <form method="POST" action="/member/messages" class="inline-form">
        <div class="form-row">
          <label>アドバイザーにメッセージを送る</label>
          <input type="text" name="body" maxlength="500" required>
        </div>
        <button class="btn primary" type="submit">送信</button>
      </form>
    </div>

    <div class="card">
      <a class="btn" href="/member/password">🔑 パスワード変更</a>
    </div>`,
  });
}

function memberPasswordPage({ userName, error, message }) {
  return layout({
    title: 'パスワード変更 | オンライン運動元気倶楽部',
    topbar: `<div class="topbar"><span class="brand"><a href="/member">&larr; 戻る</a></span><div class="topbar-actions"><a href="/board">💬 みんなの掲示板</a><form method="POST" action="/logout"><button type="submit">ログアウト</button></form></div></div>`,
    body: `
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <div class="card">
      <h2>🔑 パスワード変更</h2>
      ${message ? `<p style="font-size:0.85rem;color:var(--primary);margin:0 0 12px;">${escapeHtml(message)}</p>` : ''}
      <form method="POST" action="/member/password" class="inline-form">
        <div class="form-row">
          <label>新しいパスワード(4文字以上)</label>
          <input type="password" name="newPassword" minlength="4" required>
        </div>
        <button class="btn primary" type="submit">変更する</button>
      </form>
    </div>`,
  });
}

function adminPage({ members, teamWeekly, ranked, error, message, unreadMembers = [] }) {
  const rows = members
    .map(
      (m) => `
    <tr>
      <td>${m.badgeIcon ? `<span title="${escapeHtml(m.badgeLabel)}">${m.badgeIcon}</span> ` : ''}<a href="/admin/member/${m.id}">${escapeHtml(m.name)}</a></td>
      <td><span class="badge ${m.weekCount >= 3 ? 'good' : 'warn'}">${m.weekCount}/7</span></td>
      <td><span class="badge ${m.monthCount >= m.monthGoal ? 'good' : 'warn'}">${m.monthCount}/${m.monthGoal}</span></td>
      <td>${m.monthlyStreak}ヶ月</td>
      <td>${m.streak}日</td>
      <td>${m.total}回</td>
      <td>${m.lastDate || '未実施'}</td>
      <td>
        ${
          m.rewardsPending > 0
            ? `<form method="POST" action="/admin/members/${m.id}/reward" onsubmit="return confirm('${escapeHtml(m.name)}さんに特典を渡しましたか?');">
                <button class="btn primary" type="submit">🎁 特典を渡す(残${m.rewardsPending})</button>
               </form>`
            : `<span style="font-size:0.8rem;color:var(--muted);">渡し済み ${m.rewardsGiven}回</span>`
        }
      </td>
      <td><a class="btn" href="/admin/member/${m.id}">詳細</a></td>
      <td>
        <form method="POST" action="/admin/members/${m.id}/delete" onsubmit="return confirm('${escapeHtml(m.name)}さんを削除しますか?');">
          <button class="btn danger" type="submit">削除</button>
        </form>
      </td>
    </tr>`
    )
    .join('');

  const script = `
    const teamWeekly = ${JSON.stringify(teamWeekly)};
    new Chart(document.getElementById('teamChart'), {
      type: 'line',
      data: {
        labels: teamWeekly.map(w => w.weekStart),
        datasets: [{ label: '会員1人あたり週平均実施回数', data: teamWeekly.map(w => w.avg), borderColor: '#1d4ed8', backgroundColor: 'rgba(29,78,216,0.15)', fill: true, tension: 0.3 }]
      },
      options: { scales: { y: { beginAtZero: true, max: 7 } } }
    });`;

  return layout({
    title: '管理者ダッシュボード | オンライン運動元気倶楽部',
    topbar: topbar('管理者ダッシュボード'),
    script,
    body: `
    ${
      unreadMembers.length
        ? `<a href="/admin/member/${unreadMembers[0].id}#messages" class="notice-banner">📩 新着メッセージ: ${unreadMembers
            .map((m) => escapeHtml(m.name))
            .join('、')}さん</a>`
        : ''
    }
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    ${message ? `<div class="message">${escapeHtml(message)}</div>` : ''}

    <div class="card">
      <a class="btn" href="/admin/library">🎥📷 素材ライブラリを管理</a>
    </div>

    <div class="card">
      <h3>🏆 今月のランキング</h3>
      ${ranked.length ? leaderboardHtml(ranked, null, 3) : '<p style="font-size:0.85rem;color:var(--muted);margin:0;">まだデータがありません</p>'}
    </div>

    <div class="card">
      <h2>会員の進捗</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>名前</th><th>今週</th><th>今月</th><th>目標達成月数</th><th>連続日数</th><th>累計</th><th>最終実施日</th><th>特典</th><th></th><th></th></tr></thead>
          <tbody>
            ${rows || `<tr><td colspan="10">まだ会員が登録されていません</td></tr>`}
          </tbody>
        </table>
      </div>
      <p style="font-size:0.8rem;color:var(--muted);margin-top:8px;">特典ルール: 月${MONTHLY_GOAL}回の実施を${REWARD_MONTHS}ヶ月連続で達成すると特典1回。以降も継続すれば${REWARD_MONTHS}ヶ月ごとに繰り返し獲得できます。</p>
    </div>

    <div class="card">
      <h3>チーム全体の週次平均実施回数</h3>
      <canvas id="teamChart" height="110"></canvas>
    </div>

    <div class="card">
      <h3>会員を追加</h3>
      <form method="POST" action="/admin/members" class="inline-form">
        <div class="form-row"><label>名前</label><input type="text" name="name" required></div>
        <div class="form-row"><label>ユーザー名</label><input type="text" name="username" required></div>
        <div class="form-row"><label>初期パスワード</label><input type="text" name="password" required minlength="4"></div>
        <button class="btn primary" type="submit">追加</button>
      </form>
    </div>

    <div class="card">
      <h3>データのバックアップ / 復元</h3>
      <p style="font-size:0.85rem;color:var(--muted);margin:0 0 12px;">
        無料ホスティングではデータが消えることがあるため、時々バックアップのダウンロードをおすすめします。
      </p>
      <a class="btn" href="/admin/backup" style="margin-bottom:16px;display:inline-block;">⬇ バックアップをダウンロード</a>
      <form method="POST" action="/admin/restore" enctype="multipart/form-data" class="inline-form" onsubmit="return confirm('現在のデータをバックアップファイルの内容で上書きします。よろしいですか?');">
        <div class="form-row">
          <label>バックアップファイル(.json)から復元</label>
          <input type="file" name="backupFile" accept=".json" required>
        </div>
        <button class="btn danger" type="submit">復元する</button>
      </form>
    </div>`,
  });
}

function adminMemberPage({ member, streak, weekCount, total, grid, monthKeyForGrid, prevMonthKey, nextMonthKey, calendarBasePath, weekly, monthCount, monthlyStreak, monthlySeries, rewardsEarned, rewardsGiven, rewardsPending, badges, checkinDates, checkinRecords, badgeLog, messages, media, library, videoError, hadUnreadMessages }) {
  const script = `
    const monthlySeries = ${JSON.stringify(monthlySeries)};
    new Chart(document.getElementById('monthlyChart'), {
      type: 'bar',
      data: {
        labels: monthlySeries.map(m => m.month),
        datasets: [{
          label: '月の実施回数',
          data: monthlySeries.map(m => m.count),
          backgroundColor: monthlySeries.map(m => m.achieved ? '#1d4ed8' : '#bfdbfe'),
        }]
      },
      options: { scales: { y: { beginAtZero: true, ticks: { stepSize: 2 } } }, plugins: { legend: { display: false } } }
    });`;

  return layout({
    title: `${escapeHtml(member.name)} の詳細 | オンライン運動元気倶楽部`,
    topbar: `<div class="topbar"><span class="brand"><a href="/admin">&larr; 管理者ダッシュボード</a></span><div class="topbar-actions"><a href="/board">💬 みんなの掲示板</a><form method="POST" action="/logout"><button type="submit">ログアウト</button></form></div></div>`,
    script,
    body: `
    ${hadUnreadMessages ? `<a href="#messages" class="notice-banner">📩 ${escapeHtml(member.name)}さんから新着メッセージがあります</a>` : ''}
    <div class="card">
      <h2>${escapeHtml(member.name)} さんの進捗</h2>
      <div class="stat-row">
        <div class="stat-box"><div class="num">${streak}</div><div class="label">連続日数</div></div>
        <div class="stat-box"><div class="num">${weekCount}/7</div><div class="label">今週</div></div>
        <div class="stat-box"><div class="num">${total}</div><div class="label">累計実施回数</div></div>
      </div>
      <h3>${formatMonthJa(monthKeyForGrid)}のカレンダー</h3>
      ${calendarNavHtml(calendarBasePath, prevMonthKey, nextMonthKey)}
      ${gridHtml(grid)}
    </div>

    <div class="card" id="video">
      <h3>🎥📷 この会員専用の動画・画像(${(media || []).length}/${MAX_MEMBER_MEDIA})</h3>
      ${videoError ? `<div class="error">${escapeHtml(videoError)}</div>` : ''}
      ${mediaListHtml(media, { deletable: true, memberId: member.id })}
      ${
        (media || []).length < MAX_MEMBER_MEDIA
          ? `<details style="margin-top:12px;">
              <summary style="cursor:pointer;color:var(--primary);font-size:0.9rem;">📚 ライブラリから選んで追加</summary>
              <div style="margin-top:10px;">${libraryListHtml(library, { mode: 'pick', memberId: member.id })}</div>
            </details>
            <form method="POST" action="/admin/members/${member.id}/media/video" class="inline-form" style="margin-top:16px;">
              <div class="form-row">
                <label>動画タイトル</label>
                <input type="text" name="title" maxlength="60" required placeholder="例: スクワットフォーム講座">
              </div>
              <div class="form-row">
                <label>動画URL(YouTubeのURLを推奨)</label>
                <input type="text" name="url" required placeholder="https://www.youtube.com/watch?v=...">
              </div>
              <div class="form-row">
                <label>セット数・回数(任意)</label>
                <input type="text" name="note" maxlength="200" placeholder="例: 3セット×10回">
              </div>
              <button class="btn primary" type="submit">動画を追加</button>
            </form>
            <form method="POST" action="/admin/members/${member.id}/media/image" enctype="multipart/form-data" class="inline-form" style="margin-top:12px;">
              <div class="form-row">
                <label>画像タイトル</label>
                <input type="text" name="title" maxlength="60" required placeholder="例: 8月のフォームチェック">
              </div>
              <div class="form-row">
                <label>画像ファイル(jpg/png/webp/gif、5MBまで)</label>
                <input type="file" name="image" accept="image/*" required>
              </div>
              <div class="form-row">
                <label>セット数・回数(任意)</label>
                <input type="text" name="note" maxlength="200" placeholder="例: 3セット×10回">
              </div>
              <button class="btn primary" type="submit">画像を追加</button>
            </form>`
          : `<p style="font-size:0.85rem;color:var(--muted);margin-top:12px;">上限の${MAX_MEMBER_MEDIA}件に達しています。追加するには先に削除してください。</p>`
      }
    </div>

    <div class="card">
      <h3>実施した日</h3>
      ${historyListHtml(checkinRecords)}
    </div>

    <div class="card">
      <h3>バッジコレクション</h3>
      ${badgeRowHtml(badges)}
    </div>

    <div class="card">
      <h3>🎖 ランクアップ履歴</h3>
      ${badgeLogHtml(badgeLog)}
    </div>

    <div class="card" id="messages">
      <h3>📩 ${escapeHtml(member.name)} さんとのメッセージ</h3>
      ${messageThreadHtml(messages, { viewerRole: 'admin', deleteBasePath: `/admin/members/${member.id}/messages` })}
      <form method="POST" action="/admin/members/${member.id}/messages" class="inline-form">
        <div class="form-row">
          <label>メッセージを送る</label>
          <input type="text" name="body" maxlength="500" required>
        </div>
        <button class="btn primary" type="submit">送信</button>
      </form>
    </div>

    <div class="card">
      <h3>月間目標(月${MONTHLY_GOAL}回 × ${REWARD_MONTHS}ヶ月継続で特典)</h3>
      <div class="stat-row">
        <div class="stat-box"><div class="num">${monthCount}/${MONTHLY_GOAL}</div><div class="label">今月</div></div>
        <div class="stat-box"><div class="num">${monthlyStreak}ヶ月</div><div class="label">目標達成 連続月数</div></div>
        <div class="stat-box"><div class="num">${rewardsGiven}/${rewardsEarned}</div><div class="label">特典 渡し済み/獲得済み</div></div>
      </div>
      <canvas id="monthlyChart" height="110"></canvas>
      ${
        rewardsPending > 0
          ? `<form method="POST" action="/admin/members/${member.id}/reward" onsubmit="return confirm('${escapeHtml(member.name)}さんに特典を渡しましたか?');" style="margin-top:12px;">
              <button class="btn primary" type="submit">🎁 特典を渡す(残${rewardsPending})</button>
             </form>`
          : `<p style="font-size:0.85rem;color:var(--muted);margin-top:12px;">現在、未受け渡しの特典はありません。</p>`
      }
    </div>

    <div class="card">
      <h3>パスワードを再設定</h3>
      <form method="POST" action="/admin/members/${member.id}/reset-password" class="inline-form">
        <div class="form-row">
          <label>新しいパスワード(4文字以上)</label>
          <input type="password" name="newPassword" minlength="4" required>
        </div>
        <button class="btn" type="submit">再設定</button>
      </form>
    </div>`,
  });
}

// 素材ライブラリ管理画面(会員に配る前の動画・画像をここにまとめて登録しておく)
function adminLibraryPage({ library, error }) {
  return layout({
    title: '素材ライブラリ | オンライン運動元気倶楽部',
    topbar: `<div class="topbar"><span class="brand"><a href="/admin">&larr; 管理者ダッシュボード</a></span><div class="topbar-actions"><a href="/board">💬 みんなの掲示板</a><form method="POST" action="/logout"><button type="submit">ログアウト</button></form></div></div>`,
    body: `
    <div class="card">
      <h2>📚 素材ライブラリ(${(library || []).length}/${MAX_LIBRARY_ITEMS})</h2>
      <p style="font-size:0.85rem;color:var(--muted);margin:0 0 12px;">ここに登録した動画・画像は、各会員の詳細ページから選んで追加できます。</p>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      ${libraryListHtml(library, { mode: 'manage' })}
      ${
        (library || []).length < MAX_LIBRARY_ITEMS
          ? `<form method="POST" action="/admin/library/video" class="inline-form" style="margin-top:16px;">
              <div class="form-row">
                <label>動画タイトル</label>
                <input type="text" name="title" maxlength="60" required placeholder="例: スクワットフォーム講座">
              </div>
              <div class="form-row">
                <label>動画URL(YouTubeのURLを推奨)</label>
                <input type="text" name="url" required placeholder="https://www.youtube.com/watch?v=...">
              </div>
              <button class="btn primary" type="submit">動画を追加</button>
            </form>
            <form method="POST" action="/admin/library/image" enctype="multipart/form-data" class="inline-form" style="margin-top:12px;">
              <div class="form-row">
                <label>画像タイトル</label>
                <input type="text" name="title" maxlength="60" required placeholder="例: 8月のフォームチェック">
              </div>
              <div class="form-row">
                <label>画像ファイル(jpg/png/webp/gif、5MBまで)</label>
                <input type="file" name="image" accept="image/*" required>
              </div>
              <button class="btn primary" type="submit">画像を追加</button>
            </form>`
          : `<p style="font-size:0.85rem;color:var(--muted);margin-top:12px;">上限の${MAX_LIBRARY_ITEMS}件に達しています。追加するには先に削除してください。</p>`
      }
    </div>`,
  });
}

// 会員なら誰でも投稿できる、返信はスタッフ(管理者)のみの掲示板
function boardPage({ posts, userRole, userName, userId, error }) {
  const postsHtml = posts.length
    ? posts
        .map(
          (p) => `
      <div class="card board-post">
        <div class="board-post-meta">
          <span><strong>${escapeHtml(p.authorName)}</strong> <span>${escapeHtml(p.createdAt)}</span></span>
          ${
            p.authorId === userId
              ? `<form method="POST" action="/board/${p.id}/delete" onsubmit="return confirm('この投稿を削除しますか？');">
                  <button class="btn danger" type="submit" style="padding:2px 8px;font-size:0.75rem;">削除</button>
                </form>`
              : ''
          }
        </div>
        <div class="board-post-body">${escapeHtml(p.body)}</div>
        ${(p.replies || [])
          .map(
            (r) => `
          <div class="board-reply">
            <div class="board-reply-meta">🛠 ${escapeHtml(r.adminName)}(スタッフ) <span>${escapeHtml(r.createdAt)}</span></div>
            <div class="board-reply-body">${escapeHtml(r.body)}</div>
          </div>`
          )
          .join('')}
        ${
          userRole === 'admin'
            ? `<form method="POST" action="/board/${p.id}/reply" class="inline-form board-reply-form">
                <div class="form-row"><input type="text" name="body" placeholder="スタッフとして返信する" maxlength="500" required></div>
                <button class="btn" type="submit">返信</button>
              </form>`
            : ''
        }
      </div>`
        )
        .join('')
    : '<div class="card"><p style="font-size:0.85rem;color:var(--muted);margin:0;">まだ投稿がありません</p></div>';

  return layout({
    title: 'みんなの掲示板 | オンライン運動元気倶楽部',
    topbar: `<div class="topbar"><span class="brand"><a href="${userRole === 'admin' ? '/admin' : '/member'}">&larr; 戻る</a></span><form method="POST" action="/logout"><button type="submit">ログアウト</button></form></div>`,
    body: `
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <div class="card">
      <h2>💬 みんなの掲示板</h2>
      <p style="font-size:0.85rem;color:var(--muted);margin:0 0 12px;">会員なら誰でも自由に投稿できます。投稿への返信はスタッフのみ行えます。</p>
      <form method="POST" action="/board/post" class="inline-form">
        <div class="form-row">
          <label>投稿する(${escapeHtml(userName)}として)</label>
          <input type="text" name="body" maxlength="500" required autofocus>
        </div>
        <button class="btn primary" type="submit">投稿</button>
      </form>
    </div>
    ${postsHtml}`,
  });
}

module.exports = { escapeHtml, loginPage, memberPage, memberPasswordPage, adminPage, adminMemberPage, adminLibraryPage, boardPage };
