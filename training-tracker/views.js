// HTMLをテンプレートエンジンなしで生成する(外部依存なし)
const { MONTHLY_GOAL, REWARD_MONTHS, MAX_MEMBER_MEDIA, MAX_LIBRARY_ITEMS, DEFAULT_LIBRARY_CATEGORY, MAX_LIBRARY_CATEGORIES, STREAK_BADGES, monthKey } = require('./stats');
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

// 画像1枚ぶんの表示(base64をページに埋め込まず、専用URLから読み込む。ページを軽くし、
// ブラウザに画像だけキャッシュさせるため)。会員の動画・画像一覧は/media/、素材ライブラリは/library/から配信されるため、
// どちらのidかをsourceで区別する
function imageDisplayHtml(item, source = 'media') {
  return `<img class="media-image" src="/${source}/${item.id}/image" alt="${escapeHtml(item.title)}" loading="lazy">`;
}

// 自己完結型HTMLツール(呼吸法など)の表示。sandboxでスクリプトのみ許可し、ホスト側から隔離する
function htmlToolEmbedHtml(item) {
  return `<div class="html-embed"><iframe sandbox="allow-scripts" srcdoc="${escapeHtml(item.htmlContent || '')}"></iframe></div>`;
}

// 種類に応じた表示切り替え(動画・画像・HTMLツール)。sourceは画像の配信元('media'=会員の一覧、'library'=素材ライブラリ)
function mediaEmbedHtml(item, source = 'media') {
  if (item.type === 'image') return imageDisplayHtml(item, source);
  if (item.type === 'html') return htmlToolEmbedHtml(item);
  return videoPlayerHtml(item);
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
              ? `<div class="video-item-actions">
                  <form method="POST" action="/admin/members/${memberId}/media/${v.id}/move" style="display:inline;">
                    <input type="hidden" name="direction" value="up">
                    <button class="btn" type="submit" title="上に移動" ${i === 0 ? 'disabled' : ''}>▲</button>
                  </form>
                  <form method="POST" action="/admin/members/${memberId}/media/${v.id}/move" style="display:inline;">
                    <input type="hidden" name="direction" value="down">
                    <button class="btn" type="submit" title="下に移動" ${i === media.length - 1 ? 'disabled' : ''}>▼</button>
                  </form>
                  <form method="POST" action="/admin/members/${memberId}/media/${v.id}/delete" onsubmit="return confirm('削除しますか?');" style="display:inline;">
                    <button class="btn danger" type="submit">削除</button>
                  </form>
                </div>`
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
        ${mediaEmbedHtml(v)}
      </div>`
    )
    .join('');
  return `<div class="video-list">${items}</div>`;
}

// ライブラリ選択欄用の小さいサムネイル(画像はミニ画像、動画・HTMLツールはアイコン)
function libraryThumbHtml(v) {
  if (v.type === 'image') {
    return `<img class="lib-pick-thumb" src="/library/${v.id}/image" alt="" loading="lazy">`;
  }
  const icon = v.type === 'html' ? '🧘' : '🎥';
  return `<div class="lib-pick-thumb lib-pick-icon">${icon}</div>`;
}

// カテゴリー一覧(管理画面で登録された順)の<option>一覧(selectedを選択状態にする)
function categoryOptionsHtml(selected, categories) {
  return categories
    .map((c) => `<option value="${escapeHtml(c)}" ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`)
    .join('');
}

// 素材をカテゴリー(渡されたcategoriesの順)ごとにグループ分けする。未設定・不正な値は「その他」扱い
function groupLibraryByCategory(library, categories) {
  const groups = new Map(categories.map((c) => [c, []]));
  if (!groups.has(DEFAULT_LIBRARY_CATEGORY)) groups.set(DEFAULT_LIBRARY_CATEGORY, []);
  library.forEach((v) => {
    const cat = groups.has(v.category) ? v.category : DEFAULT_LIBRARY_CATEGORY;
    groups.get(cat).push(v);
  });
  return Array.from(groups.entries()).filter(([, items]) => items.length);
}

// 素材ライブラリの一覧表示。mode='manage'は削除ボタン・カテゴリー変更付きでフルサイズ表示(ライブラリ管理画面用)、
// mode='pick'はサムネイル+タイトルのみのコンパクトな行表示(会員詳細画面の選択欄用)。どちらもカテゴリーごとに見出しを付けて表示する
function libraryListHtml(library, { mode = 'manage', memberId, categories = [] } = {}) {
  if (!library || !library.length) {
    return '<p style="font-size:0.85rem;color:var(--muted);margin:0;">まだライブラリに素材がありません</p>';
  }
  const groups = groupLibraryByCategory(library, categories);

  if (mode === 'pick') {
    return groups
      .map(
        ([cat, items]) => `
        <details class="lib-category-group">
          <summary class="lib-category-heading">${escapeHtml(cat)}(${items.length})</summary>
          <div class="lib-pick-list" style="margin-top:10px;">
            ${items
              .map(
                (v) => `
              <details class="lib-pick-item">
                <summary class="lib-pick-row">
                  ${libraryThumbHtml(v)}
                  <div class="lib-pick-title">${escapeHtml(v.title)}</div>
                  <span class="lib-pick-preview-hint">タップで確認</span>
                </summary>
                <div class="lib-pick-preview">${mediaEmbedHtml(v, 'library')}</div>
                <form method="POST" action="/admin/members/${memberId}/media/from-library/${v.id}" class="lib-pick-form">
                  <input type="text" name="note" maxlength="200" placeholder="セット数・回数(任意)">
                  <button class="btn primary" type="submit">追加</button>
                </form>
              </details>`
              )
              .join('')}
          </div>
        </details>`
      )
      .join('');
  }

  return groups
    .map(
      ([cat, items]) => `
      <details class="lib-category-group">
        <summary class="lib-category-heading">${escapeHtml(cat)}(${items.length})</summary>
        <div class="video-list" style="margin-top:10px;">
          ${items
            .map(
              (v) => `
            <div class="video-item">
              <div class="video-item-head">
                <h4>${v.type === 'image' ? '📷' : v.type === 'html' ? '🧘' : '🎥'} ${escapeHtml(v.title)}</h4>
                <form method="POST" action="/admin/library/${v.id}/delete" onsubmit="return confirm('ライブラリから削除しますか?(会員に既に追加済みの分は残ります)');">
                  <button class="btn danger" type="submit">削除</button>
                </form>
              </div>
              <details class="history-note-edit" style="margin-bottom:8px;">
                <summary>カテゴリーを変更(現在: ${escapeHtml(cat)})</summary>
                <form method="POST" action="/admin/library/${v.id}/category" class="inline-form">
                  <div class="form-row">
                    <select name="category">${categoryOptionsHtml(cat, categories)}</select>
                  </div>
                  <button class="btn" type="submit">変更</button>
                </form>
              </details>
              ${mediaEmbedHtml(v, 'library')}
            </div>`
            )
            .join('')}
        </div>
      </details>`
    )
    .join('');
}

function layout({ title, body, script = '', topbar = '', extraScript = '' }) {
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
<script>${BUTTON_LOADING_SCRIPT}</script>
<script>${SCROLL_RESTORE_SCRIPT}</script>
<script>${MESSAGE_SCROLL_SCRIPT}</script>
${extraScript ? `<script>${extraScript}</script>` : ''}
</body>
</html>`;
}

// ボタンを押した直後、通信のラグで「押せているか分からない」状態を防ぐため、
// 送信ボタンを一時的に無効化してテキストを変える(全ページ共通)。
// メッセージ送信系のボタン(文言が「送信」)だけは「送信中...」、それ以外は「処理中...」にする
const BUTTON_LOADING_SCRIPT = `
document.addEventListener('submit', function (e) {
  // confirm()で「キャンセル」された送信(削除確認など)はここでdefaultPreventedになるので何もしない。
  // バブリング(通常)フェーズで判定することで、confirm()ダイアログの表示より後に確定させている
  if (e.defaultPrevented) return;
  var form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  var btn = form.querySelector('button[type="submit"], button:not([type])');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.dataset.originalText = btn.textContent;
  btn.textContent = btn.textContent.trim() === '送信' ? '送信中...' : '処理中...';
});

// フォームの送信ボタン以外(「詳細」などリンクの<a class="btn">、更新ボタンなど)も
// クリック直後に見た目を変えて「押せている」ことが分かるようにする
document.addEventListener('click', function (e) {
  var link = e.target.closest('a.btn');
  if (!link || link.target === '_blank' || link.dataset.loading === '1') return;
  link.dataset.loading = '1';
  var original = link.textContent;
  link.style.opacity = '0.6';
  link.textContent = '読み込み中...';
  // ダウンロードリンクなどページ移動が起きないケースのために、少し経ったら元に戻す
  setTimeout(function () {
    link.style.opacity = '';
    link.textContent = original;
    link.dataset.loading = '';
  }, 4000);
}, true);
`;

// ボタンを押して画面が更新されても、押す前のスクロール位置をできるだけ保つ(ページが上に戻ってしまうのを防ぐ)
const SCROLL_RESTORE_SCRIPT = `
(function () {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  var key = 'scrollY_' + location.pathname;
  // URLに#video/#messages/#historyなどが付いている場合は、ブラウザ標準のジャンプ機能に任せる。
  // そちらの方がセクションの高さが変わっても正しい位置に着地できるため、
  // ここでの座標(px)復元は行わない(行うと標準ジャンプと競合してズレる)
  if (!location.hash) {
    var savedY = sessionStorage.getItem(key);
    if (savedY !== null) {
      sessionStorage.removeItem(key);
      var y = parseInt(savedY, 10);
      var restore = function () { window.scrollTo(0, y); };
      restore();
      requestAnimationFrame(restore);
      setTimeout(restore, 0);
      setTimeout(restore, 150);
      window.addEventListener('load', restore);
    }
  } else {
    sessionStorage.removeItem(key);
  }
  document.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    sessionStorage.setItem(key, window.scrollY);
  });
})();
`;

// メッセージ欄(.msg-thread)は開いた時点で最新のメッセージが見えるよう、常に一番下にスクロールしておく。
// 過去のメッセージは、その枠内を上にスクロールすれば見られる(ページ全体のスクロールとは別)
const MESSAGE_SCROLL_SCRIPT = `
(function () {
  function scrollThreadsToBottom() {
    document.querySelectorAll('.msg-thread').forEach(function (el) {
      el.scrollTop = el.scrollHeight;
    });
  }
  scrollThreadsToBottom();
  requestAnimationFrame(scrollThreadsToBottom);
  window.addEventListener('load', scrollThreadsToBottom);
})();
`;

// 専用トレーニングの並び替え(▲▼)専用: ページ全体を再読み込みせず、その場で順番を入れ替える。
// これにより、並び替えのたびにスクロール位置が上に戻ってしまう問題を根本的に避けられる
const MEDIA_REORDER_SCRIPT = `
(function () {
  var CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    var action = form.getAttribute('action') || '';
    if (!/\\/media\\/\\d+\\/move$/.test(action)) return;
    var item = form.closest('.video-item');
    var dirInput = form.querySelector('input[name="direction"]');
    var direction = dirInput ? dirInput.value : 'down';
    if (!item) return;
    var list = item.parentElement;
    var sibling = direction === 'up' ? item.previousElementSibling : item.nextElementSibling;
    if (!sibling) return;
    e.preventDefault();
    fetch(action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'direction=' + direction,
      credentials: 'same-origin',
    })
      .then(function (res) {
        if (!res.ok) throw new Error('failed');
        if (direction === 'up') {
          list.insertBefore(item, sibling);
        } else {
          list.insertBefore(sibling, item);
        }
        var items = list.querySelectorAll('.video-item');
        items.forEach(function (el, i) {
          var h4 = el.querySelector('.video-item-head h4');
          if (h4) {
            var title = h4.textContent.replace(/^\\S+\\s/, '');
            h4.textContent = (CIRCLED[i] || i + 1) + ' ' + title;
          }
          var upBtn = el.querySelector('button[title="上に移動"]');
          var downBtn = el.querySelector('button[title="下に移動"]');
          if (upBtn) upBtn.disabled = i === 0;
          if (downBtn) downBtn.disabled = i === items.length - 1;
        });
      })
      .catch(function () {
        location.reload();
      });
  });
})();
`;

// 会員TOPページ専用: 下に引っ張って更新するジェスチャー(プルアンドフレッシュ)
// 「引っ張り中」かどうかはtouchstartの時点(スクロール位置が一番上)だけで判定する。
// 途中のtouchmoveのたびにwindow.scrollYを再チェックしていると、インジケーターの高さが
// 変わることによる端末側の微妙なスクロール位置のブレで「引っ張り中」判定が途切れてしまい、
// 「離して更新」の表示は出るのに指を離しても更新が始まらない、という不具合につながっていた
const PULL_TO_REFRESH_SCRIPT = `
(function () {
  var threshold = 70;
  var pulling = false;
  var startY = 0;
  var currentPull = 0;
  var indicator = document.createElement('div');
  indicator.className = 'ptr-indicator';
  indicator.textContent = '↓ 引っ張って更新';
  document.body.insertBefore(indicator, document.body.firstChild);
  function resetIndicator() {
    currentPull = 0;
    indicator.style.height = '0px';
    indicator.style.opacity = '0';
    indicator.textContent = '↓ 引っ張って更新';
  }
  document.addEventListener('touchstart', function (e) {
    if (window.scrollY === 0) {
      startY = e.touches[0].clientY;
      pulling = true;
      currentPull = 0;
    }
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!pulling) return;
    var diff = e.touches[0].clientY - startY;
    if (diff <= 0) {
      // 指を戻した場合は見た目だけ縮めておく(引っ張り自体はtouchendまで継続扱いにする)
      resetIndicator();
      return;
    }
    currentPull = Math.min(diff, 100);
    indicator.style.height = currentPull + 'px';
    indicator.style.opacity = Math.min(currentPull / threshold, 1);
    indicator.textContent = currentPull > threshold ? '↑ 離して更新' : '↓ 引っ張って更新';
  }, { passive: true });
  function finishPull() {
    if (!pulling) return;
    pulling = false;
    if (currentPull > threshold) {
      indicator.textContent = '更新中...';
      indicator.style.height = '40px';
      indicator.style.opacity = '1';
      location.reload();
    } else {
      resetIndicator();
    }
  }
  document.addEventListener('touchend', finishPull, { passive: true });
  document.addEventListener('touchcancel', finishPull, { passive: true });
})();
`;

// 管理画面の共通トップバー(更新ボタン付き)。backHrefを指定すると「← ラベル」のリンクになる
const ADMIN_REFRESH_BTN = `<button type="button" class="btn" onclick="this.disabled=true;this.textContent='更新中...';location.reload();" title="最新の情報に更新します">🔄 更新</button>`;
function adminTopbar(label, backHref = '') {
  return `<div class="topbar">
    <span class="brand">${backHref ? `<a href="${backHref}">&larr; ${escapeHtml(label)}</a>` : escapeHtml(label)}</span>
    <div class="topbar-actions">
      <a href="/guide">📖 使い方ガイド</a>
      <a href="/board">💬 みんなの掲示板</a>
      ${ADMIN_REFRESH_BTN}
      <form method="POST" action="/logout"><button type="submit">ログアウト</button></form>
    </div>
  </div>`;
}

// ページ末尾に右寄せで置く「みんなの掲示板」へのリンク(会員側ページで使用)
const BOARD_LINK_FOOTER = `<div class="board-link-footer"><a href="/board">💬 みんなの掲示板</a></div>`;

function topbar(label, showLogout = true, showSiteTitle = false, settingsMenu = '') {
  return `<div class="topbar">
    <span class="brand" style="display:flex;align-items:center;gap:8px;">
      ${
        settingsMenu
          ? `<details class="topbar-settings">
              <summary title="設定">⚙️</summary>
              <div class="topbar-settings-menu">${settingsMenu}</div>
            </details>`
          : ''
      }
      <span>
        ${showSiteTitle ? `<span style="display:block;font-size:0.72rem;font-weight:400;opacity:0.85;line-height:1.4;">オンライン運動元気倶楽部</span>` : ''}
        <span style="display:block;">${label}</span>
      </span>
    </span>
    <div class="topbar-actions">
      <a href="/guide">📖 使い方ガイド</a>
      ${showLogout ? `<form method="POST" action="/logout"><button type="submit">ログアウト</button></form>` : ''}
    </div>
  </div>`;
}

// ガイド内の1項目(見出し+説明文)
function guideItem(title, body) {
  return `<div class="guide-item"><h4>${title}</h4><p>${body}</p></div>`;
}

// サイトの使い方ガイド。会員には会員向けの案内のみ、管理者には管理者向けの案内も追加で表示する
function guidePage(userRole) {
  const memberItems = [
    guideItem('✅ 毎日のチェック', 'トップページの「トレーニング完了をチェック」ボタンを押すと、その日の実施が記録されます。間違えて押した時は、もう一度押すと取り消せます。'),
    guideItem('🎥 専用トレーニング', '担当のアドバイザーが登録してくれた動画・画像・呼吸法ツールを確認しながら取り組めます。セット数や回数の目安が書かれている場合はその下に表示されます。'),
    guideItem('📅 カレンダー・実施記録', '過去に実施した日をカレンダーで振り返れます。実施した日の記録は日付をタップすると、その日のメモを自由に書き込めます。'),
    guideItem('🏅 バッジ(ランク)', '累計の実施日数に応じて、ビギナーからレジェンドまでバッジが増えていきます。新しいバッジを獲得するとお祝いメッセージが表示されます。'),
    guideItem('🎁 メニュー更新特典', '月の目標回数を3ヶ月連続で達成すると、メニュー更新の特典が受けられます。進み具合はトップページで確認できます。'),
    guideItem('📩 メッセージ', 'アドバイザーに直接メッセージを送れます。やり取りは常に一番新しいものが見える状態で開きます。過去のものは枠内を上にスクロールすると読めます。'),
    guideItem('🏆 ランキング', '今月の実施回数の順位(上位3名)を確認できます。'),
    guideItem('⚙️ 設定', '「設定」を開くと、会員ページに表示する名前(表示名)やログインパスワードを自分で変更できます。'),
    guideItem('💬 みんなの掲示板', '会員同士が自由に投稿・交流できる場所です。返信ができるのはアドバイザー(管理者)のみです。'),
  ].join('');

  const adminItems = userRole === 'admin'
    ? [
        guideItem('👤 会員の追加', 'ダッシュボード下部の「会員を追加」から、名前・ユーザー名・初期パスワードを入力して登録します。ユーザー名とパスワードは会員本人に伝えてください。'),
        guideItem('📋 会員詳細ページ', '会員一覧の「詳細」から個別ページに移動できます。進捗の確認、専用トレーニングの登録、メッセージのやり取りはすべてここから行います。'),
        guideItem('🎥 専用トレーニングの登録', '会員詳細ページから動画(YouTubeリンクなど)・画像・呼吸法などのHTMLツールを追加できます。▲▼ボタンで表示順を入れ替えたり、「セット数・回数を編集」からメモ(例: 3セット×10回)を追加・修正できます。'),
        guideItem('🎥📷 素材ライブラリ', 'よく使う動画・画像をあらかじめ登録しておける置き場です。会員ごとに毎回アップロードし直さなくても、ライブラリから選んで配布できます。'),
        guideItem('🚫 ランキングから除外', 'スタッフのテスト用アカウントなど、ランキングに表示したくない会員は、会員詳細ページのチェックボックスで除外できます。'),
        guideItem('🎁 特典を渡す', '目標を連続達成した会員には一覧に「特典を渡す」ボタンが表示されます。実際に特典を渡したらボタンを押して記録してください。'),
        guideItem('🎉 ランクアップお祝いメッセージ', 'ダッシュボードの「ランクアップ時のお祝いメッセージ」から、バッジ獲得時に表示する一言メッセージをバッジごとに設定できます。'),
        guideItem('📩 メッセージ対応', '会員から届いたメッセージに返信できます。新着があるとダッシュボード上部に通知が表示されます。'),
        guideItem('💾 バックアップ', '1日1回自動でバックアップが保存され、直近14日分をいつでもダウンロードできます。手動ですぐに保存したい時は「今すぐダウンロード」を押してください。'),
        guideItem('🔄 更新ボタン', '画面右上の「🔄 更新」を押すと、最新の状態に読み込み直せます。'),
      ].join('')
    : '';

  return layout({
    title: '使い方ガイド | オンライン運動元気倶楽部',
    topbar: `<div class="topbar"><span class="brand"><a href="${userRole === 'admin' ? '/admin' : '/member'}">&larr; 戻る</a></span>${
      userRole === 'admin' ? '<div class="topbar-actions"><a href="/board">💬 みんなの掲示板</a></div>' : ''
    }</div>`,
    body: `
    <div class="card">
      <h2>📖 使い方ガイド</h2>
      <p style="font-size:0.9rem;color:var(--muted);margin:0;">オンライン運動元気倶楽部の基本的な使い方をまとめています。</p>
    </div>

    <div class="card">
      <h3>🙋 会員のみなさんへ</h3>
      ${memberItems}
    </div>

    ${userRole === 'admin' ? `<div class="card"><h3>🛠 管理者のみなさんへ</h3>${adminItems}</div>` : ''}

    <div class="card">
      <h3>📱 ホーム画面に追加する方法</h3>
      <p style="font-size:0.9rem;color:var(--muted);margin:0 0 12px;">ホーム画面に追加しておくと、アプリのようにアイコンをタップするだけで開けるようになります。</p>
      <div class="guide-item">
        <h4>🍎 iPhone(Safari)の場合</h4>
        <ol style="margin:8px 0 0;padding-left:20px;font-size:0.88rem;color:var(--text);line-height:1.8;">
          <li>Safariでこのサイトを開く</li>
          <li>「共有」ボタン(四角から上に矢印が出ているマーク)をタップ。画面下にある場合と、上のURL欄の右横にある場合があります</li>
          <li>出てきたメニューを下にスクロールして「ホーム画面に追加」をタップ</li>
          <li>右上の「追加」をタップすれば完了です</li>
        </ol>
      </div>
      <div class="guide-item">
        <h4>🤖 Androidの場合</h4>
        <ol style="margin:8px 0 0;padding-left:20px;font-size:0.88rem;color:var(--text);line-height:1.8;">
          <li>Chromeでこのサイトを開く</li>
          <li>右上にある「⋮」(縦に3つ並んだ点)のメニューをタップ</li>
          <li>「ホーム画面に追加」または「アプリをインストール」をタップ</li>
          <li>表示された「追加」または「インストール」をタップすれば完了です</li>
        </ol>
      </div>
    </div>

    ${userRole === 'admin' ? '' : BOARD_LINK_FOOTER}`,
  });
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
// 実施した日の一覧を月ごとにグループ化し、それぞれ折りたたみ表示にする(直近の月だけ開いた状態)
function historyListHtml(checkinRecords, { editable = false } = {}) {
  if (!checkinRecords.length) {
    return '<p style="font-size:0.85rem;color:var(--muted);margin:0;">まだ記録がありません</p>';
  }
  const sortedDesc = [...checkinRecords].sort((a, b) => b.date.localeCompare(a.date));
  const groups = [];
  const groupByMonth = new Map();
  sortedDesc.forEach((c) => {
    const mKey = monthKey(c.date);
    let group = groupByMonth.get(mKey);
    if (!group) {
      group = { month: mKey, records: [] };
      groupByMonth.set(mKey, group);
      groups.push(group);
    }
    group.records.push(c);
  });

  const dayItemHtml = (c) => {
    const note = c.note || '';
    if (editable) {
      return `
      <li>
        <details class="history-item">
          <summary class="history-date">
            <span>${formatDateJa(c.date)}</span>
            ${note ? `<span class="history-note-preview">${escapeHtml(note)}</span>` : ''}
          </summary>
          <form method="POST" action="/member/checkins/${c.date}/note" class="inline-form" style="margin-top:8px;">
            <div class="form-row">
              <textarea name="note" rows="2" maxlength="300" placeholder="例: スクワット3セット×10回、ベンチプレス...">${escapeHtml(note)}</textarea>
            </div>
            <button class="btn" type="submit">保存</button>
          </form>
        </details>
      </li>`;
    }
    return `
    <li>
      <div class="history-row">
        <span>${formatDateJa(c.date)}</span>
        ${note ? `<div class="history-note">${escapeHtml(note)}</div>` : ''}
      </div>
    </li>`;
  };

  return groups
    .map(
      (g, i) => `
    <details class="lib-category-group" ${i === 0 ? 'open' : ''}>
      <summary class="lib-category-heading">${formatMonthJa(g.month)} <span style="font-weight:400;opacity:0.85;">(${g.records.length}回)</span></summary>
      <ul class="history-list">${g.records.map(dayItemHtml).join('')}</ul>
    </details>`
    )
    .join('');
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

// 月間目標をrewardMonths連続で達成すると「メニュー更新」の対象になる、という進捗をスタンプカード風に見せる
// (達成した月にはハンコ(✓)が押され、間の線もつながって進み具合がひと目で分かる)
function menuUpdateCardHtml({ monthlyStreak, rewardMonths }) {
  const cyclePos = monthlyStreak % rewardMonths;
  const completed = cyclePos === 0 && monthlyStreak > 0 ? rewardMonths : cyclePos;
  const remaining = rewardMonths - completed;

  const circleParts = [];
  const labelParts = [];
  for (let i = 0; i < rewardMonths; i++) {
    const filled = i < completed;
    circleParts.push(`<div class="stampA ${filled ? 'filled' : ''}">${filled ? '✓' : i + 1}</div>`);
    labelParts.push(`<div class="stampA-label ${filled ? 'done' : ''}">${i + 1}ヶ月目</div>`);
    if (i < rewardMonths - 1) {
      const lineFilled = i + 1 < completed;
      circleParts.push(`<div class="stampA-line ${lineFilled ? 'filled' : ''}"></div>`);
      labelParts.push('<div class="stampA-spacer"></div>');
    }
  }

  const achieved = completed >= rewardMonths;
  const message = achieved
    ? `🎉 ${rewardMonths}ヶ月連続で目標を達成しました!メニュー更新のチャンスです。アドバイザーにご相談ください。`
    : `あと${remaining}ヶ月連続で目標を達成すると、メニュー更新のチャンスです!`;

  return `
    <div class="stampA-row">${circleParts.join('')}</div>
    <div class="stampA-labels">${labelParts.join('')}</div>
    <p class="stamp-msg ${achieved ? 'celebrate' : ''}">${message}</p>
    <p style="font-size:0.8rem;color:var(--muted);margin:8px 0 0;">月${MONTHLY_GOAL}回の実施を${rewardMonths}ヶ月連続で達成すると、メニュー更新1回の対象になります。以降も継続すれば${rewardMonths}ヶ月ごとに繰り返し対象になります。</p>`;
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
  rankUpMessages = {},
}) {
  const script = `
    ${celebrate ? confettiScript(rewardCelebrate) : ''}`;

  // ランクアップ時のメッセージ: 基本の文言は固定、バッジごとに管理画面で入力した一言があれば下に追加表示する
  const rankUpMessageTemplate = milestoneBadge ? rankUpMessages[milestoneBadge.days] || '' : '';
  const milestoneMessageHtml = milestoneBadge
    ? `${milestoneBadge.icon} バッジ「${escapeHtml(milestoneBadge.label)}」を獲得しました!<div class="sub">累計${milestoneBadge.days}日達成です、この調子!${
        rankUpMessageTemplate ? `<br>${escapeHtml(rankUpMessageTemplate)}` : ''
      }</div>`
    : '';

  const celebrateBanner = celebrate
    ? `<div class="celebrate-banner ${rewardCelebrate ? 'reward' : ''}">
        ${
          rewardCelebrate
            ? `🎁 特典ゲット!<div class="sub">月${MONTHLY_GOAL}回を${REWARD_MONTHS}ヶ月連続で達成しました。管理者に伝えて特典を受け取ってください!</div>`
            : milestoneBadge
            ? milestoneMessageHtml
            : `🎉 今日もチェック完了!<div class="sub">連続${streak}日目、いい調子です</div>`
        }
      </div>`
    : '';

  const unreadBanner = hasUnreadMessages
    ? `<a href="#messages" class="notice-banner">📩 アドバイザーから新着メッセージがあります</a>`
    : '';

  return layout({
    title: 'マイページ | オンライン運動元気倶楽部',
    topbar: topbar(`${escapeHtml(userName)} さん`, false, true),
    script,
    extraScript: PULL_TO_REFRESH_SCRIPT,
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
      <details class="lib-category-group" style="margin-top:14px;">
        <summary class="lib-category-heading">🎖 ランクアップ履歴</summary>
        ${badgeLogHtml(badgeLog)}
      </details>
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
      <h3>今月の目標🏋️(月${monthGoal}回)</h3>
      ${monthlyProgressHtml({ monthCount, monthGoal, monthlyStreak, rewardMonths })}
    </div>

    <div class="card">
      <h3>メニュー更新特典🎁</h3>
      ${menuUpdateCardHtml({ monthlyStreak, rewardMonths })}
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
      <p style="font-size:0.8rem;color:var(--muted);margin:0 0 8px;">日付をタップするとメモを自由に追加、編集できます</p>
      ${historyListHtml(checkinRecords, { editable: true })}
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
      <h3>🏆 今月のランキング(上位3名掲載)</h3>
      ${leaderboardHtml(ranked, userId)}
    </div>

    <div class="card">
      <details class="settings-collapse">
        <summary class="btn">設定</summary>
        <div class="settings-collapse-menu">
          <form method="POST" action="/member/display-name" class="inline-form" style="margin:0;">
            <div class="form-row">
              <label>表示名</label>
              <input type="text" name="displayName" maxlength="20" value="${escapeHtml(userName)}" required>
            </div>
            <button class="btn" type="submit">表示名を保存</button>
          </form>
          <a class="btn" href="/member/password">パスワード変更</a>
          <form method="POST" action="/logout"><button class="btn" type="submit">ログアウト</button></form>
        </div>
      </details>
    </div>
    ${BOARD_LINK_FOOTER}`,
  });
}

function memberPasswordPage({ userName, error, message }) {
  return layout({
    title: 'パスワード変更 | オンライン運動元気倶楽部',
    topbar: `<div class="topbar"><span class="brand"><a href="/member">&larr; 戻る</a></span><div class="topbar-actions"><a href="/guide">📖 使い方ガイド</a><form method="POST" action="/logout"><button type="submit">ログアウト</button></form></div></div>`,
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
    </div>
    ${BOARD_LINK_FOOTER}`,
  });
}

function adminPage({ members, ranked, error, message, unreadMembers = [], rankUpMessages = {}, backups = [] }) {
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

  return layout({
    title: '管理者ダッシュボード | オンライン運動元気倶楽部',
    topbar: adminTopbar('管理者ダッシュボード'),
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
      ${ranked.length ? leaderboardHtml(ranked, null, ranked.length) : '<p style="font-size:0.85rem;color:var(--muted);margin:0;">まだデータがありません</p>'}
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
      <h3>会員を追加</h3>
      <form method="POST" action="/admin/members" class="inline-form">
        <div class="form-row"><label>名前</label><input type="text" name="name" required></div>
        <div class="form-row"><label>ユーザー名</label><input type="text" name="username" required></div>
        <div class="form-row"><label>初期パスワード</label><input type="text" name="password" required minlength="4"></div>
        <button class="btn primary" type="submit">追加</button>
      </form>
    </div>

    <div class="card">
      <h3>🎉 ランクアップ時のお祝いメッセージ</h3>
      <p style="font-size:0.85rem;color:var(--muted);margin:0 0 12px;">
        会員がバッジ(ランク)を新しく獲得した時のお祝い画面に、バッジごとに一言メッセージを追加できます。ここに入力した言葉がそのまま追加で表示されます(空欄ならそのバッジには追加なし)。
      </p>
      <form method="POST" action="/admin/settings/rank-up-message" class="inline-form">
        ${STREAK_BADGES.map(
          (b) => `
        <div class="form-row">
          <label>${b.icon} ${escapeHtml(b.label)}(${b.days}日)</label>
          <input type="text" name="rankUpMessage_${b.days}" maxlength="100" value="${escapeHtml(rankUpMessages[b.days] || '')}" placeholder="例: よく頑張りました!この調子で続けましょう">
        </div>`
        ).join('')}
        <button class="btn primary" type="submit">保存</button>
      </form>
    </div>

    <div class="card">
      <h3>データのバックアップ</h3>
      <p style="font-size:0.85rem;color:var(--muted);margin:0 0 12px;">
        1日1回、自動でバックアップが保存されます(直近14日分)。ダウンロードは手動でいつでもできます。
      </p>
      <a class="btn" href="/admin/backup" style="display:inline-block;margin-bottom:14px;">⬇ 今すぐダウンロード</a>
      ${
        backups.length
          ? `<div class="table-wrap">
              <table>
                <thead><tr><th>日付</th><th></th></tr></thead>
                <tbody>
                  ${backups
                    .map(
                      (b) => `
                  <tr>
                    <td>${formatDateJa(b.date)}</td>
                    <td><a class="btn" href="/admin/backups/${b.id}">⬇ ダウンロード</a></td>
                  </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          : `<p style="font-size:0.85rem;color:var(--muted);margin:0;">自動バックアップはまだありません(アクセスすると当日分が作成されます)</p>`
      }
    </div>`,
  });
}

function adminMemberPage({ member, streak, weekCount, total, grid, monthKeyForGrid, prevMonthKey, nextMonthKey, calendarBasePath, weekly, monthCount, monthlyStreak, monthlySeries, rewardsEarned, rewardsGiven, rewardsPending, badges, checkinDates, checkinRecords, badgeLog, messages, media, library, categories, videoError, hadUnreadMessages }) {
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
    topbar: adminTopbar('管理者ダッシュボード', '/admin'),
    script,
    extraScript: MEDIA_REORDER_SCRIPT,
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
      <div class="calendar-compact">
        ${calendarNavHtml(calendarBasePath, prevMonthKey, nextMonthKey)}
        ${gridHtml(grid)}
      </div>
      <form method="POST" action="/admin/members/${member.id}/exclude-ranking" style="margin-top:14px;" onchange="this.requestSubmit()">
        <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;color:var(--muted);cursor:pointer;">
          <input type="checkbox" name="excluded" value="1" ${member.excludeFromRanking ? 'checked' : ''}>
          ランキングに表示しない(スタッフのテスト用アカウントなど)
        </label>
      </form>
    </div>

    <div class="card">
      <h3>実施した日</h3>
      ${historyListHtml(checkinRecords)}
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
      <h3>バッジコレクション</h3>
      ${badgeRowHtml(badges)}
      <details class="lib-category-group" style="margin-top:14px;">
        <summary class="lib-category-heading">🎖 ランクアップ履歴</summary>
        ${badgeLogHtml(badgeLog)}
      </details>
    </div>

    <div class="card" id="video">
      <h3>🎥📷 この会員専用の動画・画像(${(media || []).length}/${MAX_MEMBER_MEDIA})</h3>
      ${videoError ? `<div class="error">${escapeHtml(videoError)}</div>` : ''}
      ${mediaListHtml(media, { deletable: true, memberId: member.id })}
      ${
        (media || []).length < MAX_MEMBER_MEDIA
          ? `<details style="margin-top:12px;">
              <summary style="cursor:pointer;color:var(--primary);font-size:0.9rem;">📚 ライブラリから選んで追加</summary>
              <div style="margin-top:10px;">${libraryListHtml(library, { mode: 'pick', memberId: member.id, categories })}</div>
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
            </form>
            <form method="POST" action="/admin/members/${member.id}/media/html" enctype="multipart/form-data" class="inline-form" style="margin-top:12px;">
              <div class="form-row">
                <label>HTMLツール タイトル</label>
                <input type="text" name="title" maxlength="60" required placeholder="例: 呼吸法トレーニング">
              </div>
              <div class="form-row">
                <label>HTMLファイル(.html、500KBまで)</label>
                <input type="file" name="htmlFile" accept=".html,.htm" required>
              </div>
              <div class="form-row">
                <label>セット数・回数(任意)</label>
                <input type="text" name="note" maxlength="200" placeholder="例: 1日3回">
              </div>
              <button class="btn primary" type="submit">HTMLツールを追加</button>
            </form>`
          : `<p style="font-size:0.85rem;color:var(--muted);margin-top:12px;">上限の${MAX_MEMBER_MEDIA}件に達しています。追加するには先に削除してください。</p>`
      }
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
// カテゴリーの追加・名前変更・削除を行う管理カード(「その他」は既定カテゴリーとして変更・削除不可)
function categoryManageCardHtml(categories) {
  const rows = categories
    .map(
      (c) => `
      <div class="lib-category-manage-row">
        <span class="lib-category-manage-name">${escapeHtml(c)}</span>
        ${
          c === DEFAULT_LIBRARY_CATEGORY
            ? '<span class="lib-category-manage-fixed">既定・変更不可</span>'
            : `<details class="history-note-edit">
                <summary>名前を変更</summary>
                <form method="POST" action="/admin/library/categories/rename" class="inline-form">
                  <input type="hidden" name="oldName" value="${escapeHtml(c)}">
                  <div class="form-row"><input type="text" name="newName" maxlength="20" value="${escapeHtml(c)}" required></div>
                  <button class="btn" type="submit">変更</button>
                </form>
              </details>
              <form method="POST" action="/admin/library/categories/delete" onsubmit="return confirm('「${escapeHtml(c)}」を削除しますか?このカテゴリーの素材は「その他」に移動します。');">
                <input type="hidden" name="name" value="${escapeHtml(c)}">
                <button class="btn danger" type="submit">削除</button>
              </form>`
        }
      </div>`
    )
    .join('');
  const addForm =
    categories.length < MAX_LIBRARY_CATEGORIES
      ? `<form method="POST" action="/admin/library/categories/add" class="inline-form" style="margin-top:12px;">
          <div class="form-row">
            <label>新しいカテゴリー名</label>
            <input type="text" name="name" maxlength="20" required placeholder="例: 有酸素">
          </div>
          <button class="btn primary" type="submit">追加</button>
        </form>`
      : `<p style="font-size:0.85rem;color:var(--muted);margin-top:12px;">カテゴリーは最大${MAX_LIBRARY_CATEGORIES}件までです。</p>`;
  return `<div class="lib-category-manage-list">${rows}</div>${addForm}`;
}

function adminLibraryPage({ library, categories = [], error }) {
  return layout({
    title: '素材ライブラリ | オンライン運動元気倶楽部',
    topbar: adminTopbar('管理者ダッシュボード', '/admin'),
    body: `
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}

    <div class="card">
      <h3>カテゴリーの管理</h3>
      ${categoryManageCardHtml(categories)}
    </div>

    <div class="card">
      <h2>📚 素材ライブラリ(${(library || []).length}/${MAX_LIBRARY_ITEMS})</h2>
      <p style="font-size:0.85rem;color:var(--muted);margin:0 0 12px;">ここに登録した動画・画像は、各会員の詳細ページから選んで追加できます。</p>
      ${libraryListHtml(library, { mode: 'manage', categories })}
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
              <div class="form-row">
                <label>カテゴリー</label>
                <select name="category">${categoryOptionsHtml(DEFAULT_LIBRARY_CATEGORY, categories)}</select>
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
              <div class="form-row">
                <label>カテゴリー</label>
                <select name="category">${categoryOptionsHtml(DEFAULT_LIBRARY_CATEGORY, categories)}</select>
              </div>
              <button class="btn primary" type="submit">画像を追加</button>
            </form>
            <form method="POST" action="/admin/library/html" enctype="multipart/form-data" class="inline-form" style="margin-top:12px;">
              <div class="form-row">
                <label>HTMLツール タイトル</label>
                <input type="text" name="title" maxlength="60" required placeholder="例: 呼吸法トレーニング">
              </div>
              <div class="form-row">
                <label>HTMLファイル(.html、500KBまで)</label>
                <input type="file" name="htmlFile" accept=".html,.htm" required>
              </div>
              <div class="form-row">
                <label>カテゴリー</label>
                <select name="category">${categoryOptionsHtml(DEFAULT_LIBRARY_CATEGORY, categories)}</select>
              </div>
              <button class="btn primary" type="submit">HTMLツールを追加</button>
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
    topbar: `<div class="topbar"><span class="brand"><a href="${userRole === 'admin' ? '/admin' : '/member'}">&larr; 戻る</a></span></div>`,
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

module.exports = { escapeHtml, loginPage, memberPage, memberPasswordPage, adminPage, adminMemberPage, adminLibraryPage, boardPage, guidePage };
