const $ = (s) => document.querySelector(s);
const lobby = $('#lobby'), game = $('#game'), shell = $('.shell'), canvas = $('#arena'), ctx = canvas.getContext('2d');
const knightLabels={sword:'剣士',archer:'弓兵',mage:'魔導士',lancer:'槍兵'};
const defaultMageMpCost=25;
const portraitSources={princess:'/img/characters/princess.png',knight:'/img/characters/knight.png',knightBuff:'/img/characters/knight-buff.png',boss:'/img/characters/boss.png',tai:'/img/characters/tai.png',bejiTa:'/img/characters/beji-ta.png',doubutuen:'/img/characters/doubutuen.png'};
const portraits=Object.fromEntries(Object.entries(portraitSources).map(([key,src])=>{const image=new Image();image.src=src;return [key,image];}));
const enemyPortraitKey=type=>type==='boss'?'boss':type==='grunt'?'tai':type==='ranger'?'bejiTa':'doubutuen';
function drawPortrait(image,x,y,height){if(!image?.complete||!image.naturalWidth)return false;const width=height*image.naturalWidth/image.naturalHeight;ctx.drawImage(image,x-width/2,y-height/2,width,height);return true;}
const arenaWrap=$('.arena-wrap'),aimControls=document.createElement('div'),mobileBuff=document.createElement('button');
const bossCutin=document.createElement('div');let bossCutinShownFor='',bossCutinTimer;
bossCutin.className='boss-cutin';bossCutin.innerHTML='<div class="boss-cutin-stripe"></div><img src="/img/characters/boss.png" alt="ボス"><div class="boss-cutin-copy"><span>FINAL WAVE</span><strong>BOSS APPEARS</strong><b>小野の高校の落書き</b></div>';arenaWrap.append(bossCutin);
function showBossCutin(){clearTimeout(bossCutinTimer);bossCutin.classList.remove('active');void bossCutin.offsetWidth;bossCutin.classList.add('active');bossCutinTimer=setTimeout(()=>bossCutin.classList.remove('active'),1800);}
const upgradeWait=document.createElement('div');upgradeWait.className='upgrade-wait hidden';upgradeWait.innerHTML='<span>⌛</span><b>他ユーザーが強化内容を選択中</b><small>選択が終わるまで少し待ってね</small>';arenaWrap.append(upgradeWait);
const howToButton=document.createElement('button'),homeHowToButton=document.createElement('button'),howToModal=document.createElement('div');
howToButton.id='howToBtn';howToButton.className='how-to-play hidden';howToButton.type='button';howToButton.textContent='遊び方';$('#startBtn').before(howToButton);
homeHowToButton.id='homeHowToBtn';homeHowToButton.className='home-how-to-play';homeHowToButton.type='button';homeHowToButton.textContent='遊び方';$('#joinForm').append(homeHowToButton);
howToModal.id='howToModal';howToModal.className='how-to-modal hidden';howToModal.setAttribute('role','dialog');howToModal.setAttribute('aria-modal','true');howToModal.setAttribute('aria-labelledby','howToTitle');howToModal.innerHTML='<div class="how-to-card"><button class="how-to-close" id="howToClose" type="button" aria-label="遊び方を閉じる">×</button><p class="how-to-kicker">CHARACTER GUIDE</p><h2 id="howToTitle">キャラごとの操作と特徴</h2><div class="how-to-step"><b>♕ 姫 — 仕留め役</b><span>移動はできない。カーソルの円をクリックして範囲攻撃。<kbd>Q</kbd> でナイト全員を加護する。</span></div><div class="how-to-step"><b>⚔ ナイト共通 — 護衛役</b><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> で移動。敵は近づくと自動で攻撃する。</span></div><div class="how-to-step"><b>剣士 — 近距離の広範囲</b><span>正面を広く斬る。近接弱点の敵を素早く削れる。</span></div><div class="how-to-step"><b>弓兵 — 遠距離の連射</b><span>離れた位置から安全に削れる。遠隔弱点の敵にも強い。</span></div><div class="how-to-step"><b>魔導士 — 範囲攻撃</b><span>MPを使う魔導弾。<kbd>SPACE</kbd> で発射し、敵をまとめて攻撃。</span></div><div class="how-to-step"><b>槍兵 — 長い直線攻撃</b><span>正面の遠い敵にも届く。敵との距離を保って突くのが得意。</span></div><button class="primary how-to-done" id="howToDone" type="button">わかった <span>♡</span></button></div>';document.body.append(howToModal);
function closeHowTo(){ howToModal.classList.add('hidden'); }
function openHowTo(){ howToModal.classList.remove('hidden'); }
howToButton.addEventListener('click',openHowTo);homeHowToButton.addEventListener('click',openHowTo);$('#howToClose').addEventListener('click',closeHowTo);$('#howToDone').addEventListener('click',closeHowTo);howToModal.addEventListener('click',ev=>{if(ev.target===howToModal)closeHowTo();});
aimControls.id='aimControls';aimControls.className='aim-controls hidden';aimControls.innerHTML='<div class="joystick aim-joystick" id="aimJoystick" aria-label="照準・攻撃スティック"><span class="aim-reticle">⊙</span><div class="joy-knob aim-knob" id="aimKnob"></div></div><span class="touch-hint">照準を合わせて攻撃</span>';arenaWrap.append(aimControls);
mobileBuff.id='mobileBuff';mobileBuff.className='mobile-buff hidden';mobileBuff.innerHTML='姫バフ<br><small>READY</small>';arenaWrap.append(mobileBuff);
const mobileCast=document.createElement('button');mobileCast.id='mobileCast';mobileCast.className='mobile-cast hidden';mobileCast.innerHTML='魔導弾<br><small>SPACE</small>';arenaWrap.append(mobileCast);
let socket, state, myId, keyState = {}, lastInput = '', running = false, upgradePending = false, currentRole='knight', aimX=1, aimY=0, aimDistance=220, mouseAttack=false, aimPointer=null;

function connect(action, room, name) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}`);
  socket.addEventListener('open', () => socket.send(JSON.stringify({type:action, room, name, knightType:$('#knightType').value})));
  socket.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'you') { myId = msg.id; return; }
    if (msg.type === 'error') { $('#formNote').textContent = msg.text; $('#formNote').style.color = '#f18aa8'; leave(); return; }
    if (msg.type === 'state') { state = msg; renderState(); }
  });
  socket.addEventListener('close', () => { if (running) { $('#formNote').textContent='接続が切れました。もう一度お試しください'; leave(); } });
}
function leave() { running = false; if (socket && socket.readyState < 2) socket.close(); socket = null; state = null; game.classList.add('hidden'); lobby.classList.remove('hidden'); shell.classList.remove('game-open'); }
function enterRoom(action) {
  const room = $('#room').value.trim().toUpperCase(), name = $('#name').value.trim();
  if (!name) { showFormError('プレイヤー名を入力してください'); return; }
  if (action === 'join' && room.length < 4) { showFormError('部屋コードは4文字以上で入力してください'); return; }
  myId = null; state = null; lastInput = ''; lobby.classList.add('hidden'); game.classList.remove('hidden'); shell.classList.add('game-open'); running = true; $('#formNote').style.color=''; connect(action,room,name);
}
function showFormError(message) { $('#formNote').textContent=message; $('#formNote').style.color='#f18aa8'; }
$('#joinForm').addEventListener('submit', ev => { ev.preventDefault(); enterRoom('join'); });
$('#createRoom').addEventListener('click', () => enterRoom('create'));
$('#room').addEventListener('input', ev => ev.target.value = ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''));
$('#startBtn').addEventListener('click', () => socket?.send(JSON.stringify({type:'start'})));
$('#addBotBtn').addEventListener('click', () => socket?.send(JSON.stringify({type:'addBot',knightType:$('#botKnightType').value})));
$('#leaveBtn').addEventListener('click', leave); $('#returnBtn').addEventListener('click', leave);
$('#upgradeOverlay').addEventListener('click',ev=>{const button=ev.target.closest('[data-upgrade]');if(button)socket?.send(JSON.stringify({type:'upgrade',choice:button.dataset.upgrade}));});
mobileBuff.addEventListener('click',()=>socket?.send(JSON.stringify({type:'buff'})));
mobileCast.addEventListener('click',()=>socket?.send(JSON.stringify({type:'cast'})));
$('#copyBtn').addEventListener('click', async () => {
  if (!state?.room) return;
  try { await navigator.clipboard.writeText(state.room); }
  catch {
    const input=document.createElement('textarea');input.value=state.room;input.setAttribute('readonly','');input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();document.execCommand('copy');input.remove();
  }
  $('#copyLabel').textContent='コピー済み ✓';
  setTimeout(()=>$('#copyLabel').textContent='コピー',1600);
});
function renderState() {
  if (!state) return;
  if (!myId) return;
  const me = state.players.find(p=>p.id===myId), princess=state.players.find(p=>p.role==='princess');
  currentRole=me?.role||'knight';
  $('#roomLabel').textContent=state.room; $('#roomCode').textContent=state.room; $('#playerCount').textContent=state.players.length;
  $('#levelLabel').textContent=`LV ${me?.level||1}`;$('#xpText').textContent=`${Number(me?.xp||0).toFixed(1).replace(/\.0$/,'')} / ${me?.nextXp||3} XP`;$('#xpFill').style.width=`${Math.min(100,100*(me?.xp||0)/(me?.nextXp||3))}%`;
  $('#levelHud').classList.toggle('hidden',state.phase!=='playing');
  $('#waveLabel').textContent=state.wave===5?'BOSS / WAVE 5':`WAVE ${state.wave||1} / 5`;
  const bossCutinKey=state.phase==='playing'&&state.wave===5?state.room:'';if(!bossCutinKey)bossCutinShownFor='';else if(bossCutinShownFor!==bossCutinKey){bossCutinShownFor=bossCutinKey;showBossCutin();}
  $('#roster').innerHTML=state.players.map(p=>`<div class="roster-item"><span class="avatar ${p.role==='knight'?'knight':''}">${p.role==='princess'?'♕':'⚔'}</span><b>${escapeHtml(p.name)}</b><span class="role">${p.role==='princess'?'姫':p.isBot?`${knightLabels[p.knightType]||'ナイト'}・テストBot`:`${knightLabels[p.knightType]||'ナイト'}・ナイト`}${p.id===myId?' · あなた':''}</span></div>`).join('');
  const host=state.players[0]?.id===myId, canStart=host&&state.phase==='lobby'&&state.players.length>=2;
  const pending=!!me?.pendingUpgrade;
  const gamePaused=state.players.some(p=>p.pendingUpgrade);
  $('#upgradeOverlay').classList.toggle('hidden',!pending);
  upgradeWait.classList.toggle('hidden',!gamePaused||pending);
  $('#upgradePlayer').textContent=`${me?.name||'プレイヤー'} がレベルアップ！ LV ${me?.level||1}`;
  const choices=$('.upgrade-options'), choiceRole=me?.role||'knight';
  if(choices.dataset.role!==choiceRole){
    choices.dataset.role=choiceRole;
    if(choiceRole==='princess') choices.innerHTML='<button class="upgrade-choice" data-upgrade="knightXp"><span class="upgrade-icon">✦</span><span><b>ナイトの獲得XP +25%</b><small>ナイトが得る経験値が増加</small></span><span class="upgrade-arrow">→</span></button><button class="upgrade-choice" data-upgrade="knightPower"><span class="upgrade-icon">⚔</span><span><b>ナイトの攻撃力 +15%</b><small>全ナイトのダメージが増加</small></span><span class="upgrade-arrow">→</span></button><button class="upgrade-choice" data-upgrade="buffPower"><span class="upgrade-icon">♕</span><span><b>加護の効果時間 +25%</b><small>姫の加護が長く続く</small></span><span class="upgrade-arrow">→</span></button>';
    else choices.innerHTML='<button class="upgrade-choice" data-upgrade="power"><span class="upgrade-icon">✦</span><span><b>攻撃力</b><small>与えるダメージ +25%</small></span><span class="upgrade-arrow">→</span></button><button class="upgrade-choice" data-upgrade="attackSpeed"><span class="upgrade-icon">➤</span><span><b>攻撃速度</b><small>攻撃間隔を短縮 +20%</small></span><span class="upgrade-arrow">→</span></button><button class="upgrade-choice" data-upgrade="moveSpeed"><span class="upgrade-icon">➜</span><span><b>移動速度</b><small>移動速度 +15%</small></span><span class="upgrade-arrow">→</span></button>';
  }
  $('#touchControls').classList.toggle('hidden',state.phase!=='playing'||pending||me?.role!=='knight');
  $('#aimControls').classList.toggle('hidden',state.phase!=='playing'||pending||me?.role!=='princess');
  $('#mobileBuff').classList.toggle('hidden',state.phase!=='playing'||me?.role!=='princess');
  $('#mobileBuff').disabled=(me?.buffCooldown||0)>0;
  $('#mobileBuff').innerHTML=(me?.buffCooldown||0)>0?`姫バフ<br><small>${Math.ceil(me.buffCooldown/1000)}秒</small>`:'姫バフ<br><small>READY</small>';
  const isMage=me?.role==='knight'&&me.knightType==='mage';
  $('#mpHud').classList.toggle('hidden',state.phase!=='playing'||!isMage);
  $('#mpFill').style.width=`${100*(me?.mp||0)/(me?.maxMp||100)}%`;
  $('#mpText').textContent=`${Math.floor(me?.mp||0)} / ${me?.maxMp||100}`;
  mobileCast.classList.toggle('hidden',state.phase!=='playing'||!isMage||gamePaused||!window.matchMedia('(pointer: coarse)').matches);
  const mpCost=me?.mpCost||defaultMageMpCost;
  mobileCast.disabled=(me?.mp||0)<mpCost||!!me?.disabled||gamePaused;
  mobileCast.innerHTML=(me?.mp||0)<mpCost?'魔導弾<br><small>MP不足</small>':'魔導弾<br><small>発射</small>';
  $('#controlsHint').innerHTML=me?.role==='princess'?'姫は移動なし <span class="separator">·</span> 照準＋クリック攻撃 <span class="separator">·</span> <kbd>Q</kbd> 加護':isMage?`<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移動 <span class="separator">·</span> <kbd>SPACE</kbd> 魔導弾（MP消費）`:`<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移動 <span class="separator">·</span> ${knightLabels[me?.knightType]||'ナイト'}攻撃オート`;
  if(pending!==upgradePending){upgradePending=pending;keyState={};lastInput='';syncInput();}
  const canAddBot=host&&state.players.length<5&&(state.phase==='lobby'||state.phase==='playing');
  $('#botControls').classList.toggle('hidden',!canAddBot); $('#startBtn').classList.toggle('hidden',!canStart); $('#waitingNote').textContent=state.players.length<2?'テストBotを追加すると開始できます':host?'ゲームを開始できます':'ホストが開始するのを待っています';
  howToButton.classList.toggle('hidden',state.phase!=='lobby'); if(state.phase!=='lobby')closeHowTo();
  $('#lobbyOverlay').classList.toggle('hidden',state.phase!=='lobby'); $('#toast').textContent=state.message||'';
  if (princess) { $('#healthFill').style.width=`${princess.hp}%`; $('#healthText').textContent=princess.hp; }
  const seconds=Math.ceil(state.time); $('#timer').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  const over=state.phase==='clear'||state.phase==='over'; $('#resultOverlay').classList.toggle('hidden',!over);
  if (over) { const clear=state.phase==='clear'; $('#resultIcon').textContent=clear?'✦':'♡'; $('#resultTitle').textContent=clear?'GAME CLEAR':'GAME OVER'; $('#resultText').textContent=state.message; }
  draw(state,me);
}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function draw(s,me) {
  const dpr=window.devicePixelRatio||1, rect=canvas.getBoundingClientRect(); if (!rect.width||!rect.height)return;
  if(canvas.width!==Math.round(rect.width*dpr)||canvas.height!==Math.round(rect.height*dpr)){canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0); const w=rect.width,h=rect.height;
  ctx.fillStyle='#f7eff8';ctx.fillRect(0,0,w,h);
  const mapScale=Math.min(w/2000,h/2000), world=(x,y)=>({x:w/2+x*mapScale,y:h/2+y*mapScale});
  const mapTopLeft=world(-1000,-1000),mapBottomRight=world(1000,1000);
  ctx.fillStyle='#f4e8f2';ctx.fillRect(0,0,w,h);ctx.fillStyle='#fffafd';ctx.fillRect(mapTopLeft.x,mapTopLeft.y,mapBottomRight.x-mapTopLeft.x,mapBottomRight.y-mapTopLeft.y);
  ctx.save();ctx.beginPath();ctx.rect(mapTopLeft.x,mapTopLeft.y,mapBottomRight.x-mapTopLeft.x,mapBottomRight.y-mapTopLeft.y);ctx.clip();
  ctx.strokeStyle='#f2d9e8';ctx.lineWidth=1;const spacing=Math.max(1,48*mapScale),ox=mapTopLeft.x%spacing,oy=mapTopLeft.y%spacing;
  for(let x=ox;x<w;x+=spacing){ctx.beginPath();ctx.moveTo(x,mapTopLeft.y);ctx.lineTo(x,mapBottomRight.y);ctx.stroke()}for(let y=oy;y<h;y+=spacing){ctx.beginPath();ctx.moveTo(mapTopLeft.x,y);ctx.lineTo(mapBottomRight.x,y);ctx.stroke()}
  for(const e of s.enemies){const p=world(e.x,e.y),boss=e.type==='boss',r=e.radius||11,color=boss?'#ee617f':e.type==='ranger'?'#e8ae68':e.type==='disruptor'?'#b88af0':e.type==='bulwark'?'#9baac0':e.type==='shade'?'#75e0f0':'#db806c',portraitHeight=boss?116:50;if(p.x < -70||p.x>w+70||p.y < -70||p.y>h+70)continue;ctx.save();ctx.globalAlpha=.22;ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(p.x,p.y+portraitHeight*.34,boss?43:20,boss?13:7,0,0,Math.PI*2);ctx.fill();ctx.restore();if(!drawPortrait(portraits[enemyPortraitKey(e.type)],p.x,p.y,portraitHeight)){ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();}const bw=boss?72:36,barY=p.y-portraitHeight/2-8;ctx.fillStyle='#33303a';ctx.fillRect(p.x-bw/2,barY,bw,4);ctx.fillStyle=boss?'#ff7690':color;ctx.fillRect(p.x-bw/2,barY,bw*Math.max(0,e.hp/e.maxHp),4);if(boss){ctx.font='10px Manrope';ctx.textAlign='center';ctx.fillStyle='#c93d64';ctx.fillText('BOSS',p.x,barY-7);}}
  for(const e of s.enemies){if(e.type!=='bulwark'&&e.type!=='shade')continue;const p=world(e.x,e.y),portraitHeight=50;ctx.font='9px "Noto Sans JP"';ctx.textAlign='center';ctx.fillStyle=e.type==='bulwark'?'#75501c':'#17606a';ctx.fillText(e.type==='bulwark'?'近接弱点':'遠隔弱点',p.x,p.y-portraitHeight/2-17);}
  for(const effect of s.effects||[]){const p=world(effect.x,effect.y),progress=Math.min(1,(Date.now()-effect.createdAt)/effect.duration),princessBurst=effect.type==='princessBurst';ctx.save();ctx.globalAlpha=1-progress;ctx.fillStyle=princessBurst?'#ff73aa55':'#70418c55';ctx.strokeStyle=princessBurst?'#ec4d8f':'#67377f';ctx.lineWidth=2;ctx.shadowColor=princessBurst?'#ff78af':'#734191';ctx.shadowBlur=18;ctx.beginPath();ctx.arc(p.x,p.y,effect.radius*mapScale*(princessBurst ? (.7+progress*.3) : progress),0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();}
  for(const orb of s.xpOrbs||[]){const p=world(orb.x,orb.y);if(p.x < -20||p.x>w+20||p.y < -20||p.y>h+20)continue;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.PI/4);ctx.fillStyle='#348774';ctx.shadowColor='#286c5d';ctx.shadowBlur=13;ctx.fillRect(-5,-5,10,10);ctx.restore();}
  for(const shot of s.enemyShots||[]){const a=world(shot.x-shot.vx*.045,shot.y-shot.vy*.045),b=world(shot.x,shot.y),color=shot.type==='seal'?'#70428d':'#a93f46';ctx.save();ctx.lineCap='round';ctx.strokeStyle=color;ctx.lineWidth=4;ctx.shadowColor=color;ctx.shadowBlur=13;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore();}
  for(const shot of s.projectiles||[]){const a=world(shot.px,shot.py),b=world(shot.x,shot.y),color=shot.weapon==='sword'?'#98671b':shot.weapon==='orb'?'#734191':shot.weapon==='spear'?'#34765f':shot.role==='princess'?'#96601a':'#4d64a6';ctx.save();ctx.lineCap='round';ctx.strokeStyle=color;ctx.lineWidth=shot.weapon==='orb'?7:shot.weapon==='sword'?5:shot.weapon==='arrow'?2.5:3;ctx.shadowColor=color;ctx.shadowBlur=13;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();if(shot.weapon==='arrow'){ctx.translate(b.x,b.y);ctx.rotate(Math.atan2(shot.vy,shot.vx));ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(7,0);ctx.lineTo(-5,-4);ctx.lineTo(-2,0);ctx.lineTo(-5,4);ctx.closePath();ctx.fill();}else{ctx.fillStyle='#503a50';ctx.beginPath();ctx.arc(b.x,b.y,shot.weapon==='orb'?4:2.5,0,Math.PI*2);ctx.fill();}ctx.restore();}
  for(const p of s.players){const q=world(p.x,p.y),isPrincess=p.role==='princess',isBuffed=s.buffActive&&p.role==='knight',color=isPrincess?'#9f395f':'#485f9e',portraitHeight=isPrincess?48:isBuffed?82:58;if(isBuffed){ctx.strokeStyle='#f3b52f';ctx.lineWidth=3;ctx.shadowColor='#ffd86b';ctx.shadowBlur=14;ctx.beginPath();ctx.arc(q.x,q.y,39,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;}ctx.save();ctx.globalAlpha=.22;ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(q.x,q.y+portraitHeight*.34,isBuffed?34:23,8,0,0,Math.PI*2);ctx.fill();ctx.restore();if(!drawPortrait(portraits[isPrincess?'princess':isBuffed?'knightBuff':'knight'],q.x,q.y,portraitHeight)){ctx.fillStyle=color;ctx.beginPath();ctx.arc(q.x,q.y,9,0,Math.PI*2);ctx.fill();}ctx.font='10px Manrope, sans-serif';ctx.textAlign='center';ctx.fillStyle=p.id===myId?'#57304b':'#72586b';ctx.fillText(p.name,q.x,q.y-portraitHeight/2-10);if(isPrincess){ctx.font='13px sans-serif';ctx.fillStyle='#896019';ctx.fillText('♕',q.x,q.y-portraitHeight/2-20);}if(p.disabled){ctx.font='12px sans-serif';ctx.fillStyle='#70428d';ctx.fillText('封',q.x+24,q.y-12);}}
  for(const p of s.players){if(p.role!=='knight'||Date.now()>=p.attackFlashUntil)continue;const q=world(p.x,p.y),progress=1-Math.max(0,p.attackFlashUntil-Date.now())/220,angle=Math.atan2(p.attackFacingY,p.attackFacingX);ctx.save();ctx.translate(q.x,q.y);ctx.rotate(angle);ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowBlur=10;if(p.attackAxis==='sword'){ctx.rotate(-.72+progress*1.44);ctx.shadowColor='#98671b';ctx.strokeStyle='#98671b';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(12,0);ctx.lineTo(42,0);ctx.stroke();ctx.strokeStyle='#80551b';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(12,-5);ctx.lineTo(12,5);ctx.stroke();ctx.strokeStyle='#795b4b';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(8,0);ctx.lineTo(12,0);ctx.stroke();}else{ctx.shadowColor='#34765f';ctx.strokeStyle='#34765f';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(11,0);ctx.lineTo(62,0);ctx.stroke();ctx.fillStyle='#34765f';ctx.beginPath();ctx.moveTo(73,0);ctx.lineTo(60,-5);ctx.lineTo(60,5);ctx.closePath();ctx.fill();}ctx.restore();}
  if(me?.role==='princess'){const q=world(me.x,me.y),targetDistance=me.aimDistance||220,target=world(me.x+me.aimX*targetDistance,me.y+me.aimY*targetDistance),radius=105*mapScale;ctx.save();ctx.strokeStyle='#d3488388';ctx.setLineDash([5,6]);ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(target.x,target.y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#ff78ad24';ctx.strokeStyle='#d34883';ctx.lineWidth=2;ctx.beginPath();ctx.arc(target.x,target.y,radius,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();}
  ctx.restore();ctx.save();ctx.strokeStyle='#ff8cbd';ctx.lineWidth=4;ctx.shadowColor='#ffb0d2';ctx.shadowBlur=13;ctx.strokeRect(mapTopLeft.x,mapTopLeft.y,mapBottomRight.x-mapTopLeft.x,mapBottomRight.y-mapTopLeft.y);ctx.restore();
}
function syncInput(){if(!socket||socket.readyState!==1)return;const movable=currentRole==='knight'&&!upgradePending;const input={up:movable&&!!keyState.w,left:movable&&!!keyState.a,down:movable&&!!keyState.s,right:movable&&!!keyState.d,aimX,aimY,aimDistance,attack:currentRole==='princess'&&!upgradePending&&(mouseAttack||aimPointer!==null)};const sig=JSON.stringify(input);if(sig!==lastInput){lastInput=sig;socket.send(JSON.stringify({type:'input',input}));}}
window.addEventListener('keydown',ev=>{const k=ev.key.toLowerCase();if(ev.key==='Escape'){closeHowTo();return;}if(['w','a','s','d'].includes(k)){ev.preventDefault();if(currentRole==='knight')keyState[k]=true;syncInput();}if(k==='q'&&currentRole==='princess'&&!upgradePending){socket?.send(JSON.stringify({type:'buff'}));}if(ev.code==='Space'&&!ev.repeat&&currentRole==='knight'&&state?.players.find(p=>p.id===myId)?.knightType==='mage'&&!upgradePending&&!state.players.some(p=>p.pendingUpgrade)){ev.preventDefault();socket?.send(JSON.stringify({type:'cast'}));}});
window.addEventListener('keyup',ev=>{const k=ev.key.toLowerCase();if(['w','a','s','d'].includes(k)){keyState[k]=false;syncInput();}});
window.addEventListener('blur',()=>{keyState={};mouseAttack=false;aimPointer=null;lastInput='';syncInput();});
function setAimFromClient(clientX,clientY){const rect=canvas.getBoundingClientRect(),dx=clientX-(rect.left+rect.width/2),dy=clientY-(rect.top+rect.height/2),length=Math.hypot(dx,dy)||1,mapScale=Math.min(rect.width/2000,rect.height/2000);aimX=dx/length;aimY=dy/length;aimDistance=Math.max(90,Math.min(650,length/mapScale));syncInput();}
canvas.addEventListener('pointermove',ev=>{if(currentRole==='princess'&&ev.pointerType==='mouse')setAimFromClient(ev.clientX,ev.clientY);});
canvas.addEventListener('pointerdown',ev=>{if(currentRole==='princess'&&ev.pointerType==='mouse'&&ev.button===0){ev.preventDefault();setAimFromClient(ev.clientX,ev.clientY);socket?.send(JSON.stringify({type:'princessCast',aimX,aimY,aimDistance}));}});
function stopMouseAttack(ev){if(mouseAttack&&ev.pointerType==='mouse'){mouseAttack=false;syncInput();}}
canvas.addEventListener('pointerup',stopMouseAttack);canvas.addEventListener('pointercancel',stopMouseAttack);
const joystick=$('#joystick'), joyKnob=$('#joyKnob');let joyPointer=null;
function moveJoystick(ev){const rect=joystick.getBoundingClientRect(),limit=37,dx=ev.clientX-(rect.left+rect.width/2),dy=ev.clientY-(rect.top+rect.height/2),length=Math.hypot(dx,dy),scale=length>limit?limit/length:1,mx=dx*scale,my=dy*scale;joyKnob.style.transform=`translate(calc(-50% + ${mx}px),calc(-50% + ${my}px))`;keyState.a=mx < -12;keyState.d=mx > 12;keyState.w=my < -12;keyState.s=my > 12;syncInput();}
joystick.addEventListener('pointerdown',ev=>{ev.preventDefault();joyPointer=ev.pointerId;joystick.setPointerCapture(joyPointer);moveJoystick(ev);});
joystick.addEventListener('pointermove',ev=>{if(ev.pointerId===joyPointer)moveJoystick(ev);});
function releaseJoystick(ev){if(ev.pointerId!==joyPointer)return;joyPointer=null;joyKnob.style.transform='translate(-50%,-50%)';keyState.w=keyState.a=keyState.s=keyState.d=false;syncInput();}
joystick.addEventListener('pointerup',releaseJoystick);joystick.addEventListener('pointercancel',releaseJoystick);joystick.addEventListener('lostpointercapture',releaseJoystick);
const aimJoystick=$('#aimJoystick'),aimKnob=$('#aimKnob');let aimStickPointer=null;
function moveAimStick(ev){const rect=aimJoystick.getBoundingClientRect(),dx=ev.clientX-(rect.left+rect.width/2),dy=ev.clientY-(rect.top+rect.height/2),length=Math.hypot(dx,dy)||1,limit=37,scale=Math.min(1,limit/length),mx=dx*scale,my=dy*scale;aimKnob.style.transform=`translate(calc(-50% + ${mx}px),calc(-50% + ${my}px))`;aimX=dx/length;aimY=dy/length;aimDistance=280;syncInput();}
aimJoystick.addEventListener('pointerdown',ev=>{ev.preventDefault();aimStickPointer=ev.pointerId;aimPointer=ev.pointerId;aimJoystick.setPointerCapture(aimPointer);moveAimStick(ev);});aimJoystick.addEventListener('pointermove',ev=>{if(ev.pointerId===aimStickPointer)moveAimStick(ev);});
function releaseAimStick(ev){if(ev.pointerId!==aimStickPointer)return;aimStickPointer=null;aimPointer=null;aimKnob.style.transform='translate(-50%,-50%)';syncInput();}
aimJoystick.addEventListener('pointerup',releaseAimStick);aimJoystick.addEventListener('pointercancel',releaseAimStick);aimJoystick.addEventListener('lostpointercapture',releaseAimStick);
window.addEventListener('resize',()=>state&&draw(state,state.players.find(p=>p.id===myId)));
