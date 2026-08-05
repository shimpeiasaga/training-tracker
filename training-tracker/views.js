// HTMLをテンプレートエンジンなしで生成する(外部依存なし)
const { MONTHLY_GOAL, REWARD_MONTHS } = require('./stats');
const CHART_JS = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout({ title, body, script = '', topbar = '' }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/style.css">
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

function topbar(label, showLogout = true) {
  return `<div class="topbar">
    <span class="brand">${label}</span>
    ${showLogout ? `<form method="POST" action="/logout"><button type="submit">ログアウト</button></form>` : ''}
  </div>`;
}

function loginPage(error) {
  return layout({
    title: 'ログイン | トレーニング記録',
    topbar: '',
    body: `
    <div class="login-wrap">
      <div class="card login-card">
        <h1>トレーニング記録</h1>
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

function gridHtml(grid) {
  return `<div class="grid">${grid
    .map((d) => {
      const dayNum = Number(d.date.slice(8, 10));
      return `<div class="day ${d.checked ? 'checked' : ''}" title="${d.date}"><span class="daynum">${dayNum}</span></div>`;
    })
    .join('')}</div>`;
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

// "2026-08-02" -> "8月2日(日)"
function formatDateJa(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const weekday = WEEKDAY_JA[d.getUTCDay()];
  return `${month}月${day}日(${weekday})`;
}

// 実施した日を新しい順に一覧表示する(「何月何日にできたか」がひと目で分かるように)
function historyListHtml(checkinDates, limit = 30) {
  if (!checkinDates.length) {
    return '<p style="font-size:0.85rem;color:var(--muted);margin:0;">まだ記録がありません</p>';
  }
  const sortedDesc = [...checkinDates].sort((a, b) => b.localeCompare(a));
  const shown = sortedDesc.slice(0, limit);
  const items = shown.map((d) => `<li>${formatDateJa(d)}</li>`).join('');
  const more = sortedDesc.length > limit ? `<p style="font-size:0.8rem;color:var(--muted);margin:8px 0 0;">他${sortedDesc.length - limit}件</p>` : '';
  return `<ul class="history-list">${items}</ul>${more}`;
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
    : ['#40916c', '#2d6a4f', '#ffb703', '#f4a261', '#e76f51', '#8ecae6'];
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
  weekCount,
  grid,
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
}) {
  const script = `
    const weekly = ${JSON.stringify(weekly)};
    new Chart(document.getElementById('weeklyChart'), {
      type: 'bar',
      data: {
        labels: weekly.map(w => w.weekStart),
        datasets: [{ label: '週の実施回数', data: weekly.map(w => w.count), backgroundColor: '#40916c' }]
      },
      options: { scales: { y: { beginAtZero: true, max: 7, ticks: { stepSize: 1 } } }, plugins: { legend: { display: false } } }
    });
    ${celebrate ? confettiScript(rewardCelebrate) : ''}`;

  const celebrateBanner = celebrate
    ? `<div class="celebrate-banner ${rewardCelebrate ? 'reward' : ''}">
        ${
          rewardCelebrate
            ? `🎁 特典ゲット!<div class="sub">月${MONTHLY_GOAL}回を${REWARD_MONTHS}ヶ月連続で達成しました。管理者に伝えて特典を受け取ってください!</div>`
            : milestoneBadge
            ? `${milestoneBadge.icon} バッジ「${escapeHtml(milestoneBadge.label)}」を獲得しました!<div class="sub">${milestoneBadge.days}日連続達成です、この調子!</div>`
            : `🎉 今日もチェック完了!<div class="sub">連続${streak}日目、いい調子です</div>`
        }
      </div>`
    : '';

  return layout({
    title: 'マイページ | トレーニング記録',
    topbar: topbar(`${escapeHtml(userName)} さん`),
    script,
    body: `
    ${celebrateBanner}

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
      <h3>直近8週間</h3>
      ${gridHtml(grid)}
    </div>

    <div class="card">
      <h3>実施した日</h3>
      ${historyListHtml(checkinDates)}
    </div>

    <div class="card">
      <h3>バッジコレクション</h3>
      ${badgeRowHtml(badges)}
      <p style="font-size:0.85rem;color:var(--muted);margin:10px 0 0;">
        ${nextBadge ? `次のバッジ「${nextBadge.icon} ${escapeHtml(nextBadge.label)}」まであと${nextBadge.days - streak}日` : 'すべてのバッジを獲得しました!すごい継続力です 👑'}
      </p>
    </div>

    <div class="card">
      <h3>🏆 今月のランキング(${ranked.length}人中)</h3>
      ${leaderboardHtml(ranked, userId)}
    </div>

    <div class="card">
      <h3>週ごとの実施回数</h3>
      <canvas id="weeklyChart" height="120"></canvas>
    </div>

    <div class="card">
      <h3>パスワード変更</h3>
      <form method="POST" action="/member/password" class="inline-form">
        <div class="form-row">
          <label>新しいパスワード(4文字以上)</label>
          <input type="password" name="newPassword" minlength="4" required>
        </div>
        <button class="btn" type="submit">変更</button>
      </form>
    </div>`,
  });
}

function adminPage({ members, teamWeekly, ranked, error, message }) {
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
        datasets: [{ label: '会員1人あたり週平均実施回数', data: teamWeekly.map(w => w.avg), borderColor: '#2d6a4f', backgroundColor: 'rgba(45,106,79,0.15)', fill: true, tension: 0.3 }]
      },
      options: { scales: { y: { beginAtZero: true, max: 7 } } }
    });`;

  return layout({
    title: '管理者ダッシュボード | トレーニング記録',
    topbar: topbar('管理者ダッシュボード'),
    script,
    body: `
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    ${message ? `<div class="message">${escapeHtml(message)}</div>` : ''}

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

function adminMemberPage({ member, streak, weekCount, total, grid, weekly, monthCount, monthlyStreak, monthlySeries, rewardsEarned, rewardsGiven, rewardsPending, badges, checkinDates }) {
  const script = `
    const weekly = ${JSON.stringify(weekly)};
    new Chart(document.getElementById('memberChart'), {
      type: 'bar',
      data: {
        labels: weekly.map(w => w.weekStart),
        datasets: [{ label: '週の実施回数', data: weekly.map(w => w.count), backgroundColor: '#40916c' }]
      },
      options: { scales: { y: { beginAtZero: true, max: 7, ticks: { stepSize: 1 } } }, plugins: { legend: { display: false } } }
    });
    const monthlySeries = ${JSON.stringify(monthlySeries)};
    new Chart(document.getElementById('monthlyChart'), {
      type: 'bar',
      data: {
        labels: monthlySeries.map(m => m.month),
        datasets: [{
          label: '月の実施回数',
          data: monthlySeries.map(m => m.count),
          backgroundColor: monthlySeries.map(m => m.achieved ? '#2d6a4f' : '#c0d6c8'),
        }]
      },
      options: { scales: { y: { beginAtZero: true, ticks: { stepSize: 2 } } }, plugins: { legend: { display: false } } }
    });`;

  return layout({
    title: `${escapeHtml(member.name)} の詳細 | トレーニング記録`,
    topbar: `<div class="topbar"><span class="brand"><a href="/admin">&larr; 管理者ダッシュボード</a></span><form method="POST" action="/logout"><button type="submit">ログアウト</button></form></div>`,
    script,
    body: `
    <div class="card">
      <h2>${escapeHtml(member.name)} さんの進捗</h2>
      <div class="stat-row">
        <div class="stat-box"><div class="num">${streak}</div><div class="label">連続日数</div></div>
        <div class="stat-box"><div class="num">${weekCount}/7</div><div class="label">今週</div></div>
        <div class="stat-box"><div class="num">${total}</div><div class="label">累計実施回数</div></div>
      </div>
      <h3>直近12週間</h3>
      ${gridHtml(grid)}
    </div>

    <div class="card">
      <h3>実施した日</h3>
      ${historyListHtml(checkinDates)}
    </div>

    <div class="card">
      <h3>バッジコレクション</h3>
      ${badgeRowHtml(badges)}
    </div>

    <div class="card">
      <h3>週ごとの実施回数</h3>
      <canvas id="memberChart" height="120"></canvas>
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

module.exports = { escapeHtml, loginPage, memberPage, adminPage, adminMemberPage };
