
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const canvas = $("game-canvas");
  const ctx = canvas.getContext("2d");
  const W = 390, H = 520;

  const DEF = {
    machinegun: { name:"機関銃", cost:100, dmg:19, rate:.20, range:145, color:"#d5ec8d" },
    cannon:     { name:"榴弾砲", cost:180, dmg:65, rate:2.5, range:140, color:"#ffd28c" },
    missile:    { name:"ミサイル", cost:250, dmg:155, rate:2.2, range:195, color:"#f5ab79" },
    radar:      { name:"電子戦", cost:200, dmg:0, rate:.5, range:115, color:"#86e2f8" }
  };

  const KIND = {
    infantry:{hp:54,speed:53,armor:0,reward:5,damage:1,color:"#be8056"},
    car:{hp:130,speed:101,armor:.18,reward:12,damage:2,color:"#a79a68"},
    tank:{hp:365,speed:37,armor:.56,reward:25,damage:3,color:"#536c51"},
    drone:{hp:135,speed:108,armor:.08,reward:15,damage:1,color:"#8bbdc1"},
    boss:{hp:1400,speed:30,armor:.40,reward:200,damage:5,color:"#a85c4f"}
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
  let nextEnemyId = 1, kick=0, beams=[];
  let smokes=[],flashes=[],soundOn=true,audio=null;
  let shockwaves=[],screenFlash=0,combo=0,comboClock=0,missionBanner=0,ambientTime=0;
  const unlockAt={machinegun:0,cannon:1,missile:2,radar:3};
  const unlocked=type=>state.wave>=unlockAt[type];
  function sfx(kind){
    if(!soundOn)return;
    try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;audio=audio||new C();
      if(audio.state==="suspended")audio.resume();
      const o=audio.createOscillator(),g=audio.createGain(),at=audio.currentTime,hz=kind==="shot"?175:kind==="boom"?75:600;
      o.type="sawtooth";o.frequency.setValueAtTime(hz,at);o.frequency.exponentialRampToValueAtTime(hz*.45,at+.13);
      g.gain.setValueAtTime(kind==="boom"?.05:.016,at);g.gain.exponentialRampToValueAtTime(.001,at+.15);
      o.connect(g);g.connect(audio.destination);o.start(at);o.stop(at+.16);
    }catch(e){}
  }
  function guide(){
    const n=$("guide-text");if(!n)return;
    n.textContent=state.wave===0&&!towers.length?"① 光るマスをタップして機関銃を配置しよう！":
      state.wave===0?"② 配置できた！ WAVE 1 を開始してみよう":
      state.wave===1&&state.active?"③ 銃身が回転して敵を撃破！":
      state.wave===1?"④ 榴弾砲が解放！範囲攻撃を試してみよう":"兵器を強化して次の敵部隊に備えよう！";
  }
  let draftForWave=0, strikeAiming=false, strikeRings=[], combatTexts=[];
  const TACTICS = [
    {id:"warfund",tier:"ECONOMY",name:"💰 戦時特別予算",desc:"即時 +200G。配置と強化で敵を迎え撃つ。",apply:()=>state.money+=200},
    {id:"overclock",tier:"FIREPOWER",name:"🔥 全砲門オーバークロック",desc:"全兵器の連射速度 +18%。以後の設置にも適用。",apply:()=>{state.fireRate*=.82;towers.forEach(t=>t.interval*=.82)}},
    {id:"ammunition",tier:"FIREPOWER",name:"💥 強化弾頭",desc:"全兵器の攻撃力 +25%。以後の設置にも適用。",apply:()=>{state.globalPower*=1.25;towers.forEach(t=>t.power*=1.25)}},
    {id:"radial",tier:"TACTICAL",name:"🎯 精密レーダー",desc:"全兵器の射程 +17%。以後の設置にも適用。",apply:()=>{state.globalRange*=1.17;towers.forEach(t=>t.range*=1.17)}},
    {id:"salvage",tier:"ECONOMY",name:"⚙ 戦場回収班",desc:"敵撃破報酬 +35%。撃破するほど資金が増える。",apply:()=>state.rewardRate*=1.35},
    {id:"bunker",tier:"DEFENSE",name:"🛡 緊急防壁",desc:"基地HPを5回復し、最大HPも2増加。",apply:()=>{state.maxHp+=2;state.hp=Math.min(state.maxHp,state.hp+5)}},
    {id:"airforce",tier:"SUPPORT",name:"✈ 航空優勢",desc:"爆撃ゲージ +50%。爆撃の威力も +25%。",apply:()=>{state.strike=Math.min(100,state.strike+50);state.strikePower*=1.25}},
    {id:"armor",tier:"ANTI-ARMOR",name:"🔩 対装甲弾",desc:"全兵器に装甲貫通 +20%。戦車の突破を防ぐ。",apply:()=>{state.globalPierce+=.2;towers.forEach(t=>t.pierce+=.2)}},
    {id:"bounty",tier:"ECONOMY",name:"💎 高額賞金作戦",desc:"このWAVEの敵HP +25%、撃破報酬2倍。危険を資金に変える。",apply:()=>{state.wavePlan="bounty"}},
    {id:"mines",tier:"DEFENSE",name:"💣 峡谷地雷網",desc:"先頭6体に地雷が炸裂。開幕の突破を先に止める。",apply:()=>{state.wavePlan="mines"}},
    {id:"barrage",tier:"FIREPOWER",name:"🚀 開幕ロケット斉射",desc:"先頭6体へ迎撃ロケット。HPを削ってから射線に入れる。",apply:()=>{state.wavePlan="barrage"}},
    {id:"emp",tier:"SUPPORT",name:"⚡ 広域EMP妨害",desc:"先頭8体を長時間鈍足化。高速部隊への切り札。",apply:()=>{state.wavePlan="emp"}}
  ];

  function reset() {
    state = {
      hp:20, maxHp:20, money:350, wave:0, active:false,
      paused:false, speed:1, finished:false,
      queue:[], spawnTimer:0, xp:0, xpNeed:50,
      upgrades:0, rerolls:3, choosing:false,
       globalPower:1,globalRange:1,fireRate:1,rewardRate:1,globalPierce:0,
       strike:50,strikePower:1,usedTactics:[],kills:0,eliteKills:0,
      note:"防衛施設を設置してください",
      noteTime:0
    };
    towers = []; enemies = []; bullets = []; effects = [];
    selectedType = "machinegun";
    selectedPad = -1;
    draftForWave=0;strikeAiming=false;strikeRings=[];combatTexts=[];kick=0;smokes=[];flashes=[];beams=[];shockwaves=[];screenFlash=0;combo=0;comboClock=0;missionBanner=0;ambientTime=0;
    $("draft-modal").classList.add("hidden");
    $("wave-alert").classList.add("hidden");
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
      evolution:null, branch:null, awakened:false, kills:0,spin:0,recoil:0,glow:0
    };
  }

  function selectPad(index) {
    if (state.choosing || state.finished) return;

    if(!towerAt(index)&&!unlocked(selectedType)){notice("まだ解放されていない兵器です");return;}
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
      notice(DEF[selectedType].name + "を設置！");sfx("unlock");
    }

    updateUI();
  }

  function upgradeCost(t) {
    return Math.round(DEF[t.type].cost * (
      .38 + Math.pow(t.level, 1.32) * .32
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

    burst(t.x,t.y,"#c7ee86",35);sfx("unlock");kick=3;
    if(t.type==="machinegun"&&(t.level===3||t.level===5)){
      notice(t.level===3?"二連装ガトリング進化！":"四連装ヴァルカン進化！");
      combatTexts.push({x:t.x,y:t.y-38,text:"EVOLUTION!",life:1.2,color:"#ffe48d"});
    }
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
    const unitCount=9+Math.floor(n*2.1);
    const tank=n>=3 && (n%3===0 || n%5===0 || n>=12);
    const drone=n>=4 && (n%4===0 || n>=10);
    const rush=n%4===2;
    const swarm=n%4===1;
    return {unitCount,tank,drone,rush,swarm,boss:n%5===0,
      label:n%5===0?"⚠ 指揮官＋重装甲護衛":
        (rush?"高速突破部隊":swarm?"歩兵の大群":tank?"重装甲突撃":drone?"ドローン奇襲":"混成戦闘部隊")};
  }
  function waveKinds(n) {
    const profile=waveProfile(n),result=[];
    for(let i=0;i<profile.unitCount;i++){
      // Enemy composition is deliberately legible: every wave tests a different counter.
      let kind="infantry";
      if(n>=2&&i%3===0)kind="car";
      if(profile.rush&&i%2===0)kind="car";
      if(profile.tank&&i%6===0)kind="tank";
      if(profile.drone&&i%3===1)kind="drone";
      if(n%5===0&&i%(n===5?7:6)===0)kind="tank";
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
    $("draft-intel").textContent=p.label+" / 推定"+(p.unitCount+(p.boss?1:0))+"体。次の部隊に合わせて「資金・火力・支援」から作戦を選ぼう。";
    const holder=$("draft-options");
    holder.innerHTML="";
    // Three different strategic roles, so the draft is a decision rather than three stat buffs.
    const pools=[
      TACTICS.filter(t=>["bounty","mines","warfund","bunker"].includes(t.id)),
      TACTICS.filter(t=>["barrage","overclock","ammunition","armor"].includes(t.id)),
      TACTICS.filter(t=>["emp","radial","airforce"].includes(t.id))
    ];
    // Every briefing features at least one battle-changing operation.
    const special=["bounty","mines","barrage","emp"];
    const forced=TACTICS.find(t=>t.id===special[(n-2)%special.length]);
    const forcedLane=pools.findIndex(pool=>pool.includes(forced));
    const options=pools.map((pool,i)=>i===forcedLane?forced:pool[Math.floor(Math.random()*pool.length)]);
    options.forEach(card=>{
      const button=document.createElement("button");
      button.type="button";button.className="draft-option";
      const type=document.createElement("small"),head=document.createElement("strong"),desc=document.createElement("span");
      type.textContent=card.tier;head.textContent=card.name;desc.textContent=card.desc;
      const impact=document.createElement("em");impact.className="draft-impact";
      impact.textContent=card.id==="bounty"?"⚠ このWAVE限定 / 高リスク高報酬":card.id==="mines"?"💣 このWAVE限定 / 開幕地雷":card.id==="barrage"?"🚀 このWAVE限定 / ロケット迎撃":card.id==="emp"?"⚡ このWAVE限定 / 行動妨害":card.tier==="ECONOMY"?"✓ 永続 / 資金確保":card.tier==="DEFENSE"?"✓ 永続 / 基地防衛":card.tier==="FIREPOWER"?"✓ 永続 / 火力強化":card.tier==="ANTI-ARMOR"?"✓ 永続 / 装甲対策":card.tier==="TACTICAL"?"✓ 永続 / 射程強化":"✓ 永続 / 爆撃強化";
      button.append(type,head,desc,impact);
      button.onclick=()=>{
        card.apply();state.operationName=card.name;state.usedTactics.push(card.name.replace(/^[^ ]+ /,""));
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
    if(n===1)state.wavePlan=null;
    state.wave=n;state.active=true;
    state.queue=waveKinds(n);
    state.spawnedThisWave=0;
    state.spawnTimer=.16;state.paused=false;
    notice("WAVE "+n+" — "+waveProfile(n).label+(state.operationName?" ／ "+state.operationName:""));
    missionBanner=2.25;screenFlash=.17;
    $("wave-alert").textContent="WAVE "+String(n).padStart(2,"0")+" // "+waveProfile(n).label;
    $("wave-alert").classList.remove("hidden");
  }
  function startWave() {
    if(state.active||state.finished||state.choosing)return;
    if(!towers.length){notice("先に光るマスをタップして機関銃を配置しよう！");return;}
    if(state.wave===0){launchWave(1);updateUI();return;}
    // Keep the flow uninterrupted: tactical briefings previously blocked every other wave.
    launchWave(state.wave+1);
    updateUI();
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
    const w=state.wave-1;
    const scale=1+w*.20+w*w*.018;
    const elite=kind!=="boss" && state.wave>=3 && Math.random()<Math.min(.42,.09+state.wave*.016);
    return {
      id:nextEnemyId++, kind,
      x:PATH[0][0], y:PATH[0][1],
      segment:0, hp:d.hp*scale*(elite?2.2:1), maxHp:d.hp*scale*(elite?2.2:1),
      speed:d.speed*(1+Math.min(.35,w*.022))*(elite?1.16:1), armor:d.armor, reward:d.reward*(elite?3:1), elite,
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

    // Operations trigger on-screen, so the player sees the tactical choice pay off.
    if(e.operationPending&&e.x>=10){
      const op=e.operationPending;e.operationPending=null;
      if(op==="emp"){
        e.slowTime=Math.max(e.slowTime,5);
        shockwaves.push({x:e.x,y:e.y,r:4,max:42,life:.65,color:"#79eaff"});
        combatTexts.push({x:e.x,y:e.y-19,text:"EMP",life:.75,color:"#8ceaff"});
      }
      if(op==="mines"){
        e.hp=Math.max(1,e.hp-65);burst(e.x,e.y,"#ffce6d",24);
        shockwaves.push({x:e.x,y:e.y,r:5,max:54,life:.4,color:"#ffbf63"});
        combatTexts.push({x:e.x,y:e.y-22,text:"MINE -65",life:.75,color:"#ffe097"});
      }
      if(op==="barrage"){
        e.hp=Math.max(1,e.hp-95);
        beams.push({x1:e.x+65,y1:0,x2:e.x,y2:e.y,life:.35,max:.35,kind:"rail",color:"#ffba67",width:7});
        burst(e.x,e.y,"#ffbb77",26);kick=3;
        combatTexts.push({x:e.x,y:e.y-22,text:"ROCKET -95",life:.75,color:"#ffd17c"});
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
    if(effects.length>320)effects.splice(0,effects.length-320);
  }

  function hurt(e, amount, source) {
    if (!e.alive) return;
    const armor = e.armor * (1-Math.min(.9,source.pierce));
    const crit = Math.random()<source.critical ? 1.8 : 1;
    const matchup=source.type==="machinegun"?
      (source.branch==="rail"?(e.kind==="tank"||e.kind==="boss"?2.1:e.kind==="car"?1.3:.8):
       source.branch==="tesla"?(e.kind==="drone"?1.6:e.kind==="tank"?.55:1.05):
       source.branch==="gatling"?(e.kind==="infantry"?1.15:e.kind==="tank"?.38:e.kind==="drone"?.58:.75):
       (e.kind==="tank"?.48:e.kind==="drone"?.55:e.kind==="car"?.72:1)):
      source.type==="cannon"?(e.kind==="infantry"?1.25:e.kind==="car"?1.2:e.kind==="drone"?.38:.8):
      source.type==="missile"?(e.kind==="tank"?2.0:e.kind==="drone"?1.8:e.kind==="boss"?1.6:.75):1;
    const actual=amount*(1-armor)*crit*matchup;
    e.hp -= actual;
    if(actual>15 && Math.random()<.35)combatTexts.push({x:e.x,y:e.y-18,text:"-"+Math.round(actual),life:.65,color:crit>1?"#ffe88d":"#e7f2d2"});
    if(source.slow)e.slowTime=Math.max(e.slowTime,1.5);

    if(e.hp<=0){
      e.alive=false;
      state.money+=Math.round(e.reward*state.rewardRate);
      state.kills++;if(e.elite)state.eliteKills++;
      combo=comboClock>0?combo+1:1;comboClock=3.6;
      if([5,10,20,40].includes(combo)){
        const bonus=combo;state.money+=bonus;
        combatTexts.push({x:W/2,y:70,text:combo+" COMBO! +"+bonus+"G",life:1.5,color:"#ffe17c"});
        screenFlash=Math.max(screenFlash,.15);sfx("unlock");
      }
      if(e.elite||e.kind==="boss"){
        shockwaves.push({x:e.x,y:e.y,r:8,max:e.kind==="boss"?115:65,life:.65,color:"#ffc368"});
        screenFlash=Math.max(screenFlash,e.kind==="boss"?.48:.20);kick=Math.max(kick,e.kind==="boss"?10:5);
      }
      state.strike=Math.min(100,state.strike+(e.kind==="boss"?38:e.elite?12:4));
      state.xp+=e.kind==="boss"?20:4;
      if(e.kind==="boss")notice("COMMANDER ELIMINATED！ +200G");
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
    if(t.type==="machinegun"&&(t.branch==="rail"||t.branch==="tesla")){
      t.recoil=1;t.glow=.25;sfx("boom");
      shockwaves.push({x:target.x,y:target.y,r:4,max:t.branch==="rail"?40:25,life:.3,color:t.branch==="rail"?"#7cf5ff":"#d2abff"});
      const targets=[target];
      if(t.branch==="tesla"){
        const max=t.awakened?8:t.mods.includes("spread")?6:3;
        while(targets.length<max){
          const last=targets[targets.length-1];
          const next=enemies.filter(e=>e.alive&&!targets.includes(e)&&distance(e,last)<(t.awakened?125:90))
            .sort((a,b)=>distance(a,last)-distance(b,last))[0];
          if(!next)break;targets.push(next);
        }
      }else if(t.mods.includes("penetrate")){
        const dx=target.x-t.x,dy=target.y-t.y,length=Math.hypot(dx,dy)||1;
        enemies.forEach(e=>{
          if(e===target||!e.alive)return;
          const along=((e.x-t.x)*dx+(e.y-t.y)*dy)/length;
          const off=Math.abs((e.x-t.x)*dy-(e.y-t.y)*dx)/length;
          if(along>0&&along<t.range&&off<20)targets.push(e);
        });
      }
      let px=t.x,py=t.y;
      targets.forEach((e,i)=>{
        beams.push({x1:px,y1:py,x2:e.x,y2:e.y,life:t.awakened?.50:.32,max:t.awakened?.50:.32,kind:t.branch,color:t.branch==="rail"?"#71e7ff":"#bca0ff",width:t.branch==="rail"?(t.awakened?19:12):(t.awakened?9:6)});
        hurt(e,damage*(t.branch==="tesla"?Math.max(.45,1-i*.15):1),t);
        px=e.x;py=e.y;
      });
      if(t.blast>0&&t.branch==="rail")enemies.forEach(e=>{if(e.alive&&distance(e,target)<t.blast)hurt(e,damage*.4,t)});
      if(t.awakened){burst(target.x,target.y,"#fff0ad",45);kick=8;screenFlash=.3;}
      return;
    }
    t.recoil=1;t.glow=.16;t.spin+=1;
    const count=t.type==="machinegun"?(t.awakened?6:t.branch==="gatling"?4:t.level>=5?4:t.level>=3?2:1):1;
    if(t.type!=="machinegun"||Math.random()<.2)sfx(t.type==="machinegun"?"shot":"boom");
    for(let shot=0;shot<count;shot++){
    const angle=t.angle+(shot-(count-1)/2)*.065;
    bullets.push({
      x:t.x+Math.cos(angle)*25,y:t.y+Math.sin(angle)*25,px:t.x,py:t.y,targetId:target.id,
      tx:target.x,ty:target.y,
      speed:t.type==="missile"?310:
            t.type==="cannon"?380:650,
      damage:damage*(count>1?.43:1),source:t,type:t.type,
      color:d.color,alive:true
    });}
    flashes.push({x:t.x+Math.cos(t.angle)*30,y:t.y+Math.sin(t.angle)*30,life:.14});
    if(t.type==="machinegun"&&t.branch==="gatling"){
      for(let n=0;n<(t.awakened?8:4);n++){
        const jitter=(Math.random()-.5)*(t.awakened?34:19);
        beams.push({x1:t.x,y1:t.y,x2:target.x+jitter,y2:target.y+jitter,life:.11,max:.11,kind:"tracer",color:n%2?"#ffbb45":"#ffed9b",width:t.awakened?3:2});
      }
      if(t.awakened&&Math.random()<.3){shockwaves.push({x:target.x,y:target.y,r:4,max:34,life:.22,color:"#ffb54e"});kick=4;}
    }
    if(t.type!=="machinegun"){kick=Math.max(kick,2.5);
      for(let n=0;n<5;n++)smokes.push({x:t.x+(Math.random()-.5)*24,y:t.y+(Math.random()-.5)*24,r:3+Math.random()*6,life:.4+Math.random()*.5});
    }

    combatTexts.push({x:t.x+Math.cos(t.angle)*18,y:t.y+Math.sin(t.angle)*18,text:"✦",life:.22,color:"#fff3c5"});
    burst(
      t.x+Math.cos(t.angle)*17,
      t.y+Math.sin(t.angle)*17,
      "#ffe7a6", t.type==="machinegun"?3:6
    );
  }

  function impact(b,target) {
    if(b.type!=="machinegun"){kick=Math.max(kick,4);sfx("boom");
      strikeRings.push({x:b.x,y:b.y,radius:2,life:.52});
      for(let n=0;n<10;n++)smokes.push({x:b.x+(Math.random()-.5)*35,y:b.y+(Math.random()-.5)*35,r:5+Math.random()*8,life:.5+Math.random()*.5});
    }
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
    ambientTime+=dt;
    if(missionBanner>0){missionBanner-=dt;if(missionBanner<=0)$("wave-alert").classList.add("hidden");}
    shockwaves.forEach(p=>{p.life-=dt;p.r+=(p.max-p.r)*Math.min(1,dt*7);});
    shockwaves=shockwaves.filter(p=>p.life>0);
    screenFlash=Math.max(0,screenFlash-dt*1.7);
    if(comboClock>0){comboClock-=dt;if(comboClock<=0)combo=0;}
    smokes.forEach(p=>{p.life-=dt;p.r+=dt*17;p.y-=dt*7;});smokes=smokes.filter(p=>p.life>0);
    flashes.forEach(p=>p.life-=dt);flashes=flashes.filter(p=>p.life>0);
    beams.forEach(p=>p.life-=dt);beams=beams.filter(p=>p.life>0);
    towers.forEach(t=>{t.recoil=Math.max(0,t.recoil-dt*8);t.glow=Math.max(0,t.glow-dt);});
    kick=Math.max(0,kick-dt*17);
  }

  function findTarget(t) {
    const available=enemies.filter(e=>
      e.alive&&distance(t,e)<=t.range
    );
    if(!available.length)return null;
    available.sort((a,b)=>{
      const progress=e=>{if(e.segment>=PATH.length-1)return PATH.length;const to=PATH[e.segment+1],from=PATH[e.segment];const total=Math.hypot(to[0]-from[0],to[1]-from[1])||1;return e.segment+Math.max(0,1-Math.hypot(e.x-to[0],e.y-to[1])/total)};
      return progress(b)-progress(a);
    });
    return available[0];
  }

  const BRANCHES=[
    {id:"gatling",name:"ガトリングストーム",icon:"🔥",tag:"弾幕・大群殲滅",desc:"超高速4連装。歩兵の大群を一瞬で削り取る。",color:"#ffbb57"},
    {id:"rail",name:"レールガン",icon:"🎯",tag:"超火力・装甲貫通",desc:"高威力の貫通電磁砲。重戦車・ボスへの切り札。",color:"#7be3ff"},
    {id:"tesla",name:"テスラチェーン",icon:"⚡",tag:"連鎖電撃・集団制圧",desc:"最大3体に連鎖電撃。密集部隊を一斉に足止め。",color:"#b5a5ff"}
  ];
  const PERKS={
    gatling:[
      {id:"ricochet",name:"跳弾",desc:"弾丸が別の敵に跳ね返る。",symbol:"↗"},
      {id:"barrage",name:"弾幕増幅",desc:"連射数をさらに増やす。",symbol:"✹"},
      {id:"explosive",name:"炸裂弾",desc:"命中時、小爆発を起こす。",symbol:"💥"}
    ],
    rail:[
      {id:"penetrate",name:"超貫通",desc:"射線上の複数の敵を貫く。",symbol:"➤"},
      {id:"overcharge",name:"過充電",desc:"ビーム威力がさらに倍増。",symbol:"⚡"},
      {id:"shockwave",name:"衝撃波",desc:"着弾地点に範囲爆発。",symbol:"◉"}
    ],
    tesla:[
      {id:"conduction",name:"感電",desc:"電撃で敵を減速させる。",symbol:"⚡"},
      {id:"spread",name:"広域伝播",desc:"電撃がさらに遠くまで連鎖。",symbol:"⌁"},
      {id:"storm",name:"雷雲",desc:"攻撃速度が大きく上昇。",symbol:"☁"}
    ]
  };
  function applyMod(t,m) {
    if(t.type==="machinegun"&&t.branch){
      if(m.id==="ricochet")t.chain=true;
      if(m.id==="barrage")t.interval*=.68;
      if(m.id==="explosive")t.blast+=19;
      if(m.id==="penetrate")t.pierce=1;
      if(m.id==="overcharge")t.power*=1.8;
      if(m.id==="shockwave")t.blast+=38;
      if(m.id==="conduction")t.slow=true;
      if(m.id==="spread")t.range*=1.4;
      if(m.id==="storm")t.interval*=.65;
      t.mods.push(m.id);return;
    }
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
    if(t.type==="machinegun"&&t.branch){
      const has=(a,b)=>t.mods.includes(a)&&t.mods.includes(b);
      let awakening=null;
      if(t.branch==="gatling"&&has("ricochet","barrage"))awakening="インフィニティ・ヴァルカン";
      if(t.branch==="rail"&&has("penetrate","overcharge"))awakening="ゼロ・ディスタンス";
      if(t.branch==="tesla"&&has("conduction","spread"))awakening="サンダーゴッド";
      if(awakening&&!t.awakened){
        t.awakened=true;state.awakenings=(state.awakenings||0)+1;t.evolution=awakening;t.power*=1.5;t.interval*=.65;
        kick=8;sfx("unlock");
        for(let n=0;n<8;n++)burst(t.x,t.y,n%2?"#ffe5a0":"#7deeff",35);
        strikeRings.push({x:t.x,y:t.y,radius:2,life:1});
        shockwaves.push({x:t.x,y:t.y,r:8,max:W*.8,life:1.4,color:t.branch==="rail"?"#74eaff":t.branch==="tesla"?"#a99aff":"#ffcc63"});
        screenFlash=.95;
        combatTexts.push({x:t.x,y:t.y-49,text:"LEGENDARY AWAKENING!",life:2.8,color:"#ffe489"});
        notice("★ LEGENDARY AWAKENING： "+awakening+"！");
      }
      return;
    }
    if(t.type==="cannon"&&t.mods.includes("blast")&&t.mods.includes("power")&&!t.evolution){
      t.evolution="クラスター・デストロイヤー";t.blast+=33;t.power*=1.35;
    }
  }
  function evolutionChoices(t) {
    if(t.type==="machinegun"&&t.branch){
      const list=PERKS[t.branch].filter(m=>!t.mods.includes(m.id));
      return list.sort(()=>Math.random()-.5).slice(0,3);
    }
    let available=MODS.filter(m=>!t.mods.includes(m.id));
    if(t.type==="radar")available=available.filter(m=>["range","rapid","slow","blast"].includes(m.id));
    return available.sort(()=>Math.random()-.5).slice(0,3);
  }
  function openEvolution() {
    if(state.choosing||state.finished)return;
    const available=towers.filter(t=>t.type==="machinegun"?!t.branch||t.mods.length<2:t.mods.length<3);
    if(!available.length)return;
    state.choosing=true;state.paused=true;
    const selected=towerAt(selectedPad);
    let t=available.find(a=>a.type==="machinegun"&&!a.branch)||
      (selected&&available.includes(selected)?selected:available.sort((a,b)=>b.level-a.level)[0]);
    selectedPad=t.pad;
    $("evolution-modal").classList.remove("hidden");
    const title=$("evolution-title"),intro=$("evolution-description"),holder=$("evolution-options");
    const drawChoices=()=>{
      holder.innerHTML="";
      // Choose WHICH gun evolves, not only which perk. This is a strategic allocation.
      const targets=document.createElement("div");targets.className="evolution-targets";
      available.slice(0,6).forEach(candidate=>{
        const chip=document.createElement("button");chip.type="button";
        chip.className="evolution-target"+(candidate===t?" selected":"");
        chip.textContent=(candidate.type==="machinegun"?"MG":candidate.type==="cannon"?"HE":candidate.type==="missile"?"MS":"EW")+" "+(candidate.pad+1);
        chip.onclick=()=>{t=candidate;selectedPad=t.pad;drawChoices();};
        targets.appendChild(chip);
      });
      holder.appendChild(targets);
      const branchChoice=t.type==="machinegun"&&!t.branch;
      title.textContent=branchChoice?"機関銃：進化ルート":t.branch?"専用能力の選択":"兵器改造";
      intro.textContent=branchChoice?"攻撃方法が劇的に変化する進化先を選べ！":
        t.branch?"能力を組み合わせて隠された覚醒を発見しよう！":"新しい能力を1つ選択してください";
      const options=branchChoice?BRANCHES:evolutionChoices(t);
      options.forEach(m=>{
        const button=document.createElement("button");
        button.className="evolution-choice "+(branchChoice?"branch-choice":"perk-choice");
        const symbol=document.createElement("span");symbol.className="choice-symbol";
        symbol.textContent=m.icon||m.symbol||"✦";
        const wrap=document.createElement("span");wrap.className="choice-copy";
        const strong=document.createElement("strong");strong.textContent=m.name;
        const desc=document.createElement("span");desc.textContent=m.desc;
        if(branchChoice){const role=document.createElement("small");role.className="choice-role";role.textContent=m.id==="gatling"?"得意：歩兵・高速の大群　/　苦手：重装甲":m.id==="rail"?"得意：戦車・ボス　/　苦手：広域の雑魚": "得意：密集・高速部隊　/　苦手：単独の重装甲";desc.afterRole=role;}
        wrap.append(strong,desc);if(desc.afterRole)wrap.append(desc.afterRole);
        if(m.tag){const tag=document.createElement("small");tag.textContent=m.tag;wrap.append(tag);}
        if(!branchChoice&&t.branch){const goal=document.createElement("small");goal.className="recipe-hint";goal.textContent=(t.branch==="gatling"&&["ricochet","barrage"].includes(m.id)||t.branch==="rail"&&["penetrate","overcharge"].includes(m.id)||t.branch==="tesla"&&["conduction","spread"].includes(m.id))?"★ 覚醒レシピの必須パーツ":"別系統のカスタマイズ";wrap.append(goal);}
        button.append(symbol,wrap);
        button.onclick=()=>{
          if(branchChoice){
            t.branch=m.id;t.mods=[];t.evolution=null;
            if(m.id==="gatling"){t.interval*=.72;t.power*=.72;t.range*=.90;}
            if(m.id==="rail"){t.interval*=2.5;t.power*=9;t.pierce=1;t.range*=1.18;}
            if(m.id==="tesla"){t.interval*=1.12;t.power*=2.1;t.chain=true;t.range*=.93;}
            t.glow=.5;kick=5;sfx("unlock");
            combatTexts.push({x:t.x,y:t.y-40,text:m.name+"!",life:2,color:m.color});
          }else{applyMod(t,m);checkEvolution(t);}
          state.xp=Math.max(0,state.xp-state.xpNeed);
          state.upgrades++;state.xpNeed=state.upgrades<3?70:105;
          screenFlash=Math.max(screenFlash,.55);shockwaves.push({x:t.x,y:t.y,r:5,max:180,life:.9,color:m.color||"#ffdb84"});
          state.choosing=false;state.paused=false;
          $("evolution-modal").classList.add("hidden");
          if(!t.awakened)notice((branchChoice?"進化完了：":"能力獲得：")+m.name);
          if(!state.active){
            notice("進化完了！ 下の ▶ WAVE "+(state.wave+1)+" 開始で進もう");
            // One-screen UI: no programmatic page scrolling.
          }
          updateUI();
        };
        holder.appendChild(button);
      });
      $("reroll-button").style.display=branchChoice?"none":"block";
    };
    $("reroll-button").onclick=()=>{
      if(state.rerolls<=0)return;
      state.rerolls--;drawChoices();
      $("reroll-button").textContent="候補を引き直す（残り"+state.rerolls+"）";
    };
    $("reroll-button").textContent="候補を引き直す（残り"+state.rerolls+"）";
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
        $("battle-message").textContent=state.active?"防衛作戦進行中":"WAVE "+state.wave+" クリア！ 次の作戦へ";
    }

    if(!state.active)return;
    if(state.strike>=100 && !state.choosing && state.noteTime<=0 && state.kills>0){
      $("battle-message").textContent="✈ 航空爆撃 READY — ここで逆転！";
    }
    state.spawnTimer-=dt;
    if(state.queue.length&&state.spawnTimer<=0){
      const foe=spawnEnemy(state.queue.shift());
      state.spawnedThisWave++;
      if(state.wavePlan==="bounty"){foe.hp*=1.25;foe.maxHp*=1.25;foe.reward*=2;}
      if(state.wavePlan==="emp"&&state.spawnedThisWave<=8)foe.operationPending="emp";
      if(state.wavePlan==="mines"&&state.spawnedThisWave<=6)foe.operationPending="mines";
      if(state.wavePlan==="barrage"&&state.spawnedThisWave<=6)foe.operationPending="barrage";
      enemies.push(foe);
      state.spawnTimer=waveProfile(state.wave).rush?.13:waveProfile(state.wave).swarm?.16:.19;
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
      combo=0;comboClock=0;
      state.money+=state.wave===2?170:state.wave<3?50:30;
      if(state.hp===state.maxHp)state.money+=state.wave<3?20:10;
      state.xp+=15;
      state.wavePlan=null;state.operationName=null;
      const newly=state.wave===1?"cannon":state.wave===2?"missile":state.wave===3?"radar":null;
      if(newly){notice("🎉 "+DEF[newly].name+" 解放！");sfx("unlock");
        const card=document.querySelector('[data-tower="'+newly+'"]');if(card)card.classList.add("unlocked");
      }else notice("WAVE "+state.wave+" 突破！");
      if(state.wave>=20){
        finish(true);return;
      }
    }

    if(!state.active&&state.wave>0&&state.wave%3===0&&state.xp>=state.xpNeed&&
       towers.some(t=>t.type==="machinegun"?
         (!t.branch||t.mods.length<2):t.mods.length<3)){
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
    ctx.save();ctx.rotate(t.angle+Math.PI/2);ctx.translate(0,t.recoil*7);
    if(t.type==="machinegun"){
      rounded(-12,-12,24,20,4,"#214440");
      if(t.branch==="rail"){
        // Massive electric accelerator, entirely different silhouette from a gun.
        rounded(-15,-13,30,27,6,"#123b54");
        rounded(-11,-48,22,43,4,"#207baa");
        rounded(-7,-56,14,48,3,"#a8ebff");
        rounded(-3,-60,6,48,2,"#f0ffff");
        [-36,-24,-12].forEach(y=>{rounded(-15,y,30,5,2,"#1c4e71");circle(-13,y+2,3,"#7be5ff");circle(13,y+2,3,"#7be5ff")});
        circle(0,-54,7+Math.sin(ambientTime*10)*2,"#78e7ff");
        circle(0,-54,3,"#fff");
      }else if(t.branch==="tesla"){
        // Two separated high-voltage coils on a compact generator.
        rounded(-16,-16,32,32,6,"#413c70");
        for(const x of [-13,13]){
          rounded(x-5,-36,10,29,4,"#6152a2");
          for(let y=-32;y<-8;y+=6)rounded(x-7,y,14,3,2,"#af9cf9");
          circle(x,-38,7+Math.sin(ambientTime*11+x)*2,"#bc9cff");
          circle(x,-38,3,"#f8ecff");
        }
        for(let k=0;k<3;k++){const angle=ambientTime*3+k*Math.PI*2/3;circle(Math.cos(angle)*21,Math.sin(angle)*19-5,3,"#e6bcff");}
      }else{
      const barrels=t.awakened&&t.branch==="gatling"?8:t.branch==="gatling"?4:t.level>=5?4:t.level>=3?2:1;
      for(let k=0;k<barrels;k++){const x=(k-(barrels-1)/2)*(barrels>=8?4:7);
        rounded(x-2,-33,4,29,1,"#d4e0c7");circle(x,-33,3,"#10282b");
      }
      if(t.glow>0){circle(0,-35,8+t.glow*30,"#ffe49a");circle(0,-35,4,"#ffb43d");}
      rounded(-8,-11,16,13,3,t.branch==="rail"?"#77d6ec":t.branch==="tesla"?"#b7a4ff":"#91b8a3");
      if(t.branch==="rail"){rounded(-6,-45,12,28,2,"#69c7ed");circle(0,-45,6,"#b6faff");}
      if(t.branch==="tesla"){ctx.strokeStyle="#bcaaff";ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(0,-18,17,Math.PI*1.05,Math.PI*1.95);ctx.stroke();circle(0,-33,5,"#e4d6ff");}
      }
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
    if(t.evolution||t.branch){
      ctx.strokeStyle=t.awakened?"#ffdd75":t.branch==="tesla"?"#ae9bff":t.branch==="rail"?"#72eaff":"#fcb85d";ctx.lineWidth=3;
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
    ctx.save();if(kick>0)ctx.translate((Math.random()-.5)*kick*2,(Math.random()-.5)*kick*2);
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
    beams.forEach(b=>{
      ctx.save();const alpha=Math.min(1,b.life/Math.max(.01,b.max||.2));
      ctx.globalAlpha=alpha;ctx.lineCap="round";
      if(b.kind==="tesla"){
        const dx=b.x2-b.x1,dy=b.y2-b.y1,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
        ctx.beginPath();ctx.moveTo(b.x1,b.y1);
        for(let i=1;i<7;i++){const f=i/7,off=Math.sin(i*23+b.x1*.13+b.y2*.17+performance.now()*.08)*11;
          ctx.lineTo(b.x1+dx*f+nx*off,b.y1+dy*f+ny*off);}
        ctx.lineTo(b.x2,b.y2);ctx.shadowColor="#d4a5ff";ctx.shadowBlur=27;
        ctx.strokeStyle="#9b6afa";ctx.lineWidth=b.width*2.5;ctx.stroke();
        ctx.strokeStyle="#f4e9ff";ctx.lineWidth=b.width*.7;ctx.stroke();
      }else{
        ctx.shadowColor=b.color;ctx.shadowBlur=b.kind==="rail"?45:18;
        line(b.x1,b.y1,b.x2,b.y2,b.color,b.width*2.7);
        line(b.x1,b.y1,b.x2,b.y2,b.kind==="tracer"?"#fff7d5":"#ffffff",Math.max(1,b.width*.54));
        if(b.kind==="rail")circle(b.x2,b.y2,b.width*1.5,"#b7faff");
      }ctx.restore();
    });
    shockwaves.forEach(p=>{ctx.save();ctx.globalAlpha=Math.min(.85,p.life*1.6);
      ctx.strokeStyle=p.color;ctx.lineWidth=Math.max(1,p.life*9);
      ctx.shadowColor=p.color;ctx.shadowBlur=20;
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.stroke();ctx.restore();
    });
    smokes.forEach(p=>{ctx.save();ctx.globalAlpha=Math.max(0,Math.min(.45,p.life*.5));
      circle(p.x,p.y,p.r,"#e0d6bf");ctx.restore();});
    flashes.forEach(p=>{ctx.save();ctx.globalAlpha=Math.min(1,p.life*8);
      circle(p.x,p.y,11,"#fff1bd");circle(p.x,p.y,17,"#ffac5855");ctx.restore();});
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
    if(screenFlash>0){ctx.save();ctx.globalAlpha=Math.min(.45,screenFlash*.4);ctx.fillStyle="#fff7da";ctx.fillRect(0,0,W,H);ctx.restore();}
    if(comboClock>0&&combo>=3){ctx.save();ctx.textAlign="center";ctx.font="900 23px Rajdhani,sans-serif";
      ctx.strokeStyle="#102529";ctx.lineWidth=5;ctx.strokeText(combo+" COMBO",W/2,44);
      ctx.fillStyle=combo>=20?"#ffd45b":"#b9fff0";ctx.fillText(combo+" COMBO",W/2,44);ctx.restore();}
    ctx.restore();
  }

  function updateUI() {
    const nextButton=$("quick-next-wave");
    if(nextButton){
      const showNext=state.wave>0&&!state.active&&!state.choosing&&!state.finished;
      nextButton.classList.toggle("hidden",!showNext);
      if(showNext)nextButton.textContent="▶ WAVE "+(state.wave+1)+" の作戦へ  /  タップして進む";
    }
        $("base-hp").textContent=state.hp+" / "+state.maxHp;
    $("credits").textContent=state.money+" G";
    guide();
    document.querySelectorAll(".tower-card").forEach(card=>{
      const available=unlocked(card.dataset.tower);
      card.classList.toggle("locked",!available);
      card.dataset.unlock="🔒 WAVE "+unlockAt[card.dataset.tower]+" で解放";
      card.disabled=!available;
    });
    const current=towerAt(selectedPad);
    const evo=current&&current.branch;
    $("awakening-count").textContent=(state.awakenings||0)+" / 3";
    $("awakening-clue").textContent=evo?
      (current.awakened?"覚醒済： "+current.evolution:
      current.branch==="gatling"?"ヴァルカン：跳弾＋弾幕増幅で覚醒":
      current.branch==="rail"?"レールガン：超貫通＋過充電で覚醒":
      "テスラ：感電＋広域伝播で覚醒"):
      "機関銃を進化させると覚醒レシピのヒントが表示される。";
    $("upgrade-next").textContent=current?
      DEF[current.type].name+" Lv."+current.level+" → Lv."+(current.level+1):
      "機関銃 Lv.1 → Lv.3 二連装 → Lv.5 四連装";
    $("upgrade-detail").textContent=current&&current.branch?
      ("進化形態： "+BRANCHES.find(b=>b.id===current.branch).name+
       (current.awakened?" / ★覚醒済":" / 能力 "+current.mods.length+"/2")):
      current?
      (current.type==="machinegun"?"Lv.3で二連装、Lv.5で四連装！銃身と弾幕が増える":"強化で火力アップ、改造で特別な能力を獲得"):
      "兵器をタップすると次の成長を確認できます。";
    $("sound-button").textContent=soundOn?"♪":"×";
    $("wave-count").textContent=
      String(state.wave).padStart(2,"0")+" / 20";
    $("enemy-count").textContent="敵部隊："+(enemies.length+state.queue.length)+" / KILLS "+state.kills;
    const profile=waveProfile(Math.min(20,state.wave+1));
    const anyEvolution=towers.some(t=>t.type==="machinegun"?(!t.branch||t.mods.length<2):t.mods.length<3);
    const progress=anyEvolution?Math.min(100,Math.max(0,state.xp/state.xpNeed*100)):0;
    $("evolution-progress").style.width=progress+"%";
    $("evolution-meter-value").textContent=Math.floor(progress)+"%";
    $("evolution-meter-label").textContent=!anyEvolution&&towers.length?"全兵器の改造が完了！":state.choosing?"進化先を選択中":progress>=100?"進化準備完了！":"進化まであと "+Math.max(0,state.xpNeed-state.xp)+" XP";
    $("enemy-intel").textContent=state.active?
      "交戦中："+waveProfile(state.wave).label:
      "WAVE "+(state.wave+1)+"： "+profile.label+" / 約"+(profile.unitCount+(profile.boss?1:0))+"体";
    $("build-summary").textContent=state.usedTactics.length?
      "採用作戦 "+state.usedTactics.length+"回 ｜ "+state.usedTactics.slice(-2).join("・"):
      "敵を倒して経験値をため、兵器を進化させよう。進化で攻撃方法が変わる！";
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

    const repair=$("repair-button");
    if(repair){repair.disabled=state.money<60||state.hp>=state.maxHp||state.choosing||state.finished;repair.textContent="♥ 修復 60G";}
    const dockStatus=$("dock-status");
    if(dockStatus){
      const coming=state.wave+1;
      const advice=coming===1?"歩兵主体 / 機関銃で練習":
        coming%5===0?"指揮官＋重装甲 / ミサイル＋減速":
        coming%4===2?"高速車両 / 榴弾砲・減速で迎撃":
        coming%4===0?"ドローン / ミサイルで対空":
        coming%3===0?"重装甲 / ミサイル・徹甲弾":
        "混成部隊 / 複数兵器を組み合わせよう";
      dockStatus.textContent=state.choosing?"兵器進化を選択中":
        state.active?"WAVE "+state.wave+" "+waveProfile(state.wave).label+"  •  配置・強化可能":
        "次WAVE "+coming+"： "+advice;
    }
        $("tower-info").textContent=t?
      DEF[t.type].name+" Lv."+t.level+
      " ｜ 改造 "+t.mods.length+"/"+(t.type==="machinegun"?2:3)+
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

  $("sound-button").onclick=()=>{soundOn=!soundOn;updateUI();};
  $("airstrike-button").onclick=()=>{
    if(state.strike<100||!state.active||state.paused)return;
    strikeAiming=!strikeAiming;
    $("strike-hint").classList.toggle("hidden",!strikeAiming);
    notice(strikeAiming?"✈ 爆撃したい地点をタップ！":"爆撃指定を解除");
    updateUI();
  };
  // Compact command deck: all primary decisions remain accessible without scrolling.
  const dock=document.createElement("div");
  dock.className="mobile-command-dock";
  const dockTitle=document.createElement("div");
  dockTitle.className="dock-status";
  dockTitle.id="dock-status";
  dockTitle.textContent="兵器を選択して配置";
  dock.appendChild(dockTitle);
  const panel=document.querySelector(".control-panel");
  dock.appendChild(panel.querySelector(".tower-grid"));
  const dockActions=panel.querySelector(".action-row");
  dockActions.appendChild(panel.querySelector("#airstrike-button"));
  const repairButton=document.createElement("button");
  repairButton.id="repair-button";repairButton.type="button";
  repairButton.textContent="♥ 修復 60G";
  repairButton.addEventListener("click",()=>{
    if(state.finished||state.choosing||state.money<60||state.hp>=state.maxHp)return;
    const healed=Math.min(4,state.maxHp-state.hp);
    state.money-=60;state.hp+=healed;
    notice("基地を修復！ HP +"+healed);
    updateUI();
  });
  dockActions.appendChild(repairButton);
  dock.appendChild(dockActions);
  dock.appendChild(panel.querySelector("#start-wave"));
  document.querySelector(".game-shell").appendChild(dock);
    const quickNext=document.createElement("button");
  quickNext.id="quick-next-wave";
  quickNext.type="button";
  quickNext.className="quick-next-wave hidden";
  quickNext.addEventListener("click",startWave);
  document.querySelector(".battle-area").appendChild(quickNext);
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
    state.speed=state.speed===1?2:state.speed===2?3:1;
    updateUI();
  };

  // Fixed-step simulation: low rendering FPS must not slow down the battle clock.
  let gameAccumulator=0;
  function frame(now) {
    const elapsed=lastTime?Math.min(.25,(now-lastTime)/1000):0;
    lastTime=now;
    gameAccumulator+=elapsed*state.speed;
    let steps=0;
    while(gameAccumulator>=.05&&steps<15){
      update(.05);
      gameAccumulator-=.05;
      steps++;
    }
    if(steps===15&&gameAccumulator>.25)gameAccumulator=.25;
    draw();
    requestAnimationFrame(frame);
  }

  reset();
  requestAnimationFrame(frame);
})();
