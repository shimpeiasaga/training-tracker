// データ保存先を自動で切り替える
// MONGODB_URI が設定されていれば MongoDB Atlas(Render向け、再デプロイしても消えない)
// 設定されていなければ、これまで通りローカルのJSONファイル(自分のPCで動かす時向け)
module.exports = process.env.MONGODB_URI ? require('./db-mongo') : require('./db-file');
