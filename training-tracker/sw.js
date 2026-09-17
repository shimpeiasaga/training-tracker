// プッシュ通知用のサービスワーカー(ホーム画面に追加したアプリに通知を届けるために必要)

// このファイルを更新した時、既に開いているタブが古いservice workerのまま動き続けて
// 新しい処理(通知と同時に画面を更新する機能など)が反映されない問題を防ぐため、
// 新しいバージョンが見つかったらすぐに有効化して、開いている画面もすぐ管理下に置く
self.addEventListener('install', function (event) {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: 'オンライン運動元気倶楽部', body: event.data ? event.data.text() : '' };
  }
  var title = data.title || 'オンライン運動元気倶楽部';
  var options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  };
  // 通知を出すのと同時に、既に開いているタブがあれば中身を最新に更新しておく
  // (通知を確認しても、アプリの画面が古いままだと新着メッセージが見えないため)
  //
  // アプリを開いていない(バックグラウンド・完全に閉じている)状態で通知が届いた場合、
  // ページ側のスクリプト(setAppBadge)は一切実行されないため、アイコンの赤丸がいつまでも
  // つかない。そのためservice worker自身からもバッジを立てておく(iOS16.4+/Androidで対応、
  // 非対応環境では何もしない)。数はサーバーから渡された実際の未読件数(badgeCount)を使う
  var badgePromise = Promise.resolve();
  if (self.navigator && 'setAppBadge' in self.navigator && typeof data.badgeCount === 'number') {
    badgePromise =
      data.badgeCount > 0
        ? self.navigator.setAppBadge(data.badgeCount).catch(function () {})
        : self.navigator.clearAppBadge
        ? self.navigator.clearAppBadge().catch(function () {})
        : Promise.resolve();
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
        clientList.forEach(function (client) {
          client.postMessage({ type: 'push-refresh' });
        });
      }),
      badgePromise,
    ])
  );
});

// 通知をタップしたら、既に開いているタブがあればそれを使い、無ければ新しく開く
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var rawUrl = (event.notification.data && event.notification.data.url) || '/';
  // #messagesのようにハッシュ部分だけが違うURLだと、ブラウザによっては再読み込みを省略して
  // スクロールするだけになり、メッセージが最新化されないことがある。
  // 毎回変わる値をクエリに付けて、常に「新しいURL」として扱われる=必ず読み込み直させるようにする
  var hashIndex = rawUrl.indexOf('#');
  var path = hashIndex === -1 ? rawUrl : rawUrl.slice(0, hashIndex);
  var hash = hashIndex === -1 ? '' : rawUrl.slice(hashIndex);
  var sep = path.indexOf('?') === -1 ? '?' : '&';
  var url = path + sep + '_t=' + Date.now() + hash;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if ('navigate' in client) {
          // navigate()の完了を待たずにfocus()すると、iOSでは再読み込みの途中でservice workerが
          // 終了してしまい反映されないことがあるため、navigate()の完了を待ってからfocus()する
          return client.navigate(url).then(function (navigatedClient) {
            return navigatedClient ? navigatedClient.focus() : client.focus();
          });
        }
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
