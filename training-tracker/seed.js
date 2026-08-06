// 初回セットアップ用: 管理者アカウントを1つ作成する
const crypto = require('./crypto-utils');
const db = require('./db');

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';

(async () => {
  const existing = await db.getUserByUsername(ADMIN_USERNAME);
  if (existing) {
    console.log('管理者アカウントは既に存在します(username: admin)');
  } else {
    await db.createUser({
      name: '管理者',
      username: ADMIN_USERNAME,
      passwordHash: crypto.hashPassword(ADMIN_PASSWORD),
      role: 'admin',
    });
    console.log('管理者アカウントを作成しました');
    console.log('  username: ' + ADMIN_USERNAME);
    console.log('  password: ' + ADMIN_PASSWORD);
    console.log('※ ログイン後、必ずパスワードを変更してください');
  }
  process.exit(0);
})().catch((err) => {
  console.error('エラーが発生しました:', err.message);
  process.exit(1);
});
