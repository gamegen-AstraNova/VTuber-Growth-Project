const STORAGE_KEY = 'astraNovaV3';
const DEFAULT_STATE = {
  day: 1,
  money: 500,
  fans: 0,
  energy: 80,
  streams: 0,
  likes: 0,
  dislikes: 0,
  game: 35,
  talk: 35,
  song: 35,
  logs: [],
  streamHistory: [],
  adStreak: 0,
  shortRestCount: 0,
  lastGraduationCheck: 0,
  graduated: false,
  lastLiveType: '',
  liveTypeStreak: 0,
  liveType: 'game',
  lastViews: 0,
  currentLiveSC: 0,
  activeStreamId: null,
  name: 'Asteria',
  image: 'Vtuber.png',
  bgGame: 'game-background.png',
  bgSong: 'song-background.png',
  bgTalk: 'talk-background.png'
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let state = loadState();
let currentPage = 'info';
let isLive = false;
let chatTimer = null;
let scTimer = null;
let bgmAudio = null;
let audioContext = null;
const recentChatMessages = [];

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const merged = Object.assign({}, DEFAULT_STATE, saved);
    merged.logs = Array.isArray(merged.logs) ? merged.logs : [];
    merged.streamHistory = Array.isArray(merged.streamHistory) ? merged.streamHistory : [];
    if (!merged.streamHistory.length) {
      merged.streamHistory = merged.logs
        .filter(log => /^完成(遊戲|歌回|雜談)直播|^工商直播紀錄/.test(log))
        .slice(0, 6)
        .map((log, index) => {
          const type = log.startsWith('完成遊戲') ? 'game' : log.startsWith('完成歌回') ? 'song' : log.startsWith('完成雜談') ? 'talk' : 'ad';
          const views = Number(log.match(/觀看\s*(\d+)/)?.[1] || 0);
          return { id: `legacy-${index}`, type, views, likes: 0, dislikes: 0, sc: 0 };
        });
    }
    merged.image = merged.image === '01-Asteria-_1.png' ? 'Vtuber.png' : merged.image;
    const validBackground = (value, fallback) =>
      typeof value === 'string' && (value.startsWith('data:image/') || value === fallback) ? value : fallback;
    merged.bgGame = validBackground(merged.bgGame, 'game-background.png');
    merged.bgSong = validBackground(merged.bgSong, 'song-background.png');
    merged.bgTalk = validBackground(merged.bgTalk, 'talk-background.png');
    const legacyAdIncome = merged.logs
      .filter(log => /^工商直播紀錄/.test(log))
      .map(log => Number(log.match(/獲得\s*(\d+)/)?.[1] || 0));
    let legacyAdIndex = 0;
    merged.streamHistory.forEach(record => {
      if (record.type !== 'ad' || record.views > 0) return;
      const score = (merged.game + merged.song + merged.talk) / 3;
      record.views = Math.max(30, Math.floor(80 + merged.fans * 0.45 + score * 12));
      record.likes = Math.min(record.views, Math.floor(record.views * Math.min(0.96, 0.35 + score / 250)));
      record.dislikes = Math.max(1, Math.floor(record.views * Math.max(0.01, 0.16 - score / 500)));
      record.sc = record.sc || legacyAdIncome[legacyAdIndex] || 0;
      legacyAdIndex++;
    });
    return merged;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function asset(value, fallback) {
  const source = typeof value === 'string' && value ? value : fallback;
  return escapeHtml(source);
}

function ability(type) {
  return state[type === 'song' ? 'song' : type === 'game' ? 'game' : 'talk'];
}

function streamLabel(type) {
  return type === 'game' ? '遊戲' : type === 'song' ? '歌回' : '雜談';
}

function targetForDay(day = state.day) {
  const checkpoint = Math.max(1, Math.ceil(day / 7));
  return checkpoint === 1 ? 10000 : 30000 + (checkpoint - 2) * 20000;
}

function daysToCheckpoint(day = state.day) {
  return Math.max(0, Math.ceil(day / 7) * 7 - day);
}

function updateHeader() {
  $('#day').textContent = state.day;
  $('#money').textContent = Math.floor(state.money);
  $('#topEnergy').textContent = `${state.energy}%`;
  $('#topFans').textContent = Math.floor(state.fans);
  $('#topFans').style.color = state.fans < targetForDay() ? '#ff79b7' : '';
  $('#topGoal').textContent = ` / ${targetForDay().toLocaleString()}　下次結算剩 ${daysToCheckpoint()} 天`;
  $('#sideName').textContent = state.name;
  $('#title').textContent = `${state.name} 的頻道`;
}

function setActiveNav(page) {
  $$('.nav').forEach(button => button.classList.toggle('active', button.dataset.p === page));
}

function render(page = 'info') {
  if (isLive && page !== 'stream') endLive(false);
  currentPage = page;
  setActiveNav(page);
  updateHeader();
  const views = {
    info: renderInfo,
    live: renderLiveHistory,
    upgrade: renderUpgrade,
    work: renderWork,
    rest: renderRest,
    rules: renderRules
  };
  (views[page] || renderInfo)();
}

function portraitMarkup(className = '') {
  return `<div class="portrait ${className}" style="background-image:url(&quot;${asset(state.image, 'Vtuber.png')}&quot;)"></div>`;
}

function renderInfo() {
  const logs = state.logs.slice(0, 8).map(log => `・${escapeHtml(log)}`).join('<br>') || '目前還沒有紀錄。';
  const song = Math.min(1000, Math.max(0, Number(state.song) || 0)) / 1000;
  const game = Math.min(1000, Math.max(0, Number(state.game) || 0)) / 1000;
  const talk = Math.min(1000, Math.max(0, Number(state.talk) || 0)) / 1000;
  const points = `50,${66 - 66 * song} ${50 - 50 * game},${66 + 34 * game} ${50 + 50 * talk},${66 + 34 * talk}`;
  $('#page').innerHTML = `
    <div class="dashboard-grid">
      <div>
        <div class="card status-card">
          <p class="eyebrow">CHANNEL STATUS</p>
          <div class="status-hero">
            ${portraitMarkup('editable-portrait')}
            <div class="status-details">
              <input id="channelName" value="${escapeHtml(state.name)}" title="點擊編輯頻道名稱">
              <div class="stats">
                <div class="stat"><small>直播次數</small><b>${state.streams}</b></div>
                <div class="stat"><small>人氣</small><b>${Math.floor(state.fans)}</b></div>
                <div class="stat"><small>體力</small><b>${state.energy}%</b></div>
                <div class="stat"><small>資金</small><b>${Math.floor(state.money)}</b></div>
              </div>
            </div>
          </div>
          <p class="muted">點擊角色圖片即可更換</p>
          <input id="avatarInput" type="file" accept="image/png,image/jpeg,image/webp" hidden>
        </div>
        <div class="card dashboard-backgrounds">
          <p class="eyebrow">STREAM BACKGROUNDS</p>
          <p class="muted">上傳並查看目前套用中的直播背景。</p>
          <div class="background-preview-grid">
            ${backgroundControl('bgGame', '遊戲背景', 'game-background.png')}
            ${backgroundControl('bgSong', '歌回背景', 'song-background.png')}
            ${backgroundControl('bgTalk', '雜談背景', 'talk-background.png')}
          </div>
        </div>
      </div>
      <div>
        <div class="card">
          <p class="eyebrow">STREAM ABILITY</p>
          <div class="triangle">
            <svg class="ability-fill" viewBox="0 0 100 100" aria-hidden="true">
              <polygon points="${points}"></polygon>
            </svg>
            <span class="t">歌回 ${state.song}</span>
            <span class="l">遊戲 ${state.game}</span>
            <span class="r">雜談 ${state.talk}</span>
          </div>
        </div>
        <div class="card">
          <p class="eyebrow">RECENT LOG</p>
          <p class="muted">${logs}</p>
        </div>
      </div>
    </div>`;
}

function backgroundControl(key, label, fallback) {
  return `<div>
    <img src="${asset(state[key], fallback)}" alt="${label}">
    <small>${label}</small>
    <input data-background="${key}" type="file" accept="image/png,image/jpeg,image/webp">
  </div>`;
}

function renderLiveHistory() {
  const records = state.streamHistory.slice(0, 6);
  const cards = records.map(record => `
    <div class="video">
      <div class="thumb" style="background-image:url(&quot;${asset(state.image, 'Vtuber.png')}&quot;)"></div>
      <div class="video-info">
        <div class="video-title">${record.type === 'ad' ? '工商合作' : streamLabel(record.type)}</div>
        <small class="video-meta">觀看 ${record.views || 0}　👍 ${record.likes || 0}　👎 ${record.dislikes || 0}　💵 ${record.sc || 0}</small>
      </div>
    </div>`).join('');
  $('#page').innerHTML = `
    <div class="card">
      <p class="eyebrow">YOUTUBE CHANNEL · ${escapeHtml(state.name)}</p>
      <h2>直播紀錄</h2>
      <button data-start="game">🎮 遊戲直播</button>
      <button data-start="song">🎤 歌回直播</button>
      <button data-start="talk">☕ 雜談直播</button>
      <div class="video-grid">${cards || '<p class="muted">目前還沒有直播紀錄。</p>'}</div>
    </div>`;
}

function renderUpgrade() {
  $('#page').innerHTML = `
    <div class="card">
      <p class="eyebrow">UPGRADE SHOP</p>
      <h2>強化直播設備與能力</h2>
      <div class="shop">
        ${shopButton('game', '遊戲實況訓練課程', '遊戲能力 +15　價格 500')}
        ${shopButton('talk', '雜談表達訓練課程', '雜談能力 +15　價格 500')}
        ${shopButton('song', '歌唱訓練課程', '歌回能力 +15　價格 500')}
        ${shopButton('all', '綜合直播訓練課程', '三項能力各 +5　價格 500')}
      </div>
    </div>`;
}

function shopButton(type, title, description) {
  return `<button class="item" data-buy="${type}"><b>${title}</b><small>${description}</small></button>`;
}

function renderWork() {
  $('#page').innerHTML = `
    <div class="card">
      <p class="eyebrow">PART-TIME JOB</p>
      <h2>選擇打工</h2>
      <p class="muted">打工會消耗體力；工商合作會計入直播紀錄。</p>
      <div class="shop">
        ${jobButton('store', '便利商店', '資金=100｜體力-10')}
        ${jobButton('bar', '酒吧', '資金=人氣×5%｜體力-10｜人氣-5%')}
        ${jobButton('site', '工地', '資金=300｜體力-30')}
        ${jobButton('ad', '工商合作', '資金=人氣×20%｜體力-20｜人氣-15%')}
      </div>
    </div>`;
}

function jobButton(type, title, description) {
  return `<button class="item" data-job="${type}"><b>${title}</b><small>${description}</small></button>`;
}

function renderRest() {
  $('#page').innerHTML = `
    <div class="card">
      <p class="eyebrow">REST AREA</p>
      <h2>休息</h2>
      <p class="muted">目前體力：${state.energy}%。</p>
      <button data-rest="short">短暫休息　+30 體力（今日 ${state.shortRestCount} / 5）</button>
      <button data-rest="long">好好睡一覺　+100 體力，進入下一天</button>
    </div>`;
}

function renderRules() {
  $('#page').innerHTML = `
    <div class="card"><p class="eyebrow">HOW TO PLAY</p><h2>遊戲規則</h2>
      <p class="muted">培養三項能力、安排每天行動，並在期限內累積足夠人氣。</p></div>
    <div class="grid">
      <div class="card"><p class="eyebrow">DAY & ACTIONS</p><h3>每日行動</h3>
        <p>「好好睡一覺」會進入下一天並恢復 100 體力。</p>
        <p>短暫休息恢復 30 體力，每天最多 5 次。</p>
        <p>直播、打工與強化會消耗資源，請妥善安排體力與資金。</p></div>
      <div class="card"><p class="eyebrow">ABILITIES</p><h3>三項能力</h3>
        <p>遊戲直播看遊戲能力；歌回直播看歌回能力；雜談直播看雜談能力。</p>
        <p>能力三角以 1000 為滿值，超過 1000 仍維持滿格。</p>
        <p>單項訓練 +15；綜合訓練三項各 +5；價格統一為 500。</p></div>
      <div class="card"><p class="eyebrow">STREAMING</p><h3>直播策略</h3>
        <p>能力越均衡，人氣收益越穩定；連續開同類直播會降低收益。</p>
        <p>直播中的 SC 會直接增加資金。</p></div>
      <div class="card"><p class="eyebrow">CHAT ROOM</p><h3>聊天室態度</h3>
        <p>0～200：酸言酸語<br>201～500：好壞參半<br>501～900：大多好評但有黑粉<br>901 以上：狂熱粉絲</p></div>
      <div class="card"><p class="eyebrow">FAME TARGET</p><h3>人氣目標與期限</h3>
        <p>第 7 天：10,000<br>第 14 天：30,000<br>第 21 天：50,000<br>第 28 天：70,000<br>之後每 7 天增加 20,000。</p>
        <p>未達標會畢業，並選擇轉生或放棄遊戲。</p></div>
      <div class="card"><p class="eyebrow">REBIRTH</p><h3>轉生繼承</h3>
        <p>轉生後從第 1 天重新開始。</p>
        <p>可繼承資金、三項能力、角色名稱與圖片。</p>
        <p>人氣、天數、直播紀錄、體力及其他本輪進度會重置。</p></div>
    </div>`;
}

function buyTraining(type) {
  if (state.graduated) return;
  if (state.money < 500) return alert('資金不足。');
  state.money -= 500;
  if (type === 'all') {
    state.game += 5;
    state.song += 5;
    state.talk += 5;
  } else {
    state[type] += 15;
  }
  const names = { game: '遊戲實況訓練課程', talk: '雜談表達訓練課程', song: '歌唱訓練課程', all: '綜合直播訓練課程' };
  state.logs.unshift(`完成${names[type]}，能力提升`);
  save();
  render('upgrade');
}

function doJob(type) {
  if (state.graduated) return;
  const energyCost = { store: 10, bar: 10, site: 30, ad: 20 }[type];
  if (state.energy < energyCost) return alert('體力不足，請先休息。');
  const fansBefore = state.fans;
  let income = 0;
  if (type === 'store') income = 100;
  if (type === 'site') income = 300;
  if (type === 'bar') income = Math.floor(fansBefore * 0.05);
  if (type === 'ad') income = Math.floor(fansBefore * 0.20);
  state.energy -= energyCost;
  state.money += income;
  if (type === 'bar') state.fans = Math.floor(fansBefore * 0.95);
  if (type === 'ad') {
    state.streams++;
    const previousType = state.lastLiveType;
    state.lastLiveType = 'ad';
    state.liveTypeStreak = previousType === 'ad' ? state.liveTypeStreak + 1 : 1;
    const repeatPenalty = Math.max(0.35, 1 - (state.liveTypeStreak - 1) * 0.12);
    state.fans = Math.floor(fansBefore * 0.85 * repeatPenalty);
    const score = (state.game + state.song + state.talk) / 3;
    const views = Math.max(30, Math.floor(80 + fansBefore * 0.45 + score * 12));
    const likes = Math.min(views, Math.floor(views * Math.min(0.96, 0.35 + score / 250)));
    const dislikes = Math.max(1, Math.floor(views * Math.max(0.01, 0.16 - score / 500)));
    state.logs.unshift(`工商直播紀錄，獲得 ${income} 資金`);
    state.streamHistory.unshift({
      id: `ad-${Date.now()}`,
      type: 'ad',
      views,
      likes,
      dislikes,
      sc: income
    });
  } else {
    state.adStreak = 0;
    state.logs.unshift(`完成${type === 'store' ? '便利商店' : type === 'bar' ? '酒吧' : '工地'}打工，獲得 ${income} 資金`);
  }
  save();
  render('work');
}

function rest(type) {
  if (state.graduated) return;
  if (type === 'short') {
    if (state.shortRestCount >= 5) return alert('今天短暫休息已達 5 次上限。');
    state.shortRestCount++;
    state.energy = Math.min(100, state.energy + 30);
    state.logs.unshift(`短暫休息（今日 ${state.shortRestCount} / 5）`);
  } else {
    state.energy = 100;
    state.day++;
    state.shortRestCount = 0;
    state.logs.unshift('好好睡了一覺，體力恢復 100');
    graduationCheck();
  }
  save();
  render('rest');
}

function startLive(type) {
  if (state.graduated) return;
  if (state.energy < 20) return alert('體力不足，請先休息。');
  const correspondingAbility = ability(type);
  const previousType = state.lastLiveType;
  state.liveTypeStreak = previousType === type ? state.liveTypeStreak + 1 : 1;
  state.lastLiveType = type;
  state.liveType = type;
  state.energy -= 20;
  state.streams++;
  state[type === 'song' ? 'song' : type === 'game' ? 'game' : 'talk'] += 3;
  state.lastViews = Math.max(30, Math.floor(80 + state.fans * 0.45 + correspondingAbility * 12));
  state.likes = Math.min(state.lastViews, Math.floor(state.lastViews * Math.min(0.96, 0.35 + correspondingAbility / 250)));
  state.dislikes = Math.max(1, Math.floor(state.lastViews * Math.max(0.01, 0.16 - correspondingAbility / 500)));
  const values = [state.game, state.song, state.talk];
  const balance = Math.max(0.35, Math.min(...values) / Math.max(...values));
  const repeatPenalty = Math.max(0.35, 1 - (state.liveTypeStreak - 1) * 0.12);
  const fanGain = Math.floor((state.lastViews / 8) * 0.45 * balance * repeatPenalty);
  state.fans += fanGain;
  state.currentLiveSC = 0;
  state.activeStreamId = `live-${Date.now()}`;
  state.streamHistory.unshift({
    id: state.activeStreamId,
    type,
    views: state.lastViews,
    likes: state.likes,
    dislikes: state.dislikes,
    sc: 0
  });
  state.logs.unshift(`完成${streamLabel(type)}直播，觀看 ${state.lastViews} 人`);
  save();
  showLiveScreen();
}

function showLiveScreen() {
  isLive = true;
  currentPage = 'stream';
  updateHeader();
  const background = state.liveType === 'game' ? state.bgGame : state.liveType === 'song' ? state.bgSong : state.bgTalk;
  $('#page').innerHTML = `
    <div class="card liveCard">
      <p class="eyebrow">LIVE NOW · ${escapeHtml(state.name)}</p>
      <h2>${streamLabel(state.liveType)}直播</h2>
      <div class="live fixedLive">
        <div class="stage">
          <img class="streamBg" src="${asset(background, 'game-background.png')}" alt="">
          <div class="actorMotion">${portraitMarkup()}</div>
          <span class="spark s1">✦</span><span class="spark s2">✧</span><span class="spark s3">⋆</span>
        </div>
        <div class="chat fixedChat"><b>${escapeHtml(state.name)} 的聊天室</b><div id="chatfeed"></div></div>
      </div>
      <p>觀看 ${state.lastViews}　👍 ${state.likes}　👎 ${state.dislikes}　💵 <span id="liveMoney">0</span>　<button id="endLive">結束直播</button></p>
    </div>`;
  playBgm(state.liveType);
  startChatTimers();
}

function endLive(showHistory = true) {
  isLive = false;
  state.activeStreamId = null;
  save();
  stopLiveTimers();
  stopBgm();
  if (showHistory) render('live');
}

const CHAT_IDS = ['Luna','Mochi','Pixel','Nova','Aster','Maple','Clover','Misty','Sunny','Echo','Rin','Kai','Mika','Yuki','Neko','Panda','Comet','Velvet','Cloud','Berry','Sora','Nina','Coco','Kira','Mint','Ruby','Skye','Ivy','Lucky','Poppy'];
const CHAT = {
  game: {
    bad: ['這操作也太危險了吧','敵人都要睡著了','這局真的看不懂','快轉到下一場','這走位是迷路了嗎','手把是不是壞掉了','剛剛那波真的太可惜','先看一下教學吧','這關卡有這麼難嗎','怎麼又回到原點了'],
    good: ['這波打得漂亮','看得出來有進步','這場節奏很舒服','關鍵時刻穩住了','剛剛那個反應太快了','這次連招很順','逆轉得好精彩','今天手感很好','這操作值得掌聲','這局真的有料']
  },
  song: {
    bad: ['音準有點危險','這段聽起來好慘','麥克風是不是卡住了','先休息一下吧','副歌好像有點飄','今天聲音不在狀態','這首是不是太勉強了','換首歌也許比較好','我有點擔心你的喉嚨','拍子好像跑掉了'],
    good: ['好好聽','這首唱得很漂亮','聲音真的很舒服','這就是神回','高音太穩了吧','情緒唱得好細膩','這首歌很適合你','氣息控制太強','尾音好有感覺','想把這段重播十次']
  },
  talk: {
    bad: ['氣氛有點尷尬','今天狀態不太行','這話題好無聊','安靜到我快睡著了','是不是有點冷場','這個故事還沒講完嗎','聊天室也不知道回什麼','今天的節奏比較慢','話題好像繞回去了','要不要換個話題'],
    good: ['聊天好舒服','這話題很有趣','看得出來準備得很用心','真的很喜歡這種雜談','這個觀點很有意思','講故事的方式好有趣','今天笑點好多','這段分享很溫暖','時間過得好快','可以一直聽你聊下去']
  },
  mixed: ['有點精彩又有點危險','這波可以但下一波不好說','我先不下結論','偶爾會突然失誤','今天狀態起伏很大','有亮點但還能更穩','這場比剛剛好多了','我覺得可以再給一點時間','好壞都有，先繼續看','意外地有點上頭'],
  black: ['又開始了','這也值得吹嗎','粉絲濾鏡太厚了吧','先冷靜一點好嗎','剛剛那段真的不行','大家是不是太寬容了','我看不出來哪裡厲害','這樣也能叫神回嗎'],
  idol: ['神回來了','這就是天才','請收下我的訂閱','永遠支持你','這場我要看十遍','太尊了','已經離不開這個台','主播請收下我的心','今天也被治癒了','這個台永遠是我的家']
};

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function nextChatLine() {
  const score = ability(state.liveType);
  const typeMessages = CHAT[state.liveType] || CHAT.talk;
  let pool;
  if (score <= 200) pool = typeMessages.bad;
  else if (score <= 500) pool = Math.random() < 0.5 ? CHAT.mixed : typeMessages.bad;
  else if (score <= 900) pool = Math.random() < 0.25 ? CHAT.black : typeMessages.good;
  else pool = CHAT.idol;
  let message;
  do message = randomItem(pool); while (recentChatMessages.includes(message) && pool.length > 1);
  recentChatMessages.unshift(message);
  if (recentChatMessages.length > 8) recentChatMessages.pop();
  const id = `${randomItem(CHAT_IDS)}${10 + Math.floor(Math.random() * 990)}`;
  return { id, message: `${message} ${chatEmoji(message)}` };
}

function chatEmoji(text) {
  const positive = /神回|天才|支持|喜歡|努力|進步|漂亮|好聽|舒服|掌聲|穩|精彩|溫暖|有趣|治癒|訂閱|太尊/;
  const negative = /危險|睡著|看不懂|快轉|迷路|壞掉|可惜|不行|無聊|尷尬|冷場|失誤|勉強|跑掉|太難|原點/;
  const question = /嗎|是不是|要不要|怎麼|哪裡|好像|吧/;
  const pool = positive.test(text)
    ? ['💗','✨','👏','🎉','😊','🫶']
    : negative.test(text)
      ? ['💀','🙃','🤨','😬','🤦','😮‍💨']
      : question.test(text)
        ? ['🤔','🫤','❓','😅']
        : ['✨','👏','😊','😅'];
  return randomItem(pool);
}

function startChatTimers() {
  stopLiveTimers();
  const interval = Math.max(850, 3600 - state.fans * 7);
  chatTimer = setInterval(() => {
    const feed = $('#chatfeed');
    if (!feed) return stopLiveTimers();
    const line = nextChatLine();
    const row = document.createElement('p');
    row.innerHTML = `<b>${line.id}：</b>${line.message}`;
    feed.prepend(row);
    while (feed.children.length > 14) feed.lastElementChild.remove();
  }, interval);
  scTimer = setInterval(trySuperChat, 1800);
}

function stopLiveTimers() {
  clearInterval(chatTimer);
  clearInterval(scTimer);
  chatTimer = null;
  scTimer = null;
}

function trySuperChat() {
  const feed = $('#chatfeed');
  if (!feed || !isLive) return;
  const score = ability(state.liveType);
  const chance = score <= 200 ? 0.05 : score <= 500 ? 0.10 : score <= 900 ? 0.20 : 0.50;
  if (Math.random() >= chance) return;
  const amount = 50 + Math.floor(Math.random() * (80 + score / 4 + state.fans / 100));
  state.money += amount;
  state.currentLiveSC += amount;
  const activeRecord = state.streamHistory.find(record => record.id === state.activeStreamId);
  if (activeRecord) activeRecord.sc = state.currentLiveSC;
  save();
  updateHeader();
  $('#liveMoney').textContent = state.currentLiveSC;
  const messages = ['今天的直播超棒！','一直都有在看，繼續加油！','你的努力我們都有看到！','這場直播讓我心情變好了！','支持你，慢慢來就好！','今天也很喜歡你的直播！','謝謝你帶來這麼棒的內容！','你的進步真的很明顯！'];
  const row = document.createElement('p');
  row.className = `superChat sc-${amount >= 1000 ? 'ultra' : amount >= 500 ? 'high' : amount >= 200 ? 'medium' : 'low'}`;
  row.innerHTML = `<b>💰 SUPER CHAT</b><br>${randomItem(messages)}　+${amount} 資金`;
  feed.prepend(row);
}

function graduationCheck() {
  if (state.day % 7 !== 0 || state.lastGraduationCheck === state.day || state.graduated) return;
  state.lastGraduationCheck = state.day;
  const target = targetForDay();
  if (state.fans >= target) {
    state.logs.unshift(`第 ${state.day} 天人氣達標（${state.fans} / ${target}）`);
    save();
    alert(`恭喜！第 ${state.day} 天人氣檢定通過。`);
    return;
  }
  state.graduated = true;
  save();
  showGraduationModal(target);
}

function showGraduationModal(target) {
  const modal = document.createElement('div');
  modal.id = 'graduationModal';
  modal.innerHTML = `<div class="graduation-dialog">
    <p class="eyebrow">GRADUATION NOTICE</p><h2>畢業公告</h2>
    <p>第 ${state.day} 天人氣為 <b>${state.fans}</b>，未達目標 <b>${target}</b>。</p>
    <div class="graduation-actions"><button id="rebirthBtn">轉生，繼承能力與資金</button><button id="quitBtn">放棄遊戲</button></div>
  </div>`;
  document.body.appendChild(modal);
  $('#rebirthBtn').onclick = rebirth;
  $('#quitBtn').onclick = () => {
    modal.querySelector('.graduation-dialog').innerHTML = '<p class="eyebrow">GAME OVER</p><h2>遊戲結束</h2><p>重新整理頁面即可再次開始。</p>';
  };
}

function rebirth() {
  const inherited = {
    name: state.name,
    image: state.image,
    money: state.money,
    game: state.game,
    song: state.song,
    talk: state.talk,
    bgGame: state.bgGame,
    bgSong: state.bgSong,
    bgTalk: state.bgTalk
  };
  state = Object.assign({}, DEFAULT_STATE, inherited);
  save();
  $('#graduationModal')?.remove();
  render('info');
}

function ensureAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
}

function playClickSound() {
  ensureAudio();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.frequency.value = 520;
  oscillator.type = 'sine';
  gain.gain.setValueAtTime(0.25 * Number(localStorage.getItem('astraSfxVolume') || 0.5), audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.05);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.05);
}

function playBgm(type) {
  stopBgm();
  const file = type === 'game' ? 'game.mp3' : type === 'song' ? 'song.mp3' : 'talk.mp3';
  bgmAudio = new Audio(`audio/${file}`);
  bgmAudio.loop = true;
  bgmAudio.volume = Number(localStorage.getItem('astraBgmVolume') || 0.2);
  bgmAudio.play().catch(() => {});
}

function stopBgm() {
  if (!bgmAudio) return;
  bgmAudio.pause();
  bgmAudio.currentTime = 0;
  bgmAudio = null;
}

function readImage(file, callback) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => callback(reader.result);
  reader.readAsDataURL(file);
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button) playClickSound();
  const navButton = event.target.closest('[data-p]');
  if (navButton) return render(navButton.dataset.p);
  const startButton = event.target.closest('[data-start]');
  if (startButton) return startLive(startButton.dataset.start);
  const buyButton = event.target.closest('[data-buy]');
  if (buyButton) return buyTraining(buyButton.dataset.buy);
  const job = event.target.closest('[data-job]');
  if (job) return doJob(job.dataset.job);
  const restButton = event.target.closest('[data-rest]');
  if (restButton) return rest(restButton.dataset.rest);
  if (event.target.closest('#endLive')) return endLive();
  if (event.target.closest('.editable-portrait')) $('#avatarInput')?.click();
  if (event.target.closest('#reset')) {
    if (confirm('確定要重置進度嗎？資金、能力、人氣、直播紀錄與角色設定都會遺失。')) {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    }
  }
});

document.addEventListener('change', event => {
  if (event.target.id === 'channelName') {
    state.name = event.target.value.trim() || 'Asteria';
    save();
    updateHeader();
  }
  if (event.target.id === 'avatarInput') {
    readImage(event.target.files[0], result => {
      state.image = result;
      save();
      render('info');
    });
  }
  const backgroundKey = event.target.dataset.background;
  if (backgroundKey) {
    readImage(event.target.files[0], result => {
      state[backgroundKey] = result;
      save();
      render('info');
    });
  }
});

window.addEventListener('beforeunload', stopBgm);

const style = document.createElement('style');
style.textContent = `
  .dashboard-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .status-hero{display:flex;gap:18px;align-items:center}
  .status-hero .portrait{width:150px;height:210px;flex:0 0 150px;background-position:center top;background-size:cover}
  .editable-portrait{cursor:pointer}.editable-portrait:hover{outline:2px solid #ff79b7}
  .status-details{flex:1}.status-details input{font-size:22px;font-weight:bold;margin-bottom:14px}
  .dashboard-backgrounds{margin-top:18px}.background-preview-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .background-preview-grid img{width:100%;height:78px;object-fit:cover;border-radius:8px;display:block;margin-bottom:7px}
  .background-preview-grid small{display:block;margin-bottom:6px}.background-preview-grid input{font-size:10px;padding:5px}
  .ability-fill{position:absolute;inset:10px 20px;width:calc(100% - 40px);height:calc(100% - 10px);pointer-events:none;z-index:1}
  .ability-fill polygon{fill:#ff79b7;fill-opacity:.38}.triangle span{z-index:2}
  .video-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:18px}
  .video-grid .video{display:block;width:auto;min-width:0;margin:0;padding:10px}
  .video-grid .thumb{width:100%;height:auto;aspect-ratio:16/9;margin:0;background-size:contain;background-position:center bottom}
  .video-info{padding:10px 3px 4px}
  .video-title{min-height:2.8em;overflow:hidden;font-size:15px;font-weight:700;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .video-meta{display:block;margin-top:5px;color:#9999ad;font-size:12px}
  .fixedLive{height:460px;max-height:460px;overflow:hidden}
  .fixedLive .stage{position:relative;overflow:hidden;background:#151827}
  .streamBg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
  .actorMotion{position:absolute;inset:10px 0 -10px;display:flex;align-items:flex-end;justify-content:center;z-index:2;animation:idleBreath 4.6s ease-in-out infinite}
  .actorMotion .portrait{position:static;width:100%;height:100%;background-size:auto 100%;background-position:center bottom;background-repeat:no-repeat;background-color:transparent}
  .fixedChat{flex:0 0 220px;height:420px;overflow:hidden}.fixedChat #chatfeed{height:390px;overflow:hidden}
  .superChat{padding:9px 11px;border-radius:8px}.sc-low{background:#087f8c;color:#d8ffff}.sc-medium{background:#1769aa;color:#e1f2ff}.sc-high{background:#7542a8;color:#f4e7ff}.sc-ultra{background:#a5532e;color:#ffe4a8}
  #graduationModal{position:fixed;inset:0;z-index:9999;background:rgba(8,9,16,.82);display:grid;place-items:center;padding:20px}
  .graduation-dialog{max-width:460px;background:#1d1e2d;border:1px solid #ff79b7;border-radius:17px;padding:28px}
  .graduation-actions{display:flex;gap:10px;margin-top:22px}.graduation-actions button{flex:1}
  @keyframes idleBreath{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-3px) scale(1.008)}}
  @media(max-width:900px){.video-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:780px){.dashboard-grid{grid-template-columns:1fr}.status-hero{align-items:flex-start}.background-preview-grid{grid-template-columns:1fr}.fixedLive{height:auto;max-height:none}}
  @media(max-width:560px){.video-grid{grid-template-columns:1fr}}
`;
document.head.appendChild(style);

if (!$('[data-p="rules"]')) {
  const rulesButton = document.createElement('button');
  rulesButton.className = 'nav';
  rulesButton.dataset.p = 'rules';
  rulesButton.innerHTML = 'ⓘ　<span>遊戲規則</span>';
  $('.side nav').appendChild(rulesButton);
}

save();
render('info');
