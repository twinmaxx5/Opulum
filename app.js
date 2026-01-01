/* app.js — Improved Opulum prototype:
   - Stylized procedural terrain (colored per biome)
   - Composite low-poly enemy and boss models (not boxes)
   - Escape closes shop/inventory
   - Shop close button works
   - Helper functions & debug log remain exposed for testing
   Note: This is still a prototype — replace composite meshes with GLTFs when ready.
*/

// ----------- Utilities & simple value noise -------------
function lerp(a,b,t){return a+(b-a)*t;}
function fade(t){return t*t*(3-2*t);} // smootherstep
// Simple value noise (grid-based)
class ValueNoise {
  constructor(seed=12345){
    this.seed = seed;
    this.perm = new Uint8Array(512);
    for (let i=0;i<256;i++) this.perm[i]=i;
    // simple shuffle
    for (let i=255;i>0;i--) {
      const j = Math.floor((Math.abs(Math.sin(seed++))*10000)) % (i+1);
      const tmp = this.perm[i]; this.perm[i]=this.perm[j]; this.perm[j]=tmp;
    }
    for (let i=0;i<256;i++) this.perm[i+256]=this.perm[i];
  }
  noise2(x,y){
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const a = this.perm[xi + this.perm[yi]] / 255;
    const b = this.perm[xi+1 + this.perm[yi]] / 255;
    const c = this.perm[xi + this.perm[yi+1]] / 255;
    const d = this.perm[xi+1 + this.perm[yi+1]] / 255;
    const u = fade(xf), v = fade(yf);
    const x1 = lerp(a,b,u), x2 = lerp(c,d,u);
    return lerp(x1,x2,v);
  }
}
const noise = new ValueNoise(42);

// ----------- Three.js setup -------------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfefff);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 1000);
camera.position.set(0,1.8,6);

const hemi = new THREE.HemisphereLight(0xffffee, 0x666677, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(6,10,3);
scene.add(sun);

window.addEventListener('resize', ()=> {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
});

// ----------- Debug panel -------------
(function(){
  if (document.getElementById('debugPanel')) return;
  const p = document.createElement('div'); p.id='debugPanel';
  p.style.position='fixed'; p.style.left='12px'; p.style.top='12px'; p.style.zIndex='99999';
  p.style.background='rgba(0,0,0,0.45)'; p.style.color='#e6ffe6'; p.style.padding='8px'; p.style.borderRadius='8px';
  p.style.fontFamily='system-ui'; p.style.fontSize='12px';
  p.innerHTML='<div style="font-weight:bold;margin-bottom:6px">Game Debug</div><div id="gameDebugLog"></div>';
  document.body.appendChild(p);
})();
function debugLog(msg) {
  console.log('[Opulum]', msg);
  const dbg = document.getElementById('gameDebugLog');
  if (dbg) {
    const e = document.createElement('div'); e.textContent = msg; dbg.prepend(e);
    while (dbg.children.length>10) dbg.removeChild(dbg.lastChild);
  }
}

// ----------- World, biomes, terrain -------------
const world = { zones:[], objects:[], enemies:[], projectiles:[], items:[], chests:[], allies:[] };
window.world = world;

const biomeDefs = [
  { name:'Sea', cx:-60, cz:-20, size:40, color:new THREE.Color(0x76d9ff) },
  { name:'Coral Reefs', cx:-40, cz:-40, size:30, color:new THREE.Color(0xff77cc) },
  { name:'Mountains', cx:40, cz:40, size:50, color:new THREE.Color(0xB0B0B0) },
  { name:'Snowy Mountains', cx:60, cz:60, size:40, color:new THREE.Color(0xE6F0FF) },
  { name:'Desert', cx:120, cz:-20, size:50, color:new THREE.Color(0xffdd99) },
  { name:'Plains', cx:20, cz:-80, size:40, color:new THREE.Color(0x99ee88) },
  { name:'Forest', cx:-20, cz:80, size:45, color:new THREE.Color(0x2e8b57) },
  { name:'Rainforest', cx:-80, cz:80, size:45, color:new THREE.Color(0x0aa37f) },
  { name:'Tundra', cx:100, cz:80, size:38, color:new THREE.Color(0xccf0ff) },
  { name:'Meadow', cx:-100, cz:-80, size:30, color:new THREE.Color(0xa8ffb2) },
  { name:'Ancient Ruins', cx:0, cz:140, size:35, color:new THREE.Color(0xffe0a0) }
];
biomeDefs.forEach(b=>world.zones.push(b));

// Procedural stylized terrain
const TERRAIN_SIZE = 480;
const SEG = 192;
const terrainGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEG, SEG);
terrainGeo.rotateX(-Math.PI/2);

// displace vertices with noise and compute color per vertex by biome proximity + height
for (let i=0;i<terrainGeo.attributes.position.count;i++){
  const vx = terrainGeo.attributes.position.getX(i);
  const vz = terrainGeo.attributes.position.getZ(i);
  let h = 0;
  let freq = 0.01;
  h += (noise.noise2(vx*freq, vz*freq)-0.5)*6.0;
  freq = 0.05;
  h += (noise.noise2(vx*freq+10, vz*freq+10)-0.5)*2.0;
  terrainGeo.attributes.position.setY(i, h);
}

// vertex colors
const colors = new Float32Array(terrainGeo.attributes.position.count * 3);
for (let i=0;i<terrainGeo.attributes.position.count;i++){
  const vx = terrainGeo.attributes.position.getX(i);
  const vz = terrainGeo.attributes.position.getZ(i);
  const vy = terrainGeo.attributes.position.getY(i);
  let best = biomeDefs[0]; let bestDist = 1e9;
  for (const b of biomeDefs) {
    const d = Math.hypot(vx - b.cx, vz - b.cz);
    if (d < bestDist) { best = b; bestDist = d; }
  }
  const c = best.color.clone();
  if (vy > 3) c.lerp(new THREE.Color(0xffffff), 0.6);
  else if (vy < -2) c.lerp(new THREE.Color(0x3ea6d9), 0.5);
  c.offsetHSL(0, 0, (vy/20));
  colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
}
terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors,3));
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors:true, flatShading:true });
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.receiveShadow = true;
scene.add(terrain);

// water plane near sea center
const water = new THREE.Mesh(new THREE.CircleGeometry(70, 32), new THREE.MeshStandardMaterial({ color:0x2ea8e5, transparent:true, opacity:0.65 }));
water.rotation.x = -Math.PI/2; water.position.set(-60, 0.02, -20);
scene.add(water);

// ----------- Stylized props -------------
function makeTree() {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,0.8,6), new THREE.MeshStandardMaterial({ color:0x6b4423 }));
  trunk.position.y = 0.4;
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.65,1.0,6), new THREE.MeshStandardMaterial({ color:0x2e8b57 }));
  leaves.position.y = 1.05;
  group.add(trunk); group.add(leaves);
  return group;
}
function makeCoral() {
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.35,0.8,6), new THREE.MeshStandardMaterial({ color:0xff88bb }));
  c.rotation.x = Math.PI*0.1;
  return c;
}
function scatterProps() {
  for (let i=0;i<180;i++){
    const x = (Math.random()-0.5)*TERRAIN_SIZE*0.9;
    const z = (Math.random()-0.5)*TERRAIN_SIZE*0.9;
    const ry = 30;
    const ray = new THREE.Raycaster(new THREE.Vector3(x,ry,z), new THREE.Vector3(0,-1,0));
    const hit = ray.intersectObject(terrain, true)[0];
    if (!hit) continue;
    const pos = hit.point;
    const b = biomeDefs.reduce((best,r)=> (Math.hypot(pos.x-r.cx,pos.z-r.cz) < Math.hypot(pos.x-best.cx,pos.z-best.cz) ? r : best), biomeDefs[0]);
    if (b.name.includes('Coral') || b.name.includes('Sea')) {
      const coral = makeCoral(); coral.position.copy(pos).add(new THREE.Vector3(0,0.12,0)); coral.rotation.y = Math.random()*Math.PI*2;
      scene.add(coral); world.objects.push(coral);
    } else if (b.name.includes('Forest') || b.name.includes('Rainforest')) {
      const t = makeTree(); t.position.copy(pos); scene.add(t); world.objects.push(t);
    } else {
      const rock = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.3,0.4), new THREE.MeshStandardMaterial({ color:0xd6c6b0 }));
      rock.position.copy(pos).add(new THREE.Vector3(0,0.15,0)); rock.rotation.y = Math.random()*Math.PI;
      scene.add(rock); world.objects.push(rock);
    }
  }
}
scatterProps();

// ----------- Player & controls -------------
const player = { pos:new THREE.Vector3(0,2.0,6), yaw:0, pitch:0, speed:6, maxHealth:100, health:100, buffs:{speed:1, shield:0} };
window.player = player;
camera.position.copy(player.pos);

// input
const keys = { w:false,a:false,s:false,d:false };
window.keys = keys;
window.addEventListener('keydown', e=>{
  if (e.code==='KeyW') keys.w=true;
  if (e.code==='KeyA') keys.a=true;
  if (e.code==='KeyS') keys.s=true;
  if (e.code==='KeyD') keys.d=true;
  if (e.code==='KeyE') toggleInventory();
  if (e.code==='Escape') {
    closeShop();
    closeInventory();
  }
});
window.addEventListener('keyup', e=>{
  if (e.code==='KeyW') keys.w=false;
  if (e.code==='KeyA') keys.a=false;
  if (e.code==='KeyS') keys.s=false;
  if (e.code==='KeyD') keys.d=false;
});

// right mouse drag camera
let rightMouse=false, prevMouse={x:0,y:0};
window.addEventListener('contextmenu', e=>e.preventDefault());
window.addEventListener('mousedown', e=>{ if (e.button===2){ rightMouse=true; prevMouse={x:e.clientX,y:e.clientY}; document.body.style.cursor='grabbing'; }});
window.addEventListener('mouseup', e=>{ if (e.button===2){ rightMouse=false; document.body.style.cursor='auto'; }});
window.addEventListener('mousemove', e=>{ if (rightMouse){ const dx = e.clientX - prevMouse.x, dy = e.clientY - prevMouse.y; prevMouse={x:e.clientX,y:e.clientY}; player.yaw -= dx*0.003; player.pitch -= dy*0.003; player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch)); }});

// HUD & UI helpers
function showHUD(){ document.getElementById('hud').classList.remove('hidden'); document.getElementById('menu').classList.add('hidden'); document.getElementById('mode').innerText='world'; }
function closeShop(){ document.getElementById('shopModal').classList.add('hidden'); debugLog('Shop closed'); }
function openShop(){ document.getElementById('shopModal').classList.remove('hidden'); debugLog('Shop opened'); refreshShopUI(); }
function closeInventory(){ document.getElementById('inventory').classList.add('hidden'); }
function toggleInventory(){ document.getElementById('inventory').classList.toggle('hidden'); refreshInventoryUI(); }

// expose for test
window.openShop = openShop; window.closeShop = closeShop; window.toggleInventory = toggleInventory; window.closeInventory = closeInventory;

// ----------- Inventory & economy -------------
let fragments = 0; let lifeCrystals = 0;
window.fragments = fragments; window.lifeCrystals = lifeCrystals;
const inventory = []; window.inventory = inventory;
let equippedWeapon = null; let equippedSpell = null;
window.equippedWeapon = () => equippedWeapon; window.equippedSpell = () => equippedSpell;

function updateHUD(){ document.getElementById('fragments').innerText = `Fragments: ${fragments}`; document.getElementById('crystals').innerText = `Crystals: ${lifeCrystals}`; document.getElementById('health').innerText = `HP: ${Math.round(player.health)}`; }
updateHUD();

// ----------- Stylized enemy builder (composite, not box) -------------
function makeEnemyMesh(isBoss=false){
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: isBoss ? 0x884422 : 0xff6677, flatShading:true });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff4e6, flatShading:true });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(isBoss?0.8:0.35, isBoss?1.2:0.6, 6, 8), bodyMat);
  body.position.y = isBoss?1.2:0.6;
  const head = new THREE.Mesh(new THREE.SphereGeometry(isBoss?0.6:0.32, 12, 8), headMat);
  head.position.y = body.position.y + (isBoss?1.05:0.5);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.06,8,6), new THREE.MeshStandardMaterial({ color:0x111111 }));
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.12, head.position.y+0.06, 0.28);
  eyeR.position.set(0.12, head.position.y+0.06, 0.28);
  g.add(body); g.add(head); g.add(eyeL); g.add(eyeR);
  if (isBoss) {
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.28,0.6,6), new THREE.MeshStandardMaterial({ color:0xffcc66 }));
    crest.position.set(0, head.position.y+0.25, 0); crest.rotation.x = Math.PI*0.2;
    g.add(crest);
  }
  return g;
}

// spawn enemy entity (model group) with data
function spawnEnemy(pos, opts={}) {
  const eMesh = makeEnemyMesh(opts.isBoss);
  eMesh.position.copy(pos);
  const data = { isBoss:!!opts.isBoss, strength:opts.strength||1, hp: opts.isBoss?200*(opts.strength||1):40*(opts.strength||1), status:{} };
  eMesh.userData.enemy = data;
  scene.add(eMesh); world.enemies.push(eMesh);
  debugLog(`Spawned enemy at ${pos.x.toFixed(1)},${pos.z.toFixed(1)} boss=${!!opts.isBoss}`);
  if (opts.isBoss) addBossDecoration(eMesh, opts.biome || 'Generic');
  return eMesh;
}

// add boss decoration (aquanaut helmet etc)
function addBossDecoration(bossMesh, biomeName) {
  const biome = (biomeName||'').toLowerCase();
  if (biome.includes('sea') || biome.includes('coral')) {
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 10), new THREE.MeshStandardMaterial({ color:0x66e0ff, transparent:true, opacity:0.55 }));
    glass.position.y += 0.5; bossMesh.add(glass);
    debugLog('Boss: aquanaut helmet added');
  } else if (biome.includes('mountain')) {
    const stone = new THREE.Mesh(new THREE.TorusGeometry(0.9,0.22,8,16), new THREE.MeshStandardMaterial({ color:0x888888 }));
    stone.rotation.x = Math.PI/2; stone.position.y += 0.6; bossMesh.add(stone);
    debugLog('Boss: mountain crown added');
  } else if (biome.includes('ancient')) {
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(1.6,1.6), new THREE.MeshStandardMaterial({ color:0xffe0a0 }));
    rune.position.y += 1.2; bossMesh.add(rune);
    debugLog('Boss: ancient rune added');
  } else {
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffdd77 }));
    orb.position.y += 0.9; bossMesh.add(orb);
  }
}

// sample spawn enemies and bosses
for (let i=0;i<16;i++){
  const x = (Math.random()-0.5)*200, z = (Math.random()-0.5)*200;
  spawnEnemy(new THREE.Vector3(x, 0.3, z), { strength: 1 + Math.floor(Math.random()*2) });
}
spawnEnemy(new THREE.Vector3(-60,0.3,-18), { isBoss:true, biome:'Sea', strength:3 });
spawnEnemy(new THREE.Vector3(40,0.3,42), { isBoss:true, biome:'Mountains', strength:3 });
spawnEnemy(new THREE.Vector3(0,0.3,140), { isBoss:true, biome:'Ancient Ruins', strength:3 });

// ----------- Collectibles & chests (spellbook 10% chance) -------------
function spawnCollectible(type, pos, meta={}) {
  const mat = new THREE.MeshStandardMaterial({ color: type==='fragment' ? 0xffdd33 : 0xffffff });
  const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18,0), mat);
  s.position.copy(pos); s.userData.collectible = { type, meta }; scene.add(s); world.items.push(s);
  return s;
}
for (let i=0;i<14;i++) spawnCollectible('fragment', new THREE.Vector3((Math.random()-0.5)*220, 0.6, (Math.random()-0.5)*220));

function spawnChest(pos){
  const chest = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.42,0.6), new THREE.MeshStandardMaterial({ color:0x8b5a2b }));
  chest.add(base); chest.position.copy(pos); chest.userData = { opened:false, chest:true };
  scene.add(chest); world.chests.push(chest);
  return chest;
}
for (let i=0;i<16;i++) spawnChest(new THREE.Vector3((Math.random()-0.5)*220,0.25,(Math.random()-0.5)*220));

function openChest(chest){
  if (!chest || chest.userData.opened) return;
  chest.userData.opened = true;
  debugLog('Chest opened');
  const r = Math.random();
  if (r < 0.10) {
    const spells = ['Fireball','Water Jet','Ice Shard','Command Dead','Earth Protector'];
    const s = spells[Math.floor(Math.random()*spells.length)];
    inventory.push({ kind:'spellbook', name:s, power:20 + Math.floor(Math.random()*12) });
    debugLog('Chest reward: spellbook '+s);
  } else if (r < 0.35) {
    const pool = ['Snake Dagger','Elemental Ruin','Frost Crown','Life Stealer'];
    const w = pool[Math.floor(Math.random()*pool.length)];
    inventory.push({ kind:'weapon', name:w, power:12 + Math.floor(Math.random()*20), level:1 });
    debugLog('Chest reward: weapon '+w);
  } else if (r < 0.65) {
    const pool = ['Speed','Vitality','Shield']; const p = pool[Math.floor(Math.random()*pool.length)];
    inventory.push({ kind:'potion', name:p, duration:10, strength: p==='Shield'?30:(p==='Speed'?1.6:3) });
    debugLog('Chest reward: potion '+p);
  } else {
    inventory.push({ kind:'resource', name:'Wood', amount:2 + Math.floor(Math.random()*5) });
    debugLog('Chest reward: resources');
  }
  refreshInventoryUI();
}

// ----------- Inventory, shop, potions, upgrades -------------
function refreshInventoryUI(){
  const list = document.getElementById('inventoryList'); if (!list) return; list.innerHTML = '';
  inventory.forEach((it,idx)=>{
    const div = document.createElement('div'); div.className='invItem';
    const name = it.kind==='weapon'?`${it.name} (Lv ${it.level||1})`:it.kind==='spellbook'?`Spell: ${it.name}`:it.kind==='potion'?`Potion: ${it.name}`:it.name;
    div.innerHTML = `<div>${name}</div><div><button data-idx="${idx}" class="useBtn">Use</button></div>`;
    list.appendChild(div);
  });
  document.querySelectorAll('.useBtn').forEach(b=>{
    b.onclick = ()=> {
      const idx = parseInt(b.getAttribute('data-idx'));
      const it = inventory[idx];
      if (!it) return;
      if (it.kind==='weapon'){ equippedWeapon = it; debugLog('Equipped '+it.name); alert('Equipped '+it.name); }
      else if (it.kind==='spellbook'){ equippedSpell = it; debugLog('Equipped spell '+it.name); alert('Equipped spell '+it.name); }
      else if (it.kind==='potion'){ usePotion(it); inventory.splice(idx,1); refreshInventoryUI(); }
    };
  });
}
document.getElementById('equipWeapon').onclick = ()=> { const idx = inventory.findIndex(x=>x.kind==='weapon'); if (idx>=0){ equippedWeapon=inventory[idx]; alert('Equipped '+equippedWeapon.name);} else alert('No weapon'); };
document.getElementById('equipSpell').onclick = ()=> { const idx = inventory.findIndex(x=>x.kind==='spellbook'); if (idx>=0){ equippedSpell=inventory[idx]; alert('Equipped '+equippedSpell.name);} else alert('No spellbook'); };
document.getElementById('upgradeWeapon').onclick = ()=> {
  if (!equippedWeapon) { alert('Equip a weapon first'); return; }
  const cost = 5 + (equippedWeapon.level||1)*6;
  if (lifeCrystals < cost) { alert('Need '+cost+' crystals'); return; }
  lifeCrystals -= cost; equippedWeapon.level = (equippedWeapon.level||1)+1; equippedWeapon.power = Math.round((equippedWeapon.power||12)*1.33);
  updateHUD(); debugLog('Upgraded weapon '+equippedWeapon.name);
};
document.getElementById('placeInMuseum').onclick = ()=> alert('Use build mode in museum to place items.');

// shop definition
const shopItemsDef = [
  { id:'potion_speed', display:'Speed Potion', price:6, data:{ kind:'potion', name:'Speed', duration:12, strength:1.6 } },
  { id:'potion_vital', display:'Vitality Potion', price:8, data:{ kind:'potion', name:'Vitality', duration:18, strength:12 } },
  { id:'potion_shield', display:'Shield Potion', price:7, data:{ kind:'potion', name:'Shield', duration:18, strength:35 } },
  { id:'snake_dagger', display:'Snake Dagger', price:14, data:{ kind:'weapon', name:'Snake Dagger', power:20, level:1 } },
  { id:'elemental_ruin', display:'Elemental Ruin', price:18, data:{ kind:'weapon', name:'Elemental Ruin', power:22, level:1 } },
  { id:'frost_crown', display:'Frost Crown', price:16, data:{ kind:'weapon', name:'Frost Crown', power:18, level:1 } },
  { id:'life_stealer', display:'Life Stealer', price:20, data:{ kind:'weapon', name:'Life Stealer', power:16, level:1 } },
];

function refreshShopUI(){
  const grid = document.getElementById('shopItems'); if (!grid) return; grid.innerHTML='';
  shopItemsDef.forEach(it=>{
    const div = document.createElement('div'); div.className='shopItem';
    div.innerHTML = `<div class="icon">${it.display[0]}</div><div class="meta"><div style="font-weight:700">${it.display}</div><div style="font-size:12px;color:#bfe">Price: ${it.price} crystals</div></div>`;
    const btn = document.createElement('button'); btn.innerText='Buy'; btn.onclick = ()=> buyShopItem(it);
    div.appendChild(btn); grid.appendChild(div);
  });
}
function buyShopItem(item){
  if (lifeCrystals < item.price) { alert('Not enough crystals'); debugLog('Shop purchase failed: not enough crystals'); return; }
  lifeCrystals -= item.price; inventory.push(item.data); updateHUD(); refreshInventoryUI(); debugLog('Bought '+item.display);
}
document.getElementById('openShop').onclick = ()=> { document.getElementById('shopModal').classList.remove('hidden'); refreshShopUI(); };
document.getElementById('closeShop').onclick = ()=> { document.getElementById('shopModal').classList.add('hidden'); };

// ----------- Spells & projectiles -------------
function spawnProjectile(pos, dir, speed, power, kind='generic'){
  const g = new THREE.Mesh(new THREE.SphereGeometry(0.12,8,8), new THREE.MeshStandardMaterial({ color: kind==='fire'?0xff7f33: kind==='ice'?0x99ddff:0xaedcff }));
  g.position.copy(pos); g.userData.proj = { dir: dir.clone().normalize(), speed, power, kind }; scene.add(g); world.projectiles.push(g);
  debugLog(`Spawned projectile (${kind})`);
  return g;
}
function castSpell(name){
  debugLog('Cast spell: '+name);
  if (name==='Fireball'){ const dir = camera.getWorldDirection(new THREE.Vector3()); spawnProjectile(camera.position.clone().add(dir.clone().multiplyScalar(0.8)), dir, 22, 30, 'fire'); }
  else if (name==='Water Jet'){ const dir = camera.getWorldDirection(new THREE.Vector3()); spawnProjectile(camera.position.clone().add(dir.clone().multiplyScalar(0.8)), dir, 26, 18, 'water'); }
  else if (name==='Ice Shard'){ const dir = camera.getWorldDirection(new THREE.Vector3()); spawnProjectile(camera.position.clone().add(dir.clone().multiplyScalar(0.8)), dir, 18, 24, 'ice'); }
  else if (name==='Command Dead'){ const a = spawnAlly(camera.position.clone().add(new THREE.Vector3((Math.random()-0.5)*1.6,0,(Math.random()-0.5)*1.6))); world.allies.push(a); }
  else if (name==='Earth Protector'){ createEarthProtector(); }
}

// allies and earth protector
function spawnAlly(pos){ const g = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.9,0.3), new THREE.MeshStandardMaterial({ color:0xffffff })); g.position.copy(pos); g.userData = { timer:16 }; scene.add(g); return g; }
let earthShieldObj = null;
function createEarthProtector(){ if (earthShieldObj){ earthShieldObj.userData.t=12; return; } const ring = new THREE.Mesh(new THREE.RingGeometry(0.9,1.6,32), new THREE.MeshBasicMaterial({ color:0x8f7a55, side:THREE.DoubleSide, transparent:true, opacity:0.9 })); ring.rotation.x=-Math.PI/2; ring.position.copy(camera.position.clone().add(new THREE.Vector3(0,-0.9,0))); ring.userData={t:12}; scene.add(ring); earthShieldObj=ring; }

// ----------- Damage / effects / death -------------
function damageEnemy(enemy, amount, attacker=null, weapon=null){
  if (!enemy || !enemy.userData || !enemy.userData.enemy) return;
  const d = enemy.userData.enemy;
  if (d.status && d.status.frozen){ amount = Math.round(amount*0.9); debugLog('Enemy frozen, reduced damage'); }
  d.hp -= amount;
  enemy.traverse(c=>{ if (c.material) c.material.emissive && (c.material.emissive.set(0x331100), setTimeout(()=>c.material.emissive.set(0x000000),140)); });
  if (weapon && weapon.name==='Life Stealer'){ const heal = amount*0.2; player.health = Math.min(player.maxHealth, player.health+heal); updateHUD(); }
  if (weapon && weapon.name==='Snake Dagger'){ d.status.poison = { t:6, per: Math.max(1, Math.floor((weapon.power||10)*0.08)) }; debugLog('Applied poison'); }
  if (weapon && weapon.name==='Frost Crown'){ if (Math.random()<0.5){ d.status.frozen={t:2.2}; debugLog('Enemy frozen by Frost Crown'); } }
  if (d.hp<=0){ debugLog('Enemy died'); onEnemyDeath(enemy); scene.remove(enemy); world.enemies = world.enemies.filter(e=>e!==enemy); }
}
function onEnemyDeath(enemy){
  const s = enemy.userData.enemy.strength||1;
  const base = enemy.userData.enemy.isBoss ? 8 : 1;
  const qty = Math.max(1, Math.floor(base * s * (enemy.userData.enemy.isBoss?2.2:1)));
  lifeCrystals += qty; updateHUD(); debugLog(`Enemy dropped ${qty} crystals`);
  if (enemy.userData.enemy.isBoss || Math.random()<0.15) spawnCollectible('fragment', enemy.position.clone().add(new THREE.Vector3(0,1,0)));
}

// ----------- Interaction handler -------------
function handlePrimaryAction(){
  const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0,0), camera);
  const hits = ray.intersectObjects([...world.items, ...world.chests, ...world.enemies], true);
  if (hits.length){
    const o = hits[0].object;
    let target = o; while (target && !target.userData && target.parent) target = target.parent;
    if (target && target.userData && target.userData.collectible){ const c = target.userData.collectible; if (c.type==='fragment'){ fragments++; inventory.push({ kind:'fragment', name:'Crown Fragment' }); } else inventory.push({ kind:c.type, name:'Item' }); scene.remove(target); world.items = world.items.filter(i=>i!==target); updateHUD(); refreshInventoryUI(); }
    else if (target && target.userData && target.userData.chest) { openChest(target); }
    else {
      const enemyObj = hits.find(h=>h.object.parent && h.object.parent.userData && h.object.parent.userData.enemy) || hits.find(h=>h.object.userData && h.object.userData.enemy);
      const enemy = enemyObj ? (enemyObj.object.parent && enemyObj.object.parent.userData && enemyObj.object.parent.userData.enemy ? enemyObj.object.parent : enemyObj.object) : null;
      if (enemy && enemy.userData && enemy.userData.enemy){ const dmg = equippedWeapon ? equippedWeapon.power : 8; damageEnemy(enemy, dmg, null, equippedWeapon); return; }
      if (equippedSpell) castSpell(equippedSpell.name);
      else if (equippedWeapon){
        if (equippedWeapon.name==='Elemental Ruin'){ const ray2=new THREE.Raycaster(); ray2.setFromCamera(new THREE.Vector2(0,0), camera); const gh = ray2.intersectObject(terrain)[0]; if (gh){ const root = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.36,1.6), new THREE.MeshStandardMaterial({ color:0x2d6b33 })); root.position.copy(gh.point).add(new THREE.Vector3(0,0.8,0)); scene.add(root); setTimeout(()=>scene.remove(root),5000); world.enemies.forEach(en=>{ if (en.position.distanceTo(root.position)<3.0) damageEnemy(en, equippedWeapon.power, null, equippedWeapon); }); } }
        else { const dir = camera.getWorldDirection(new THREE.Vector3()); spawnProjectile(camera.position.clone().add(dir.clone().multiplyScalar(0.8)), dir, 20, equippedWeapon.power||10, 'generic', { weaponName: equippedWeapon.name }); }
      }
    }
  } else {
    if (equippedSpell) castSpell(equippedSpell.name);
    else if (equippedWeapon){ const dir = camera.getWorldDirection(new THREE.Vector3()); spawnProjectile(camera.position.clone().add(dir.clone().multiplyScalar(0.8)), dir, 20, equippedWeapon.power||8, 'generic'); }
  }
}
window.addEventListener('mousedown', e=>{ if (e.button===0 && document.getElementById('mode').innerText === 'world') handlePrimaryAction(); });

// ----------- Projectiles update -------------
function updateProjectiles(dt){
  for (let i=world.projectiles.length-1;i>=0;i--){
    const p = world.projectiles[i]; const pd = p.userData.proj;
    p.position.addScaledVector(pd.dir, pd.speed*dt);
    if (p.position.distanceTo(camera.position)>400){ scene.remove(p); world.projectiles.splice(i,1); continue; }
    for (let j=world.enemies.length-1;j>=0;j--){
      const en = world.enemies[j];
      if (p.position.distanceTo(en.position)<(en.userData.enemy.isBoss?1.4:0.9)){
        if (pd.kind==='fire') damageEnemy(en, pd.power);
        else if (pd.kind==='water') damageEnemy(en, Math.round(pd.power*0.85));
        else if (pd.kind==='ice'){ damageEnemy(en, pd.power); en.userData.enemy.status.frozen = { t:2.4 }; }
        scene.remove(p); world.projectiles.splice(i,1); break;
      }
    }
  }
}

// ----------- Allies update -------------
function updateAllies(dt){
  for (let i=world.allies.length-1;i>=0;i--){
    const a = world.allies[i]; a.userData.timer -= dt;
    let target=null, best=1e9;
    world.enemies.forEach(en=>{ const d=en.position.distanceTo(a.position); if (d<6 && d<best){ best=d; target=en; } });
    if (target){ const dir = target.position.clone().sub(a.position).setY(0).normalize(); a.position.addScaledVector(dir, dt*1.6); if (Math.random()<0.02) damageEnemy(target,6); }
    if (a.userData.timer<=0){ scene.remove(a); world.allies.splice(i,1); }
  }
}

// ----------- Potions -------------
function usePotion(p){
  if (!p) return;
  debugLog('Use potion '+p.name);
  if (p.name==='Speed'){ player.buffs.speed = p.strength; setTimeout(()=>player.buffs.speed=1, p.duration*1000); }
  if (p.name==='Vitality'){ player.maxHealth += p.strength; player.health += p.strength; setTimeout(()=>{ player.maxHealth -= p.strength; if (player.health>player.maxHealth) player.health = player.maxHealth; }, p.duration*1000); }
  if (p.name==='Shield'){ player.buffs.shield += p.strength; setTimeout(()=>{ player.buffs.shield -= p.strength; }, p.duration*1000); }
  updateHUD();
}

// ----------- Update loop -------------
let last = performance.now()/1000;
function animate(){
  requestAnimationFrame(animate);
  const now = performance.now()/1000; const dt = Math.min(0.05, now-last); last = now;

  camera.rotation.set(player.pitch, player.yaw, 0);

  const forward = new THREE.Vector3(Math.sin(player.yaw),0,Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));
  const mv = new THREE.Vector3();
  if (keys.w) mv.add(forward); if (keys.s) mv.sub(forward); if (keys.a) mv.sub(right); if (keys.d) mv.add(right);
  if (mv.lengthSq()>0) mv.normalize();
  player.pos.addScaledVector(mv, player.speed * (player.buffs.speed||1) * dt);
  camera.position.copy(player.pos);

  world.enemies.forEach((en, idx)=> {
    const d = en.userData.enemy;
    en.rotation.y += 0.2*dt;
    const bob = Math.sin((performance.now()/1000) * (d.isBoss?1.2:2.0) + idx) * (d.isBoss?0.2:0.08);
    en.position.y = (d.isBoss?1.2:0.3) + bob;
  });

  updateProjectiles(dt);
  world.enemies.forEach(en=>{
    const ed = en.userData.enemy;
    if (ed.status && ed.status.poison){ ed.status.poison.t -= dt; ed.hp -= ed.status.poison.per*dt; if (ed.status.poison.t<=0) delete ed.status.poison; }
    if (ed.status && ed.status.frozen){ ed.status.frozen.t -= dt; if (ed.status.frozen.t<=0) delete ed.status.frozen; else return; }
    const dist = en.position.distanceTo(player.pos);
    if (dist < 20){
      const dir = player.pos.clone().sub(en.position).setY(0).normalize();
      en.position.addScaledVector(dir, (ed.isBoss?1.2:0.9) * dt * (1 + ed.strength*0.15));
      if (dist < 1.6 && Math.random()<0.02){
        let dmg = 6 * (ed.isBoss?2.2:1.0);
        if (player.buffs.shield>0){ const absorb = Math.min(player.buffs.shield, dmg); player.buffs.shield -= absorb; dmg -= absorb; }
        player.health -= dmg; updateHUD();
        debugLog('Player hit, dmg '+dmg.toFixed(1));
        if (player.health <=0){ player.health=0; alert('You died — reload to try again'); }
      }
    }
  });
  updateAllies(dt);

  if (earthShieldObj){ earthShieldObj.position.copy(camera.position.clone().add(new THREE.Vector3(0,-0.9,0))); earthShieldObj.userData.t -= dt; if (earthShieldObj.userData.t<=0){ scene.remove(earthShieldObj); earthShieldObj=null; } }

  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// ----------- Basic UI wiring -------------
document.getElementById('btnPlay').addEventListener('click', ()=> { showHUD(); debugLog('Play pressed — Opulum world'); });
document.getElementById('btnMuseum').addEventListener('click', ()=> { showHUD(); document.getElementById('mode').innerText='museum'; debugLog('Museum opened'); });
document.getElementById('closeShop').addEventListener('click', ()=> closeShop());

// expose important bits for debugging/testing
window.debugLog = debugLog; window.spawnEnemy = spawnEnemy; window.spawnCollectible = spawnCollectible; window.openChest = openChest;
debugLog('Opulum prototype loaded (terrain, styled enemies, shop close/Esc handling)');
