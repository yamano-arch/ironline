
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const canvas = $("game-canvas");
  const ctx = canvas.getContext("2d");
  const W = 390, H = 520;

  const DEF = {
    machinegun: { name:"機関銃", cost:100, dmg:8, rate:.30, range:100, color:"#d5ec8d" },
    cannon:     { name:"榴弾砲", cost:180, dmg:65, rate:2.5, range:140, color:"#ffd28c" },
    missile:    { name:"ミサイル", cost:250, dmg:100, rate:3, range:175, color:"#f5ab79" },
    radar:      { name:"電子戦", cost:200, dmg:0, rate:.5, range:115, color:"#86e2f8" }
  };

  const KIND = {
    infantry:{hp:60,speed:38,armor:0,reward:5,damage:1,color:"#be8056"},
    car:{hp:105,speed:65,armor:.13,reward:12,damage:2,color:"#a79a68"},
    tank:{hp:330,speed:24,armor:.54,reward:25,damage:3,color:"#536c51"},
    drone:{hp:115,speed:62,armor:.08,reward:15,damage:1,color:"#8bbdc1"},
    boss:{hp:3200,speed:18,armor:.4,reward:200,damage:5,color:"#a85c4f"}
  };

  const PATH = [
    [-35,110],[75,110],[75,210],[165,210],
    [165,330],[300,330],[300,160],[425,160]
  ];

  const PADS = [
    [28,65],[128,75],[129,153],[30,270],
    [220,163],[215,260],[245,385],[342,255],
    [95,390],[175,425],[340,80],[350,405]
  ];

  const MODS = [
    {id:"power",name:"高威力弾",desc:"攻撃力＋30%"},
    {id:"rapid",name:"高速装填",desc:"攻撃間隔－20%"},
    {id:"range",name:"長距離照準",desc:"射程＋25%"},
    {id:"pierce",name:"徹甲弾",desc:"装甲へのダメージ増加"},
    {id:"blast",name:"拡散爆撃",desc:"範囲攻撃を強化"},
    {id:"critical",name:"精密射撃",desc:"会心率＋20%"},
    {id:"chain",name:"連鎖弾",desc:"近くの敵にも追加攻撃"},
    {id:"slow",name:"制圧弾",desc:"命中した敵の速度低下"}
  ];

  let state, towers, enemies, bullets, effects;
  let selectedType, selectedPad, lastTime = 0;
  let nextEnemyId = 1;
  let draftForWave=0, strikeAiming=false, strikeRings=[], combatTexts=[];
  const TACTICS = [
    {id:"warfund",tier:"ECONOMY",name:"💰 戦時特別予算",desc:"即時 +200G。配置と強化で敵を迎え撃つ。",apply:()=>state.money+=200},
    {id:"overclock",tier:"FIREPOWER",name:"🔥 全砲門オーバークロック",desc:"全兵器の連射速度 +18%。以後の設置にも適用。",apply:()=>{state.fireRate*=.82;towers.forEach(t=>t.interval*=.82)}},
    {id:"ammunition",tier:"FIREPOWER",name:"💥 強化弾頭",desc:"全兵器の攻撃力 +25%。以後の設置にも適用。",apply:()=>{state.globalPower*=1.25;towers.forEach(t=>t.power*=1.25)}},
    {id:"radial",tier:"TACTICAL",name:"🎯 精密レーダー",desc:"全兵器の射程 +17%。以後の設置にも適用。",apply:()=>{state.globalRange*=1.17;towers.forEach(t=>t.range*=1.17)}},
    {id:"salvage",tier:"ECONOMY",name:"⚙ 戦場回収班",desc:"敵撃破報酬 +35%。撃破するほど資金が増える。",apply:()=>state.rewardRate*=1.35},
    {id:"bunker",tier:"DEFENSE",name:"🛡 緊急防壁",desc:"基地HPを5回復し、最大HPも2増加。",apply:()=>{state.maxHp+=2;state.hp=Math.min(state.maxHp,state.hp+5)}},
    {id:"airforce",tier:"SUPPORT",name:"✈ 航空優勢",desc:"爆撃ゲージ +50%。爆撃の威力も +25%。",apply:()=>{state.strike=Math.min(100,state.strike+50);state.strikePower*=1.25}},
    {id:"armor",tier:"ANTI-ARMOR",name:"🔩 対装甲弾",desc:"全兵器に装甲貫通 +20%。戦車の突破を防ぐ。",apply:()=>{state.globalPierce+=.2;towers.forEach(t=>t.pierce+=.2)}}
  ];

  function reset() {
    state = {
      hp:20, maxHp:20, money:500, wave:0, active:false,
      paused:false, speed:1, finished:false,
      queue:[], spawnTimer:0, xp:0, xpNeed:80,
      upgrades:0, rerolls:3, choosing:false,
       globalPower:1,globalRange:1,fireRate:1,rewardRate:1,globalPierce:0,
       strike:50,strikePower:1,usedTactics:[],kills:0,eliteKills:0,
      note:"防衛施設を設置してください",
      noteTime:0
    };
    towers = []; enemies = []; bullets = []; effects = [];
    selectedType = "machinegun";
    selectedPad = -1;
    draftForWave=0;strikeAiming=false;strikeRings=[];combatTexts=[];
    $("draft-modal").classList.add("hidden");
    $("strike-hint").classList.add("hidden");
    $("evolution-modal").classList.add("hidden");
    $("result-modal").classList.add("hidden");
    updateUI();
  }

  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const towerAt = index => towers.find(t => t.pad === index);

  function notice(message) {
    state.note = message;
    state.noteTime = 2.4;
    $("battle-message").textContent = message;
  }

  function makeTower(index, type) {
    const d = DEF[type];
    const [x,y] = PADS[index];
    return {
      pad:index, type, x,y, level:1, spent:d.cost,
      power:state.globalPower, interval:d.rate*state.fireRate, range:d.range*state.globalRange,
      cooldown:0, angle:-Math.PI/2,
      pierce:state.globalPierce, critical:0, blast:0,
      chain:false, slow:false, mods:[],
      evolution:null, kills:0
    };
  }

  function selectPad(index) {
    if (state.choosing || state.finished) return;

    selectedPad = index;
    const existing = towerAt(index);

    if (!existing) {
      const price = DEF[selectedType].cost;
      if (state.money < price) {
        notice("資金が足りません！");
        updateUI();
        return;
      }
      state.money -= price;
      towers.push(makeTower(index, selectedType));
      notice(DEF[selectedType].name + "を設置！");
    }

    updateUI();
  }

  function upgradeCost(t) {
    return Math.round(DEF[t.type].cost * (
      .38 + Math.pow(t.level, 1.24) * .27
    ));
  }

  function upgradeTower() {
    const t = towerAt(selectedPad);
    if (!t || t.level >= 10) return;
    const cost = upgradeCost(t);
    if (state.money < cost) return;

    state.money -= cost;
    t.spent += cost;
    t.level++;
    t.power *= t.type === "radar" ? 1.08 : 1.16;
    if (t.type === "radar") t.range *= 1.025;

    burst(t.x,t.y,"#c7ee86",22);
    notice("LEVEL " + t.level + " に強化！");
    updateUI();
  }

  function sellTower() {
    const t = towerAt(selectedPad);
    if (!t) return;
    state.money += Math.floor(t.spent * .7);
    towers = towers.filter(a => a !== t);
    selectedPad = -1;
    notice("兵器を売却しました");
    updateUI();
  }

  function waveProfile(n) {
    const unitCount=9+Math.floor(n*1.8);
    const tank=n>=5 && (n%3===0 || n>=14);
    const drone=n>=6 && (n%4===0 || n>=15);
    const rush=n%4===2;
    const swarm=n%4===1;
    return {unitCount,tank,drone,rush,swarm,boss:n%5===0,
      label:(n%5===0?"⚠ 重装甲指揮官 / ":"")+
        (rush?"高速突破部隊":swarm?"歩兵の大群":tank?"重装甲突撃":drone?"ドローン奇襲":"混成戦闘部隊")};
  }
  function waveKinds(n) {
    const profile=waveProfile(n),result=[];
    for(let i=0;i<profile.unitCount;i++){
      let kind="infantry";
      if(n>=3&&i%5===0)kind="car";
      if(profile.tank && i%4===0)kind="tank";
      if(profile.drone && i%5===2)kind="drone";
      if(profile.rush && i%3===0)kind="car";
      result.push(kind);
    }
    if(profile.boss)result.push("boss");
    return result;
  }
  function tacticalDraft(n) {
    state.choosing=true;
    state.paused=true;
    $("draft-wave").textContent=String(n).padStart(2,"0");
    const p=waveProfile(n);
    $("draft-intel").textContent=p.label+" / 推定"+(p.unitCount+(p.boss?1:0))+"体。戦術強化を1つ選んで出撃。";
    const holder=$("draft-options");
    holder.innerHTML="";
    const pool=[...TACTICS].sort(()=>Math.random()-.5);
    const options=pool.slice(0,3);
    options.forEach(card=>{
      const button=document.createElement("button");
      button.type="button";button.className="draft-option";
      const type=document.createElement("small"),head=document.createElement("strong"),desc=document.createElement("span");
      type.textContent=card.tier;head.textContent=card.name;desc.textContent=card.desc;
      button.append(type,head,desc);
      button.onclick=()=>{
        card.apply();state.usedTactics.push(card.name.replace(/^[^ ]+ /,""));
        state.choosing=false;state.paused=false;
        $("draft-modal").classList.add("hidden");
        launchWave(n);updateUI();
      };
      holder.append(button);
    });
    $("draft-modal").classList.remove("hidden");
    updateUI();
  }
  function launchWave(n) {
    draftForWave=n;
    state.wave=n;state.active=true;
    state.queue=waveKinds(n);
    state.spawnTimer=.5;state.paused=false;
    notice("WAVE "+n+" — "+waveProfile(n).label);
  }
  function startWave() {
    if(state.active||state.finished||state.choosing)return;
    tacticalDraft(state.wave+1);
  }
  function useAirstrike(x,y) {
    if(state.strike<100 || !state.active || state.paused)return;
    state.strike=0;strikeAiming=false;
    $("strike-hint").classList.add("hidden");
    strikeRings.push({x,y,radius:12,life:.7});
    const dmg=240*state.strikePower+state.wave*32;
    let hits=0;
    enemies.forEach(e=>{
      if(e.alive&&Math.hypot(e.x-x,e.y-y)<105){
        hurt(e,dmg,{pierce:1,critical:0,slow:false,kills:0});hits++;
      }
    });
    for(let i=0;i<5;i++)burst(x+(Math.random()-.5)*95,y+(Math.random()-.5)*95,"#ffb75f",30);
    combatTexts.push({x,y:y-20,text:"AIRSTRIKE ×"+hits,life:1.6,color:"#fff3af"});
    notice("✈ 航空爆撃！ "+hits+"体を攻撃");
    updateUI();
  }

  function spawnEnemy(kind) {
    const d = KIND[kind];
    const scale = 1 + (state.wave-1) * .13;
    const elite=kind!=="boss" && state.wave>=3 && Math.random()<Math.min(.38,.08+state.wave*.013);
    return {
      id:nextEnemyId++, kind,
      x:PATH[0][0], y:PATH[0][1],
      segment:0, hp:d.hp*scale*(elite?2.2:1), maxHp:d.hp*scale*(elite?2.2:1),
      speed:d.speed*(elite?1.16:1), armor:d.armor, reward:d.reward*(elite?3:1), elite,
      damage:d.damage, color:d.color,
      slowTime:0, alive:true, angle:0
    };
  }

  function moveEnemy(e, dt) {
    const slowFactor = e.slowTime > 0 ? .55 : 1;
    e.slowTime = Math.max(0,e.slowTime-dt);
    let travel = e.speed * slowFactor * dt;

    while (travel > 0 && e.segment < PATH.length-1) {
      const target = PATH[e.segment+1];
      const dx = target[0]-e.x, dy=target[1]-e.y;
      const left = Math.hypot(dx,dy);

      if (left < .001) {
        e.segment++;
        continue;
      }

      e.angle = Math.atan2(dy,dx);

      if (travel >= left) {
        e.x=target[0]; e.y=target[1];
        e.segment++; travel-=left;
      } else {
        e.x += dx/left*travel;
        e.y += dy/left*travel;
        travel=0;
      }
    }

    if (e.segment >= PATH.length-1) {
      e.alive=false;
      state.hp -= e.damage;
      combatTexts.push({x:345,y:105,text:"BASE -"+e.damage,life:1.1,color:"#ff8176"});
      burst(e.x,e.y,"#ff7373",13);
    }
  }

  function burst(x,y,color,count=12) {
    for(let i=0;i<count;i++){
      const a=Math.random()*Math.PI*2;
      const v=25+Math.random()*90;
      effects.push({
        x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,
        life:.35+Math.random()*.35,
        max:.7,color,size:2+Math.random()*4
      });
    }
  }

  function hurt(e, amount, source) {
    if (!e.alive) return;
    const armor = e.armor * (1-Math.min(.9,source.pierce));
    const crit = Math.random()<source.critical ? 1.8 : 1;
    const actual=amount*(1-armor)*crit;
    e.hp -= actual;
    if(actual>15 && Math.random()<.35)combatTexts.push({x:e.x,y:e.y-18,text:"-"+Math.round(actual),life:.65,color:crit>1?"#ffe88d":"#e7f2d2"});
    if(source.slow)e.slowTime=Math.max(e.slowTime,1.5);

    if(e.hp<=0){
      e.alive=false;
      state.money+=Math.round(e.reward*state.rewardRate);
      state.kills++;if(e.elite)state.eliteKills++;
      state.strike=Math.min(100,state.strike+(e.kind==="boss"?38:e.elite?12:4));
      state.xp+=e.kind==="boss"?20:4;
      source.kills++;
      burst(e.x,e.y,e.elite?"#ffe18b":"#ffbf61",e.elite?25:12);
    }
  }

  function fireTower(t,target) {
    if(t.type==="radar"){
      enemies.forEach(e=>{
        if(e.alive&&distance(t,e)<t.range)
          e.slowTime=Math.max(e.slowTime,.8);
      });
      return;
    }

    t.angle=Math.atan2(target.y-t.y,target.x-t.x);
    const d=DEF[t.type];
    const damage=d.dmg*t.power;

    bullets.push({
      x:t.x,y:t.y,targetId:target.id,
      tx:target.x,ty:target.y,
      speed:t.type==="missile"?310:
            t.type==="cannon"?380:650,
      damage,source:t,type:t.type,
      color:d.color,alive:true
    });

    burst(
      t.x+Math.cos(t.angle)*17,
      t.y+Math.sin(t.angle)*17,
      "#ffe7a6", t.type==="machinegun"?3:6
    );
  }

  function impact(b,target) {
    burst(b.x,b.y,b.type==="missile"?"#ff964c":"#ffcf79",
      b.type==="machinegun"?4:18);

    if(target && target.alive)hurt(target,b.damage,b.source);

    let radius = b.type==="cannon"?37:
                 b.type==="missile"?19:0;
    radius += b.source.blast;

    if(radius>0){
      enemies.forEach(e=>{
        if(e.alive && e!==target &&
           Math.hypot(e.x-b.x,e.y-b.y)<radius)
          hurt(e,b.damage*.6,b.source);
      });
    }

    if(b.source.chain && target){
      const other=enemies.find(e=>e.alive&&e!==target&&
        distance(e,target)<80);
      if(other)hurt(other,b.damage*.55,b.source);
    }
  }

  function updateBullets(dt) {
    bullets.forEach(b=>{
      if(!b.alive)return;
      const target=enemies.find(e=>e.id===b.targetId&&e.alive);

      if(target){b.tx=target.x;b.ty=target.y;}

      const dx=b.tx-b.x,dy=b.ty-b.y;
      const length=Math.hypot(dx,dy);
      const step=b.speed*dt;

      if(length<=step || length<4){
        b.x=b.tx;b.y=b.ty;
        impact(b,target);
        b.alive=false;
      }else{
        b.x+=dx/length*step;
        b.y+=dy/length*step;
      }
    });
    bullets=bullets.filter(b=>b.alive);
  }

  function updateEffects(dt) {
    effects.forEach(p=>{
      p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;
      p.vx*=.95;p.vy*=.95;
    });
    effects=effects.filter(p=>p.life>0);
  }

  function findTarget(t) {
    const available=enemies.filter(e=>
      e.alive&&distance(t,e)<=t.range
    );
    if(!available.length)return null;
    available.sort((a,b)=>b.segment-a.segment);
    return available[0];
  }

  function applyMod(t,m) {
    if(m.id==="power")t.power*=1.3;
    if(m.id==="rapid")t.interval*=.8;
    if(m.id==="range")t.range*=1.25;
    if(m.id==="pierce")t.pierce+=.4;
    if(m.id==="blast")t.blast+=22;
    if(m.id==="critical")t.critical+=.2;
    if(m.id==="chain")t.chain=true;
    if(m.id==="slow")t.slow=true;
    t.mods.push(m.id);
  }

  function checkEvolution(t) {
    const has=(...ids)=>ids.every(id=>t.mods.includes(id));

    if(t.type==="machinegun"&&has("rapid","chain")){
      t.evolution="ヴァルカン・オーバードライブ";
      t.interval*=.65;
      t.power*=1.35;
    }
    if(t.type==="cannon"&&has("blast","power")){
      t.evolution="クラスター・デストロイヤー";
      t.blast+=33;
      t.power*=1.35;
    }
    if(t.evolution){
      burst(t.x,t.y,"#ffe27b",35);
      notice("LEGENDARY EVOLUTION！");
    }
  }

  function evolutionChoices(t) {
    let available=MODS.filter(m=>!t.mods.includes(m.id));
    if(t.type==="radar")
      available=available.filter(m=>
        ["range","rapid","slow","blast"].includes(m.id)
      );

    const wanted=t.type==="machinegun"
      ?["rapid","chain"]:t.type==="cannon"
      ?["blast","power"]:[];

    const guaranteed=available.find(m=>wanted.includes(m.id));
    available=available.sort(()=>Math.random()-.5);

    const result=available.slice(0,3);
    if(guaranteed&&!result.some(m=>m.id===guaranteed.id))
      result[2]=guaranteed;
    return result;
  }

  function openEvolution() {
    if(state.choosing||state.finished)return;

    const available=towers.filter(t=>t.mods.length<3);
    if(!available.length)return;

    state.choosing=true;
    state.paused=true;

    const t=available.sort((a,b)=>b.level-a.level)[0];
    selectedPad=t.pad;
    $("evolution-modal").classList.remove("hidden");

    const drawChoices=()=>{
      const holder=$("evolution-options");
      holder.innerHTML="";

      evolutionChoices(t).forEach(m=>{
        const button=document.createElement("button");
        button.className="evolution-choice";
        const strong=document.createElement("strong");
        strong.textContent="⚙ "+m.name;
        const desc=document.createElement("span");
        desc.textContent=m.desc;
        button.append(strong,desc);

        button.onclick=()=>{
          applyMod(t,m);
          if(!t.evolution)checkEvolution(t);
          state.xp-=state.xpNeed;
          state.upgrades++;
          state.xpNeed=state.upgrades<3?80:120;
          state.choosing=false;
          state.paused=false;
          $("evolution-modal").classList.add("hidden");
          notice("改造完了："+m.name);
          updateUI();
        };
        holder.appendChild(button);
      });
    };

    $("reroll-button").onclick=()=>{
      if(state.rerolls<=0)return;
      state.rerolls--;
      drawChoices();
      $("reroll-button").textContent=
        "候補を引き直す（残り"+state.rerolls+"）";
    };

    $("reroll-button").textContent=
      "候補を引き直す（残り"+state.rerolls+"）";
    drawChoices();
  }

  function finish(win) {
    state.finished=true;state.active=false;
    state.paused=true;

    $("result-modal").classList.remove("hidden");
    $("result-icon").textContent=win?"★":"✕";
    $("result-title").textContent=win?
      "MISSION COMPLETE":"MISSION FAILED";
    $("result-description").textContent=win?
      "全20ウェーブを防衛しました！":
      "基地が陥落しました";

    const stars=state.hp===state.maxHp?3:state.hp>=11?2:1;
    $("result-stats").textContent=
      "到達 WAVE "+state.wave+
      " / 20 ｜ 撃破 "+state.kills+" ｜ エリート撃破 "+state.eliteKills+
      " ｜ 獲得戦術 "+state.usedTactics.length+
      " ｜ 防衛評価："+(win?"★".repeat(stars):"—");
    updateUI();
  }

  function update(dt) {
    updateEffects(dt);
    combatTexts.forEach(p=>{p.y-=21*dt;p.life-=dt;});
    combatTexts=combatTexts.filter(p=>p.life>0);
    strikeRings.forEach(p=>{p.radius+=200*dt;p.life-=dt;});
    strikeRings=strikeRings.filter(p=>p.life>0);
    if(state.paused||state.choosing||state.finished)return;

    if(state.noteTime>0){
      state.noteTime-=dt;
      if(state.noteTime<=0)
        $("battle-message").textContent="防衛作戦進行中";
    }

    if(!state.active)return;
    if(state.strike>=100 && !state.choosing && state.noteTime<=0 && state.kills>0){
      $("battle-message").textContent="✈ 航空爆撃 READY — ここで逆転！";
    }
    state.spawnTimer-=dt;
    if(state.queue.length&&state.spawnTimer<=0){
      enemies.push(spawnEnemy(state.queue.shift()));
      state.spawnTimer=waveProfile(state.wave).rush?.28:waveProfile(state.wave).swarm?.32:.47;
    }

    enemies.forEach(e=>{
      if(e.alive)moveEnemy(e,dt);
    });

    towers.forEach(t=>{
      t.cooldown-=dt;
      if(t.cooldown>0)return;
      const target=findTarget(t);
      if(target){
        fireTower(t,target);
        t.cooldown=t.interval;
      }
    });

    updateBullets(dt);
    enemies=enemies.filter(e=>e.alive);

    if(state.hp<=0){
      state.hp=0;
      finish(false);
      return;
    }

    if(!state.queue.length&&!enemies.length){
      state.active=false;
      state.money+=50;
      if(state.hp===state.maxHp)state.money+=20;
      state.xp+=15;
      notice("WAVE "+state.wave+" 突破！");
      if(state.wave>=20){
        finish(true);return;
      }
    }

    if(state.xp>=state.xpNeed&&
       towers.some(t=>t.mods.length<3)){
      openEvolution();
    }

    updateUI();
  }

  // ---------- GRAPHICS ----------

  function circle(x,y,r,color) {
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fillStyle=color;ctx.fill();
  }

  function rounded(x,y,w,h,r,color) {
    ctx.beginPath();ctx.roundRect(x,y,w,h,r);
    ctx.fillStyle=color;ctx.fill();
  }

  function drawTerrain() {
    const gradient=ctx.createLinearGradient(0,0,W,H);
    gradient.addColorStop(0,"#87a46b");
    gradient.addColorStop(1,"#476b56");
    ctx.fillStyle=gradient;ctx.fillRect(0,0,W,H);

    for(let i=0;i<85;i++){
      const x=(i*83+29)%W,y=(i*137+61)%H;
      circle(x,y,2+(i%4),"#779663");
    }

    // Miniature trees
    for(let i=0;i<28;i++){
      const x=(i*113+17)%W,y=(i*79+32)%H;
      if(PATH.some(p=>Math.hypot(p[0]-x,p[1]-y)<32))continue;
      circle(x+3,y+7,12,"#253f3580");
      circle(x,y,10,"#355e40");
      circle(x-4,y-5,8,"#6c9957");
      circle(x+5,y-3,7,"#83ad64");
    }

    // Rock formations
    for(let i=0;i<19;i++){
      const x=(i*71+33)%W,y=(i*113+42)%H;
      if(PATH.some(p=>Math.hypot(p[0]-x,p[1]-y)<31))continue;
      circle(x+3,y+5,8,"#445a4b");
      circle(x,y,7,"#a6a79b");
      circle(x-3,y-3,4,"#d0ceae");
    }

    // Road
    ctx.lineCap="round";ctx.lineJoin="round";
    ctx.beginPath();
    PATH.forEach(([x,y],i)=>{
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    });
    ctx.strokeStyle="#506044";ctx.lineWidth=53;ctx.stroke();
    ctx.strokeStyle="#a88e63";ctx.lineWidth=46;ctx.stroke();
    ctx.strokeStyle="#d2bd8d";ctx.lineWidth=35;ctx.stroke();
    ctx.strokeStyle="#e8d1a0";ctx.lineWidth=1;
    ctx.setLineDash([7,12]);ctx.stroke();ctx.setLineDash([]);
  }

  function drawPads() {
    PADS.forEach(([x,y],i)=>{
      const occupied=towerAt(i);
      if(occupied)return;

      rounded(x-18,y-12,36,29,7,"#344c42");
      rounded(x-16,y-15,32,27,5,
        selectedPad===i?"#a7d96a":"#7eaa80");
      ctx.strokeStyle="#c4edaa";
      ctx.lineWidth=1.5;
      ctx.strokeRect(x-12,y-10,24,17);
      ctx.fillStyle="#e6f8cd";
      ctx.font="bold 19px sans-serif";
      ctx.textAlign="center";
      ctx.fillText("+",x,y+7);
    });
  }

  function drawTower(t) {
    ctx.save();ctx.translate(t.x,t.y);

    circle(3,8,23,"#1b332c80");
    rounded(-20,-10,40,33,9,"#2b3d37");
    rounded(-19,-17,38,30,8,t.evolution?"#d7b65e":"#6d826b");
    rounded(-14,-13,28,22,6,"#90a282");
    circle(0,-3,11,"#445d4a");

    ctx.save();ctx.rotate(t.angle+Math.PI/2);
    const barrel=t.evolution?"#ffdd74":"#cbd2b6";

    if(t.type==="machinegun"){
      for(let k=-1;k<=1;k++)
        rounded(k*6-2,-26,4,25,2,barrel);
      rounded(-10,-10,20,16,5,"#506957");
    }else if(t.type==="cannon"){
      rounded(-5,-30,10,32,4,barrel);
      rounded(-13,-10,26,19,6,"#6c745c");
    }else if(t.type==="missile"){
      rounded(-15,-19,30,27,5,"#586d5c");
      for(let i=-1;i<=1;i++)
        circle(i*9,-13,4,"#efc491");
    }else{
      ctx.strokeStyle="#79dcff";
      ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,-13,16,Math.PI,0);ctx.stroke();
      circle(0,-13,5,"#8fe8ff");
    }
    ctx.restore();

    if(t.evolution){
      ctx.strokeStyle="#ffde76";
      ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,0,25,0,Math.PI*2);ctx.stroke();
    }

    ctx.fillStyle="#fff";
    ctx.font="bold 10px sans-serif";
    ctx.textAlign="center";
    ctx.fillText(t.level,0,11);
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();ctx.translate(e.x,e.y);
    ctx.rotate(e.angle);

    const size=e.kind==="boss"?25:
      e.kind==="tank"?15:e.kind==="car"?12:8;

    circle(3,5,size,"#16282366");

    if(e.kind==="infantry"){
      circle(0,-2,6,"#d1a27c");
      rounded(-6,3,12,10,4,"#694e3b");
    }else if(e.kind==="drone"){
      rounded(-12,-5,24,10,5,"#6fadb8");
      ctx.strokeStyle="#d0f0ef";ctx.lineWidth=3;
      ctx.beginPath();ctx.moveTo(0,-13);ctx.lineTo(0,13);
      ctx.stroke();
    }else{
      rounded(-size,-size*.65,size*2,size*1.3,5,e.color);
      rounded(-size*.65,-size*.45,size*1.3,size*.9,4,"#a1ae89");
      rounded(0,-3,size*1.1,6,2,"#374f41");
      if(e.kind==="boss")
        rounded(-size*.7,-size*.7,size*1.4,size*.3,3,"#f2c76d");
    }

    ctx.fillStyle="#25362e";
    ctx.fillRect(-size,-size-11,size*2,4);
    ctx.fillStyle=e.kind==="boss"?"#ff8b73":"#d3ee8b";
    ctx.fillRect(-size,-size-11,
      size*2*Math.max(0,e.hp/e.maxHp),4);
    ctx.restore();
    if(e.elite){
      ctx.strokeStyle="#ffcc64";ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(e.x,e.y,(e.kind==="tank"?23:18),0,Math.PI*2);ctx.stroke();
      ctx.fillStyle="#fff3b1";ctx.font="bold 9px sans-serif";ctx.textAlign="center";
      ctx.fillText("★",e.x,e.y-24);
    }
  }

  function draw() {
    ctx.clearRect(0,0,W,H);
    drawTerrain();
    drawPads();

    const selected=towerAt(selectedPad);
    if(selected){
      circle(selected.x,selected.y,selected.range,"#bde9a51c");
      ctx.strokeStyle="#dcf5b9aa";ctx.lineWidth=1.5;
      ctx.beginPath();
      ctx.arc(selected.x,selected.y,selected.range,0,Math.PI*2);
      ctx.stroke();
    }

    towers.forEach(drawTower);
    enemies.forEach(drawEnemy);

    bullets.forEach(b=>{
      circle(b.x,b.y,b.type==="missile"?5:3,b.color);
      circle(b.x,b.y,8,b.color+"44");
    });

    strikeRings.forEach(p=>{
      ctx.save();
      ctx.globalAlpha=Math.max(0,p.life/.7)*.7;
      circle(p.x,p.y,Math.max(5,p.radius),"#ffb85544");
      ctx.strokeStyle="#ffe5a2";ctx.lineWidth=5;
      ctx.beginPath();ctx.arc(p.x,p.y,p.radius,0,Math.PI*2);ctx.stroke();
      ctx.restore();
    });
    combatTexts.forEach(p=>{
      ctx.save();ctx.globalAlpha=Math.min(1,p.life*1.8);
      ctx.fillStyle=p.color;ctx.strokeStyle="#19232b";ctx.lineWidth=3;
      ctx.font="900 14px Rajdhani,sans-serif";ctx.textAlign="center";
      ctx.strokeText(p.text,p.x,p.y);ctx.fillText(p.text,p.x,p.y);
      ctx.restore();
    });
    effects.forEach(p=>{
      ctx.globalAlpha=Math.max(0,p.life/p.max);
      circle(p.x,p.y,p.size,p.color);
    });
    ctx.globalAlpha=1;

    // Base
    rounded(343,122,45,58,7,"#263e3e");
    rounded(349,128,34,44,5,"#697f77");
    rounded(355,113,21,21,4,"#344b48");
    ctx.fillStyle="#f3eab9";
    ctx.font="bold 9px sans-serif";
    ctx.textAlign="center";
    ctx.fillText("BASE",365,166);
  }

  function updateUI() {
    $("base-hp").textContent=state.hp+" / "+state.maxHp;
    $("credits").textContent=state.money+" G";
    $("wave-count").textContent=
      String(state.wave).padStart(2,"0")+" / 20";
    $("enemy-count").textContent="敵部隊："+(enemies.length+state.queue.length)+" / KILLS "+state.kills;
    const profile=waveProfile(Math.min(20,state.wave+1));
    $("enemy-intel").textContent=state.active?
      "交戦中："+waveProfile(state.wave).label:
      "WAVE "+(state.wave+1)+"： "+profile.label+" / 約"+(profile.unitCount+(profile.boss?1:0))+"体";
    $("build-summary").textContent=state.usedTactics.length?
      "獲得戦術 "+state.usedTactics.length+"個 ｜ "+state.usedTactics.slice(-2).join("・"):
      "各ウェーブ直前にランダム3択の永続戦術を獲得";
    const strike=$("airstrike-button");
    strike.disabled=state.strike<100||!state.active||state.paused||state.finished;
    strike.classList.toggle("ready",state.strike>=100);
    strike.classList.toggle("aiming",strikeAiming);
    $("strike-charge").textContent=Math.floor(state.strike)+"%";
    $("game-status").textContent=state.finished?"END":
      state.paused?"PAUSED":state.active?"IN BATTLE":"STANDBY";

    $("speed-button").textContent="×"+state.speed;
    $("pause-button").textContent=state.paused?"▶":"Ⅱ";

    $("start-wave").disabled=state.active||state.finished||state.choosing;
    $("start-wave").textContent=state.active?"迎撃中":
      state.finished?"作戦終了":
      "▶ WAVE "+(state.wave+1)+" 開始";

    document.querySelectorAll(".tower-card").forEach(el=>{
      el.classList.toggle("selected",
        el.dataset.tower===selectedType);
    });

    const t=towerAt(selectedPad);
    const cost=t?upgradeCost(t):0;
    $("upgrade-button").disabled=!t||t.level>=10||state.money<cost;
    $("sell-button").disabled=!t;
    $("upgrade-button").textContent=t?
      "↑ 強化 "+(t.level>=10?"MAX":cost+"G"):"↑ 強化";

    $("tower-info").textContent=t?
      DEF[t.type].name+" Lv."+t.level+
      " ｜ 改造 "+t.mods.length+"/3"+
      (t.evolution?" ｜ ★ "+t.evolution:""):
      "配置可能なマスをタップしてください";
  }

  canvas.addEventListener("pointerdown",event=>{
    const rect=canvas.getBoundingClientRect();
    const x=(event.clientX-rect.left)*W/rect.width;
    const y=(event.clientY-rect.top)*H/rect.height;

    let index=-1,nearest=25;
    PADS.forEach((p,i)=>{
      const d=Math.hypot(p[0]-x,p[1]-y);
      if(d<nearest){nearest=d;index=i;}
    });
    if(strikeAiming) {
      if(state.strike>=100 && state.active && !state.paused)useAirstrike(x,y);
      else{strikeAiming=false;$("strike-hint").classList.add("hidden");}
      return;
    }
    if(index>=0)selectPad(index);
  });

  document.querySelectorAll(".tower-card").forEach(button=>{
    button.onclick=()=>{
      selectedType=button.dataset.tower;
      selectedPad=-1;
      updateUI();
    };
  });

  $("airstrike-button").onclick=()=>{
    if(state.strike<100||!state.active||state.paused)return;
    strikeAiming=!strikeAiming;
    $("strike-hint").classList.toggle("hidden",!strikeAiming);
    notice(strikeAiming?"✈ 爆撃したい地点をタップ！":"爆撃指定を解除");
    updateUI();
  };
  $("start-wave").onclick=startWave;
  $("upgrade-button").onclick=upgradeTower;
  $("sell-button").onclick=sellTower;
  $("retry-button").onclick=reset;

  $("pause-button").onclick=()=>{
    if(state.choosing||state.finished)return;
    state.paused=!state.paused;
    if(state.paused){strikeAiming=false;$("strike-hint").classList.add("hidden");}
    updateUI();
  };

  $("speed-button").onclick=()=>{
    state.speed=state.speed===1?2:1;
    updateUI();
  };

  function frame(now) {
    const dt=lastTime?Math.min(.05,(now-lastTime)/1000):0;
    lastTime=now;

    for(let i=0;i<state.speed;i++)update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  reset();
  requestAnimationFrame(frame);
})();
