
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
      strikeRings.push({x:360,y:140,radius:8,life:.55});
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
      burst(e.x,e.y,e.elite?"#ffe18b":"#ffbf61",e.elite?35:20);
      strikeRings.push({x:e.x,y:e.y,radius:3,life:.33});
      combatTexts.push({x:e.x,y:e.y-23,text:e.elite?"ELITE DOWN":"KILL +"+Math.round(e.reward*state.rewardRate),life:.9,color:e.elite?"#ffe18b":"#b4ffbf"});
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
      x:t.x,y:t.y,px:t.x,py:t.y,targetId:target.id,
      tx:target.x,ty:target.y,
      speed:t.type==="missile"?310:
            t.type==="cannon"?380:650,
      damage,source:t,type:t.type,
      color:d.color,alive:true
    });

    combatTexts.push({x:t.x+Math.cos(t.angle)*18,y:t.y+Math.sin(t.angle)*18,text:"✦",life:.22,color:"#fff3c5"});
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
      b.px=b.x;b.py=b.y;
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

  // Battlefield art direction: high-contrast tactical top-down environment.
  function polygon(points,fill,stroke,width=1) {
    ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
    ctx.closePath();ctx.fillStyle=fill;ctx.fill();
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}
  }
  function line(x1,y1,x2,y2,color,width=1) {
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
  }
  function terrainTexture() {
    // Dark contour patches with stable procedural placement.
    for(let i=0;i<90;i++){
      const x=(i*187+39)%W,y=(i*131+27)%H;
      const r=2+(i%7);
      circle(x,y,r,i%3===0?"#a0bd8650":"#273f354c");
      if(i%8===0){
        line(x-10,y+3,x+10,y-4,"#253f3b50",1);
      }
    }
    // Craters and worn battlefield scars.
    [[45,35,18],[183,39,13],[353,328,16],[52,445,20],[230,464,13]].forEach(([x,y,r])=>{
      circle(x+3,y+4,r,"#1c383550");circle(x,y,r,"#304d42");
      circle(x-3,y-3,r*.71,"#64806b");circle(x-4,y-4,r*.35,"#405c4d");
    });
    // Sandbags and steel berms outside the road.
    [[45,146],[260,98],[247,430],[315,375]].forEach(([x,y])=>{
      ctx.save();ctx.translate(x,y);ctx.rotate(-.3);
      for(let i=0;i<4;i++){
        rounded(i*10-20,-6,12,11,3,"#203c36");
        rounded(i*10-20,-8,11,9,3,i%2?"#8c9b70":"#aaac7b");
        line(i*10-15,-7,i*10-15,0,"#5c6e55",1);
      }ctx.restore();
    });
    // Industrial debris, not round toy trees.
    for(let i=0;i<22;i++){
      const x=(i*117+47)%W,y=(i*73+33)%H;
      if(PATH.some(p=>Math.hypot(p[0]-x,p[1]-y)<31))continue;
      const r=6+i%6;
      polygon([[x-r,y+r],[x-r*.7,y-r*.8],[x+r*.7,y-r],[x+r,y+r*.6]],"#213d37","#56715b",1.4);
      polygon([[x-r*.7,y-r*.8],[x,y-r*1.2],[x+r*.7,y-r],[x+2,y]],"#6f886c");
      line(x-r/2,y+r/3,x+r/3,y-r/2,"#8c9d78",1);
    }
  }
  function drawTerrain() {
    const ground=ctx.createLinearGradient(0,0,W,H);
    ground.addColorStop(0,"#344d43");ground.addColorStop(.55,"#405d4d");ground.addColorStop(1,"#1c3c37");
    ctx.fillStyle=ground;ctx.fillRect(0,0,W,H);
    // Strongly visible tactical map grid.
    ctx.strokeStyle="#b5d8ab0c";ctx.lineWidth=1;
    for(let x=0;x<=W;x+=32)line(x,0,x,H,"#d9f2db10");
    for(let y=0;y<=H;y+=32)line(0,y,W,y,"#d9f2db10");
    terrainTexture();
    ctx.lineCap="round";ctx.lineJoin="round";
    ctx.beginPath();
    PATH.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
    ctx.strokeStyle="#112d2b";ctx.lineWidth=66;ctx.stroke();
    ctx.strokeStyle="#536751";ctx.lineWidth=60;ctx.stroke();
    ctx.strokeStyle="#77694f";ctx.lineWidth=51;ctx.stroke();
    ctx.strokeStyle="#b7a47c";ctx.lineWidth=44;ctx.stroke();
    ctx.strokeStyle="#c9ba95";ctx.lineWidth=36;ctx.stroke();
    ctx.strokeStyle="#f8e3a164";ctx.lineWidth=1.6;ctx.setLineDash([10,12]);ctx.stroke();ctx.setLineDash([]);
    // Danger line across the entry point.
    ctx.save();ctx.translate(14,110);ctx.rotate(-Math.PI/2);
    ctx.fillStyle="#f46d55";ctx.fillRect(-13,-24,26,5);
    ctx.font="bold 10px Rajdhani,sans-serif";ctx.textAlign="center";ctx.fillStyle="#ffd6ad";
    ctx.fillText("HOSTILE ENTRY",0,-32);ctx.restore();
    ctx.fillStyle="#ff7659";ctx.beginPath();
    ctx.moveTo(12,110);ctx.lineTo(-2,101);ctx.lineTo(-2,119);ctx.closePath();ctx.fill();
    // Military edge vignette.
    const v=ctx.createRadialGradient(W/2,H/2,145,W/2,H/2,420);
    v.addColorStop(0,"#061a1700");v.addColorStop(1,"#06151575");
    ctx.fillStyle=v;ctx.fillRect(0,0,W,H);
    // Strategic markers.
    ctx.fillStyle="#e1efca80";ctx.font="bold 9px Rajdhani,sans-serif";ctx.textAlign="left";
    ctx.fillText("SECTOR A-01",15,18);ctx.fillText("GRID 39°N",305,H-14);
  }
  function drawPads() {
    PADS.forEach(([x,y],i)=>{
      const occupied=towerAt(i);if(occupied)return;
      const pulse=.5+Math.sin(performance.now()/400+i)*.18;
      ctx.save();ctx.translate(x,y);
      circle(2,5,22,"#0b292c8a");
      rounded(-19,-19,38,38,5,"#182e32");
      rounded(-16,-16,32,32,4,"#264d49");
      ctx.strokeStyle="rgba(129,234,213,"+pulse+")";ctx.lineWidth=1.7;
      ctx.strokeRect(-14,-14,28,28);
      line(-8,0,8,0,"#8af8db",2.6);line(0,-8,0,8,"#8af8db",2.6);
      ctx.strokeStyle="#7ddfce88";
      line(-21,-21,-11,-21,"#7ddfce",2);line(-21,-21,-21,-11,"#7ddfce",2);
      line(21,21,11,21,"#7ddfce",2);line(21,21,21,11,"#7ddfce",2);
      ctx.restore();
    });
  }
  function drawTower(t) {
    const color=t.type==="radar"?"#5ed9e5":t.type==="missile"?"#f3bd75":t.type==="cannon"?"#f2c77a":"#9fe1c1";
    ctx.save();ctx.translate(t.x,t.y);
    ctx.shadowColor="#010d0caa";ctx.shadowBlur=10;ctx.shadowOffsetY=7;
    rounded(-22,-18,44,40,6,"#112a29");
    rounded(-20,-21,40,38,5,"#335952");
    ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    // Steel chassis with faction color and readable identity.
    rounded(-17,-17,34,29,4,"#62857a");
    rounded(-13,-14,26,22,3,"#2b514b");
    polygon([[-20,14],[-13,19],[13,19],[20,14]],"#152c2b");
    ctx.fillStyle="#8bada2";ctx.fillRect(-21,-14,3,24);ctx.fillRect(18,-14,3,24);
    ctx.save();ctx.rotate(t.angle+Math.PI/2);
    if(t.type==="machinegun"){
      rounded(-12,-12,24,20,4,"#214440");
      for(let k=-1;k<=1;k++){
        rounded(k*7-2,-33,4,29,1,"#d4e0c7");
        circle(k*7,-33,3,"#10282b");
      }
      rounded(-8,-11,16,13,3,"#91b8a3");
    }else if(t.type==="cannon"){
      rounded(-8,-12,16,28,4,"#243d37");
      rounded(-5,-38,10,35,2,"#d5c4a0");
      rounded(-7,-35,14,6,2,"#fff0c5");
      rounded(-12,-10,24,20,5,"#8c9983");
      circle(0,-6,6,"#506b5d");
    }else if(t.type==="missile"){
      rounded(-18,-15,36,26,4,"#223f3b");
      for(let ix=-1;ix<=1;ix++)for(let iy=0;iy<2;iy++){
        rounded(ix*10-4,iy*11-17,8,10,2,"#b4c8ae");
        circle(ix*10,iy*11-12,3,"#f3bd75");
      }
    }else{
      rounded(-12,-13,24,20,4,"#224c55");
      ctx.strokeStyle="#6ceaff";ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,-15,21,Math.PI*1.08,Math.PI*1.92);ctx.stroke();
      line(0,-15,0,-32,"#a1fcff",2);
      circle(0,-15,6,"#abf8fa");circle(0,-15,3,"#285463");
    }
    ctx.restore();
    ctx.strokeStyle=color;ctx.lineWidth=1.7;ctx.strokeRect(-20,-21,40,38);
    if(t.evolution){
      ctx.strokeStyle="#ffd774";ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,0,25,0,Math.PI*2);ctx.stroke();
      circle(18,-17,5,"#ffd774");
    }
    rounded(-14,18,28,12,3,"#112b2d");
    ctx.fillStyle="#e9fcf2";ctx.font="900 10px Rajdhani,sans-serif";ctx.textAlign="center";
    ctx.fillText((t.type==="machinegun"?"MG":t.type==="cannon"?"ART":t.type==="missile"?"MSL":"EW")+" "+t.level,0,27);
    ctx.restore();
  }
  function drawEnemy(e) {
    ctx.save();ctx.translate(e.x,e.y);
    const large=e.kind==="boss",tank=e.kind==="tank",vehicle=large||tank||e.kind==="car";
    const scale=large?1.6:tank?1.24:1;
    ctx.scale(scale,scale);ctx.rotate(e.angle);
    const hostile="#e96a56",armor="#9c5148";
    ctx.shadowColor="#0b1216b0";ctx.shadowBlur=6;ctx.shadowOffsetY=5;
    if(vehicle){
      // unmistakable armored silhouette: caterpillar tracks, hull and turret.
      rounded(-13,-11,28,23,5,"#242725");
      rounded(-17,-13,8,27,3,"#292f2e");rounded(10,-13,8,27,3,"#292f2e");
      for(let i=-9;i<=9;i+=6){line(-16,i,-10,i,"#a59a77",1.5);line(12,i,17,i,"#a59a77",1.5);}
      rounded(-12,-10,25,20,3,e.kind==="car"?"#bc8066":"#784c45");
      polygon([[-7,-8],[8,-8],[11,0],[7,8],[-7,8],[-10,0]],"#d08066","#452c2b",1);
      rounded(-1,-4,22,8,2,"#d4b59a");
      circle(-2,0,5,"#563732");
      if(large){rounded(-15,-13,30,8,2,"#df6a4d");circle(1,0,9,"#c97554");}
    }else if(e.kind==="drone"){
      polygon([[-17,0],[-4,-7],[4,-7],[17,0],[4,7],[-4,7]],"#db7766","#632f2d",2);
      circle(0,0,5,"#2f3334");circle(-16,0,4,"#d5c7a4");circle(16,0,4,"#d5c7a4");
      line(-18,0,18,0,"#ffe0b0",1);
    }else{
      circle(0,3,7,"#312623");
      rounded(-6,-6,12,15,3,"#bb6e55");
      circle(0,-7,5,"#d6a58c");
      line(3,-2,15,-5,"#2a2927",3);
      circle(-2,-8,3,"#6c4035");
    }
    ctx.restore();
    // Hostile IFF marker remains fixed regardless of enemy orientation.
    ctx.save();ctx.translate(e.x,e.y);
    const r=large?31:tank?23:e.kind==="drone"?20:15;
    ctx.strokeStyle=e.elite?"#ffdf74":"#ff715d";ctx.lineWidth=e.elite?2.5:1.8;
    const corners=[[-1,-1],[1,-1],[-1,1],[1,1]];
    corners.forEach(([sx,sy])=>{
      const x=sx*r,y=sy*r;
      line(x,y,x-sx*7,y,e.elite?"#ffdf74":"#ff715d",2);
      line(x,y,x,y-sy*7,e.elite?"#ffdf74":"#ff715d",2);
    });
    ctx.fillStyle="#142526";ctx.fillRect(-r,-r-11,2*r,5);
    ctx.fillStyle=e.elite?"#ffda70":"#f16b58";
    ctx.fillRect(-r,-r-11,2*r*Math.max(0,e.hp/e.maxHp),5);
    if(e.elite||large){
      ctx.fillStyle="#ffe3ae";ctx.font="900 10px Rajdhani,sans-serif";ctx.textAlign="center";
      ctx.fillText(large?"⚠ COMMANDER":"★ ELITE",0,-r-15);
    }
    ctx.restore();
  }
  function draw() {
    ctx.clearRect(0,0,W,H);
    drawTerrain();
    drawPads();

    const selected=towerAt(selectedPad);
    if(selected && (!state.active||state.paused)){
      ctx.fillStyle="#63d9c408";ctx.beginPath();ctx.arc(selected.x,selected.y,selected.range,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="#a6f6d25a";ctx.lineWidth=1.3;ctx.setLineDash([7,8]);
      ctx.beginPath();ctx.arc(selected.x,selected.y,selected.range,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    }

    towers.forEach(drawTower);
    enemies.forEach(drawEnemy);

    bullets.forEach(b=>{
      const dx=b.x-b.px,dy=b.y-b.py,m=Math.hypot(dx,dy)||1;
      const len=b.type==="missile"?26:b.type==="cannon"?15:12;
      const tx=b.x-dx/m*len,ty=b.y-dy/m*len;
      ctx.strokeStyle=b.type==="missile"?"#ff7b46":b.type==="cannon"?"#ffe49e":"#f6f5d8";
      ctx.lineWidth=b.type==="missile"?5:b.type==="cannon"?3:2;
      line(tx,ty,b.x,b.y,ctx.strokeStyle,ctx.lineWidth);
      circle(b.x,b.y,b.type==="missile"?5:3,"#fff6ce");
      if(b.type==="missile"){circle(tx,ty,8,"#ff913b44");circle(tx+2,ty+2,4,"#ffb53f");}
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
    ctx.save();ctx.shadowColor="#78edd366";ctx.shadowBlur=20;
    rounded(339,119,48,61,5,"#0d3030");
    ctx.shadowBlur=0;
    rounded(345,125,36,48,4,"#4c8884");
    rounded(351,115,23,19,3,"#274647");
    ctx.strokeStyle="#90f5de";ctx.lineWidth=2;ctx.strokeRect(345,125,36,48);
    ctx.fillStyle="#e4fff0";ctx.font="bold 10px Rajdhani,sans-serif";
    ctx.textAlign="center";ctx.fillText("HQ",364,155);
    ctx.fillStyle="#b2ffe2";ctx.fillRect(353,163,22,3);
    ctx.restore();
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
