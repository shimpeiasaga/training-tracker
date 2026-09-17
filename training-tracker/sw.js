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
  // つかない。そのためservice worker自身からもバッジを立てておき、実際にアプリを開いた時に
  // ページ側の正しい件数で上書き・解除されるようにする
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
        clientList.forEach(function (client) {
          client.postMessage({ type: 'push-refresh' });
        });
      }),
      self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge().catch(function () {}) : Promise.resolve(),
    ])
  );
});

// 通知をタップしたら、既に開いているタブがあればそれを使い、無ければ新しく開く
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
