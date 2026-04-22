// 執行這個檔案來產生 VAPID 金鑰
// 指令：node setup-vapid.js

const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();

console.log('\n✅ 你的 VAPID 金鑰產生好了！\n');
console.log('請把以下內容複製，等一下在 Railway 設定環境變數會用到：\n');
console.log('─────────────────────────────────────────────');
console.log('VAPID_PUBLIC_KEY=', keys.publicKey);
console.log('VAPID_PRIVATE_KEY=', keys.privateKey);
console.log('─────────────────────────────────────────────');
console.log('\n⚠️  私鑰 (PRIVATE_KEY) 不要給別人，公鑰 (PUBLIC_KEY) 要貼到 PWA 裡\n');
