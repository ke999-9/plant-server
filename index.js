require('dotenv').config();
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');

const app = express();
app.use(express.json());
app.use(cors());

webpush.setVapidDetails(
  'mailto:plant@watering.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── 推播排程儲存 ──────────────────────────────────────────────────────
const schedules = new Map();

function subKey(sub){ return sub.endpoint; }

async function sendNotification(subscription, title, body){
  try{
    await webpush.sendNotification(subscription, JSON.stringify({title,body}));
    console.log('✅ 通知已發送:', title);
  }catch(err){
    console.error('❌ 通知失敗:', err.statusCode);
    if(err.statusCode===410){
      const key=subKey(subscription);
      const entry=schedules.get(key);
      if(entry) Object.values(entry.timers).forEach(t=>t&&clearTimeout(t));
      schedules.delete(key);
    }
  }
}

function clearTypeTimer(key, type){
  const entry=schedules.get(key);
  if(entry?.timers?.[type]){ clearTimeout(entry.timers[type]); entry.timers[type]=null; }
}

// ── 推播 API ──────────────────────────────────────────────────────────
app.post('/subscribe',(req,res)=>{
  const{subscription}=req.body;
  if(!subscription?.endpoint) return res.status(400).json({error:'缺少 subscription'});
  const key=subKey(subscription);
  const existing=schedules.get(key)||{timers:{water:null,med:null,fert:null}};
  schedules.set(key,{...existing,subscription});
  console.log('📱 訂閱儲存，共',schedules.size,'裝置');
  res.json({ok:true});
});

app.post('/schedule',(req,res)=>{
  const{subscription,nextWateringTime,title,body,type='water'}=req.body;
  if(!subscription||!nextWateringTime) return res.status(400).json({error:'缺少參數'});
  const key=subKey(subscription);
  const targetTime=new Date(nextWateringTime);
  const delay=targetTime-new Date();
  clearTypeTimer(key,type);
  const entry=schedules.get(key)||{subscription,timers:{water:null,med:null,fert:null}};
  entry.subscription=subscription;
  if(delay<=0){
    sendNotification(subscription,title||'🌿 提醒',body||'照護植物的時間到了！');
    schedules.set(key,entry);
    return res.json({ok:true,status:'sent_immediately'});
  }
  if(delay>30*24*3600*1000) return res.status(400).json({error:'超過30天'});
  const timeStr=targetTime.toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  entry.timers[type]=setTimeout(()=>{
    sendNotification(subscription,title||'🌿 提醒',body||`預定時間 ${timeStr}`);
    entry.timers[type]=null;
  },delay);
  schedules.set(key,entry);
  console.log(`⏰ [${type}] 排程：${timeStr}（${Math.round(delay/3600000*10)/10}h後）`);
  res.json({ok:true,status:'scheduled',targetTime:targetTime.toISOString()});
});

app.post('/unschedule',(req,res)=>{
  const{subscription,type}=req.body;
  if(!subscription) return res.status(400).json({error:'缺少 subscription'});
  const key=subKey(subscription);
  if(type){ clearTypeTimer(key,type); console.log(`🗑️ [${type}] 取消`); }
  else{
    const entry=schedules.get(key);
    if(entry) Object.keys(entry.timers).forEach(t=>clearTypeTimer(key,t));
    schedules.delete(key);
  }
  res.json({ok:true});
});

// ── Google OAuth Token 交換 API ───────────────────────────────────────
// 前端把 authorization code 送來，後端換成 access_token + refresh_token
app.post('/google/token',(req,res)=>{
  const{code,redirect_uri}=req.body;
  if(!code||!redirect_uri) return res.status(400).json({error:'缺少 code 或 redirect_uri'});
  const clientId=process.env.GOOGLE_CLIENT_ID;
  const clientSecret=process.env.GOOGLE_CLIENT_SECRET;
  if(!clientId||!clientSecret) return res.status(500).json({error:'伺服器未設定 Google 憑證'});

  fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      code, redirect_uri,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code'
    })
  })
  .then(r=>r.json())
  .then(data=>{
    if(data.error) return res.status(400).json({error:data.error_description||data.error});
    res.json({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_in:    data.expires_in||3600
    });
  })
  .catch(e=>{ console.error('Token exchange error:',e); res.status(500).json({error:'token 交換失敗'}); });
});

// 前端送來 refresh_token，後端換新的 access_token
app.post('/google/refresh',(req,res)=>{
  const{refresh_token}=req.body;
  if(!refresh_token) return res.status(400).json({error:'缺少 refresh_token'});
  const clientId=process.env.GOOGLE_CLIENT_ID;
  const clientSecret=process.env.GOOGLE_CLIENT_SECRET;
  if(!clientId||!clientSecret) return res.status(500).json({error:'伺服器未設定 Google 憑證'});

  fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token'
    })
  })
  .then(r=>r.json())
  .then(data=>{
    if(data.error) return res.status(400).json({error:data.error_description||data.error});
    res.json({
      access_token: data.access_token,
      expires_in:   data.expires_in||3600
    });
  })
  .catch(e=>{ console.error('Refresh error:',e); res.status(500).json({error:'refresh 失敗'}); });
});

// ── 健康檢查 ──────────────────────────────────────────────────────────
app.get('/health',(req,res)=>{
  res.json({status:'ok',schedules:schedules.size,uptime:Math.round(process.uptime())+'s'});
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>{
  console.log(`\n🌿 植物照護推播伺服器啟動！`);
  console.log(`   Port: ${PORT}`);
  console.log(`   VAPID: ${process.env.VAPID_PUBLIC_KEY?'✅':'❌'}`);
  console.log(`   Google OAuth: ${process.env.GOOGLE_CLIENT_ID?'✅':'❌'}\n`);
});
