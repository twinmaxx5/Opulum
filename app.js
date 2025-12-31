/* app.js - Debug-enabled full prototype for Colin's Crown
   - Three.js prototype (first-person)
   - Spellbooks (rare 10% chest chance), spells (fire/water/ice/command-dead/earth-protector)
   - Life crystals dropped by enemies (scale with strength), potions, shop, weapon upgrades and special effects
   - Boss decorations per-biome (sea = aquanaut helmet, etc.)
   - Debug logging + on-screen debug panel + helpers exposed on window for testing
   Replace previous app.js with this file.
*/

// ---------- Minimal helpers ----------
function debugLog(msg) {
  console.log('[GAME]', msg);
  try {
    const dbg = document.getElementById('gameDebugLog');
    if (dbg) {
      const e = document.createElement('div');
      e.textContent = msg;
      dbg.prepend(e);
      while (dbg.children.length > 10) dbg.removeChild(dbg.lastChild);
    }
  } catch (e) { /* ignore UI errors */ }
}

// ---------- Three.js setup ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfefff);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.6, 4);

const hemi = new THREE.HemisphereLight(0xffffee, 0x444455, 1.0);
hemi.position.set(0, 50, 0);
scene.add(hemi);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- Debug UI (on-screen) ----------
(function createDebugPanel() {
  if (document.getElementById('debugPanel')) return;
  const panel = document.createElement('div');
  panel.id = 'debugPanel';
  panel.style.position = 'fixed';
  panel.style.left = '12px';
  panel.style.top = '12px';
  panel.style.zIndex = '99999';
  panel.style.background = 'rgba(0,0,0,0.5)';
  panel.style.color = '#e6ffe6';
  panel.style.padding = '8px';
  panel.style.borderRadius = '8px';
  panel.style.fontFamily = 'system-ui';
  panel.style.fontSize = '12px';
  panel.innerHTML = '<div style="font-weight:bold;margin-bottom:6px">Game Debug</div><div id="gameDebugLog" style="max-width:360px"></div>';
  document.body.appendChild(panel);
})();

// ---------- Game state & exposure ----------
let gameState = 'menu'; // menu|world|museum
window.gameState = gameState;

const menu = document.getElementById('menu');
const hud = document.getElementById('hud');
const inventoryPanel = document.getElementById('inventory');
const shopModal = document.getElementById('shopModal');

// ---------- Player ----------
const player = {
  pos: new THREE.Vector3(0, 1.6, 6),
  yaw: 0, pitch: 0, speed: 6,
  maxHealth: 100, health: 100,
  buffs: { speed: 1.0, vitality: 0, shield: 0 },
};
window.player = player;

camera.position.copy(player.pos);

// ---------- Input ----------
const keys = { w:false,a:false,s:false,d:false };
window.keys = keys;

window.addEventListener('keydown', e => {
  if (e.code === 'KeyW') keys.w=true;
  if (e.code === 'KeyA') keys.a=true;
  if (e.code === 'KeyS') keys.s=true;
  if (e.code === 'KeyD') keys.d=true;
  if (e.code === 'KeyE') toggleInventory();
});
window.addEventListener('keyup', e => {
  if (e.code === 'KeyW') keys.w=false;
  if (e.code === 'KeyA') keys.a=false;
  if (e.code === 'KeyS') keys.s=false;
  if (e.code === 'KeyD') keys.d=false;
});

// right-mouse camera drag
let rightMouseDown = false, prevMouse = {x:0,y:0};
window.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('mousedown', e => {
  if (e.button === 2) { rightMouseDown = true; prevMouse = {x:e.clientX, y:e.clientY}; document.body.style.cursor = 'grabbing'; }
});
window.addEventListener('mouseup', e => { if (e.button === 2) { rightMouseDown=false; document.body.style.cursor='auto'; }});
window.addEventListener('mousemove', e => {
  if (rightMouseDown) {
    const dx = (e.clientX - prevMouse.x), dy = (e.clientY - prevMouse.y);
    prevMouse = {x:e.clientX, y:e.clientY};
    player.yaw -= dx * 0.0025; player.pitch -= dy * 0.0025;
    player.pitch = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, player.pitch));
  }
});

// ---------- World containers ----------
const world = { zones: [], objects: [], enemies: [], projectiles: [], items: [], chests: [], shops: [], allies: [] };
window.world = world;

// ground
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: 0x91d06b }));
ground.rotation.x = -Math.PI/2; ground.receiveShadow = true; scene.add(ground);

// ---------- Convenience & UI helpers ----------
function showHUD() { hud.classList.remove('hidden'); menu.classList.add('hidden'); document.getElementById('mode').innerText = 'world'; }
function hideHUD() { hud.classList.add('hidden'); menu.classList.remove('hidden'); document.getElementById('mode').innerText = 'menu'; }

// fragments & crystals
let fragments = 0;
let lifeCrystals = 0;
window.fragments = fragments;
window.lifeCrystals = lifeCrystals;

const inventory = []; window.inventory = inventory;
let equippedWeapon = null; window.equippedWeapon = equippedWeapon;
let equippedSpell = null; window.equippedSpell = equippedSpell;
let earthShieldObj = null; window.earthShieldObj = earthShieldObj;

// UI update function (exposed)
function updateHUD() {
  window.fragments = fragments; window.lifeCrystals = lifeCrystals;
  const f = document.getElementById('fragments'); if (f) f.innerText = `Fragments: ${fragments}`;
  const c = document.getElementById('crystals'); if (c) c.innerText = `Crystals: ${lifeCrystals}`;
  const h = document.getElementById('health'); if (h) h.innerText = `HP: ${Math.round(player.health)}`;
}
window.updateHUD = updateHUD;

// ---------- Shop definition ----------
const shopItemsDef = [
  { id:'potion_speed', display:'Speed Potion', type:'potion', price:6, data:{ kind:'potion', name:'Speed', duration:12, strength:1.6 } },
  { id:'potion_vital', display:'Vitality Potion', type:'potion', price:8, data:{ kind:'potion', name:'Vitality', duration:18, strength:12 } },
  { id:'potion_shield', display:'Shield Potion', type:'potion', price:7, data:{ kind:'potion', name:'Shield', duration:18, strength:35 } },
  { id:'snake_dagger', display:'Snake Dagger', type:'weapon', price:14, data:{ kind:'weapon', name:'Snake Dagger', power:20, level:1 } },
  { id:'elemental_ruin', display:'Elemental Ruin', type:'weapon', price:18, data:{ kind:'weapon', name:'Elemental Ruin', power:22, level:1 } },
  { id:'frost_crown', display:'Frost Crown', type:'weapon', price:16, data:{ kind:'weapon', name:'Frost Crown', power:18, level:1 } },
  { id:'life_stealer', display:'Life Stealer', type:'weapon', price:20, data:{ kind:'weapon', name:'Life Stealer', power:16, level:1 } },
];
window.shopItemsDef = shopItemsDef;

// ---------- Spawning helpers (exposed) ----------
function spawnCollectible(type, pos, meta = {}) {
  const g = new THREE.SphereGeometry(0.18, 10, 10);
  const mat = new THREE.MeshStandardMaterial({ color: type === 'fragment' ? 0xffdd33 : 0xffffff, emissive: 0x222200 });
  const m = new THREE.Mesh(g, mat); m.position.copy(pos);
  m.userData.collectible = { type, meta }; scene.add(m); world.items.push(m);
  debugLog(`Spawned collectible ${type} at ${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}`);
  return m;
}
window.spawnCollectible = spawnCollectible;

function spawnChest(pos) {
  const g = new THREE.BoxGeometry(0.8, 0.5, 0.6); const mat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
  const chest = new THREE.Mesh(g, mat); chest.position.copy(pos);
  chest.userData.chest = { opened:false }; scene.add(chest); world.chests.push(chest);
  debugLog(`Spawned chest at ${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}`);
  return chest;
}
window.spawnChest = spawnChest;

function spawnEnemy(pos, opts = {}) {
  const strength = opts.strength || 1;
  const size = opts.isBoss ? (1.6 + strength*0.6) : (0.6 + strength*0.2);
  const g = new THREE.BoxGeometry(size, size, size);
  const mat = new THREE.MeshStandardMaterial({ color: opts.isBoss ? 0x6a2d2d : 0xff5555 });
  const e = new THREE.Mesh(g, mat); e.position.copy(pos);
  e.userData.enemy = { hp: opts.isBoss ? 250 * strength : 40 * strength, maxHp: opts.isBoss ? 250 * strength : 40 * strength, isBoss: !!opts.isBoss, biome: opts.biome || 'Generic', strength, status: {} };
  scene.add(e); world.enemies.push(e);
  debugLog(`Spawned enemy (boss=${!!opts.isBoss}) at ${pos.x.toFixed(1)},${pos.z.toFixed(1)} strength=${strength}`);
  if (opts.isBoss) addBossDecoration(e);
  return e;
}
window.spawnEnemy = spawnEnemy;

// ---------- Boss decorations ----------
function addBossDecoration(boss) {
  try {
    const biome = (boss.userData.enemy.biome || '').toLowerCase();
    if (biome.includes('sea') || biome.includes('coral')) {
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshStandardMaterial({ color:0x77e0ff, opacity:0.95, transparent:true }));
      helm.position.set(0, (boss.geometry.parameters && boss.geometry.parameters.height) ? boss.geometry.parameters.height*0.5 : 0.9, 0);
      boss.add(helm);
      debugLog('Added aquanaut helmet to boss (sea biome)');
    } else if (biome.includes('mountain')) {
      const crown = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.25, 8, 16), new THREE.MeshStandardMaterial({ color:0x888888 }));
      crown.rotation.x = Math.PI/2; crown.position.y = 0.9; boss.add(crown);
      debugLog('Added crown to mountain boss');
    } else if (biome.includes('ancient')) {
      const rune = new THREE.Mesh(new THREE.PlaneGeometry(1.6,1.6), new THREE.MeshBasicMaterial({ color:0xffe0a0 }));
      rune.position.y = 1.2; rune.rotation.y = 0.3; boss.add(rune);
      debugLog('Added rune to ancient ruins boss');
    } else {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffdd77 }));
      orb.position.y = 0.9; boss.add(orb);
      debugLog('Added generic orb to boss');
    }
  } catch (err) { console.warn('addBossDecoration failed', err); }
}

// ---------- Chest loot (10% spellbook) ----------
function openChest(chest) {
  if (!chest || !chest.userData || chest.userData.chest.opened) return;
  chest.userData.chest.opened = true; chest.material.color.set(0x6a3f2a);
  debugLog('Chest opened');
  const r = Math.random();
  if (r < 0.10) {
    const spells = ['Fireball','Water Jet','Ice Shard','Command Dead','Earth Protector'];
    const s = spells[Math.floor(Math.random()*spells.length)];
    addToInventory({ kind:'spellbook', name:s, power: 20 + Math.floor(Math.random()*12) });
    debugLog(`Chest dropped spellbook: ${s}`);
  } else if (r < 0.35) {
    const pool = ['Snake Dagger','Elemental Ruin','Frost Crown','Life Stealer'];
    const w = pool[Math.floor(Math.random()*pool.length)];
    addToInventory({ kind:'weapon', name:w, power: 12 + Math.floor(Math.random()*20), level:1 });
    debugLog(`Chest dropped weapon: ${w}`);
  } else if (r < 0.65) {
    const pool = ['Speed','Vitality','Shield']; const p = pool[Math.floor(Math.random()*pool.length)];
    addToInventory({ kind:'potion', name:p, duration:10, strength: p === 'Shield' ? 30 : p === 'Speed' ? 1.6 : 3 });
    debugLog(`Chest dropped potion: ${p}`);
  } else {
    addToInventory({ kind:'resource', name:'Wood', amount:2 + Math.floor(Math.random()*5) });
    debugLog('Chest dropped resources');
  }
}
window.openChest = openChest;

// ---------- Inventory helpers ----------
function addToInventory(item) { inventory.push(item); refreshInventoryUI(); debugLog('Added to inventory: ' + JSON.stringify(item)); }
window.addToInventory = addToInventory;

function refreshInventoryUI() {
  const list = document.getElementById('inventoryList'); if (!list) return;
  list.innerHTML = '';
  inventory.forEach((it, idx) => {
    const div = document.createElement('div'); div.className = 'invItem';
    const name = it.kind === 'weapon' ? `${it.name} (Lv ${it.level||1})` : it.kind === 'spellbook' ? `Spell: ${it.name}` : it.kind === 'potion' ? `Potion: ${it.name}` : it.name;
    div.innerHTML = `<div>${name}</div><div><button data-idx="${idx}" class="useBtn">Use</button></div>`;
    list.appendChild(div);
  });
  document.querySelectorAll('.useBtn').forEach(b => {
    b.onclick = (ev) => {
      const idx = parseInt(b.getAttribute('data-idx'));
      const it = inventory[idx];
      if (!it) return;
      if (it.kind === 'weapon') { equippedWeapon = it; window.equippedWeapon = equippedWeapon; debugLog('Equipped weapon: '+it.name); alert('Equipped '+it.name); }
      else if (it.kind === 'spellbook') { equippedSpell = it; window.equippedSpell = equippedSpell; debugLog('Equipped spellbook: '+it.name); alert('Equipped spell '+it.name); }
      else if (it.kind === 'potion') { usePotion(it); inventory.splice(idx,1); refreshInventoryUI(); }
      else if (it.kind === 'fragment') { alert('Fragment'); }
    };
  });
}
window.refreshInventoryUI = refreshInventoryUI;

// ---------- Spell casting & projectiles ----------
function spawnProjectile(pos, dir, speed, power, kind='generic', meta={}) {
  const g = new THREE.SphereGeometry(0.12, 8, 8);
  const mat = new THREE.MeshStandardMaterial({ color: kind === 'fire' ? 0xff7f33 : kind === 'ice' ? 0x99ddff : 0xaedcff });
  const p = new THREE.Mesh(g, mat); p.position.copy(pos);
  p.userData = { proj: { dir: dir.clone().normalize(), speed, power, kind, meta } }; scene.add(p); world.projectiles.push(p);
  debugLog(`Projectile spawned: kind=${kind}, power=${power}`);
  return p;
}
window.spawnProjectile = spawnProjectile;

function castSpell(name) {
  debugLog(`Casting spell: ${name}`);
  if (name === 'Fireball') {
    const dir = camera.getWorldDirection(new THREE.Vector3()); const pos = camera.position.clone().add(dir.clone().multiplyScalar(0.8)).add(new THREE.Vector3(0,-0.1,0));
    spawnProjectile(pos, dir, 22, 30, 'fire');
  } else if (name === 'Water Jet') {
    const dir = camera.getWorldDirection(new THREE.Vector3()); const pos = camera.position.clone().add(dir.clone().multiplyScalar(0.8));
    spawnProjectile(pos, dir, 26, 18, 'water');
  } else if (name === 'Ice Shard') {
    const dir = camera.getWorldDirection(new THREE.Vector3()); const pos = camera.position.clone().add(dir.clone().multiplyScalar(0.8));
    spawnProjectile(pos, dir, 18, 24, 'ice');
  } else if (name === 'Command Dead') {
    const c = camera.position.clone().add(new THREE.Vector3((Math.random()-0.5)*1.6,0,(Math.random()-0.5)*1.6));
    const a = spawnAlly(c); world.allies.push(a); debugLog('Command Dead: spawned ally');
  } else if (name === 'Earth Protector') {
    createEarthProtector(); debugLog('Earth Protector created');
  }
}
window.castSpell = castSpell;

// ---------- Allies & earth protector ----------
function spawnAlly(pos) {
  const g = new THREE.BoxGeometry(0.5, 0.9, 0.3); const m = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const a = new THREE.Mesh(g, m); a.position.copy(pos); a.userData = { timer: 16 }; scene.add(a);
  debugLog('Ally spawned at '+pos.x.toFixed(1)+','+pos.z.toFixed(1));
  return a;
}
window.spawnAlly = spawnAlly;

function createEarthProtector() {
  if (earthShieldObj) { earthShieldObj.userData.t = 12; debugLog('Earth protector refreshed'); return; }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9,1.6,32), new THREE.MeshBasicMaterial({ color:0x8f7a55, side:THREE.DoubleSide, transparent:true, opacity:0.9 }));
  ring.rotation.x = -Math.PI/2; ring.position.copy(camera.position.clone().add(new THREE.Vector3(0,-0.9,0))); ring.userData = { t: 12 };
  scene.add(ring); earthShieldObj = ring; window.earthShieldObj = earthShieldObj;
  debugLog('Earth protector created');
}
window.createEarthProtector = createEarthProtector;

// ---------- Enemy damage & death ----------
function damageEnemy(enemy, amount, attacker=null, weapon=null) {
  if (!enemy || !enemy.userData || !enemy.userData.enemy) { console.warn('damageEnemy: invalid enemy'); return; }
  const d = enemy.userData.enemy;
  if (!d) return;
  if (d.status && d.status.frozen) { debugLog('Enemy is frozen — reduced damage'); amount = Math.round(amount * 0.9); }
  d.hp -= amount;
  enemy.material.emissive = new THREE.Color(0x331100); setTimeout(()=> enemy.material.emissive.set(0x000000),120);
  debugLog(`Damaged enemy (hp now ${d.hp.toFixed ? d.hp.toFixed(1) : d.hp}) by ${amount} (weapon=${weapon ? weapon.name : 'none'})`);
  if (weapon && weapon.name === 'Life Stealer') {
    const heal = amount * 0.2; player.health = Math.min(player.maxHealth, player.health + heal); updateHUD(); debugLog(`Life Stealer healed player ${heal.toFixed(1)}`);
  }
  if (weapon && weapon.name === 'Snake Dagger') {
    d.status.poison = { t:6, dmgPerSec: Math.max(1, Math.floor((weapon.power || 10) * 0.08)) };
    debugLog('Applied poison to enemy');
  }
  if (weapon && weapon.name === 'Frost Crown') {
    if (Math.random() < 0.5) { d.status.frozen = { t: 2.2 }; debugLog('Enemy frozen by Frost Crown'); }
  }
  if (d.hp <= 0) {
    debugLog('Enemy died');
    onEnemyDeath(enemy);
    scene.remove(enemy);
    world.enemies = world.enemies.filter(e => e !== enemy);
  }
}
window.damageEnemy = damageEnemy;

// ---------- Enemy death handling (life crystals) ----------
function onEnemyDeath(enemy) {
  const s = enemy.userData.enemy.strength || 1;
  const base = enemy.userData.enemy.isBoss ? 10 : 1 + Math.floor(Math.random()*2);
  const amount = Math.max(1, Math.floor(base * s * (enemy.userData.enemy.isBoss ? 2.0 : 1)));
  lifeCrystals += amount; window.lifeCrystals = lifeCrystals; updateHUD();
  debugLog(`Enemy death: awarded ${amount} life crystals (total now ${lifeCrystals})`);
  if (enemy.userData.enemy.isBoss || Math.random() < 0.15) {
    spawnCollectible('fragment', enemy.position.clone().add(new THREE.Vector3(0,1,0)));
  }
}
window.onEnemyDeath = onEnemyDeath;

// ---------- Shop ----------
function buyShopItem(item) {
  if (lifeCrystals < item.price) { alert('Not enough crystals'); debugLog(`Failed shop purchase: ${item.display}, need ${item.price} crystals`); return; }
  lifeCrystals -= item.price; window.lifeCrystals = lifeCrystals; addToInventory(item.data); updateHUD(); debugLog(`Purchased ${item.display} for ${item.price} crystals`);
}
window.buyShopItem = buyShopItem;

// ---------- Potions ----------
function usePotion(p) {
  if (!p) return;
  debugLog(`Using potion: ${p.name}`);
  if (p.name === 'Speed') { player.buffs.speed = p.strength; setTimeout(()=> player.buffs.speed = 1.0, p.duration*1000); }
  if (p.name === 'Vitality') { player.maxHealth += p.strength; player.health += p.strength; setTimeout(()=> { player.maxHealth -= p.strength; if (player.health > player.maxHealth) player.health = player.maxHealth; }, p.duration*1000); }
  if (p.name === 'Shield') { player.buffs.shield += p.strength; setTimeout(()=> { player.buffs.shield -= p.strength; }, p.duration*1000); }
  updateHUD();
  debugLog(`Potion applied: ${p.name}`);
}
window.usePotion = usePotion;

// ---------- Weapon upgrade ----------
function upgradeEquippedWeapon() {
  if (!equippedWeapon) { alert('No weapon equipped'); return; }
  const cost = 5 + (equippedWeapon.level || 1) * 6;
  if (lifeCrystals < cost) { alert('Need '+cost+' crystals to upgrade.'); return; }
  lifeCrystals -= cost; equippedWeapon.level = (equippedWeapon.level || 1) + 1; equippedWeapon.power = Math.round((equippedWeapon.power || 12) * 1.33);
  window.lifeCrystals = lifeCrystals; updateHUD(); debugLog(`Upgraded weapon ${equippedWeapon.name} to level ${equippedWeapon.level}`);
}
window.upgradeEquippedWeapon = upgradeEquippedWeapon;

// ---------- Interaction (click) ----------
function worldClickInteraction() {
  const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0,0), camera);
  const targets = [...world.items, ...world.chests, ...world.enemies];
  const hits = ray.intersectObjects(targets, false);
  if (hits.length) {
    const obj = hits[0].object;
    if (obj.userData && obj.userData.collectible) {
      const c = obj.userData.collectible;
      if (c.type === 'fragment') { fragments++; addToInventory({ kind:'fragment', name:'Crown Fragment' }); debugLog('Picked fragment'); }
      else addToInventory({ kind:c.type, name:'Item' });
      scene.remove(obj); world.items = world.items.filter(i=>i!==obj); updateHUD(); return;
    } else if (obj.userData && obj.userData.chest) { openChest(obj); return; }
    else if (obj.userData && obj.userData.enemy) {
      const dmg = equippedWeapon ? equippedWeapon.power : 8;
      damageEnemy(obj, dmg, null, equippedWeapon); return;
    }
  } else {
    if (equippedSpell) castSpell(equippedSpell.name);
    else if (equippedWeapon) {
      if (equippedWeapon.name === 'Elemental Ruin') {
        const ray2 = new THREE.Raycaster(); ray2.setFromCamera(new THREE.Vector2(0,0), camera);
        const groundHit = ray2.intersectObject(ground)[0];
        if (groundHit) {
          const root = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.36, 1.6), new THREE.MeshStandardMaterial({ color:0x2d6b33 }));
          root.position.copy(groundHit.point).add(new THREE.Vector3(0,0.8,0)); scene.add(root); setTimeout(()=> scene.remove(root), 5000);
          world.enemies.forEach(en => { if (en.position.distanceTo(root.position) < 3.0) damageEnemy(en, equippedWeapon.power, null, equippedWeapon); });
          debugLog('Elemental Ruin root placed');
        }
      } else {
        const dir = camera.getWorldDirection(new THREE.Vector3()); const pos = camera.position.clone().add(dir.multiplyScalar(0.8));
        spawnProjectile(pos, dir, 20, equippedWeapon.power || 10, 'generic', { weaponName: equippedWeapon.name });
      }
    }
  }
}
window.worldClickInteraction = worldClickInteraction;
window.addEventListener('mousedown', (e) => { if (e.button === 0 && gameState === 'world') worldClickInteraction(); });

// ---------- Update loops ----------
let lastTime = performance.now() / 1000;
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now() / 1000; let dt = Math.min(0.05, now - lastTime); lastTime = now;

  camera.rotation.set(player.pitch || 0, player.yaw || 0, 0);

  // movement
  const forward = new THREE.Vector3(Math.sin(player.yaw),0,Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));
  let mv = new THREE.Vector3();
  if (keys.w) mv.add(forward); if (keys.s) mv.sub(forward); if (keys.a) mv.sub(right); if (keys.d) mv.add(right);
  if (mv.lengthSq()>0) mv.normalize();
  const speedMul = player.buffs.speed || 1.0;
  player.pos.addScaledVector(mv, player.speed * speedMul * dt); camera.position.copy(player.pos);

  // update projectiles
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i]; const pd = p.userData.proj;
    p.position.addScaledVector(pd.dir, pd.speed * dt);
    if (p.position.distanceTo(player.pos) > 400) { scene.remove(p); world.projectiles.splice(i,1); continue; }
    for (let j = world.enemies.length - 1; j >= 0; j--) {
      const en = world.enemies[j]; if (p.position.distanceTo(en.position) < 0.9) { handleProjectileHit(p, en); break; }
    }
  }

  // enemies
  for (let i = world.enemies.length - 1; i >= 0; i--) {
    const e = world.enemies[i]; const d = e.userData.enemy;
    if (!d) continue;
    if (d.status && d.status.poison) { d.status.poison.t -= dt; d.hp -= d.status.poison.dmgPerSec * dt; if (d.status.poison.t <= 0) delete d.status.poison; }
    if (d.status && d.status.frozen) { d.status.frozen.t -= dt; if (d.status.frozen.t <= 0) delete d.status.frozen; else continue; }
    const dist = e.position.distanceTo(player.pos);
    if (dist < 22) {
      const dir = player.pos.clone().sub(e.position).setY(0).normalize();
      e.position.addScaledVector(dir, (d.isBoss ? 1.2 : 0.9) * dt * (1 + d.strength*0.15));
      if (dist < 1.6 && Math.random() < 0.02) {
        let dmg = 6 * (d.isBoss ? 2.2 : 1.0);
        if (player.buffs.shield > 0) { const absorb = Math.min(player.buffs.shield, dmg); player.buffs.shield -= absorb; dmg -= absorb; }
        player.health -= dmg; updateHUD();
        debugLog(`Player hit by enemy; dmg=${dmg.toFixed(1)} shield=${player.buffs.shield}`);
        if (player.health <= 0) { player.health = 0; debugLog('Player died'); alert('You died — reload to restart.'); }
      }
    }
    if (d.hp <= 0) { onEnemyDeath(e); scene.remove(e); world.enemies.splice(i,1); }
  }

  // allies
  for (let i = world.allies.length-1; i>=0; i--) {
    const a = world.allies[i]; a.userData.timer -= dt;
    let target = null, best = 9999;
    world.enemies.forEach(en => { const dist = en.position.distanceTo(a.position); if (dist < 6 && dist < best) { best = dist; target = en; }});
    if (target) { const dir = target.position.clone().sub(a.position).setY(0).normalize(); a.position.addScaledVector(dir, dt * 1.6); if (Math.random() < 0.02) damageEnemy(target, 6, a, null); }
    if (a.userData.timer <= 0) { scene.remove(a); world.allies.splice(i,1); }
  }

  // earth shield follow
  if (earthShieldObj) { earthShieldObj.position.copy(camera.position.clone().add(new THREE.Vector3(0,-0.9,0))); earthShieldObj.userData.t -= dt; if (earthShieldObj.userData.t <= 0) { scene.remove(earthShieldObj); earthShieldObj = null; window.earthShieldObj = null; } }

  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// ---------- Initialization: spawn default objects for demo ----------
(function seedWorld() {
  function createBiome(name, cx, cz, size, color) {
    world.zones.push({ name, cx, cz, size, color });
    const mat = new THREE.MeshBasicMaterial({ color, opacity:0.12, transparent:true });
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(size*2, size*2), mat);
    patch.rotation.x = -Math.PI/2; patch.position.set(cx, 0.01, cz); scene.add(patch);
  }
  createBiome('Sea', -60, -20, 40, 0x66d9ff);
  createBiome('Coral Reefs', -40, -40, 30, 0xff77cc);
  createBiome('Mountains', 40, 40, 50, 0x888888);
  createBiome('Snowy Mountains', 60, 60, 40, 0xddddff);
  createBiome('Desert', 120, -20, 50, 0xffdd99);
  createBiome('Plains', 20, -80, 40, 0x99ee88);
  createBiome('Forest', -20, 80, 45, 0x1e8b3b);
  createBiome('Rainforest', -80, 80, 45, 0x0aa37f);
  createBiome('Tundra', 100, 80, 38, 0xccf0ff);
  createBiome('Meadow', -100, -80, 30, 0xa8ffb2);
  createBiome('Ancient Ruins', 0, 140, 35, 0xffe0a0);

  for (let i=0;i<16;i++) spawnChest(new THREE.Vector3((Math.random()-0.5)*220, 0.25, (Math.random()-0.5)*220));
  for (let i=0;i<18;i++) spawnEnemy(new THREE.Vector3((Math.random()-0.5)*220, 0.5, (Math.random()-0.5)*220), { strength: 1 + Math.floor(Math.random()*2) });
  spawnEnemy(new THREE.Vector3(-60, 1, -18), { isBoss:true, biome:'Sea', strength: 3 });
  spawnEnemy(new THREE.Vector3(40, 1, 42), { isBoss:true, biome:'Mountains', strength: 3 });
  spawnEnemy(new THREE.Vector3(0, 1, 140), { isBoss:true, biome:'Ancient Ruins', strength: 3 });

  for (let i=0;i<12;i++) spawnCollectible('fragment', new THREE.Vector3((Math.random()-0.5)*200,0.6,(Math.random()-0.5)*200));
  debugLog('World seeded: chests/enemies/fragments spawned');
})();

// ---------- UI wiring (menu/hud/shop) ----------
document.getElementById('btnPlay')?.addEventListener('click', ()=>{ gameState = 'world'; window.gameState = gameState; showHUD(); debugLog('Switched to world'); });
document.getElementById('btnMuseum')?.addEventListener('click', ()=>{ gameState = 'museum'; window.gameState = gameState; showHUD(); debugLog('Switched to museum'); /* museum setup left as is */ });
document.getElementById('openInventory')?.addEventListener('click', ()=>{ toggleInventory(); });
document.getElementById('openShop')?.addEventListener('click', ()=>{ shopModal.classList.remove('hidden'); debugLog('Shop opened'); refreshShopUI(); });
document.getElementById('closeShop')?.addEventListener('click', ()=>{ shopModal.classList.add('hidden'); debugLog('Shop closed'); });
document.getElementById('toggleBuild')?.addEventListener('click', ()=>{ buildMode = !buildMode; document.getElementById('toggleBuild').innerText = buildMode ? 'Building: ON' : 'Build'; debugLog('Build mode: '+buildMode); });

function toggleInventory() {
  if (!inventoryPanel) return;
  inventoryPanel.classList.toggle('hidden');
  refreshInventoryUI();
  debugLog('Inventory toggled: ' + (inventoryPanel.classList.contains('hidden') ? 'closed' : 'open'));
}

// shop UI refresh (simple)
function refreshShopUI() {
  const grid = document.getElementById('shopItems'); if (!grid) return;
  grid.innerHTML = '';
  shopItemsDef.forEach(it => {
    const div = document.createElement('div'); div.className = 'shopItem';
    div.innerHTML = `<div class="icon">${it.display[0]}</div><div class="meta"><div style="font-weight:700">${it.display}</div><div style="font-size:12px;color:#bfe">Price: ${it.price} crystals</div></div>`;
    const btn = document.createElement('button'); btn.innerText = 'Buy'; btn.onclick = ()=> { buyShopItem(it); refreshShopUI(); };
    div.appendChild(btn);
    grid.appendChild(div);
  });
}
refreshShopUI();

// ---------- Projectile hit handler ----------
function handleProjectileHit(proj, enemy) {
  const pd = proj.userData.proj;
  if (pd.kind === 'fire') damageEnemy(enemy, pd.power, null, null);
  if (pd.kind === 'water') damageEnemy(enemy, Math.round(pd.power*0.85));
  if (pd.kind === 'ice') { damageEnemy(enemy, pd.power); enemy.userData.enemy.status.frozen = { t: 2.5 }; }
  scene.remove(proj); world.projectiles = world.projectiles.filter(x=>x!==proj);
}
window.handleProjectileHit = handleProjectileHit;

// ---------- Final exposure for external test harness ----------
window.debugLog = debugLog;
window.spawnChest = spawnChest;
window.spawnEnemy = spawnEnemy;
window.spawnCollectible = spawnCollectible;
window.openChest = openChest;
window.castSpell = castSpell;
window.spawnProjectile = spawnProjectile;
window.damageEnemy = damageEnemy;
window.buyShopItem = buyShopItem;
window.upgradeEquippedWeapon = upgradeEquippedWeapon;
window.usePotion = usePotion;
window.equippedWeapon = equippedWeapon;
window.equippedSpell = equippedSpell;
window.inventory = inventory;
window.updateHUD = updateHUD;
window.worldClickInteraction = worldClickInteraction;

debugLog('Debug-enabled app.js loaded and ready. Exposed helpers on window.*; run tests or play the game.');
