import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomInt } from 'node:crypto';
import { extname, join } from 'node:path';

const PORT = Number(process.env.PORT || 3000);
const ROOT = new URL('./public/', import.meta.url);
const rooms = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const FIELD_LIMIT = 1000;
const knightWeapons = {
  sword: { name: '剣士', weapon: 'sword', reach: 320, halfAngle: Math.PI/4, lateral: 200, cooldown: 720, damage: 42, melee: true },
  archer: { name: '弓兵', weapon: 'arrow', range: 820, cooldown: 600, speed: 1000, damage: 28 },
  mage: { name: '魔導士', weapon: 'orb', range: 760, cooldown: 3000, speed: 420, damage: 58, splash: 70, mpCost: 25, mpRegen: 8 },
  lancer: { name: '槍兵', weapon: 'spear', reach: 470, lateral: 42, cooldown: 860, damage: 38, melee: true },
};

function enemyDamageMultiplier(enemy, melee) {
  if (enemy.type === 'bulwark') return melee ? 1.6 : 0.55;
  if (enemy.type === 'shade') return melee ? 0.55 : 1.6;
  return 1;
}

// 画面上の顔画像の縦横比に寄せた、攻撃用の当たり判定（移動・接触距離は従来どおり radius を使用）。
function enemyHitbox(enemy) {
  if (enemy.type === 'boss') return { x: 174, y: 213 };
  if (enemy.type === 'grunt') return { x: 45, y: 92 };
  if (enemy.type === 'ranger') return { x: 82, y: 92 };
  return { x: 65, y: 92 };
}
function enemyHitRadius(enemy) { const box=enemyHitbox(enemy); return Math.max(box.x,box.y)*.65; }
function segmentDistance(x1,y1,x2,y2,px,py) {
  const dx=x2-x1,dy=y2-y1,lengthSquared=dx*dx+dy*dy;
  const t=lengthSquared?Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/lengthSquared)):0;
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}
function segmentHitsEnemy(x1,y1,x2,y2,enemy) {
  // タイ米は縦長なので、顔の上側・下側へ円形判定を2つ並べる。
  // これで横方向に広がり過ぎず、頭から口元まで自然に弾が当たる。
  if (enemy.type === 'grunt') {
    // 上側は髪先まで覆う。下側は顔〜口元を覆う。
    return [{ y:-52, r:56 },{ y:45, r:46 }].some(part => segmentDistance(x1,y1,x2,y2,enemy.x,enemy.y+part.y)<=part.r);
  }
  const box=enemyHitbox(enemy);
  return segmentDistance(x1/box.x,y1/box.y,x2/box.x,y2/box.y,enemy.x/box.x,enemy.y/box.y)<=1;
}

const http = createServer(async (req, res) => {
  const path = new URL(req.url, `http://${req.headers.host}`).pathname;
  const file = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
  try {
    const body = await readFile(new URL(file, ROOT));
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

function send(peer, message) {
  if (!peer || peer.destroyed || peer.writableEnded || !peer.writable) return;
  const data = Buffer.from(JSON.stringify(message));
  let header;
  if (data.length < 126) header = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
  try { peer.write(Buffer.concat([header, data])); } catch { peer.destroy(); }
}

function snapshot(room) {
  const now = Date.now();
  return { type: 'state', room: room.code, phase: room.phase, wave: room.wave, time: room.waveTime, buffActive: room.buffUntil > now, players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, role: p.role, knightType: p.knightType, isBot: !!p.isBot, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp, mpCost: knightWeapons[p.knightType]?.mpCost||0, xp: p.xp, nextXp: p.nextXp, level: p.level, pendingUpgrade: p.pendingUpgrade, disabled: p.disabledUntil > now, disabledFor: Math.max(0, p.disabledUntil-now), buffCooldown: Math.max(0, p.buffCooldownUntil-now), attackFlashUntil: p.attackFlashUntil||0, attackAxis: p.attackAxis||null, attackFacingX: Number.isFinite(p.attackFacingX)?p.attackFacingX:(Number.isFinite(p.facingX)?p.facingX:1), attackFacingY: Number.isFinite(p.attackFacingY)?p.attackFacingY:(Number.isFinite(p.facingY)?p.facingY:0), facingX: Number.isFinite(p.facingX)?p.facingX:1, facingY: Number.isFinite(p.facingY)?p.facingY:0, aimX: Number.isFinite(p.input.aimX)?p.input.aimX:1, aimY: Number.isFinite(p.input.aimY)?p.input.aimY:0, aimDistance: Number.isFinite(p.input.aimDistance)?p.input.aimDistance:220 })), enemies: room.enemies, projectiles: room.projectiles, enemyShots: room.enemyShots, xpOrbs: room.xpOrbs, effects: room.effects, message: room.message };
}
function broadcast(room) { const state = snapshot(room); for (const p of room.players.values()) send(p.peer, state); }
function announce(room, message) { room.message = message; }
function makeRoom(code) { return { code, players: new Map(), enemies: [], projectiles: [], enemyShots: [], xpOrbs: [], effects: [], phase: 'lobby', wave: 0, waveTime: 0, waveStartedAt: 0, buffUntil: 0, buffCooldownUntil: 0, buffDurationMultiplier: 1, knightXpMultiplier: 1, knightDamageMultiplier: 1, bossSpawned: false, message: '仲間を待っています', lastSpawn: 0, lastTick: Date.now(), seq: 0, projectileSeq: 0, enemyShotSeq: 0, orbSeq: 0 }; }
function makeKnight({ id, peer = null, name, knightType = 'archer', isBot = false }) {
  return { id, peer, name, role: 'knight', knightType, isBot, x: 0, y: 0, facingX: 1, facingY: 0, hp: 100, maxHp: 100, mp: 100, maxMp: 100, lastAttack: 0, disabledUntil: 0, buffCooldownUntil: 0, input: { aimX: 1, aimY: 0 }, xp: 0, nextXp: 3, level: 1, pendingUpgrade: false, attackPower: 1, attackSpeed: 1, moveSpeed: 1 };
}
function addPlayer(peer, msg, room) {
  const code = String(msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (!/^[A-Z0-9]{4,8}$/.test(code)) return send(peer, { type: 'error', text: '部屋コードは4〜8文字で入力してください' });
  if (!room) return send(peer, { type: 'error', text: 'ルームが見つかりません。コードを確認してください' });
  if (room.players.size >= 5) return send(peer, { type: 'error', text: 'この部屋は満員です' });
  const id = Math.random().toString(36).slice(2, 9);
  const role = room.players.size === 0 ? 'princess' : 'knight';
  const knightType = Object.hasOwn(knightWeapons, msg.knightType) ? msg.knightType : 'archer';
  const player = role === 'princess'
    ? { ...makeKnight({ id, peer, name: String(msg.name || 'プレイヤー').slice(0, 12), knightType }), role: 'princess' }
    : makeKnight({ id, peer, name: String(msg.name || 'プレイヤー').slice(0, 12), knightType });
  room.players.set(id, player); peer.player = player; peer.room = room;
  send(peer, { type: 'you', id });
  if (room.players.size === 2 && room.phase === 'lobby') announce(room, '準備完了！ホストがゲームを開始できます');
  broadcast(room);
}

function addBot(room, knightType = 'archer') {
  if (room.players.size >= 5) return false;
  const number = [...room.players.values()].filter(p => p.isBot).length + 1;
  const bot = makeKnight({ id: `bot-${Date.now()}-${number}`, name: `守護Bot ${number}`, knightType: Object.hasOwn(knightWeapons, knightType) ? knightType : 'archer', isBot: true });
  if (room.phase === 'playing') {
    bot.x = (Math.random() - .5) * 180;
    bot.y = (Math.random() - .5) * 180;
  }
  room.players.set(bot.id, bot);
  announce(room, `${bot.name}が防衛に参加した`);
  return true;
}

function startGame(room) {
  if (room.phase !== 'lobby' || room.players.size < 2) return;
  const now = Date.now();
  room.phase = 'playing'; room.wave = 1; room.waveTime = 30; room.waveStartedAt = now; room.enemies = []; room.projectiles = []; room.enemyShots = []; room.xpOrbs = []; room.effects = []; room.lastSpawn = now; room.lastTick = now; room.bossSpawned = false; room.buffUntil = 0; room.buffCooldownUntil = 0; room.buffDurationMultiplier = 1; room.knightXpMultiplier = 1; room.knightDamageMultiplier = 1;
  for (const p of room.players.values()) { p.hp = 100; p.mp = p.maxMp; p.lastAttack = 0; p.facingX = 1; p.facingY = 0; p.x = p.role==='princess'?0:(Math.random()-.5)*180; p.y = p.role==='princess'?0:(Math.random()-.5)*180; p.xp = 0; p.nextXp = 3; p.level = 1; p.pendingUpgrade = false; p.attackPower = 1; p.attackSpeed = 1; p.moveSpeed = 1; p.disabledUntil = 0; p.buffCooldownUntil = 0; p.input = { aimX: 1, aimY: 0 }; }
  announce(room, 'WAVE 1 / 5 — 姫を守れ！');
}

function activatePrincessBuff(room, player, now) {
  if (player.role !== 'princess' || now < player.buffCooldownUntil || room.phase !== 'playing') return;
  room.buffUntil = now + 8000*room.buffDurationMultiplier;
  player.buffCooldownUntil = now + 25000;
  announce(room, '姫の加護！ナイトの攻撃速度と移動速度が上昇');
}

function castMage(room, player, now) {
  const weapon = knightWeapons.mage;
  const cooldown=weapon.cooldown/(player.attackSpeed*(room.buffUntil>now?1.35:1));
  if (room.phase !== 'playing' || [...room.players.values()].some(p=>p.pendingUpgrade) || player.role !== 'knight' || player.knightType !== 'mage' || player.pendingUpgrade || player.disabledUntil > now || player.mp < weapon.mpCost || now-player.lastAttack < cooldown) return;
  const target = room.enemies.filter(e=>e.hp>1&&Math.hypot(e.x-player.x,e.y-player.y)<=weapon.range).sort((a,b)=>Math.hypot(a.x-player.x,a.y-player.y)-Math.hypot(b.x-player.x,b.y-player.y))[0];
  if (!target) return;
  player.mp -= weapon.mpCost; player.lastAttack = now;
  const dx=target.x-player.x,dy=target.y-player.y,d=Math.hypot(dx,dy)||1;
  room.projectiles.push({id:++room.projectileSeq,role:'knight',weapon:'orb',x:player.x,y:player.y,px:player.x,py:player.y,vx:dx/d*weapon.speed,vy:dy/d*weapon.speed,damage:weapon.damage*player.attackPower*room.knightDamageMultiplier,life:3.5,splash:weapon.splash,pierce:1,homing:true,targetId:target.id});
}

function castPrincess(room, player, now, input = player.input) {
  if (room.phase !== 'playing' || player.role !== 'princess' || player.pendingUpgrade || now-player.lastAttack < 430) return;
  const ax=Number.isFinite(Number(input.aimX))?Number(input.aimX):1,ay=Number.isFinite(Number(input.aimY))?Number(input.aimY):0,aimLength=Math.hypot(ax,ay)||1;
  const aimDistance=Math.max(90,Math.min(650,Number(input.aimDistance)||220)),x=player.x+ax/aimLength*aimDistance,y=player.y+ay/aimLength*aimDistance,radius=105,damage=27*player.attackPower;
  player.lastAttack=now;
  room.effects.push({type:'princessBurst',x,y,createdAt:now,duration:320,radius});
  for(const enemy of room.enemies.filter(e=>Math.hypot(e.x-x,e.y-y)<=radius+enemyHitRadius(e))){
    enemy.hp-=damage;
    if(enemy.hp<=0){room.enemies=room.enemies.filter(e=>e!==enemy);room.xpOrbs.push({id:++room.orbSeq,x:enemy.x,y:enemy.y,value:enemy.type==='boss'?5:1});if(enemy.type==='boss'){room.phase='clear';room.waveTime=0;announce(room,'ボス撃破！GAME CLEAR');}else announce(room,'姫が敵を撃破！経験値が落ちた');}
  }
}

function advanceLevel(room, player) {
  if (!player.pendingUpgrade && player.xp >= player.nextXp) {
    player.xp -= player.nextXp; player.level += 1; player.nextXp = Math.ceil(player.nextXp*1.35); player.pendingUpgrade = true; player.input = { aimX: 1, aimY: 0 };
    announce(room, `${player.name}がレベルアップ！強化を選んでいます`);
  }
}
function gainXp(room, player, amount) { player.xp += amount; advanceLevel(room, player); }

function chooseUpgrade(room, player, choice) {
  if (!player.pendingUpgrade) return;
  if (player.role === 'princess') {
    const supportUpgrades = {
      knightXp: () => { room.knightXpMultiplier *= 1.25; return 'ナイトの経験値取得量'; },
      knightPower: () => { room.knightDamageMultiplier *= 1.15; return 'ナイトの攻撃力'; },
      buffPower: () => { room.buffDurationMultiplier *= 1.25; return '姫の加護の効果時間'; },
    };
    const supportApply=supportUpgrades[choice];if(!supportApply)return;
    const supportName=supportApply();player.pendingUpgrade=false;announce(room,`${player.name}は${supportName}を強化した`);advanceLevel(room,player);return;
  }
  const upgrades = {
    power: () => { player.attackPower *= 1.25; return '攻撃力'; },
    attackSpeed: () => { player.attackSpeed *= 1.2; return '攻撃速度'; },
    moveSpeed: () => { player.moveSpeed *= 1.15; return '移動速度'; },
  };
  const apply = upgrades[choice];
  if (!apply) return;
  const name = apply();
  player.pendingUpgrade = false;
  announce(room, `${player.name}は${name}を強化した`);
  advanceLevel(room, player);
}

function driveBot(room, bot, now) {
  const princess = [...room.players.values()].find(p => p.role === 'princess');
  if (!princess || bot.role !== 'knight' || bot.disabledUntil > now) return;
  const target = room.enemies.filter(e => e.hp > 1).sort((a, b) => Math.hypot(a.x - bot.x, a.y - bot.y) - Math.hypot(b.x - bot.x, b.y - bot.y))[0];
  if (!target) { bot.input = { aimX: 1, aimY: 0 }; return; }
  const dx = target.x - bot.x, dy = target.y - bot.y, distance = Math.hypot(dx, dy) || 1;
  bot.facingX = dx / distance; bot.facingY = dy / distance;
  const preferredDistance = 260;
  const move = distance > preferredDistance ? 1 : distance < 150 ? -1 : 0;
  bot.input = { up: move * dy < -20, down: move * dy > 20, left: move * dx < -20, right: move * dx > 20, aimX: bot.facingX, aimY: bot.facingY };
  if (bot.knightType === 'mage') castMage(room, bot, now);
}

function tick(room, now) {
  if (room.phase !== 'playing') return;
  const dt = Math.min(.05, (now-room.lastTick)/1000); room.lastTick = now;
  const players = [...room.players.values()], princess = players.find(p=>p.role==='princess');
  if (!princess) { room.phase='over'; announce(room,'姫がいなくなりました'); return; }
  for (const bot of players.filter(p => p.isBot && p.pendingUpgrade)) chooseUpgrade(room, bot, 'power');
  if (players.some(p=>p.pendingUpgrade)) return;
  for (const bot of players.filter(p => p.isBot)) driveBot(room, bot, now);
  room.waveTime = Math.max(0,room.waveTime-dt);
  if (room.waveTime <= 0) {
    if (room.wave < 5) {
      room.wave += 1; room.waveTime = room.wave === 5 ? 90 : 30; room.waveStartedAt = now; room.bossSpawned = false;
      announce(room, room.wave===5?'FINAL WAVE — ボスが出現！':`WAVE ${room.wave} / 5 — 敵が強くなった！`);
    } else { room.phase='over'; announce(room,'ボスを倒しきれなかった…'); return; }
  }
  const buffActive = room.buffUntil > now;
  for (const p of players) {
    if (p.pendingUpgrade) continue;
    if(p.role==='princess'){
      p.x=0;p.y=0;
      if(p.input.attack)castPrincess(room,p,now);
      continue;
    }
    const speed=220*p.moveSpeed*(buffActive?1.18:1);
    const dx=Number(!!p.input.right)-Number(!!p.input.left),dy=Number(!!p.input.down)-Number(!!p.input.up),len=Math.hypot(dx,dy)||1;
    if(dx||dy){p.facingX=dx/len;p.facingY=dy/len;}
    p.x=Math.max(-FIELD_LIMIT,Math.min(FIELD_LIMIT,p.x+dx/len*speed*dt));p.y=Math.max(-FIELD_LIMIT,Math.min(FIELD_LIMIT,p.y+dy/len*speed*dt));
    const weapon=knightWeapons[p.knightType]||knightWeapons.archer;
    p.mp=Math.min(p.maxMp,p.mp+(weapon.mpRegen||0)*dt);
    if(p.disabledUntil>now)continue;
    if(p.knightType==='mage')continue;
    const targets=room.enemies.filter(e=>{
      if(e.hp<=1)return false;
      const tx=e.x-p.x,ty=e.y-p.y,d=Math.hypot(tx,ty)||1;
      const hitRadius=enemyHitRadius(e),lateral=Math.abs(tx*p.facingY-ty*p.facingX);
      if(p.knightType==='sword'){const angleAllowance=Math.asin(Math.min(1,hitRadius/d));return d<=weapon.reach+hitRadius&&(tx*p.facingX+ty*p.facingY)/d>=Math.cos(weapon.halfAngle+angleAllowance)&&lateral<=weapon.lateral+hitRadius;}
      if(p.knightType==='lancer'){const forward=tx*p.facingX+ty*p.facingY;return forward>-hitRadius&&forward<=weapon.reach+hitRadius&&lateral<=weapon.lateral+hitRadius;}
      return d<=weapon.range;
    }).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
    const target=targets[0];
    const cooldown=Math.max(260,weapon.cooldown/(p.attackSpeed*(buffActive?1.35:1)));
    if(targets.length&&now-p.lastAttack>=cooldown){
      p.lastAttack=now;
      const damage=weapon.damage*p.attackPower*room.knightDamageMultiplier;
      if(weapon.melee){
        p.attackFlashUntil=now+220;p.attackAxis=p.knightType;p.attackFacingX=p.facingX;p.attackFacingY=p.facingY;
        for(const enemy of targets)enemy.hp=Math.max(1,enemy.hp-damage*enemyDamageMultiplier(enemy,true));
      }else{
        const tx=target.x-p.x,ty=target.y-p.y,d=Math.hypot(tx,ty)||1;
        room.projectiles.push({id:++room.projectileSeq,role:'knight',weapon:weapon.weapon,x:p.x,y:p.y,px:p.x,py:p.y,vx:tx/d*weapon.speed,vy:ty/d*weapon.speed,damage,life:2.2,splash:weapon.splash||0,pierce:weapon.pierce||1});
      }
    }
  }
  if(room.wave===5&&!room.bossSpawned){room.bossSpawned=true;const angle=Math.random()*Math.PI*2;room.enemies.push({id:++room.seq,type:'boss',x:princess.x+Math.cos(angle)*560,y:princess.y+Math.sin(angle)*560,hp:900+players.length*180,maxHp:900+players.length*180,speed:42,damageAt:0,attackAt:now+1700,radius:29});}
  const spawnInterval=Math.max(480,(2050-room.wave*280)*1.15);
  if(now-room.lastSpawn>spawnInterval&&room.enemies.length<30){
    room.lastSpawn=now;const angle=Math.random()*Math.PI*2,distance=480+Math.random()*140;
    let type='grunt';const typeRoll=Math.random();
    if(room.wave>=2&&typeRoll<.08)type='bulwark';
    else if(room.wave>=2&&typeRoll<.16)type='shade';
    else {const specialRoll=Math.random();if(room.wave>=3&&specialRoll<.24)type='disruptor';else if(room.wave>=2&&specialRoll<.3)type='ranger';}
    const hp=(90+room.wave*24)*(type==='disruptor'?1.25:type==='bulwark'?1.55:type==='shade'?.9:1);
    const speed=type==='ranger'?42:type==='bulwark'?34:type==='shade'?58:48+room.wave*4;
    room.enemies.push({id:++room.seq,type,x:princess.x+Math.cos(angle)*distance,y:princess.y+Math.sin(angle)*distance,hp,maxHp:hp,speed,damageAt:0,attackAt:now+1100,radius:type==='disruptor'||type==='bulwark'?15:11});
  }
  for(const e of room.enemies){
    const dx=princess.x-e.x,dy=princess.y-e.y,d=Math.hypot(dx,dy)||1;
    if(e.type==='ranger'){if(d>365){e.x+=dx/d*e.speed*dt;e.y+=dy/d*e.speed*dt;}else if(d<250){e.x-=dx/d*e.speed*dt;e.y-=dy/d*e.speed*dt;}if(now>=e.attackAt&&d<680){e.attackAt=now+1900;room.enemyShots.push({id:++room.enemyShotSeq,type:'arrow',targetId:princess.id,x:e.x,y:e.y,vx:dx/d*260,vy:dy/d*260,life:2.5,damage:6});}}
    else {if(d>e.radius+12){e.x+=dx/d*e.speed*dt;e.y+=dy/d*e.speed*dt;}else if(now-e.damageAt> (e.type==='boss'?550:850)){e.damageAt=now;princess.hp=Math.max(0,princess.hp-(e.type==='boss'?14:7));if(!princess.hp){room.phase='over';announce(room,'姫が倒れてしまった…');}}
      if(e.type==='disruptor'){const knight=players.filter(p=>p.role==='knight').sort((a,b)=>Math.hypot(a.x-e.x,a.y-e.y)-Math.hypot(b.x-e.x,b.y-e.y))[0];if(knight&&now>=e.attackAt&&Math.hypot(knight.x-e.x,knight.y-e.y)<560){e.attackAt=now+2500;const kx=knight.x-e.x,ky=knight.y-e.y,kd=Math.hypot(kx,ky)||1;room.enemyShots.push({id:++room.enemyShotSeq,type:'seal',targetId:knight.id,x:e.x,y:e.y,vx:kx/kd*300,vy:ky/kd*300,life:2.1,damage:0});}}
    }
    if(e.type==='boss'&&now>=e.attackAt){e.attackAt=now+1400;const base=Math.atan2(dy,dx);for(const offset of [-.3,0,.3])room.enemyShots.push({id:++room.enemyShotSeq,type:'boss',targetId:princess.id,x:e.x,y:e.y,vx:Math.cos(base+offset)*310,vy:Math.sin(base+offset)*310,life:2.8,damage:12});}
  }
  const shots=[];
  for(const shot of room.projectiles){shot.px=shot.x;shot.py=shot.y;if(shot.homing){let target=room.enemies.find(e=>e.id===shot.targetId&&e.hp>1);if(!target)target=room.enemies.filter(e=>e.hp>1).sort((a,b)=>Math.hypot(a.x-shot.x,a.y-shot.y)-Math.hypot(b.x-shot.x,b.y-shot.y))[0];if(target){shot.targetId=target.id;const dx=target.x-shot.x,dy=target.y-shot.y,d=Math.hypot(dx,dy)||1;shot.vx=dx/d*knightWeapons.mage.speed;shot.vy=dy/d*knightWeapons.mage.speed;}}shot.x+=shot.vx*dt;shot.y+=shot.vy*dt;shot.life-=dt;
    const target=room.enemies.find(e=>segmentHitsEnemy(shot.px,shot.py,shot.x,shot.y,e));
    if(target){const hits=shot.splash?room.enemies.filter(e=>Math.hypot(e.x-target.x,e.y-target.y)<shot.splash):[target];
      if(shot.weapon==='orb')room.effects.push({x:target.x,y:target.y,createdAt:now,duration:360,radius:shot.splash});
      for(const enemy of hits){const damage=shot.damage*enemyDamageMultiplier(enemy,shot.weapon==='sword'||shot.weapon==='spear');if(shot.role==='princess')enemy.hp-=damage;else enemy.hp=Math.max(1,enemy.hp-damage);
        if(enemy.hp<=0){room.enemies=room.enemies.filter(e=>e!==enemy);room.xpOrbs.push({id:++room.orbSeq,x:enemy.x,y:enemy.y,value:enemy.type==='boss'?5:1});if(enemy.type==='boss'){room.phase='clear';room.waveTime=0;announce(room,'ボス撃破！GAME CLEAR');}else announce(room,'姫が敵を撃破！経験値が落ちた');}
      }
      if(target.type==='boss'&&target.hp<=0)continue;
      if(shot.splash||shot.weapon==='sword'||(shot.pierce||1)<=1)continue;
      shot.pierce-=1;
    }
    if(shot.life>0)shots.push(shot);
  }
  room.projectiles=shots;
  room.effects=room.effects.filter(effect=>now-effect.createdAt<effect.duration);
  const enemyShots=[];
  for(const shot of room.enemyShots){shot.x+=shot.vx*dt;shot.y+=shot.vy*dt;shot.life-=dt;const target=players.find(p=>p.id===shot.targetId);
    if(target&&Math.hypot(target.x-shot.x,target.y-shot.y)<18){if(shot.type==='seal'){target.disabledUntil=now+2600;announce(room,`${target.name}の武器が封じられた！`);}else if(target.role==='princess'){target.hp=Math.max(0,target.hp-shot.damage);if(!target.hp){room.phase='over';announce(room,'姫が倒れてしまった…');}}continue;}
    if(shot.life>0)enemyShots.push(shot);
  }
  room.enemyShots=enemyShots;
  for(const orb of [...room.xpOrbs]){const collector=players.filter(p=>!p.pendingUpgrade&&Math.hypot(p.x-orb.x,p.y-orb.y)<30).sort((a,b)=>Math.hypot(a.x-orb.x,a.y-orb.y)-Math.hypot(b.x-orb.x,b.y-orb.y))[0];if(!collector)continue;room.xpOrbs=room.xpOrbs.filter(item=>item!==orb);const amount=orb.value*(collector.role==='knight'?room.knightXpMultiplier:1);announce(room,`${collector.name}が経験値を取得！姫にも経験値が届いた`);gainXp(room,collector,amount);if(collector.role==='knight')gainXp(room,princess,amount*.5);}
}

function frame(peer, chunk) {
  peer.buffer = Buffer.concat([peer.buffer, chunk]);
  while (peer.buffer.length >= 2) {
    const b = peer.buffer, opcode = b[0] & 15; let len = b[1] & 127, offset = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); offset = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); offset = 10; }
    const masked = !!(b[1]&128); if (masked) offset += 4;
    if (b.length < offset+len) return;
    let payload = b.subarray(offset, offset+len);
    if (masked) { const mask = b.subarray(offset-4,offset); payload = Buffer.from(payload); for (let i=0;i<payload.length;i++) payload[i] ^= mask[i%4]; }
    peer.buffer = b.subarray(offset+len);
    if (opcode === 8) { peer.end(); return; }
    if (opcode !== 1) continue;
    try {
      const msg = JSON.parse(payload.toString());
      if (msg.type === 'join') {
        const code = String(msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        addPlayer(peer, msg, rooms.get(code));
      }
      else if (msg.type === 'create') {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code;
        do { code = Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join(''); } while (rooms.has(code));
        const room = makeRoom(code); rooms.set(code, room);
        addPlayer(peer, { ...msg, room: code }, room);
      }
      else if (msg.type === 'upgrade' && peer.room && peer.player) chooseUpgrade(peer.room, peer.player, msg.choice);
      else if (msg.type === 'buff' && peer.room && peer.player) activatePrincessBuff(peer.room, peer.player, Date.now());
      else if (msg.type === 'cast' && peer.room && peer.player) castMage(peer.room, peer.player, Date.now());
      else if (msg.type === 'princessCast' && peer.room && peer.player) castPrincess(peer.room, peer.player, Date.now(), msg);
      else if (msg.type === 'start' && peer.room && peer.room.players.values().next().value === peer.player) startGame(peer.room);
      else if (msg.type === 'addBot' && peer.room && peer.room.players.values().next().value === peer.player) { addBot(peer.room, msg.knightType); broadcast(peer.room); }
      else if (msg.type === 'input' && peer.player) {
        const input=msg.input||{},ax=Number.isFinite(Number(input.aimX))?Number(input.aimX):1,ay=Number.isFinite(Number(input.aimY))?Number(input.aimY):0,aimLength=Math.hypot(ax,ay)||1,aimDistance=Math.max(90,Math.min(650,Number(input.aimDistance)||220));
        peer.player.input={up:!!input.up,down:!!input.down,left:!!input.left,right:!!input.right,attack:!!input.attack,aimX:ax/aimLength,aimY:ay/aimLength,aimDistance};
      }
    } catch {}
  }
}

http.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key']; if (!key) return socket.destroy();
  const accept = createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.buffer = Buffer.alloc(0); socket.on('data', data => frame(socket,data));
  socket.on('error', () => socket.destroy());
  socket.on('close', () => { const room=socket.room, p=socket.player; if (!room||!p) return; room.players.delete(p.id); const humans=[...room.players.values()].filter(player=>!player.isBot); if (!humans.length) rooms.delete(room.code); else { if (p.role==='princess' && room.phase==='playing') { room.phase='over'; announce(room,'姫が退出しました'); } broadcast(room); } });
});

setInterval(() => { const now=Date.now(); for (const room of rooms.values()) { tick(room,now); broadcast(room); } }, 50);
http.listen(PORT, () => console.log(`姫ぷオンライン: http://localhost:${PORT}`));
