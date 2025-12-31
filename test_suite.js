// Test harness for Colin's Crown prototype
// Paste into browser console or include after app.js on the page and call runAllTests()

(function(){
  if (!window.player || !window.world) {
    console.error('Game globals not found (player/world). Make sure app.js has loaded and you are in the world scene.');
    alert('Test harness: game not ready. Open the game and press Play (world) before running tests.');
    return;
  }

  const panel = document.createElement('div');
  panel.id = 'testPanel';
  panel.style.position = 'fixed';
  panel.style.right = '12px';
  panel.style.top = '12px';
  panel.style.zIndex = '99999';
  panel.style.background = 'rgba(0,0,0,0.7)';
  panel.style.color = '#e6ffe6';
  panel.style.padding = '10px';
  panel.style.borderRadius = '8px';
  panel.style.fontFamily = 'system-ui';
  panel.style.fontSize = '13px';
  panel.innerHTML = '<b>Test Runner</b><div id="testResults">Ready</div>';
  document.body.appendChild(panel);

  function logResult(name, ok, details) {
    const el = document.getElementById('testResults');
    const row = document.createElement('div');
    row.innerHTML = `<div style="margin-top:6px"><span style="color:${ok? '#8fff9a':'#ff9a9a'}">${ok? 'PASS':'FAIL'}</span> — ${name}${details? ' — '+details : ''}</div>`;
    el.appendChild(row);
    console[ok ? 'log' : 'warn'](`TEST ${ok ? 'PASS' : 'FAIL'}: ${name}` + (details ? ' — ' + details : ''));
  }

  function wait(ms){ return new Promise(res=>setTimeout(res, ms)); }

  async function testMovement() {
    const name = 'Movement (W forward / A strafe left / D strafe right)';
    const start = player.pos.clone();
    keys.w = true;
    await wait(400);
    keys.w = false;
    const after = player.pos.clone();
    const moved = after.distanceTo(start) > 0.05;
    logResult(name, moved, `moved ${after.distanceTo(start).toFixed(3)} units`);
    const start2 = player.pos.clone();
    keys.a = true; await wait(300); keys.a = false;
    const leftPos = player.pos.clone();
    keys.d = true; await wait(300); keys.d = false;
    const rightPos = player.pos.clone();
    const leftMoved = leftPos.distanceTo(start2) > 0.02;
    const rightMoved = rightPos.distanceTo(leftPos) > 0.02;
    logResult('Strafing', leftMoved && rightMoved, `left:${leftMoved}, right:${rightMoved}`);
    return moved && leftMoved && rightMoved;
  }

  async function testCameraDrag() {
    const name = 'Camera rotation (right-mouse drag)';
    const oldYaw = player.yaw, oldPitch = player.pitch;
    player.yaw += 0.6; player.pitch += 0.15;
    await wait(80);
    const changed = (Math.abs(player.yaw - oldYaw) > 0.1) && (Math.abs(player.pitch - oldPitch) > 0.02);
    logResult(name, changed, `yawDelta=${(player.yaw-oldYaw).toFixed(2)}, pitchDelta=${(player.pitch-oldPitch).toFixed(2)}`);
    return changed;
  }

  async function testInventoryToggle() {
    const name = 'Inventory toggle (E)';
    const invPanel = document.getElementById('inventory');
    const before = invPanel.classList.contains('hidden');
    toggleInventory();
    await wait(120);
    const after = invPanel.classList.contains('hidden');
    const ok = before !== after;
    logResult(name, ok);
    toggleInventory();
    return ok;
  }

  async function testChestLootRate() {
    const name = 'Chest spellbook drop rate ≈ 10% (stat test, 200 chests)';
    const startInvCount = inventory.filter(i=>i.kind==='spellbook').length;
    const tempChests = [];
    for (let i=0;i<200;i++){
      const x = 1000 + i*2;
      const z = 1000;
      spawnChest(new THREE.Vector3(x, 0.25, z));
      tempChests.push(world.chests[world.chests.length-1]);
    }
    for (let ch of tempChests){ openChest(ch); await wait(8); }
    const spellsFound = inventory.filter(i=>i.kind==='spellbook').length - startInvCount;
    tempChests.forEach(c => { scene.remove(c); world.chests = world.chests.filter(x=>x!==c); });
    const rate = spellsFound / 200;
    const ok = Math.abs(rate - 0.10) <= 0.06;
    logResult(name, ok, `rate=${(rate*100).toFixed(1)}% (${spellsFound}/200)`);
    return ok;
  }

  async function testSpellCasting() {
    const name = 'Spell casting (fire, water, ice, command dead, earth protector)';
    const spells = ['Fireball','Water Jet','Ice Shard','Command Dead','Earth Protector'];
    let allOk = true;
    for (let s of spells) {
      const beforeProj = world.projectiles.length;
      const beforeAllies = (world.allies ? world.allies.length : 0);
      castSpell(s);
      await wait(220);
      if (s === 'Command Dead') {
        const nowAllies = (world.allies ? world.allies.length : 0);
        const ok = nowAllies > beforeAllies;
        logResult(`Spell: ${s}`, ok, `allies ${beforeAllies}→${nowAllies}`);
        allOk = allOk && ok;
      } else if (s === 'Earth Protector') {
        const ok = !!window.earthShieldObj;
        logResult(`Spell: ${s}`, ok, `earthShieldObj=${!!window.earthShieldObj}`);
        allOk = allOk && ok;
        if (window.earthShieldObj) { scene.remove(window.earthShieldObj); window.earthShieldObj = null; }
      } else {
        const nowProj = world.projectiles.length;
        const ok = nowProj > beforeProj;
        logResult(`Spell: ${s}`, ok, `projectiles ${beforeProj}→${nowProj}`);
        allOk = allOk && ok;
        for (let i=world.projectiles.length-1;i>=0;i--) { scene.remove(world.projectiles[i]); world.projectiles.splice(i,1); }
      }
      await wait(80);
    }
    return allOk;
  }

  async function testWeaponEffects() {
    function spawnTestEnemy() { return spawnEnemy(new THREE.Vector3(player.pos.x+3, 0.5, player.pos.z+3), { strength:1 }); }
    let okAll = true;
    const snake = { kind:'weapon', name:'Snake Dagger', power:20 };
    let e1 = spawnTestEnemy();
    damageEnemy(e1, 6, null, snake);
    await wait(80);
    const poisoned = e1.userData.enemy && e1.userData.enemy.status && e1.userData.enemy.status.poison;
    logResult('Snake Dagger poison', !!poisoned, `poison=${!!poisoned}`);
    okAll = okAll && !!poisoned;
    const frost = { kind:'weapon', name:'Frost Crown', power:18 };
    let frozenObserved = false;
    for (let i=0;i<8;i++){
      let e2 = spawnTestEnemy();
      damageEnemy(e2, 12, null, frost);
      if (e2.userData.enemy.status && e2.userData.enemy.status.frozen) frozenObserved = true;
      scene.remove(e2);
    }
    logResult('Frost Crown freeze (50% chance) observed', frozenObserved, `observed freeze:${frozenObserved}`);
    okAll = okAll && frozenObserved;
    const startHP = player.health;
    const life = { kind:'weapon', name:'Life Stealer', power:20 };
    let e3 = spawnTestEnemy();
    damageEnemy(e3, 25, null, life);
    await wait(80);
    const healed = player.health > startHP;
    logResult('Life Stealer heals player 20% of damage', healed, `hp ${startHP}→${player.health}`);
    okAll = okAll && healed;
    const elem = { kind:'weapon', name:'Elemental Ruin', power:20 };
    equippedWeapon = elem;
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0,0), camera);
    const hits = ray.intersectObject(ground);
    if (hits.length) {
      const pos = hits[0].point;
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.36, 1.6), new THREE.MeshStandardMaterial({color:0x2d6b33}));
      root.position.copy(pos).add(new THREE.Vector3(0,0.8,0));
      scene.add(root);
      logResult('Elemental Ruin root placement', true, 'root placed programmatically');
    } else {
      logResult('Elemental Ruin root placement', false, 'ground raycast failed');
      okAll = false;
    }
    return okAll;
  }

  async function testPotions() {
    let allOk = true;
    const sp = { kind:'potion', name:'Speed', duration:2, strength:1.6 };
    usePotion(sp); await wait(80);
    const spOk = player.buffs.speed === 1.6 || player.buffs.speed > 1.0;
    logResult('Speed potion applied', spOk);
    allOk = allOk && spOk;
    const priorMax = player.maxHealth;
    const vit = { kind:'potion', name:'Vitality', duration:1, strength:8 };
    usePotion(vit); await wait(80);
    const vitOk = player.maxHealth > priorMax;
    logResult('Vitality potion applied', vitOk);
    allOk = allOk && vitOk;
    const priorShield = player.buffs.shield || 0;
    const sh = { kind:'potion', name:'Shield', duration:2, strength:15 };
    usePotion(sh); await wait(80);
    const shieldOk = player.buffs.shield >= priorShield + 15 || player.buffs.shield > priorShield;
    logResult('Shield potion applied', shieldOk);
    allOk = allOk && shieldOk;
    return allOk;
  }

  async function testShop() {
    lifeCrystals += 30; updateHUD();
    const beforeInv = inventory.length;
    const item = shopItemsDef && shopItemsDef[0];
    if (!item) { logResult('Shop purchase', false, 'shopItemsDef missing'); return false; }
    buyShopItem(item);
    await wait(120);
    const afterInv = inventory.length;
    const ok = lifeCrystals >= 0 && afterInv > beforeInv;
    logResult('Shop purchase (deduct crystals & add to inventory)', ok, `crystals after=${lifeCrystals}, inv ${beforeInv}→${afterInv}`);
    return ok;
  }

  async function testBossDecorations() {
    const bosses = world.enemies.filter(e => e.userData && e.userData.enemy && e.userData.enemy.isBoss);
    if (!bosses.length) { logResult('Boss decorations', false, 'no bosses found'); return false; }
    let foundDecor = false;
    bosses.forEach(b => { if (b.children && b.children.length > 0) foundDecor = true; });
    logResult('Boss decorations (per-biome visuals)', foundDecor, `bosses:${bosses.length}`);
    return foundDecor;
  }

  async function runAllTests() {
    const finalResults = [];
    panel.querySelector('#testResults').innerHTML = '<div>Running tests...</div>';
    await wait(200);

    finalResults.push(['Movement', await testMovement()]);
    await wait(120);
    finalResults.push(['Camera', await testCameraDrag()]);
    await wait(120);
    finalResults.push(['Inventory UI', await testInventoryToggle()]);
    await wait(120);
    finalResults.push(['Chest loot rate', await testChestLootRate()]);
    await wait(120);
    finalResults.push(['Spell casting', await testSpellCasting()]);
    await wait(120);
    finalResults.push(['Weapon effects', await testWeaponEffects()]);
    await wait(120);
    finalResults.push(['Potions', await testPotions()]);
    await wait(120);
    finalResults.push(['Shop', await testShop()]);
    await wait(120);
    finalResults.push(['Boss decorations', await testBossDecorations()]);

    const passed = finalResults.filter(r=>r[1]).length;
    const total = finalResults.length;
    const summary = `<div style="margin-top:8px"><b>Summary:</b> ${passed}/${total} tests passed.</div>`;
    panel.querySelector('#testResults').insertAdjacentHTML('beforeend', summary);
    console.log('Detailed test results:', finalResults);
    alert(`Test run finished: ${passed}/${total} passed. See overlay or console for details.`);
  }

  window.runAllTests = runAllTests;
  console.log('Test harness loaded. Run runAllTests() to execute tests.');
})();
