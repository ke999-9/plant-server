require('dotenv').config();
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');

const app = express();
app.use(express.json());
app.use(cors());

// ── VAPID 設定 ────────────────────────────────────────────────────────
webpush.setVapidDetails(
  'mailto:plant@watering.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── 記憶體儲存（伺服器重啟會清空，但排程會由 PWA 重新設定）────────────
// 格式：{ subscriptionKey: { subscription, nextWateringTime, timer } }
const schedules = new Map();

// ── 工具：產生訂閱唯一 key ────────────────────────────────────────────
function subKey(sub) {
  return sub.endpoint;
}

// ── 工具：發送通知 ────────────────────────────────────────────────────
async function sendNotification(subscription, title, body) {
  const payload = JSON.stringify({ title, body });
  try {
    await webpush.sendNotification(subscription, payload);
    console.log('✅ 通知已發送:', title);
  } catch (err) {
    console.error('❌ 通知發送失敗:', err.statusCode, err.message);
    // 如果訂閱已失效（410），從排程移除
    if (err.statusCode === 410) {
      const key = subKey(subscription);
      clearSchedule(key);
      schedules.delete(key);
    }
  }
}

// ── 工具：清除某個排程的 timer ────────────────────────────────────────
function clearSchedule(key) {
  const existing = schedules.get(key);
  if (existing && existing.timer) {
    clearTimeout(existing.timer);
  }
}

// ── API：接收訂閱資訊（PWA 第一次開啟時呼叫）────────────────────────
app.post('/subscribe', (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: '缺少 subscription' });
  }

  const key = subKey(subscription);
  // 保留現有排程時間，只更新訂閱物件
  const existing = schedules.get(key) || {};
  schedules.set(key, { ...existing, subscription });

  console.log('📱 新訂閱儲存，目前共', schedules.size, '個裝置');
  res.json({ ok: true });
});

// ── API：設定下次澆花提醒時間 ─────────────────────────────────────────
app.post('/schedule', (req, res) => {
  const { subscription, nextWateringTime } = req.body;

  if (!subscription || !nextWateringTime) {
    return res.status(400).json({ error: '缺少必要參數' });
  }

  const key = subKey(subscription);
  const targetTime = new Date(nextWateringTime);
  const now = new Date();
  const delay = targetTime - now;

  // 清除舊排程
  clearSchedule(key);

  if (delay <= 0) {
    // 時間已過，立即發送
    sendNotification(subscription, '🌿 澆花時間到！', '你的植物需要澆水了');
    schedules.set(key, { subscription, nextWateringTime, timer: null });
    return res.json({ ok: true, status: 'sent_immediately' });
  }

  // 最多排程 30 天
  const MAX_DELAY = 30 * 24 * 60 * 60 * 1000;
  if (delay > MAX_DELAY) {
    return res.status(400).json({ error: '排程時間不能超過 30 天' });
  }

  const timeStr = targetTime.toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });

  const timer = setTimeout(() => {
    sendNotification(
      subscription,
      '🌿 澆花時間到！',
      `預定時間 ${timeStr}，記得給植物澆水 💧`
    );
    // 通知後清除 timer 引用
    const entry = schedules.get(key);
    if (entry) schedules.set(key, { ...entry, timer: null });
  }, delay);

  schedules.set(key, { subscription, nextWateringTime, timer });

  const hours = Math.round(delay / 3600000 * 10) / 10;
  console.log(`⏰ 排程設定：${timeStr}（${hours} 小時後）`);

  res.json({ ok: true, status: 'scheduled', targetTime: targetTime.toISOString() });
});

// ── API：取消排程 ─────────────────────────────────────────────────────
app.post('/unschedule', (req, res) => {
  const { subscription } = req.body;
  if (!subscription) return res.status(400).json({ error: '缺少 subscription' });

  const key = subKey(subscription);
  clearSchedule(key);
  schedules.delete(key);
  console.log('🗑️ 排程已取消');
  res.json({ ok: true });
});

// ── API：健康檢查（Railway 會用到）───────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    schedules: schedules.size,
    uptime: Math.round(process.uptime()) + 's'
  });
});

// ── 啟動伺服器 ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🌿 澆花推播伺服器啟動！`);
  console.log(`   Port: ${PORT}`);
  console.log(`   VAPID 公鑰: ${process.env.VAPID_PUBLIC_KEY ? '✅ 已設定' : '❌ 未設定！請設環境變數'}`);
  console.log(`   健康檢查: http://localhost:${PORT}/health\n`);
});
