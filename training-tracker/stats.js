// 進捗計算まわりのユーティリティ
// 「今日」は日本時間(JST, UTC+9)基準で判定する
const TZ_OFFSET_MS = 9 * 60 * 60 * 1000;

function todayStr() {
  return new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

// メッセージ・掲示板の投稿日時("YYYY-MM-DD HH:MM"、日本時間)
function nowStr() {
  return new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// その日を含む週の月曜日を返す
function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0=日,1=月,...
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(dateStr, diff);
}

// 直近N週分の {weekStart, count} 配列(古い週→新しい週の順)
function weeklySeries(checkinDates, weeksBack = 8) {
  const dateSet = new Set(checkinDates);
  const today = todayStr();
  const thisWeekStart = weekStart(today);
  const series = [];
  for (let i = weeksBack - 1; i >= 0; i--) {
    const start = addDays(thisWeekStart, -7 * i);
    let count = 0;
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, d);
      if (day > today) break;
      if (dateSet.has(day)) count++;
    }
    series.push({ weekStart: start, count });
  }
  return series;
}

// 直近N日分のカレンダーグリッド用データ(日付とチェック有無)
function dailyGrid(checkinDates, daysBack = 56) {
  const dateSet = new Set(checkinDates);
  const today = todayStr();
  const days = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    days.push({ date: day, checked: dateSet.has(day) });
  }
  return days;
}

// 指定した月(YYYY-MM)のカレンダー用データを作る
// その月の1日が何曜日から始まるかに合わせて先頭にnull(空白セル)を入れ、
// 月末以降も7の倍数になるようnullで埋める(週の行として表示するため)
function monthCalendar(checkinDates, mKey) {
  const dateSet = new Set(checkinDates);
  const [y, m] = mKey.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const startDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=日,...,6=土
  const leadingBlanks = (startDow + 6) % 7; // 月曜始まりにするための調整(0=月,...,6=日)
  const cells = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      date: dateStr,
      day: d,
      checked: dateSet.has(dateStr),
      dow: new Date(dateStr + 'T00:00:00Z').getUTCDay(),
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// 連続達成日数(今日 or 昨日から遡って連続している日数)
function currentStreak(checkinDates) {
  const dateSet = new Set(checkinDates);
  const today = todayStr();
  let start = today;
  if (!dateSet.has(today)) {
    start = addDays(today, -1);
    if (!dateSet.has(start)) return 0;
  }
  let streak = 0;
  let cursor = start;
  while (dateSet.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// 今週すでに何回チェックしたか
function thisWeekCount(checkinDates) {
  const dateSet = new Set(checkinDates);
  const today = todayStr();
  const start = weekStart(today);
  let count = 0;
  for (let d = 0; d < 7; d++) {
    const day = addDays(start, d);
    if (day > today) break;
    if (dateSet.has(day)) count++;
  }
  return count;
}

// --- 月間目標(月10回×3ヶ月継続で特典)まわり ---
const MONTHLY_GOAL = 10; // 月にこの回数以上で「達成」
const REWARD_MONTHS = 3; // この月数連続達成で特典1回分

// 会員1人あたりに登録できる動画・画像(合わせて)の最大件数
const MAX_MEMBER_MEDIA = 10;

function monthKey(dateStr) {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

function addMonths(mKey, n) {
  const [y, m] = mKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function countForMonth(checkinDates, mKey) {
  return checkinDates.filter((d) => d.startsWith(mKey)).length;
}

// 今月の実施回数
function currentMonthCount(checkinDates) {
  return countForMonth(checkinDates, monthKey(todayStr()));
}

// 直近N ヶ月分の {month, count, achieved} 配列(古い月→新しい月の順)
function monthlySeries(checkinDates, monthsBack = 6) {
  const current = monthKey(todayStr());
  const series = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const mk = addMonths(current, -i);
    const count = countForMonth(checkinDates, mk);
    series.push({ month: mk, count, achieved: count >= MONTHLY_GOAL });
  }
  return series;
}

// 目標を連続で達成している月数
// 「先月以前」は完了した月なので厳密にカウントし、今月はまだ途中なので
// 既に目標を達成していればプラス1するだけ(未達でも連続記録は途切れさせない)
function currentMonthlyStreak(checkinDates) {
  const current = monthKey(todayStr());
  let streakFromPastMonths = 0;
  let cursor = addMonths(current, -1);
  while (countForMonth(checkinDates, cursor) >= MONTHLY_GOAL) {
    streakFromPastMonths++;
    cursor = addMonths(cursor, -1);
  }
  const currentAchieved = countForMonth(checkinDates, current) >= MONTHLY_GOAL;
  return currentAchieved ? streakFromPastMonths + 1 : streakFromPastMonths;
}

// 連続達成月数から、これまでに獲得した特典の回数(3ヶ月ごとに1回)
function rewardsEarned(monthlyStreak) {
  return Math.floor(monthlyStreak / REWARD_MONTHS);
}

// --- 累計実施日数ランク(連続でなくてもOK、ランクが上がっていく仕組み) ---
const STREAK_BADGES = [
  { days: 1, icon: '🔰', label: 'ビギナー' },
  { days: 3, icon: '🥉', label: 'ブロンズ' },
  { days: 7, icon: '🥈', label: 'シルバー' },
  { days: 14, icon: '🥇', label: 'ゴールド' },
  { days: 30, icon: '💎', label: 'プラチナ' },
  { days: 60, icon: '💠', label: 'ダイヤモンド' },
  { days: 100, icon: '👑', label: 'レジェンド' },
];

function streakBadges(streak) {
  return STREAK_BADGES.map((b) => ({ ...b, achieved: streak >= b.days }));
}

// 次の目標バッジ(全部達成済みならnull)
function nextStreakBadge(streak) {
  return STREAK_BADGES.find((b) => streak < b.days) || null;
}

// 今の連続日数が、ちょうどバッジのしきい値と一致するか(達成の瞬間かどうか)
function justUnlockedBadge(streak) {
  return STREAK_BADGES.find((b) => b.days === streak) || null;
}

// 獲得済みバッジを「いつ達成したか」付きで一覧にする(達成日が古い順)
// 累計N日目に到達した日 = チェックイン日を昇順に並べたときのN番目の日付
function badgeUnlockLog(checkinDates) {
  const sorted = [...checkinDates].sort();
  return STREAK_BADGES.filter((b) => sorted.length >= b.days).map((b) => ({
    ...b,
    unlockedDate: sorted[b.days - 1],
  }));
}

// 同点は同順位になるランキング(1,2,2,4方式)
function rankMembers(list) {
  const sorted = [...list].sort((a, b) => b.count - a.count);
  let rank = 0;
  let prevCount = null;
  return sorted.map((item, idx) => {
    if (item.count !== prevCount) {
      rank = idx + 1;
      prevCount = item.count;
    }
    return { ...item, rank };
  });
}

module.exports = {
  todayStr,
  nowStr,
  addDays,
  weekStart,
  weeklySeries,
  dailyGrid,
  monthCalendar,
  currentStreak,
  thisWeekCount,
  MONTHLY_GOAL,
  REWARD_MONTHS,
  MAX_MEMBER_MEDIA,
  monthKey,
  addMonths,
  countForMonth,
  currentMonthCount,
  monthlySeries,
  currentMonthlyStreak,
  rewardsEarned,
  STREAK_BADGES,
  streakBadges,
  nextStreakBadge,
  justUnlockedBadge,
  badgeUnlockLog,
  rankMembers,
};
