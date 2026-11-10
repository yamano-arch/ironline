
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const canvas = $("game-canvas");
  const ctx = canvas.getContext("2d");
  const W = 390, H = 760, VIEW_H = 520;
  let cameraY=0,panStartY=0,panStartCamera=0,isPanning=false;
  // Production-painted turret portraits double as battlefield sprites.
  // Canvas fallback remains for evolved branches with unique silhouettes.
  const turretArt = Object.fromEntries(["machinegun","cannon","flak","missile","radar"].map(type=>{
    const img=typeof Image!=="undefined"?new Image():null;
    if(img)img.src=`./assets/${type}.webp?v=3.3.0`;
    return [type,img];
  }));
  document.querySelectorAll?.('.tower-card[data-tower]').forEach(card=>{
    const img=turretArt[card.dataset.tower];
    const holder=card.querySelector('.tower-symbol');
    if(img&&holder){
      const portrait=img.cloneNode();
      portrait.alt='';portrait.className='tower-portrait';
      holder.replaceChildren(portrait);
    }
  });

  const DEF = {
    machinegun: { name:"機関銃", cost:100, dmg:16, rate:.23, range:137, color:"#d5ec8d" },
    cannon:     { name:"榴弾砲", cost:170, dmg:83, rate:2.05, range:144, color:"#ffd28c" },
    flak:       { name:"対空砲", cost:195, dmg:49, rate:.65, range:188, color:"#8de8ff" },
    missile:    { name:"ミサイル", cost:250, dmg:170, rate:2.1, range:205, color:"#f5ab79" },
    radar:      { name:"電子戦", cost:175, dmg:0, rate:.5, range:128, color:"#86e2f8" }
  };

  const KIND = {
    infantry:{hp:54,speed:53,armor:0,reward:5,damage:1,color:"#be8056"},
    car:{hp:108,speed:92,armor:.14,reward:12,damage:1,color:"#a79a68"},
    tank:{hp:315,speed:36,armor:.45,reward:25,damage:2,color:"#536c51"},
    drone:{hp:115,speed:99,armor:.06,reward:15,damage:1,color:"#8bbdc1"},
    boss:{hp:900,speed:30,armor:.35,reward:200,damage:4,color:"#a85c4f"}
  };

  let PATH = [
    [-35,110],[75,110],[75,210],[165,210],
    [165,330],[300,330],[300,160],[425,160]
  ];
  let ROUTES=[PATH];

  let PADS = [
    [28,65],[128,75],[129,153],[30,270],
    [220,163],[215,260],[245,385],[342,255],
    [92,290],[185,390],[320,73],[352,315]
  ];
  const PAD_TRAITS=[
    "front","high","link","supply","standard","standard",
    "guard","link","supply","guard","high","guard"
  ];
  const WAVES_PER_STAGE=10;
  const STAGES=[
    {name:"渓谷防衛線",icon:"⛰",theme:"canyon",start:0,brief:"曲がり角で敵を迎え撃て",path:[[-35,110],[75,110],[75,210],[165,210],[165,330],[300,330],[300,160],[425,160]],pads:[[28,65],[128,75],[129,153],[30,270],[220,163],[215,260],[245,385],[342,255],[92,290],[185,390],[320,73],[352,315]]},
    {name:"砂漠の関門",icon:"☀",theme:"desert",start:10,brief:"高速車両を止めろ",path:[[-35,365],[100,365],[100,150],[240,150],[240,295],[425,295]],pads:[[35,325],[48,250],[160,300],[159,190],[198,100],[292,200],[302,340],[350,240],[65,80],[195,390],[342,110],[340,420]]},
    {name:"雪嶺の前哨地",icon:"❄",theme:"snow",start:20,brief:"二方向の敵を迎撃せよ",path:[[-35,165],[110,165],[110,335],[265,335],[265,115],[425,115]],routes:[
      [[-35,165],[110,165],[110,335],[265,335],[265,115],[425,115]],
      [[-35,165],[110,165],[110,335],[110,455],[320,455],[320,115],[425,115]]
    ],pads:[[45,85],[160,105],[70,260],[175,250],[220,165],[365,210],[190,395],[367,365],[44,390],[180,55],[340,62],[350,490]]},
    {name:"鉄鋼要塞",icon:"⚙",theme:"factory",start:30,brief:"左右から来る重戦車を止めろ",path:[[-35,110],[105,110],[105,250],[300,250],[300,385],[165,385],[165,465],[425,465]],routes:[
      [[-35,110],[105,110],[105,250],[300,250],[300,385],[165,385],[165,465],[425,465]],
      [[-35,110],[105,110],[105,250],[105,450],[310,450],[310,465],[425,465]]
    ],pads:[[38,58],[170,80],[50,185],[180,195],[345,180],[348,310],[255,340],[55,340],[45,402],[230,420],[348,416],[350,65]]}
  ];
  let stageIndex=0;
  const stageEnd=()=>STAGES[stageIndex].start+WAVES_PER_STAGE;
  const localWave=n=>n-STAGES[stageIndex].start;
  const PAD_INFO={
    front:{name:"前衛",color:"#edc480",desc:"素早く撃てる"},
    high:{name:"高台",color:"#9adcf7",desc:"遠くまで届く"},
    link:{name:"連携地点",color:"#ac9ef5",desc:"近くの兵器と協力しやすい"},
    supply:{name:"補給地点",color:"#b8eb9c",desc:"安く設置できる"},
    standard:{name:"要衝",color:"#83e4c6",desc:"複数の道路を狙える"},
    guard:{name:"防衛地点",color:"#ffc083",desc:"一撃が強くなる"}
  };
  const padTrait=i=>PAD_INFO[PAD_TRAITS[i]];
  const padCost=(type,i)=>Math.ceil(DEF[type].cost*(PAD_TRAITS[i]==="supply"?.85:1));
  function padCoverage(i,type){
    const [x,y]=PADS[i],trait=PAD_TRAITS[i];
    const range=DEF[type].range*state.globalRange*(trait==="high"?1.30:trait==="guard"?.95:1);
    let total=0,covered=0;
    for(const path of ROUTES)for(let s=0;s<path.length-1;s++){
      const a=path[s],b=path[s+1],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
      total+=len;
      for(let k=0;k<32;k++){
        const f=(k+.5)/32;
        if(Math.hypot(a[0]+(b[0]-a[0])*f-x,a[1]+(b[1]-a[1])*f-y)<=range)covered+=len/32;
      }
    }
    return Math.round(covered/total*100);
  }

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
  let selectedType, selectedPad, lastTime = 0,hoverPad=-1,pressedPad=-1;
  let nextEnemyId = 1, kick=0, beams=[];
  let smokes=[],flashes=[],casings=[],soundOn=true,audio=null;
  let shockwaves=[],screenFlash=0,combo=0,comboClock=0,missionBanner=0,ambientTime=0;
  const unlockAt={machinegun:0,cannon:1,flak:2,missile:3,radar:4};
  // Learned weapons remain available on later fronts; equipment knowledge is progress.
  const unlocked=type=>stageIndex>0||localWave(state.wave)>=unlockAt[type];
  // Story advances with combat, never opens a blocking dialogue or pauses the game.
  const STORY=[
    {wave:1,code:"第1章 / 峡谷",speaker:"ミナ",line:"避難列車が来る。ここを守って。"},
    {wave:4,code:"装甲の影",speaker:"ガク",line:"戦車だ！ミサイルの準備を。"},
    {wave:7,code:"空の敵影",speaker:"レン",line:"ドローン接近！対空砲を使って。"},
    {wave:10,code:"峡谷の夜明け",speaker:"ミナ",line:"突破部隊だ。これを止めれば道が開く！"},
    {wave:11,code:"第2章 / 砂漠",speaker:"レン",line:"砂塵の中から高速車両が来る。"},
    {wave:16,code:"消えた通信",speaker:"ミナ",line:"後方との通信が途絶えた……。"},
    {wave:20,code:"砂漠の決戦",speaker:"ガク",line:"敵に友軍の識別信号があるぞ。"},
    {wave:21,code:"第3章 / 雪嶺",speaker:"レン",line:"空を見ろ。ドローンの編隊だ！"},
    {wave:26,code:"封印命令",speaker:"司令部",line:"旧施設の調査を禁ずる。"},
    {wave:30,code:"凍てつく真相",speaker:"ミナ",line:"誰かが内部から敵を操っている……。"},
    {wave:31,code:"第4章 / 要塞",speaker:"ガク",line:"重戦車軍団だ。全火力を集中！"},
    {wave:37,code:"最後の橋",speaker:"ミナ",line:"列車が最後の橋に入った。"},
    {wave:40,code:"夜明け",speaker:"ミナ",line:"この戦いで、街の明日が決まる。"}
  ];
  const storyAt=n=>STORY.find(s=>s.wave===n);
  const storyLead=n=>STORY.filter(s=>s.wave<=n).slice(-1)[0];
  let loggedStoryWave=-1;
  const DECISIONS={
    5:{title:"避難列車へ弾薬を送るか？",options:[
      {label:"🚆 列車を守る −90G",hint:"避難評価＋1",cost:90,effect:s=>{s.convoySafety++;s.money-=90},log:"弾薬を避難列車へ回した"},
      {label:"⚔ 防衛線を優先 ＋80G",hint:"資金＋80 / 避難評価−1",cost:0,effect:s=>{s.convoySafety--;s.money+=80},log:"防衛線の備蓄を優先した"}
    ]},
    10:{title:"友軍信号の発信源を調べるか？",options:[
      {label:"📡 暗号を解析 −120G",hint:"全兵器の装甲貫通＋12%",cost:120,effect:s=>{s.money-=120;s.globalPierce+=.12;towers.forEach(t=>t.pierce+=.12);s.intelScore++},log:"友軍識別信号の暗号を解析した"},
      {label:"💰 調査を中断 ＋140G",hint:"資金＋140 / 真相は不明",cost:0,effect:s=>{s.money+=140},log:"司令部の命令に従い調査を止めた"}
    ]},
    15:{title:"最後の橋を守るか、火力を集めるか？",options:[
      {label:"🛡 退路を確保 −100G",hint:"基地HP＋5 / 避難評価＋1",cost:100,effect:s=>{s.money-=100;s.hp=Math.min(s.maxHp,s.hp+5);s.convoySafety++},log:"列車の退路を確保した"},
      {label:"🔥 全火力を集中",hint:"全兵器の火力＋10% / 避難評価−1",cost:0,effect:s=>{s.globalPower*=1.1;towers.forEach(t=>t.power*=1.1);s.convoySafety--},log:"退路を犠牲に火力を集中した"}
    ]}
  };
  const pendingDecision=()=>0; // Short stages must never block progress with a text choice.
  function chooseDecision(n,index){
    if(pendingDecision()!==n)return;
    const choice=DECISIONS[n].options[index];
    if(state.money<choice.cost){notice("資金不足。もう一方の決断を選んでください");return;}
    choice.effect(state);state.decisions[n]=choice.log;
    notice("📡 決断："+choice.log);
    loggedStoryWave=-1;updateUI();
  }

  // Local-only progression: no account, analytics SDK, or personal data collection.
  const SAVE_KEY="ironline_commander_v1";
  const DOCTRINES=[
    {id:"standard",name:"均衡防衛",icon:"🛡",tag:"標準",desc:"♥20 · 350G"},
    {id:"assault",name:"先制強襲",icon:"⚔",tag:"速攻",desc:"+90G · ♥−4"},
    {id:"precision",name:"精密迎撃",icon:"🎯",tag:"射程",desc:"射程+12% · −65G"},
    {id:"salvage",name:"戦場回収",icon:"💰",tag:"報酬",desc:"報酬+20% · 敵速+12%"}
  ];
  const RESEARCH=[
    {id:"power",name:"火力",icon:"💥",desc:"攻撃+4%",cost:35},
    {id:"supply",name:"補給",icon:"💰",desc:"報酬+5%",cost:55},
    {id:"reroll",name:"索敵",icon:"🎯",desc:"引き直し+1",cost:80}
  ];
  function loadCommander(){
    try{
      const raw=JSON.parse(localStorage.getItem(SAVE_KEY)||"{}");
      const levels={};RESEARCH.forEach(r=>levels[r.id]=raw.levels&&raw.levels[r.id]===1?1:0);
      // Preserve stage unlocks from v3 (5-wave stages) rather than reinterpreting old best waves.
      return {points:Math.max(0,Math.min(99999,Number(raw.points)||0)),best:Math.max(0,Math.min(40,Number(raw.best)||0)),runs:Math.max(0,Number(raw.runs)||0),stages:Math.max(1,Math.min(4,Number(raw.stages)||Math.ceil((Number(raw.best)||0)/5)||1)),levels};
    }catch(_){return {points:0,best:0,runs:0,stages:1,levels:{power:0,supply:0,reroll:0}};}
  }
  const commander=loadCommander();
  let doctrine="standard",labOpenedFromResult=false;
  function saveCommander(){try{localStorage.setItem(SAVE_KEY,JSON.stringify(commander));}catch(_){/* private mode */}}
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
    n.textContent=localWave(state.wave)===0&&!towers.length?"① 光る＋に銃を置こう":
      localWave(state.wave)===0?"② ▶ でスタート":
      localWave(state.wave)===1&&state.active?"③ 銃身が回転して敵を撃破！":
      localWave(state.wave)===1?"④ 榴弾砲で集団をまとめて撃破":"敵の種類を見て兵器を選ぼう！";
  }
  let draftForWave=0, strikeAiming=false, strikeRings=[], combatTexts=[];
  const TACTICS = [
    {id:"warfund",tier:"ECONOMY",name:"💰 戦時特別予算",desc:"即時 +200G。配置と強化で敵を迎え撃つ。",apply:()=>state.money+=200},
    {id:"overclock",tier:"FIREPOWER",name:"🔥 全砲門オーバークロック",desc:"全兵器の連射速度 +18%。以後の設置にも適用。",apply:()=>{state.fireRate*=.82;towers.forEach(t=>t.interval*=.82)}},
    {id:"ammunition",tier:"FIREPOWER",name:"💥 強化弾頭",desc:"全兵器の攻撃力 +25%。以後の設置にも適用。",apply:()=>{state.globalPower*=1.25;towers.forEach(t=>t.power*=1.25)}},
    {id:"radial",tier:"TACTICAL",name:"🎯 精密レーダー",desc:"全兵器の射程 +17%。以後の設置にも適用。",apply:()=>{state.globalRange*=1.17;towers.forEach(t=>t.range*=1.17)}},
    {id:"salvage",tier:"ECONOMY",name:"⚙ 戦場回収班",desc:"敵撃破報酬 +35%。撃破するほど資金が増える。",apply:()=>state.rewardRate*=1.35},
    {id:"bunker",tier:"DEFENSE",name:"🛡 緊急防壁",desc:"基地の体力を5回復し、最大体力も2増加。",apply:()=>{state.maxHp+=2;state.hp=Math.min(state.maxHp,state.hp+5)}},
    {id:"airforce",tier:"SUPPORT",name:"✈ 航空優勢",desc:"爆撃ゲージ +50%。爆撃の威力も +25%。",apply:()=>{state.strike=Math.min(100,state.strike+50);state.strikePower*=1.25}},
    {id:"armor",tier:"ANTI-ARMOR",name:"🔩 対装甲弾",desc:"全兵器に装甲貫通 +20%。戦車の突破を防ぐ。",apply:()=>{state.globalPierce+=.2;towers.forEach(t=>t.pierce+=.2)}},
    {id:"bounty",tier:"ECONOMY",name:"💎 高額賞金作戦",desc:"次の敵の体力が25%増える代わりに、撃破報酬2倍。",apply:()=>{state.wavePlan="bounty"}},
    {id:"mines",tier:"DEFENSE",name:"💣 峡谷地雷網",desc:"先頭6体に地雷が炸裂。開幕の突破を先に止める。",apply:()=>{state.wavePlan="mines"}},
    {id:"barrage",tier:"FIREPOWER",name:"🚀 開幕ロケット斉射",desc:"先頭6体へ迎撃ロケット。HPを削ってから射線に入れる。",apply:()=>{state.wavePlan="barrage"}},
    {id:"emp",tier:"SUPPORT",name:"⚡ 広域電波妨害",desc:"先頭8体を長時間鈍足化。高速部隊への切り札。",apply:()=>{state.wavePlan="emp"}}
  ];

  function reset() {
    const sy=1.43;
    ROUTES=(STAGES[stageIndex].routes||[STAGES[stageIndex].path]).map(route=>route.map(([x,y])=>[x,y*sy]));
    PATH=ROUTES[0];
    PADS=STAGES[stageIndex].pads.map(([x,y])=>[x,y*sy]);
    cameraY=0;
    state = {
      hp:20, maxHp:20, money:350+stageIndex*500, wave:STAGES[stageIndex].start, active:false,
      waveLeaks:{},lastWaveReport:"",suggestedTower:"machinegun",
      enemySeed:Math.floor(Math.random()*4294967296),
      paused:false, speed:1, finished:false,
      queue:[], spawnTimer:0, xp:0, xpNeed:50,
      upgrades:0, rerolls:3, choosing:false,
       globalPower:1,globalRange:1,fireRate:1,rewardRate:1,globalPierce:0,
       strike:50,strikePower:1,usedTactics:[],kills:0,eliteKills:0,
       convoySafety:1,intelScore:0,decisions:{},
      note:"まずは兵器を置こう！",
      noteTime:0
    };
    state.money+=doctrine==="assault"?90:doctrine==="precision"?-65:0;
    state.hp-=doctrine==="assault"?4:0;
    state.maxHp=20;
    state.globalRange*=doctrine==="precision"?1.12:1;
    state.globalPower*=commander.levels.power?1.04:1;
    state.rewardRate*=commander.levels.supply?1.05:1;
    state.rewardRate*=doctrine==="salvage"?1.20:1;
    state.rerolls+=commander.levels.reroll?1:0;
    towers = []; enemies = []; bullets = []; effects = [];
    selectedType = "machinegun";
    selectedPad = -1;
    hoverPad=-1;pressedPad=-1;
    loggedStoryWave=-1;
    draftForWave=0;strikeAiming=false;strikeRings=[];combatTexts=[];kick=0;smokes=[];flashes=[];casings=[];beams=[];shockwaves=[];screenFlash=0;combo=0;comboClock=0;missionBanner=0;ambientTime=0;
    $("draft-modal").classList.add("hidden");
    $("wave-alert").classList.add("hidden");
    $("strike-hint").classList.add("hidden");
    $("evolution-modal").classList.add("hidden");
    $("result-modal").classList.add("hidden");
    updateUI();
  }
  function selectStage(index){
    if(index<0||index>=commander.stages||index>=STAGES.length)return;
    stageIndex=index;
    reset();
    $("lab-modal").classList.add("hidden");
    $("result-modal").classList.add("hidden");
    notice(STAGES[index].icon+" "+STAGES[index].name+" — "+STAGES[index].brief);
    updateUI();
  }

  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const towerAt = index => towers.find(t => t.pad === index);
  const FUSIONS={
    "cannon+machinegun":{name:"焼夷弾幕",tag:"HE×MG",color:"#ffb36d",desc:"機関銃の一定弾数が小範囲に延焼"},
    "flak+machinegun":{name:"対空弾幕",tag:"AA×MG",color:"#8de8ff",desc:"機関銃の対ドローン性能が上がる"},
    "cannon+flak":{name:"近接信管",tag:"HE×AA",color:"#ffc97b",desc:"対空砲の爆風が広がる"},
    "machinegun+missile":{name:"追尾連装",tag:"MG×MS",color:"#ffe28a",desc:"機関銃が対装甲小型ロケットを追加発射"},
    "machinegun+radar":{name:"妨害射撃",tag:"MG×EW",color:"#8cfff1",desc:"機関銃が命中した敵を減速させる"},
    "flak+missile":{name:"防空ネット",tag:"AA×MS",color:"#93e8ff",desc:"対空砲がドローンへ集中砲火"},
    "flak+radar":{name:"電子照準",tag:"AA×EW",color:"#93e8ff",desc:"対空砲がドローンをマーク"},
    "cannon+missile":{name:"破片散弾",tag:"HE×MS",color:"#ffcb8b",desc:"榴弾砲の爆発範囲が広がる"},
    "cannon+radar":{name:"EMP榴弾",tag:"HE×EW",color:"#8ae5ff",desc:"榴弾砲の爆発が敵を減速させる"},
    "missile+radar":{name:"標的捕捉",tag:"MS×EW",color:"#a1e8ff",desc:"ミサイルが戦車・ドローンを狙い撃つ"}
  };
  function fusionFor(t){
    if(!t||t.type==="radar")return null;
    const pairs=towers.filter(o=>o!==t&&distance(o,t)<=(PAD_TRAITS[t.pad]==="link"||PAD_TRAITS[o.pad]==="link"?170:140)&&FUSIONS[[o.type,t.type].sort().join("+")]);
    pairs.sort((a,b)=>distance(a,t)-distance(b,t));
    const partner=pairs[0];if(!partner)return null;
    return {partner,info:FUSIONS[[partner.type,t.type].sort().join("+")]};
  }

  function notice(message) {
    state.note = message;
    state.noteTime = 2.4;
    $("battle-message").textContent = message;
  }

  function makeTower(index, type) {
    const d = DEF[type];
    const [x,y] = PADS[index];
    const trait=PAD_TRAITS[index],cost=padCost(type,index);
    return {
      pad:index, type, x,y, level:1, spent:cost,
      power:state.globalPower*(trait==="guard"?1.20:1),
      interval:d.rate*state.fireRate*(trait==="front"?.87:trait==="high"?1.12:1),
      range:d.range*state.globalRange*(trait==="high"?1.30:trait==="guard"?.95:1),
      cooldown:0, angle:-Math.PI/2,
      pierce:state.globalPierce, critical:0, blast:0,
      chain:false, slow:false, mods:[],
      evolution:null, branch:null, awakened:false, kills:0,spin:0,recoil:0,glow:0,comboShots:0,comboCooldown:0
    };
  }

  function selectPad(index) {
    if (state.choosing || state.finished) return;

    if(!towerAt(index)&&!unlocked(selectedType)){notice("まだ解放されていない兵器です");return;}
    selectedPad = index;
    const existing = towerAt(index);

    if (!existing) {
      const price = padCost(selectedType,index);
      if (state.money < price) {
        notice("資金が足りません！");
        updateUI();
        return;
      }
      state.money -= price;
      const placed=makeTower(index, selectedType);
      towers.push(placed);
      const newFusion=fusionFor(placed);
      if(newFusion){
        notice("⚡ 複合連携発動："+newFusion.info.name+"！");
        shockwaves.push({x:placed.x,y:placed.y,r:4,max:67,life:.65,color:newFusion.info.color});
        combatTexts.push({x:placed.x,y:placed.y-34,text:newFusion.info.name,life:1.4,color:newFusion.info.color});
      }else notice(DEF[selectedType].name + "を設置！ / "+padTrait(index).desc);
      sfx("unlock");
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
    // Upgrades must feel useful against crowds, not merely overkill one target.
    t.interval*=.96;
    t.range*=t.type==="radar"?1.035:1.02;
    if(t.type==="cannon")t.blast+=2;
    if(t.type==="missile")t.blast+=1;
    if(t.type==="flak")t.range+=1.8;

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
    const local=Math.max(1,Math.min(WAVES_PER_STAGE,n-STAGES[stageIndex].start));
    const focus=local===10?"boss":local===1||local===2?"infantry":
      stageIndex===1&&local%3!==0?"car":stageIndex===2&&(local>=7||local%3!==0)?"drone":
      stageIndex===3&&local%3!==0?"tank":
      [3,6,9].includes(local)?"car":[4,8].includes(local)?"tank":local===7?"drone":"infantry";
    // Finale is a boss encounter, not a wall of 25+ giant tanks.
    const unitCount=7+Math.floor(local*1.75)+stageIndex-(stageIndex===3&&local>=8?(local===10?12:5):0);
    const rush=focus==="car",swarm=focus==="infantry",tank=focus==="tank",drone=focus==="drone";
    return {local,focus,unitCount,tank,drone,rush,swarm,boss:local===10,
      label:focus==="boss"?"⚠ ボス接近":focus==="car"?"🚗 高速車両":
        focus==="tank"?"🛡 重装甲戦車":focus==="drone"?"🚁 ドローン群":"👣 歩兵部隊"};
  }
  const COUNTER_TIPS={
    infantry:{name:"歩兵",weapon:"cannon",tip:"榴弾砲を増やそう"},
    car:{name:"車両",weapon:"cannon",tip:"榴弾砲を追加しよう"},
    tank:{name:"戦車",weapon:"missile",tip:"ミサイルを増やそう"},
    drone:{name:"ドローン",weapon:"flak",tip:"対空砲で迎撃しよう"},
    boss:{name:"ボス",weapon:"missile",tip:"ミサイルを強化しよう"}
  };
  function waveLeakReport(){
    const counts=Object.entries(state.waveLeaks).sort((a,b)=>b[1]-a[1]);
    if(!counts.length)return "";
    const [kind,count]=counts[0],tip=COUNTER_TIPS[kind];
    state.suggestedTower=unlocked(tip.weapon)?tip.weapon:"machinegun";
    return "⚠ "+tip.name+count+"体突破 → "+tip.tip;
  }
  function nextWaveAdvice(n){
    const p=waveProfile(Math.min(stageEnd(),n));
    return p.boss?"強敵！ミサイルを増やそう":
      p.rush?"速い敵！電子戦で足止め":
      p.tank?"戦車対策にミサイルを配置":
      p.drone?"ドローン対策に対空砲を配置":
      p.swarm?"歩兵の大群！榴弾砲で範囲攻撃":
      "配置と強化で敵に備えよう";
  }
  function recommendNextWeapon(n){
    const p=waveProfile(Math.min(stageEnd(),n));
    return p.boss||p.tank?"missile":p.drone?"flak":p.rush?"radar":p.swarm?"cannon":"machinegun";
  }
  function waveKinds(n) {
    const profile=waveProfile(n),result=[];
    for(let i=0;i<profile.unitCount;i++){
      // Telegraph a clear counter: each wave is dominated by ONE silhouette.
      let kind=profile.focus;
      if(profile.boss){
        kind=stageIndex===1?(i%6===0?"tank":"car"):
          stageIndex===2?(i%5===0?"tank":"drone"):
          stageIndex===3?(i%4===0?"car":"tank"):
          i%5===0?"tank":i%4===1?"drone":"car";
      }
      else if(profile.local<=2){kind=i%6===0&&profile.local===2?"car":"infantry";}
      else if(profile.focus==="car"){kind=i%6===0?"infantry":"car";}
      else if(profile.focus==="tank"){kind=stageIndex===3?(i%3===0?"car":"tank"):(i%3===0?"tank":"car");}
      else if(profile.focus==="drone"){kind=i%5===0?"infantry":"drone";}
      else {kind=i%6===0?"car":"infantry";}
      result.push(kind);
    }
    if(profile.boss)result.push("boss");
    return result;
  }
  function tacticalDraft(n) {
    state.choosing=true;
    state.paused=true;
    $("draft-wave").textContent=String(n);
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
      const categoryNames={ECONOMY:"資金・報酬",FIREPOWER:"攻撃力",DEFENSE:"基地防衛",TACTICAL:"射程・作戦",SUPPORT:"援護", "ANTI-ARMOR":"戦車対策"};
      type.textContent=categoryNames[card.tier]||"支援";head.textContent=card.name;desc.textContent=card.desc;
      const impact=document.createElement("em");impact.className="draft-impact";
      impact.textContent=card.id==="bounty"?"⚠ 次の戦いだけ / 高リスク高報酬":card.id==="mines"?"💣 次の戦いだけ / 開幕地雷":card.id==="barrage"?"🚀 次の戦いだけ / ロケット迎撃":card.id==="emp"?"⚡ 次の戦いだけ / 行動妨害":card.tier==="ECONOMY"?"✓ 作戦中ずっと / 資金確保":card.tier==="DEFENSE"?"✓ 作戦中ずっと / 基地防衛":card.tier==="FIREPOWER"?"✓ 作戦中ずっと / 火力強化":card.tier==="ANTI-ARMOR"?"✓ 作戦中ずっと / 装甲対策":card.tier==="TACTICAL"?"✓ 作戦中ずっと / 射程強化":"✓ 作戦中ずっと / 爆撃強化";
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
    state.waveLeaks={};state.lastWaveReport="";
    state.queue=waveKinds(n);
    state.spawnedThisWave=0;
    state.spawnTimer=.16;state.paused=false;
    const dispatch=storyAt(n);
    notice(dispatch?"📡 "+dispatch.line.slice(0,19):"敵接近："+waveProfile(n).label);
    missionBanner=2.25;screenFlash=.17;
    $("wave-alert").textContent="第"+localWave(n)+"波："+waveProfile(n).label;
    $("wave-alert").classList.remove("hidden");
  }
  function startWave() {
    if(state.active||state.finished||state.choosing)return;
    if(!towers.length){notice("先に光るマスをタップして機関銃を配置しよう！");return;}
    if(pendingDecision()){notice("下の二択から作戦を決めてください");return;}
    if(localWave(state.wave)===0){launchWave(state.wave+1);updateUI();return;}
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
    const w=localWave(state.wave)-1;
    // Every stage has ten waves of meaningful growth, but the *counter* matters more than level.
    const scale=(1+w*.105+w*w*.011)*(1+stageIndex*.27);
    // An independent enemy RNG keeps difficulty stable regardless of particles and sound.
    state.enemySeed=(Math.imul(state.enemySeed,1664525)+1013904223)>>>0;
    const elite=kind!=="boss" && w>=5 && state.enemySeed/4294967296<Math.min(.25,.045+w*.015);
    const routeIndex=ROUTES.length===1?0:state.spawnedThisWave%ROUTES.length;
    const path=ROUTES[routeIndex];
    return {
      id:nextEnemyId++, kind,
      x:path[0][0], y:path[0][1], path,routeIndex,
      segment:0, hp:d.hp*scale*(elite?1.65:1), maxHp:d.hp*scale*(elite?1.65:1),
      speed:d.speed*(1+Math.min(.25,w*.015))*(elite?1.10:1)*(doctrine==="salvage"?1.12:1)*(stageIndex===2&&kind==="drone"?.83:1)*(stageIndex>=2?1.13:1.07), armor:d.armor, reward:d.reward*(elite?3:1), elite,
      damage:kind==="tank"&&stageIndex===0?1:d.damage, color:d.color,
      slowTime:0, alive:true, angle:0
    };
  }

  function moveEnemy(e, dt) {
    const path=e.path||PATH;
    const slowFactor = e.slowTime > 0 ? (e.empTime>0?.34:.55) : 1;
    e.slowTime = Math.max(0,e.slowTime-dt);
    e.empTime=Math.max(0,(e.empTime||0)-dt);
    e.markTime=Math.max(0,(e.markTime||0)-dt);
    e.burnTime=Math.max(0,(e.burnTime||0)-dt);
    if(e.burnTime>0&&e.burnSource){
      hurt(e,(e.burnDps||7)*dt,e.burnSource);
      if(!e.alive)return;
      if(Math.random()<.3)effects.push({x:e.x+(Math.random()-.5)*9,y:e.y,vx:(Math.random()-.5)*16,vy:-22,life:.38,max:.38,color:"#ff873d",size:3});
    }
    let travel = e.speed * slowFactor * dt;

    while (travel > 0 && e.segment < path.length-1) {
      const target = path[e.segment+1];
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
    if (e.segment >= path.length-1) {
      e.alive=false;
      state.hp -= e.damage;
      state.waveLeaks[e.kind]=(state.waveLeaks[e.kind]||0)+1;
      strikeRings.push({x:360,y:PATH.at(-1)[1],radius:8,life:.55});
      combatTexts.push({x:345,y:PATH.at(-1)[1]-35,text:"基地 -"+e.damage,life:1.1,color:"#ff8176"});
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
      (source.branch==="rail"?(e.kind==="tank"||e.kind==="boss"?2.45:e.kind==="car"?1.1:.55):
       source.branch==="tesla"?(e.kind==="drone"?1.45:e.kind==="tank"?.20:1.08):
       source.branch==="gatling"?(e.kind==="infantry"?1.35:e.kind==="tank"?.06:e.kind==="drone"?.12:.8):
       (e.kind==="tank"?.065:e.kind==="boss"?.10:e.kind==="drone"?.13:e.kind==="car"?.65:1.25)):
      source.type==="cannon"?(e.kind==="infantry"?1.4:e.kind==="car"?1.5:e.kind==="drone"?.09:e.kind==="tank"?.48:.42):
      source.type==="flak"?(e.kind==="drone"?2.65:e.kind==="infantry"?.38:e.kind==="car"?.34:e.kind==="tank"?.11:.2):
      source.type==="missile"?(e.kind==="tank"?2.25:e.kind==="boss"?2.1:e.kind==="drone"?.95:e.kind==="car"?.7:.4):1;
    const link=fusionFor(source);
    const bonus=link&&link.info.name==="標的捕捉"&&(e.kind==="tank"||e.kind==="drone")?1.24:
      link&&link.info.name==="対空弾幕"&&e.kind==="drone"?2.5:
      link&&link.info.name==="防空ネット"&&e.kind==="drone"?1.28:1;
    const tagged=source.type==="missile"&&e.markTime>0?1+(e.markStrength||.35):1;
    const actual=amount*(1-armor)*crit*matchup*bonus*tagged;
    e.hp -= actual;
    if(actual>15 && Math.random()<.35)combatTexts.push({x:e.x,y:e.y-18,text:"-"+Math.round(actual),life:.65,color:crit>1?"#ffe88d":"#e7f2d2"});
    if(source.slow)e.slowTime=Math.max(e.slowTime,1.5);
    if(link&&link.info.name==="妨害射撃")e.slowTime=Math.max(e.slowTime,.55);
    if(link&&link.info.name==="EMP榴弾")e.slowTime=Math.max(e.slowTime,.9);

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
        if(e.alive&&distance(t,e)<t.range){
          e.slowTime=Math.max(e.slowTime,1.25);
          if(t.branch==="empfield")e.empTime=Math.max(e.empTime||0,1.4);
          e.markTime=Math.max(e.markTime||0,1.3);
          e.markStrength=Math.max(e.markStrength||0,t.branch==="targetlock"?.70:.35);
        }
      });
      shockwaves.push({x:t.x,y:t.y,r:t.range*.2,max:t.range,life:.55,color:t.branch==="empfield"?"#a99aff":"#68eaff"});
      return;
    }

    t.angle=Math.atan2(target.y-t.y,target.x-t.x);
    const d=DEF[t.type];
    const damage=d.dmg*t.power;
    const fusion=fusionFor(t);
    if(fusion&&fusion.info.name==="追尾連装"&&t.comboCooldown<=0){
      t.comboCooldown=2.8;
      const armored=enemies.filter(e=>e.alive&&distance(e,t)<t.range).sort((a,b)=>(b.kind==="tank")-(a.kind==="tank"))[0]||target;
      bullets.push({x:t.x,y:t.y,px:t.x,py:t.y,targetId:armored.id,tx:armored.x,ty:armored.y,
        speed:330,damage:60*t.power,source:t,type:"missile",special:"hunter",color:"#ffe593",alive:true});
      combatTexts.push({x:t.x,y:t.y-35,text:"追尾連装",life:.65,color:"#ffe28a"});
    }
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
    const count=t.type==="machinegun"?(t.awakened?6:t.branch==="gatling"?4:t.level>=5?4:t.level>=3?2:1):t.type==="flak"?2:t.type==="missile"&&t.branch==="swarm"?3:1;
    if(t.type!=="machinegun"||Math.random()<.2)sfx(t.type==="machinegun"?"shot":"boom");
    for(let shot=0;shot<count;shot++){
    const angle=t.angle+(shot-(count-1)/2)*.065;
    bullets.push({
      x:t.x+Math.cos(angle)*25,y:t.y+Math.sin(angle)*25,px:t.x,py:t.y,targetId:target.id,
      tx:target.x,ty:target.y,
      speed:t.type==="missile"?310:
            t.type==="cannon"?380:t.type==="flak"?510:650,
      damage:damage*(t.type==="flak"?.55:t.type==="missile"&&t.branch==="swarm"?.59:count>1?.43:1),source:t,type:t.type,
      color:d.color,alive:true
    });}
    const muzzleLength=t.type==="missile"?24:t.type==="flak"?49:t.type==="cannon"?47:43;
    flashes.push({x:t.x+Math.cos(t.angle)*muzzleLength,y:t.y+Math.sin(t.angle)*muzzleLength,
      life:.19,size:t.type==="cannon"?20:t.type==="missile"?17:t.type==="flak"?12:9,
      color:t.type==="flak"?"#99faff":t.type==="missile"?"#ff9e52":"#ffe49a",angle:t.angle});
    if(t.type!=="radar"){
      const side=t.angle+Math.PI/2;
      for(let j=0;j<(t.type==="machinegun"?Math.min(count,5):t.type==="flak"?2:1);j++){
        casings.push({x:t.x+Math.cos(side)*11,y:t.y+Math.sin(side)*11,
          vx:Math.cos(side)*(35+Math.random()*45)+(Math.random()-.5)*18,
          vy:Math.sin(side)*(35+Math.random()*45)-24,
          angle:Math.random()*5,spin:(Math.random()-.5)*12,
          life:.75,max:.75,color:t.type==="flak"?"#a7e7e5":"#eac17a",size:t.type==="cannon"?6:3});
      }
      if(casings.length>130)casings.splice(0,casings.length-130);
    }
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
    burst(b.x,b.y,b.type==="missile"?"#ff964c":b.type==="flak"?"#76eaff":"#ffcf79",
      b.type==="machinegun"?4:18);
    if(b.source.branch==="cluster"){
      // Shell separates into satellite blasts; obvious area-denial identity.
      const petals=b.source.awakened?6:3;
      for(let i=0;i<petals;i++){
        const a=i*Math.PI*2/petals+ambientTime*.4;
        const px=b.x+Math.cos(a)*29,py=b.y+Math.sin(a)*29;
        burst(px,py,"#ffdb83",b.source.awakened?11:7);
        shockwaves.push({x:px,y:py,r:3,max:b.source.awakened?31:23,life:.28,color:"#ffd174"});
        enemies.forEach(e=>{if(e.alive&&Math.hypot(e.x-px,e.y-py)<(b.source.awakened?31:23))hurt(e,b.damage*.13,b.source)});
      }
    }
    if(b.source.branch==="bunker"&&target&&(target.kind==="tank"||target.kind==="boss")){
      shockwaves.push({x:b.x,y:b.y,r:6,max:b.source.awakened?65:38,life:.44,color:"#ffcf8b"});
      combatTexts.push({x:b.x,y:b.y-21,text:"装甲破壊",life:.75,color:"#ffe1a4"});
    }
    if(b.source.branch==="swarm"&&b.source.awakened){
      burst(b.x,b.y,"#ffe28f",12);
      shockwaves.push({x:b.x,y:b.y,r:4,max:28,life:.24,color:"#ffe28f"});
    }

    if(target && target.alive)hurt(target,b.damage,b.special==="hunter"?{...b.source,type:"missile"}:b.source);

    let radius = b.type==="cannon"?43:
                 b.type==="missile"?21:b.type==="flak"?26:0;
    radius += b.source.blast;
    const combo=fusionFor(b.source);
    if(combo&&combo.info.name==="破片散弾"&&b.type==="cannon")radius+=13;
    if(combo&&combo.info.name==="近接信管"&&b.type==="flak")radius+=13;
    if(combo&&combo.info.name==="焼夷弾幕"&&b.type==="machinegun"){
      b.source.comboShots++;
      if(b.source.comboShots%7===0){
        enemies.forEach(e=>{if(e.alive&&e!==target&&Math.hypot(e.x-b.x,e.y-b.y)<25)hurt(e,b.damage*.24,b.source)});
        burst(b.x,b.y,"#ff8e50",9);
      }
    }

    if(radius>0){
      enemies.forEach(e=>{
        if(e.alive && e!==target &&
           Math.hypot(e.x-b.x,e.y-b.y)<radius)
          hurt(e,b.damage*.6,b.source);
      });
    }
    if(b.type==="cannon"&&b.source.branch==="incendiary"){
      enemies.forEach(e=>{
        if(e.alive&&Math.hypot(e.x-b.x,e.y-b.y)<radius+5){
          e.burnTime=Math.max(e.burnTime||0,2.8);
          e.burnDps=Math.max(e.burnDps||0,10*b.source.power);
          e.burnSource=b.source;
        }
      });
      burst(b.x,b.y,"#ff6e31",10);
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
        if(b.type==="missile"&&Math.random()<.75){
          smokes.push({x:b.x+(Math.random()-.5)*6,y:b.y+(Math.random()-.5)*6,r:3+Math.random()*4,life:.30+Math.random()*.18});
          if(smokes.length>190)smokes.splice(0,smokes.length-190);
        }
      }
    });
    bullets=bullets.filter(b=>b.alive);
  }

  function updateEffects(dt) {
    if(state.towerHintTime>0)state.towerHintTime=Math.max(0,state.towerHintTime-dt);
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
    casings.forEach(p=>{p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=115*dt;p.vx*=.985;p.angle+=p.spin*dt;});
    casings=casings.filter(p=>p.life>0);
    beams.forEach(p=>p.life-=dt);beams=beams.filter(p=>p.life>0);
    towers.forEach(t=>{t.recoil=Math.max(0,t.recoil-dt*8);t.glow=Math.max(0,t.glow-dt);});
    kick=Math.max(0,kick-dt*17);
  }

  function findTarget(t) {
    const available=enemies.filter(e=>
      e.alive&&distance(t,e)<=t.range
    );
    if(!available.length)return null;
    if(t.type==="flak"){
      const aerial=available.filter(e=>e.kind==="drone");
      if(aerial.length)return aerial.sort((a,b)=>a.hp-b.hp)[0];
    }
    if(t.type==="missile"){
      const armored=available.filter(e=>e.kind==="tank"||e.kind==="boss");
      if(armored.length)return armored.sort((a,b)=>a.hp-b.hp)[0];
    }
    if(t.type==="cannon"){
      const crowded=available.map(e=>({e,n:available.filter(a=>distance(a,e)<55).length}));
      crowded.sort((a,b)=>b.n-a.n);
      if(crowded[0]?.n>=3)return crowded[0].e;
    }
    available.sort((a,b)=>{
      const progress=e=>{const path=e.path||PATH;if(e.segment>=path.length-1)return 1;const to=path[e.segment+1],from=path[e.segment];const total=Math.hypot(to[0]-from[0],to[1]-from[1])||1;return (e.segment+Math.max(0,1-Math.hypot(e.x-to[0],e.y-to[1])/total))/(path.length-1)};
      return progress(b)-progress(a);
    });
    return available[0];
  }

  const BRANCHES=[
    {id:"gatling",name:"ガトリングストーム",icon:"🔥",tag:"弾幕・大群殲滅",desc:"超高速4連装。歩兵の大群を一瞬で削り取る。",color:"#ffbb57"},
    {id:"rail",name:"レールガン",icon:"🎯",tag:"超火力・装甲貫通",desc:"高威力の貫通電磁砲。重戦車・ボスへの切り札。",color:"#7be3ff"},
    {id:"tesla",name:"テスラチェーン",icon:"⚡",tag:"連鎖電撃・集団制圧",desc:"最大3体に連鎖電撃。密集部隊を一斉に足止め。",color:"#b5a5ff"}
  ];
  const SPECIALIZATIONS={
    cannon:[
      {id:"cluster",name:"クラスター砲",icon:"💥",desc:"着弾範囲が一気に拡大",color:"#ffd174"},
      {id:"incendiary",name:"焼夷榴弾",icon:"🔥",desc:"爆炎が敵を燃やし続ける",color:"#ff8e5f"}
    ],
    flak:[
      {id:"skywall",name:"スカイウォール",icon:"🛡",desc:"ドローンに高速で集中砲火",color:"#91e9ff"},
      {id:"shrapnel",name:"フレシェット弾",icon:"✴",desc:"散弾が広い空域を制圧",color:"#b7faff"}
    ],
    missile:[
      {id:"bunker",name:"バンカーバスター",icon:"🚀",desc:"装甲を貫く巨大ミサイル",color:"#ffad66"},
      {id:"swarm",name:"スウォーム連装",icon:"🎇",desc:"小型ミサイルを3連射",color:"#ffe08b"}
    ],
    radar:[
      {id:"empfield",name:"EMPフィールド",icon:"⚡",desc:"敵の動きをさらに遅くする",color:"#85e7ff"},
      {id:"targetlock",name:"戦術リンク",icon:"🎯",desc:"敵をマーキングし火力支援",color:"#b8b2ff"}
    ]
  };
  const ROLE_HINT={
    machinegun:"👣 歩兵向き・装甲には弱い",
    cannon:"💥 集団攻撃・ドローンには弱い",
    flak:"🚁 対空攻撃・装甲には弱い",
    missile:"🛡 装甲破壊・単体に強い",
    radar:"⚡ 敵を遅くして味方を支援"
  };
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
      if(awakening)awakenWeapon(t,awakening,t.branch==="rail"?"#74eaff":t.branch==="tesla"?"#a99aff":"#ffcc63");
      return;
    }
    // Other classes have their own obtainable two-part awakening recipes.
    if(t.type==="cannon"&&t.branch==="cluster"&&t.mods.includes("blast")&&t.mods.includes("power"))
      awakenWeapon(t,"メテオ・クラスター","#ffd174");
    if(t.type==="cannon"&&t.branch==="incendiary"&&t.mods.includes("blast")&&t.mods.includes("rapid"))
      awakenWeapon(t,"インフェルノ砲","#ff8e5f");
    if(t.type==="missile"&&t.branch==="bunker"&&t.mods.includes("pierce")&&t.mods.includes("power"))
      awakenWeapon(t,"タイタン・ブレイカー","#ffad66");
    if(t.type==="missile"&&t.branch==="swarm"&&t.mods.includes("rapid")&&t.mods.includes("blast"))
      awakenWeapon(t,"ハイドラ・スウォーム","#ffe08b");
  }
  function awakenWeapon(t,name,color){
    if(t.awakened)return;
    t.awakened=true;state.awakenings=(state.awakenings||0)+1;
    t.evolution=name;t.power*=1.28;t.interval*=.80;t.glow=1.4;
    kick=8;sfx("unlock");
    for(let n=0;n<8;n++)burst(t.x,t.y,n%2?"#ffe5a0":color,30);
    strikeRings.push({x:t.x,y:t.y,radius:2,life:1});
    shockwaves.push({x:t.x,y:t.y,r:8,max:W*.8,life:1.4,color});
    screenFlash=.75;
    combatTexts.push({x:t.x,y:t.y-49,text:"★ 覚醒！",life:2.2,color});
    notice("★ 覚醒："+name+"！");
  }
  function evolutionChoices(t) {
    if(t.type==="machinegun"&&t.branch){
      const list=PERKS[t.branch].filter(m=>!t.mods.includes(m.id));
      return list.sort(()=>Math.random()-.5).slice(0,3);
    }
    let available=MODS.filter(m=>!t.mods.includes(m.id));
    if(t.type==="radar")available=available.filter(m=>["range","rapid","slow"].includes(m.id));
    if(t.type==="cannon")available=available.filter(m=>["power","rapid","blast","slow"].includes(m.id));
    if(t.type==="flak")available=available.filter(m=>["rapid","range","blast","critical"].includes(m.id));
    if(t.type==="missile")available=available.filter(m=>["power","rapid","pierce","blast"].includes(m.id));
    return available.sort(()=>Math.random()-.5).slice(0,3);
  }
  function specializeWeapon(t,protocol){
    t.branch=protocol.id;t.evolution=protocol.name;t.glow=.8;
    if(protocol.id==="cluster"){t.blast+=37;t.interval*=1.08;}
    if(protocol.id==="incendiary"){t.power*=1.18;t.blast+=12;}
    if(protocol.id==="skywall"){t.interval*=.62;t.range*=1.14;}
    if(protocol.id==="shrapnel"){t.blast+=30;t.interval*=1.08;}
    if(protocol.id==="bunker"){t.power*=1.65;t.pierce=1;t.interval*=1.18;}
    if(protocol.id==="swarm"){t.interval*=1.18;}
    if(protocol.id==="empfield"){t.interval*=.82;t.range*=1.12;}
    if(protocol.id==="targetlock"){t.range*=1.24;}
    combatTexts.push({x:t.x,y:t.y-43,text:protocol.name,life:1.6,color:protocol.color});
    shockwaves.push({x:t.x,y:t.y,r:6,max:130,life:.8,color:protocol.color});
  }
  function padAreaLabel(pad){
    const [x,y]=PADS[pad];
    const vertical=y<125?"上":y<245?"中":y<350?"下":"最下";
    const horizontal=x<105?"左":x<195?"中央左":x<305?"中央右":"右";
    return vertical+horizontal;
  }
  function openEvolution() {
    if(state.choosing||state.finished)return;
    const available=towers.filter(t=>!t.branch||t.mods.length<(t.type==="machinegun"?2:2));
    if(!available.length)return;
    state.choosing=true;state.paused=true;
    const selected=towerAt(selectedPad);
    const forecast=recommendNextWeapon(state.wave+1);
    let t=selected&&available.includes(selected)?selected:
      available.find(a=>a.type===forecast&&!a.branch)||
      available.find(a=>!a.branch)||available[0];
    selectedPad=t.pad;
    $("evolution-modal").classList.remove("hidden");
    const title=$("evolution-title"),intro=$("evolution-description"),holder=$("evolution-options");
    const drawChoices=()=>{
      holder.innerHTML="";
      // Choose WHICH gun evolves, not only which perk. This is a strategic allocation.
      const targets=document.createElement("div");targets.className="evolution-targets";
      available.slice(0,8).forEach(candidate=>{
        const chip=document.createElement("button");chip.type="button";
        chip.className="evolution-target"+(candidate===t?" selected":"");
        chip.textContent=DEF[candidate.type].name+"・"+padAreaLabel(candidate.pad);
        chip.onclick=()=>{t=candidate;selectedPad=t.pad;drawChoices();};
        targets.appendChild(chip);
      });
      holder.appendChild(targets);
      const branchChoice=!t.branch;
      title.textContent=branchChoice?DEF[t.type].name+" 進化":t.branch?"追加カスタム":"兵器改造";
      intro.textContent="";
      const options=branchChoice?(t.type==="machinegun"?BRANCHES:SPECIALIZATIONS[t.type]):evolutionChoices(t);
      options.forEach(m=>{
        const button=document.createElement("button");
        button.className="evolution-choice "+(branchChoice?"branch-choice":"perk-choice");
        const symbol=document.createElement("span");symbol.className="choice-symbol";
        symbol.textContent=m.icon||m.symbol||"✦";
        const wrap=document.createElement("span");wrap.className="choice-copy";
        const strong=document.createElement("strong");strong.textContent=m.name;
        const desc=document.createElement("span");desc.textContent=m.desc;
        if(branchChoice&&t.type==="machinegun"){const role=document.createElement("small");role.className="choice-role";role.textContent=m.id==="gatling"?"歩兵に特化":m.id==="rail"?"重戦車に特化":"連鎖と減速に特化";desc.afterRole=role;}
        wrap.append(strong,desc);if(desc.afterRole)wrap.append(desc.afterRole);
        if(m.tag){const tag=document.createElement("small");tag.textContent=m.tag;wrap.append(tag);}
        if(!branchChoice&&t.branch){const goal=document.createElement("small");goal.className="recipe-hint";goal.textContent=(t.branch==="gatling"&&["ricochet","barrage"].includes(m.id)||t.branch==="rail"&&["penetrate","overcharge"].includes(m.id)||t.branch==="tesla"&&["conduction","spread"].includes(m.id)||t.branch==="cluster"&&["blast","power"].includes(m.id)||t.branch==="incendiary"&&["blast","rapid"].includes(m.id)||t.branch==="bunker"&&["pierce","power"].includes(m.id)||t.branch==="swarm"&&["rapid","blast"].includes(m.id))?"★ 覚醒パーツ":"別の強化";wrap.append(goal);}
        button.append(symbol,wrap);
        button.onclick=()=>{
          if(branchChoice){
            if(t.type==="machinegun"){
              t.branch=m.id;t.mods=[];t.evolution=null;
              if(m.id==="gatling"){t.interval*=.72;t.power*=.72;t.range*=.90;}
              if(m.id==="rail"){t.interval*=2.5;t.power*=9;t.pierce=1;t.range*=1.18;}
              if(m.id==="tesla"){t.interval*=1.12;t.power*=2.1;t.chain=true;t.range*=.93;}
            }else specializeWeapon(t,m);
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
            notice("進化完了！ ▶ 第"+(localWave(state.wave)+1)+"波へ");
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
    const gained=Math.floor(localWave(state.wave)*3+Math.min(30,state.kills/6)+(win?80:0)+(win&&state.convoySafety>=2?20:0));
    commander.points+=gained;commander.best=Math.max(commander.best,state.wave);commander.runs++;
    if(win)commander.stages=Math.max(commander.stages,Math.min(STAGES.length,stageIndex+2));
    saveCommander();

    $("result-modal").classList.remove("hidden");
    $("result-icon").textContent=win?"★":"✕";
    $("result-title").textContent=win?"作戦成功！":"防衛失敗";
    const failureHint=win?"":waveLeakReport();
    $("result-description").textContent=win?
      (stageIndex<STAGES.length-1?"🔓 次の戦場が解放！":"🏆 全戦場の防衛に成功！"):
      (failureHint||"配置を変えて再挑戦！");

    const stars=state.hp===state.maxHp?3:state.hp>=11?2:1;
    $("result-stats").textContent=
      STAGES[stageIndex].icon+" "+STAGES[stageIndex].name+"　"+(win?"★".repeat(stars):"挑戦中");
    $("result-salvage").textContent="◆ +"+gained+"　 合計 "+commander.points;
    $("retry-button").textContent=win&&stageIndex<STAGES.length-1?"▶ 次のステージへ":win?"▶ ステージ選択":"↻ もう一度";
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
        $("battle-message").textContent=state.active?"防衛作戦進行中":"第"+localWave(state.wave)+"波 突破！";
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
      state.spawnTimer=waveProfile(state.wave).rush?.27:waveProfile(state.wave).swarm?.25:.32;
    }

    enemies.forEach(e=>{
      if(e.alive)moveEnemy(e,dt);
    });

    towers.forEach(t=>{
      t.comboCooldown=Math.max(0,t.comboCooldown-dt);
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
      state.lastWaveReport=waveLeakReport();
      if(!state.lastWaveReport&&state.hp<state.maxHp){
        state.hp=Math.min(state.maxHp,state.hp+1);
        notice("✓ 敵を全員撃破！基地の体力が１回復");
      }
      if(!Object.keys(state.waveLeaks).length)state.suggestedTower=recommendNextWeapon(state.wave+1);
      const cleared=localWave(state.wave);
      state.money+=cleared===2?165:cleared<3?60:Math.min(180,65+cleared*11);
      if(state.hp===state.maxHp)state.money+=cleared<3?20:15;
      state.xp+=15;
      state.wavePlan=null;state.operationName=null;
      const newly=cleared===1?"cannon":cleared===2?"flak":cleared===3?"missile":cleared===4?"radar":null;
      if(newly){notice("🎉 "+DEF[newly].name+" 解放！");sfx("unlock");
        const card=document.querySelector('[data-tower="'+newly+'"]');if(card)card.classList.add("unlocked");
      }else notice("第"+localWave(state.wave)+"波 突破！");
      if(state.wave>=stageEnd()){
        finish(true);return;
      }
    }

    if(!state.active&&state.wave>STAGES[stageIndex].start&&localWave(state.wave)%3===0&&state.xp>=state.xpNeed&&
       towers.some(t=>!t.branch||t.mods.length<2)){
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
      if(ROUTES.some(path=>path.some(p=>Math.hypot(p[0]-x,p[1]-y)<31)))continue;
      const r=6+i%6;
      polygon([[x-r,y+r],[x-r*.7,y-r*.8],[x+r*.7,y-r],[x+r,y+r*.6]],"#213d37","#56715b",1.4);
      polygon([[x-r*.7,y-r*.8],[x,y-r*1.2],[x+r*.7,y-r],[x+2,y]],"#6f886c");
      line(x-r/2,y+r/3,x+r/3,y-r/2,"#8c9d78",1);
    }
  }
  // Each battlefield has its own illustrated geography, architecture and motion.
  // Deterministic decoration: no random layout jitter between animation frames.
  function drawWorld(theme){
    ctx.save();
    if(theme==="canyon"){
      // A copper gorge cut into green rock, with a turquoise river running below.
      const water=ctx.createLinearGradient(0,0,W,0);
      water.addColorStop(0,"#174f57");water.addColorStop(.5,"#3b9b9b");water.addColorStop(1,"#123e49");
      polygon([[0,0],[26,0],[12,520],[0,520]],water);
      for(let j=0;j<13;j++){
        const y=j*43+15;line(2,y,20,y-9,"#b0e9d16c",2);
      }
      const cliffs=[
        [[150,-24],[305,-24],[350,47],[305,90],[193,73],[159,45]],
        [[-30,287],[50,300],[88,385],[65,484],[-30,520]],
        [[205,392],[283,403],[327,520],[154,520],[166,457]]
      ];
      cliffs.forEach((pts,i)=>{
        polygon(pts,"#1d3436","#102c30",4);
        polygon(pts.map(([x,y],k)=>[x+(k%2?7:-10),y-9]),i%2?"#53704d":"#65764d","#9e9362",2);
        for(let k=0;k<5;k++){const p=pts[k%pts.length];line(p[0]+k*8,p[1]+8,p[0]+k*8+21,p[1]+28,"#d8ad7359",2);}
      });
      for(let j=0;j<22;j++){
        const x=(j*79+64)%W,y=(j*137+30)%H;
        if(x<40)continue;
        polygon([[x-12,y+8],[x-7,y-9],[x+7,y-14],[x+15,y+7]],"#263d36","#718665",1);
        polygon([[x-7,y-9],[x+7,y-14],[x+3,y+2]],"#9aa5796e");
      }
      for(const [x,y] of [[42,420],[370,46],[285,88]]){
        circle(x,y,18,"#132d2e66");polygon([[x-14,y+8],[x-4,y-14],[x+7,y-17],[x+17,y+5]],"#72856d","#b8b487",2);
      }
    }else if(theme==="desert"){
      // Sculpted dunes and the remains of a desert military outpost.
      for(let b=0;b<7;b++){
        ctx.beginPath();const y=b*86-35;
        ctx.moveTo(-30,y+25);ctx.bezierCurveTo(65,y-50,125,y+46,210,y-3);
        ctx.bezierCurveTo(305,y-65,350,y+52,425,y-9);
        ctx.lineTo(425,y+68);ctx.lineTo(-30,y+68);ctx.closePath();
        ctx.fillStyle=b%2?"#d9a96d45":"#e8c68a38";ctx.fill();
        ctx.strokeStyle="#f3d29877";ctx.lineWidth=3;ctx.stroke();
      }
      for(const [x,y] of [[40,100],[310,48],[330,410]]){
        // Broken sandstone watchtowers with cast shadows.
        circle(x+10,y+12,27,"#3e38264f");
        polygon([[x-21,y+12],[x-16,y-16],[x+5,y-30],[x+24,y-10],[x+20,y+13]],"#ac8156","#efd1a0",2);
        polygon([[x-9,y+9],[x-7,y-9],[x+7,y-16],[x+10,y+10]],"#654c3b","#d5b383",2);
        for(let i=0;i<3;i++)line(x-17,y-3+i*8,x+17,y-4+i*8,"#7c5f46",1);
      }
      for(let i=0;i<35;i++){
        const x=(i*79+23)%W,y=(i*109+7)%H;
        circle(x,y,2+i%3,"#e5c79766");
        if(i%3===0){line(x-9,y+4,x+11,y,"#fce0ad58",1.5);}
      }
      for(const [x,y] of [[70,480],[235,59]]){
        circle(x,y,24,"#59735a44");
        line(x,y+8,x+2,y-17,"#654734",5);
        for(let n=0;n<6;n++){
          const a=n*Math.PI/3;line(x+2,y-18,x+Math.cos(a)*23,y-18+Math.sin(a)*11,"#486b4d",5);
        }
      }
      // Wind-driven grains always travel diagonally, not as a full screen filter.
      for(let i=0;i<12;i++){
        const x=((i*73+ambientTime*15)%460)-30,y=(i*53+91)%520;
        line(x,y,x+12,y-3,"#ffe2ab64",1.3);
      }
    }else if(theme==="snow"){
      // Frozen lake, blue glacier walls and dark alpine conifers.
      const lake=ctx.createLinearGradient(0,330,180,520);
      lake.addColorStop(0,"#6ab4c0");lake.addColorStop(1,"#225c79");
      polygon([[0,360],[90,353],[136,399],[185,520],[0,520]],lake,"#e0ffff",3);
      for(let i=0;i<9;i++){
        const x=12+i*21,y=388+i*13;
        line(x,y,x+20,y+8,"#c7faff88",2);line(x+8,y-4,x+17,y+11,"#d5ffff66",1);
      }
      const walls=[
        [[-25,-20],[155,-20],[125,61],[56,95],[-25,83]],
        [[247,330],[408,297],[420,530],[262,535],[244,410]]
      ];
      walls.forEach((p,i)=>{
        polygon(p,"#2c5e76","#b4e7ec",4);
        polygon(p.map(([x,y],n)=>[x+(n%2?9:-8),y-12]),"#96cdd6","#e8ffff",2);
        for(let j=1;j<5;j++){const q=p[j%p.length];polygon([[q[0]-10,q[1]+10],[q[0]+7,q[1]-16],[q[0]+19,q[1]+5]],j%2?"#e5faf6":"#70adc2");}
      });
      for(let i=0;i<25;i++){
        const x=(i*71+19)%W,y=(i*113+29)%H;
        if(x<20&&y>340)continue;
        circle(x+3,y+6,10,"#214c5777");
        polygon([[x-10,y+7],[x,y-20],[x+10,y+7]],"#1e5361","#b4dadd",1);
        polygon([[x-8,y-1],[x,y-27],[x+8,y-1]],"#437d80","#d3f4ed",1);
        line(x,y+7,x,y+12,"#4f747b",3);
      }
      for(let i=0;i<35;i++){
        const x=((i*89+ambientTime*(7+i%3*4))%420)-15;
        const y=(i*69+ambientTime*11)%540;
        circle(x,y,1+i%3*.45,"#ffffffac");
      }
    }else if(theme==="factory"){
      // A fortified industrial foundry: metal floors, molten channels, fans and pipes.
      ctx.strokeStyle="#9bb3ba31";ctx.lineWidth=1.5;
      for(let x=0;x<W;x+=48)line(x,0,x,H,"#8ba6a731",1.5);
      for(let y=0;y<H;y+=46)line(0,y,W,y,"#8ba6a731",1.5);
      const flow=ctx.createLinearGradient(0,0,80,0);
      flow.addColorStop(0,"#742f22");flow.addColorStop(.5,"#ff7b32");flow.addColorStop(1,"#65251e");
      polygon([[8,-5],[47,-5],[78,520],[19,520]],flow,"#4b2d2c",5);
      for(let i=0;i<18;i++){
        const y=(i*33+ambientTime*19)%535;
        line(33,y,57,y+7,"#ffe89c88",3);
      }
      for(const [x,y,r] of [[275,58,33],[58,324,36],[335,402,23]]){
        circle(x+7,y+8,r+5,"#0d1820b0");circle(x,y,r+4,"#242f37");
        circle(x,y,r,"#52626b");circle(x,y,r*.72,"#192b35");
        ctx.save();ctx.translate(x,y);ctx.rotate(ambientTime*.7);
        for(let j=0;j<5;j++){
          const a=j*Math.PI*2/5;
          polygon([[0,0],[Math.cos(a)*r*.65-8,Math.sin(a)*r*.65-4],[Math.cos(a)*r*.9+4,Math.sin(a)*r*.9+10]],"#81969c");
        }ctx.restore();circle(x,y,6,"#b5d1d2");
      }
      for(const [x,y,w] of [[172,40,85],[184,490,64],[335,335,80]]){
        rounded(x-w/2,y-8,w,16,3,"#172832");
        rounded(x-w/2,y-6,w,9,3,"#70818a");
        for(let i=0;i<w;i+=17)circle(x-w/2+i+5,y-1,2,"#c1d3d2");
      }
      for(const [x,y] of [[100,40],[351,99],[47,464]]){
        circle(x,y,18,"#263b46");circle(x,y,10,"#ed8d46");
        circle(x,y,4+Math.sin(ambientTime*4)*2,"#fff09c");
      }
    }
    ctx.restore();
  }
  function drawRoadMarkings(theme){
    // Material details follow each piece of the path, making every map tangible.
    ctx.save();
    for(const path of ROUTES)for(let k=0;k<path.length-1;k++){
      const [x1,y1]=path[k], [x2,y2]=path[k+1];
      const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1;
      for(let d=23;d<len-9;d+=theme==="factory"?28:42){
        const x=x1+dx*d/len,y=y1+dy*d/len;
        ctx.save();ctx.translate(x,y);ctx.rotate(Math.atan2(dy,dx));
        if(theme==="factory"){
          rounded(-5,-23,10,45,1,"#31414b4d");
          line(-7,-23,7,-23,"#ffbc56b2",2);line(-7,23,7,23,"#ffbc56b2",2);
          circle(0,-28,2,"#c6d9e0");circle(0,28,2,"#c6d9e0");
        }else if(theme==="snow"){
          line(-4,-24,4,-24,"#ebffffbc",3);line(-4,24,4,24,"#ebffffbc",3);
          line(-8,-15,8,-15,"#6a91a65c",1);
        }else if(theme==="desert"){
          line(-12,-23,10,-23,"#f7dfad7d",2);
          line(-12,23,10,23,"#f7dfad7d",2);
        }else{
          circle(0,-27,3,"#d0b67c");circle(0,27,3,"#d0b67c");
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }
  function drawTerrain() {
    const theme=STAGES[stageIndex].theme;
    const palettes={canyon:["#344d43","#405d4d","#1c3c37"],desert:["#66543f","#8b7650","#4b5140"],snow:["#455f68","#8bafaf","#253f52"],factory:["#3a424b","#56605c","#222e3b"]};
    const colors=palettes[theme];
    const ground=ctx.createLinearGradient(0,0,W,H);
    ground.addColorStop(0,colors[0]);ground.addColorStop(.55,colors[1]);ground.addColorStop(1,colors[2]);
    ctx.fillStyle=ground;ctx.fillRect(0,0,W,H);
    // Strongly visible tactical map grid.
    ctx.strokeStyle="#b5d8ab0c";ctx.lineWidth=1;
    for(let x=0;x<=W;x+=32)line(x,0,x,H,"#d9f2db10");
    for(let y=0;y<=H;y+=32)line(0,y,W,y,"#d9f2db10");
    if(theme==="canyon")terrainTexture();
    ctx.save();ctx.scale(1,H/520);drawWorld(theme);ctx.restore();
    ctx.lineCap="round";ctx.lineJoin="round";
    for(let pathNo=0;pathNo<ROUTES.length;pathNo++){
      ctx.beginPath();
      ROUTES[pathNo].forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
      ctx.strokeStyle=theme==="factory"?"#101b25":"#142e2edb";ctx.lineWidth=67;ctx.stroke();
      ctx.strokeStyle=theme==="snow"?"#cce8e9":theme==="desert"?"#94744d":theme==="factory"?"#d49d47":"#647d63";ctx.lineWidth=61;ctx.stroke();
      ctx.strokeStyle=theme==="snow"?"#72939f":theme==="desert"?"#9d805b":theme==="factory"?"#44535e":"#77694f";ctx.lineWidth=51;ctx.stroke();
      ctx.strokeStyle=theme==="snow"?"#a6c5cc":theme==="factory"?"#6e7f89":theme==="desert"?"#c2a372":"#b7a47c";ctx.lineWidth=44;ctx.stroke();
      ctx.strokeStyle=theme==="snow"?"#b9d4d9":theme==="factory"?"#87949c":theme==="desert"?"#e0bc82":"#c9ba95";ctx.lineWidth=36;ctx.stroke();
      ctx.strokeStyle=pathNo?"#8bece9b0":theme==="factory"?"#ffbd5988":theme==="snow"?"#f0ffffac":"#f8e3a164";
      ctx.lineWidth=pathNo?2.7:1.6;ctx.setLineDash(pathNo?[5,9]:[10,12]);ctx.stroke();ctx.setLineDash([]);
    }
    drawRoadMarkings(theme);
    // Danger line across the entry point.
    ctx.save();ctx.translate(14,PATH[0][1]);ctx.rotate(-Math.PI/2);
    ctx.fillStyle="#f46d55";ctx.fillRect(-13,-24,26,5);
    ctx.font="bold 10px Rajdhani,sans-serif";ctx.textAlign="center";ctx.fillStyle="#ffd6ad";
    ctx.fillText("HOSTILE ENTRY",0,-32);ctx.restore();
    ctx.fillStyle="#ff7659";ctx.beginPath();
    ctx.moveTo(12,PATH[0][1]);ctx.lineTo(-2,PATH[0][1]-9);ctx.lineTo(-2,PATH[0][1]+9);ctx.closePath();ctx.fill();
    // Military edge vignette.
    const v=ctx.createRadialGradient(W/2,H/2,145,W/2,H/2,420);
    v.addColorStop(0,"#061a1700");v.addColorStop(1,"#06151575");
    ctx.fillStyle=v;ctx.fillRect(0,0,W,H);
    // Strategic markers.
    ctx.fillStyle="#e1efca80";ctx.font="bold 9px Rajdhani,sans-serif";ctx.textAlign="left";
    // 地図の飾り英字は意味のない読解負荷になるため表示しない。
  }
  function drawPads() {
    PADS.forEach(([x,y],i)=>{
      const occupied=towerAt(i);if(occupied)return;
      const pulse=.5+Math.sin(performance.now()/400+i)*.18;
      const suggested=localWave(state.wave)===0&&towers.length===0&&i===2;
      ctx.save();ctx.translate(x,y);
      circle(2,5,22,"#0b292c8a");
      rounded(-19,-19,38,38,5,"#182e32");
      rounded(-16,-16,32,32,4,"#264d49");
      ctx.strokeStyle=suggested?"#f6ef9d":"rgba(129,234,213,"+pulse+")";ctx.lineWidth=suggested?2.7:1.7;
      ctx.strokeRect(-14,-14,28,28);
      line(-8,0,8,0,"#8af8db",2.6);line(0,-8,0,8,"#8af8db",2.6);
      ctx.strokeStyle="#7ddfce88";
      line(-21,-21,-11,-21,"#7ddfce",2);line(-21,-21,-21,-11,"#7ddfce",2);
      line(21,21,11,21,"#7ddfce",2);line(21,21,21,11,"#7ddfce",2);
      if(suggested){
        const bob=Math.sin(ambientTime*5)*3;
        rounded(-45,-52+bob,90,21,6,"#e6efb7");
        ctx.font="bold 11px 'Noto Sans JP',sans-serif";ctx.textAlign="center";ctx.fillStyle="#1a382e";
        ctx.fillText("まずはここ！",0,-37+bob);
      }
      ctx.restore();
    });
  }
  function drawPadPreview(){
    if(hoverPad<0||towerAt(hoverPad)||!unlocked(selectedType))return;
    const [x,y]=PADS[hoverPad],trait=PAD_TRAITS[hoverPad];
    const radius=DEF[selectedType].range*state.globalRange*(trait==="high"?1.30:trait==="guard"?.95:1);
    ctx.save();
    ctx.fillStyle="#8cebc50d";ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#9af9d9b8";ctx.lineWidth=1.5;ctx.setLineDash([7,6]);
    ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle="#102b2bea";ctx.fillRect(Math.max(4,Math.min(W-160,x-79)),Math.max(7,y-56),158,23);
    ctx.fillStyle="#e0ffeb";ctx.font="bold 10px 'Noto Sans JP',sans-serif";ctx.textAlign="center";
    ctx.fillText(padTrait(hoverPad).name+"："+padTrait(hoverPad).desc,Math.max(83,Math.min(W-83,x)),Math.max(23,y-40));
    ctx.restore();
  }
  // Small-scale painted miniature materials. Keep broad highlights visible at phone size.
  function steelPlate(x,y,w,h,r,top,bottom,edge="#172c32"){
    const metal=ctx.createLinearGradient(x,y,x+w*.45,y+h);
    metal.addColorStop(0,top);metal.addColorStop(.43,top);
    metal.addColorStop(1,bottom);
    rounded(x,y+2,w,h,r,edge);
    rounded(x,y,w,h-2,r,metal);
    line(x+4,y+3,x+w-6,y+3,"#ffffff55",1.5);
    line(x+w-3,y+5,x+w-3,y+h-5,"#00191d77",2);
  }
  function rivet(x,y,color="#ecf5d7"){
    circle(x+1,y+1,2.1,"#081c22");circle(x,y,1.6,color);
    circle(x-.5,y-.5,.55,"#ffffff");
  }
  function metalBar(x,y,w,h,top,bottom){
    const g=ctx.createLinearGradient(x,y,x+w,y);
    g.addColorStop(0,bottom);g.addColorStop(.22,top);g.addColorStop(.6,top);g.addColorStop(1,bottom);
    rounded(x,y,w,h,2,g);
    line(x+2,y+2,x+w-2,y+2,"#ffffff88",1);
  }
  function radialLamp(x,y,r,color){
    ctx.save();ctx.shadowColor=color;ctx.shadowBlur=11;
    circle(x,y,r+2,"#122932");circle(x,y,r,color);
    circle(x-r*.24,y-r*.27,r*.36,"#fffef2");ctx.restore();
  }
  function drawWeaponEvolution(t,size){
    if(!t.branch)return;
    const glow=t.awakened?"#ffe49a":t.branch==="tesla"||t.branch==="empfield"?"#c5a7ff":t.type==="flak"?"#9befff":t.type==="cannon"?"#ffb978":t.type==="missile"?"#ffce79":"#83eeff";
    ctx.save();
    ctx.shadowColor=glow;ctx.shadowBlur=t.awakened?14:8;
    const flank=size*.39;
    if(t.branch==="gatling"){
      // Spinning muzzle ring and twin ammo feeder drums.
      for(const side of [-1,1]){rounded(side*flank-4,-11,8,20,3,"#788e70");circle(side*flank,0,4,"#dfaa57");}
      ctx.strokeStyle="#ffd078";ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,-size*.30,8,ambientTime*16,ambientTime*16+Math.PI*1.6);ctx.stroke();
    }else if(t.branch==="rail"){
      for(const side of [-1,1]){rounded(side*flank-5,-29,10,36,3,"#245b81");line(side*flank,-32,side*flank,-3,"#89e9ff",3);}
      circle(0,-size*.34,6+Math.sin(ambientTime*12)*2,"#b5f8ff");
    }else if(t.branch==="tesla"){
      for(const side of [-1,1]){rounded(side*flank-6,-20,12,30,4,"#63568e");for(let j=0;j<4;j++)line(side*flank-6,-18+j*8,side*flank+6,-18+j*8,"#d4b6ff",2);circle(side*flank,-25,5,"#e2c2ff");}
      line(-flank,-25,0,-34,"#f2deff",2);line(0,-34,flank,-25,"#f2deff",2);
    }else if(t.branch==="cluster"||t.branch==="incendiary"){
      const hot=t.branch==="incendiary";
      for(const side of [-1,1]){
        rounded(side*flank-7,-20,14,30,4,hot?"#913f27":"#ad8954");
        for(let j=0;j<3;j++)circle(side*flank,-15+j*8,3,hot?"#ff864a":"#ffe3a0");
      }
    }else if(t.branch==="bunker"){
      rounded(-9,-size*.53,18,27,4,"#a9a187");
      polygon([[-9,-size*.48],[0,-size*.65],[9,-size*.48]],"#ffb56c");
      for(const side of [-1,1])rounded(side*flank-5,-15,10,23,3,"#c8a572");
    }else if(t.branch==="swarm"){
      for(const side of [-1,1])for(let j=0;j<3;j++){
        const x=side*flank,y=-23+j*12;
        rounded(x-5,y-4,10,13,3,"#926b50");
        polygon([[x-4,y],[x,y-9],[x+4,y]],"#ffdc87");
      }
    }else if(t.branch==="skywall"||t.branch==="shrapnel"){
      for(const side of [-1,1]){
        rounded(side*flank-5,-32,10,37,3,"#408ba6");
        line(side*flank,-40,side*flank,-7,"#c7faff",3);
        circle(side*flank,-40,t.branch==="skywall"?6:3,"#a7ecff");
      }
    }else if(t.branch==="empfield"||t.branch==="targetlock"){
      ctx.strokeStyle=t.branch==="empfield"?"#bcaaff":"#92f4ff";ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,0,flank,ambientTime*1.8,ambientTime*1.8+Math.PI*1.4);ctx.stroke();
      for(const side of [-1,1])circle(side*flank,-12,4,glow);
    }
    if(t.awakened){
      ctx.strokeStyle="#ffe49a";ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,0,size*.54,ambientTime*.6,ambientTime*.6+Math.PI*1.7);ctx.stroke();
      for(let n=0;n<4;n++){const a=ambientTime*.8+n*Math.PI/2;circle(Math.cos(a)*size*.54,Math.sin(a)*size*.54,3,"#fff7bd");}
    }
    ctx.restore();
  }
  function drawTower(t) {
    const color=t.type==="radar"?"#5ed9e5":t.type==="flak"?"#88e7ff":t.type==="missile"?"#f3bd75":t.type==="cannon"?"#f2c77a":"#9fe1c1";
    ctx.save();ctx.translate(t.x,t.y);
    const sprite=turretArt[t.type];
    const painted=!!(sprite?.complete&&sprite.naturalWidth);
    if(painted){
      ctx.save();
      ctx.shadowColor="#06131bd9";ctx.shadowBlur=11;ctx.shadowOffsetY=5;
      ctx.rotate(t.angle+Math.PI/2);
      ctx.translate(0,t.recoil*4);
      const size=t.awakened?69:t.branch?65:59;
      ctx.drawImage(sprite,-size/2,-size/2,size,size);
      drawWeaponEvolution(t,size);
      ctx.shadowBlur=0;ctx.shadowOffsetY=0;
      if(t.glow>0){
        circle(0,-size*.38,7+t.glow*24,"#ffdc80");
        circle(0,-size*.38,3,"#fff6bc");
      }
      ctx.restore();
    }else{
    // Chassis does not rotate. Turrets swivel independently and genuinely recoil.
    ctx.save();ctx.scale(1,1.02);
    ctx.shadowColor="#06131bd9";ctx.shadowBlur=13;ctx.shadowOffsetY=9;
    rounded(-23,-20,46,45,8,"#0b222c");
    ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    for(const side of [-1,1]){
      const x=side<0?-25:18;
      steelPlate(x,-19,7,40,3,"#4e6465","#192b34");
      for(let y=-14;y<20;y+=7)line(x+1,y,x+6,y,"#a4b7a4",1.4);
    }
    steelPlate(-20,-20,40,41,6,"#7b9487","#355f5c");
    steelPlate(-15,-14,30,27,4,"#587a74","#253f49");
    polygon([[-19,15],[-13,22],[13,22],[19,15]],"#203b3f","#9bb1a2",1);
    [-16,16].forEach(x=>{rivet(x,-16);rivet(x,17);});
    rounded(-13,16,26,3,1,"#c7d8bc");
    ctx.restore();
    ctx.save();ctx.rotate(t.angle+Math.PI/2);ctx.translate(0,t.recoil*5);
    // Cast circular bearing and segmented retaining bolts.
    circle(0,0,18,"#172f37");circle(0,-2,16,"#89a79d");circle(0,-3,13,"#294b55");
    for(let k=0;k<8;k++){const a=k*Math.PI/4;rivet(Math.cos(a)*15,Math.sin(a)*15-2,"#bcd0bb");}
    if(t.type==="machinegun"){
      steelPlate(-13,-13,26,24,6,"#90b59a","#315a52");
      for(const x of [-11,11]){rivet(x,-9,"#ffe1a4");rivet(x,7,"#ffe1a4");}
      if(t.branch==="rail"){
        // Massive electric accelerator, entirely different silhouette from a gun.
        rounded(-15,-13,30,27,6,"#123b54");
        rounded(-11,-48,22,43,4,"#207baa");
        rounded(-7,-56,14,48,3,"#a8ebff");
        rounded(-3,-60,6,48,2,"#f0ffff");
        [-36,-24,-12].forEach(y=>{rounded(-15,y,30,5,2,"#1c4e71");circle(-13,y+2,3,"#7be5ff");circle(13,y+2,3,"#7be5ff")});
        circle(0,-54,7+Math.sin(ambientTime*10)*2,"#78e7ff");
        circle(0,-54,3,"#fff");
        for(const x of [-16,16]){
          steelPlate(x-4,-48,8,41,3,"#67bbd7","#1c586f");
          [-40,-29,-18].forEach(y=>radialLamp(x,y,1.5,"#a7f6ff"));
        }
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
        ctx.strokeStyle="#eee0ff";ctx.lineWidth=1.6;
        for(let k=0;k<2;k++){
          const y=-27-k*8;line(-13,y,0,y-5,"#d4b1ff",1.5);line(0,y-5,13,y,"#d4b1ff",1.5);
        }
      }else{
      const barrels=t.awakened&&t.branch==="gatling"?8:t.branch==="gatling"?4:t.level>=5?4:t.level>=3?2:1;
      for(let k=0;k<barrels;k++){const x=(k-(barrels-1)/2)*(barrels>=8?4:7);
        rounded(x-3,-40,6,37,1,"#1b343c");
        metalBar(x-2,-43,4,39,"#ecf1d6","#6d9a91");
        circle(x,-42,3.6,"#152930");circle(x,-42,2,"#f0eac6");circle(x,-42,1,"#162b33");
      }
      if(barrels>=4){
        for(const y of [-34,-19])steelPlate(-13,y,26,5,2,"#c5cf9e","#5b7769");
        circle(0,-9,10,"#2c4549");circle(0,-9,7,"#b2c8a9");
        const spin=ambientTime*(t.branch==="gatling"?17:5);
        for(let k=0;k<4;k++){const a=spin+k*Math.PI/2;circle(Math.cos(a)*5,Math.sin(a)*5-9,2.3,"#446b68");}
      }else{
        steelPlate(-7,-20,14,13,3,"#9db8a9","#345f5a");
      }
      if(t.glow>0){circle(0,-35,8+t.glow*30,"#ffe49a");circle(0,-35,4,"#ffb43d");}
      rounded(-8,-11,16,13,3,t.branch==="rail"?"#77d6ec":t.branch==="tesla"?"#b7a4ff":"#91b8a3");
      if(t.branch==="rail"){rounded(-6,-45,12,28,2,"#69c7ed");circle(0,-45,6,"#b6faff");}
      if(t.branch==="tesla"){ctx.strokeStyle="#bcaaff";ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(0,-18,17,Math.PI*1.05,Math.PI*1.95);ctx.stroke();circle(0,-33,5,"#e4d6ff");}
      }
      radialLamp(-13,8,2.7,"#bdf3ab");radialLamp(13,8,2.7,"#bdf3ab");
    }else if(t.type==="cannon"){
      steelPlate(-15,-16,30,33,6,"#b2a77e","#555c51");
      polygon([[-18,-8],[-11,-17],[11,-17],[18,-8],[17,7],[-17,7]],"#797b66","#d9cba1",1.6);
      const barrels=t.level>=5?2:1;
      for(let j=0;j<barrels;j++){
        const x=(j-(barrels-1)/2)*12;
        rounded(x-8,-43,16,43,4,"#27343a");
        metalBar(x-6,-48,12,46,"#ecd4a0","#806f57");
        steelPlate(x-8,-32,16,9,2,"#c5b18a","#4a5958");
        circle(x,-47,7.5,"#f4dcaa");circle(x,-47,5.5,"#28353a");
        circle(x-2,-49,1.7,"#aebdc0");
      }
      steelPlate(-12,-10,24,20,5,"#c8c29d","#687c6b");
      circle(0,-6,6,"#506b5d");
      radialLamp(-13,4,2.2,"#ffc870");radialLamp(13,4,2.2,"#ffc870");
      for(let j=0;j<4;j++){const a=j*Math.PI/2+ambientTime*.25;circle(Math.cos(a)*10,Math.sin(a)*10-5,2,"#fff4d3");}
      if(t.branch==="cluster"){
        for(const x of [-17,17]){rounded(x-4,-19,8,24,3,"#e8be72");circle(x,-18,4,"#fff1bd");}
      }
      if(t.branch==="incendiary"){
        for(const x of [-16,16]){rounded(x-4,-16,8,21,3,"#9e4127");circle(x,-13,4,"#ffb359");}
        circle(0,-30,4+Math.sin(ambientTime*8)*2,"#ff7c3c");
      }
    }else if(t.type==="flak"){
      // Sweeping twin anti-air barrels with high-speed pulse coils.
      steelPlate(-18,-18,36,35,5,"#7ab8c1","#214d61");
      steelPlate(-13,-16,26,26,4,"#55acbd","#1d495d");
      for(const x of [-10,10]){
        rounded(x-6,-47,12,43,3,"#153d51");
        metalBar(x-4,-54,8,48,"#d1fbff","#427b93");
        for(let j=0;j<4;j++)steelPlate(x-7,-41+j*9,14,4,1,"#91e6f0","#316c86");
        circle(x,-53,5,"#b5eaf2");circle(x,-53,3.1,"#133d50");
        circle(x,-53,1.4,"#ecffff");
      }
      steelPlate(-11,-12,22,23,4,"#76c8d3","#21576a");
      circle(0,-8,7,"#174255");radialLamp(0,-8,4.5,"#72e7ff");
      for(const x of [-20,20]){polygon([[x-2,-13],[x,-24],[x+4,-13]],"#9de5e9");rivet(x,5,"#ceebf0");}
      if(t.branch==="skywall"){
        for(const x of [-23,23]){rounded(x-3,-24,6,32,2,"#abeffe");circle(x,-27,5,"#75dfff");}
        circle(0,-7,7+Math.sin(ambientTime*12)*2,"#d4fcff");
      }
      if(t.branch==="shrapnel"){
        for(const x of [-21,21]){
          polygon([[x-5,-11],[x,-37],[x+5,-11]],"#65c8e8");
          circle(x,-37,4,"#c4f8ff");
        }
      }
    }else if(t.type==="missile"){
      steelPlate(-20,-18,40,35,5,"#aaa78c","#465b56");
      steelPlate(-18,-23,36,38,4,"#879b8a","#263f4b");
      polygon([[-17,-17],[0,-27],[17,-17],[17,6],[0,14],[-17,6]],"#586f6b","#d0c9a4",1);
      for(let ix=-1;ix<=1;ix++)for(let iy=0;iy<2;iy++){
        const x=ix*11,y=iy*12-13;
        steelPlate(x-5,y-5,10,15,3,"#b8c5b2","#4b656a");
        polygon([[x-4,y-1],[x,y-12],[x+4,y-1]],"#ffe1aa","#ca8057",1);
        rounded(x-3,y-2,6,9,2,"#c66c48");
        circle(x,y+5,2,"#2c4546");
      }
      for(const x of [-17,17])radialLamp(x,12,2.5,"#ffc16e");
      steelPlate(-16,10,32,7,2,"#d7cba5","#4f6666");
      if(t.branch==="bunker"){
        steelPlate(-11,-30,22,33,4,"#b7ad88","#314958");
        polygon([[-10,-25],[0,-47],[10,-25]],"#ffe3a7","#bd7953",2);
        metalBar(-5,-28,10,27,"#edb878","#aa5b46");
        for(const x of [-8,8])rivet(x,-8,"#ffe6ad");
      }
      if(t.branch==="swarm"){
        for(const x of [-23,23])for(const y of [-15,0]){
          polygon([[x-3,y],[x,y-12],[x+3,y]],"#ffe7a7");
          circle(x,y+3,3,"#e67f4d");
        }
      }
    }else{
      // Radar is a rotating emitter, not a gun: dish, antennas, scanning LEDs.
      steelPlate(-17,-16,34,31,5,"#7cacb4","#24576b");
      steelPlate(-12,-14,24,23,4,"#407d92","#193c54");
      for(const x of [-17,17]){
        metalBar(x-3,-39,6,35,"#d3faff","#44798c");
        radialLamp(x,-40,3.5,"#9df9ff");
      }
      ctx.strokeStyle="#1b4356";ctx.lineWidth=9;
      ctx.beginPath();ctx.arc(0,-17,22,Math.PI*1.05,Math.PI*1.95);ctx.stroke();
      ctx.strokeStyle="#b2f7fc";ctx.lineWidth=5;
      ctx.beginPath();ctx.arc(0,-17,22,Math.PI*1.05,Math.PI*1.95);ctx.stroke();
      ctx.strokeStyle="#e8ffff";ctx.lineWidth=1.4;
      ctx.beginPath();ctx.arc(0,-17,18,Math.PI*1.08,Math.PI*1.92);ctx.stroke();
      for(let k=0;k<5;k++){
        const x=(k-2)*8;line(x,-34,x*.6,-17,"#6be1ed",1);
      }
      line(0,-17,0,-34,"#ecffff",2);
      circle(0,-17,8,"#18495d");radialLamp(0,-17,4.3,"#abf8fa");
      const sweep=ambientTime*2.7;
      const sx=Math.cos(sweep)*13,sy=Math.sin(sweep)*11-16;
      line(0,-17,sx,sy,"#a5fff0a8",2.6);
      if(t.branch==="empfield"){
        ctx.strokeStyle="#a998ff";ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(0,-15,27,Math.PI*1.08,Math.PI*1.92);ctx.stroke();
        circle(0,-33,6,"#d6beff");
      }
      if(t.branch==="targetlock"){
        for(const x of [-21,21]){
          line(x,-19,x,-37,"#92f0ff",3);
          circle(x,-38,4,"#f1ffff");
        }
      }
    }
    ctx.restore();
    }
    // Tactical class LEDs, deliberately color-coded but never reliant on color alone.
    for(const side of [-1,1]){
      ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=5;
      ctx.fillRect(side<0?-21:18,-17,3,11);
    }
    ctx.shadowBlur=0;
    const synergy=fusionFor(t);
    if(synergy){
      ctx.strokeStyle=synergy.info.color;ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(0,0,29+Math.sin(ambientTime*3)*1.5,0,Math.PI*2);ctx.stroke();
      rounded(-15,-31,30,11,3,"#102c34");
      ctx.fillStyle=synergy.info.color;ctx.font="bold 9px Rajdhani,sans-serif";ctx.textAlign="center";
      ctx.fillText(synergy.info.tag,0,-23);
    }
    if(t.evolution||t.branch){
      ctx.strokeStyle=t.awakened?"#ffdd75":t.branch==="tesla"?"#ae9bff":t.branch==="rail"?"#72eaff":"#fcb85d";ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,0,25,0,Math.PI*2);ctx.stroke();
      circle(18,-17,5,"#ffd774");
    }
    rounded(-14,18,28,12,3,"#112b2d");
    ctx.fillStyle="#e9fcf2";ctx.font="900 10px Rajdhani,sans-serif";ctx.textAlign="center";
    ctx.fillText((t.type==="machinegun"?"MG":t.type==="cannon"?"ART":t.type==="flak"?"AA":t.type==="missile"?"MSL":"EW")+" "+t.level,0,27);
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
    if(e.markTime>0){
      ctx.strokeStyle="#7aecff";ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(0,0,r+5,Math.PI*1.17,Math.PI*1.87);ctx.stroke();
      line(-6,0,6,0,"#7aecff88",1);line(0,-6,0,6,"#7aecff88",1);
    }
    if(e.elite||large){
      ctx.fillStyle="#ffe3ae";ctx.font="900 10px Rajdhani,sans-serif";ctx.textAlign="center";
      ctx.fillText(large?"⚠ COMMANDER":"★ ELITE",0,-r-15);
    }
    ctx.restore();
  }
  function draw() {
    ctx.clearRect(0,0,W,VIEW_H);
    ctx.save();ctx.translate(0,-cameraY);
    if(kick>0)ctx.translate((Math.random()-.5)*kick*2,(Math.random()-.5)*kick*2);
    drawTerrain();
    drawPadPreview();
    drawPads();

    const selected=towerAt(selectedPad);
    if(selected && (!state.active||state.paused)){
      ctx.fillStyle="#63d9c408";ctx.beginPath();ctx.arc(selected.x,selected.y,selected.range,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="#a6f6d25a";ctx.lineWidth=1.3;ctx.setLineDash([7,8]);
      ctx.beginPath();ctx.arc(selected.x,selected.y,selected.range,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    }

    towers.forEach(t=>{
      const fusion=fusionFor(t);if(!fusion)return;
      ctx.save();ctx.strokeStyle=fusion.info.color;ctx.globalAlpha=.24+Math.sin(ambientTime*3)*.08;
      ctx.lineWidth=2;ctx.setLineDash([5,6]);line(t.x,t.y,fusion.partner.x,fusion.partner.y,fusion.info.color,2);ctx.restore();
    });
    towers.forEach(drawTower);
    enemies.forEach(drawEnemy);

    bullets.forEach(b=>{
      const dx=b.x-b.px,dy=b.y-b.py,m=Math.hypot(dx,dy)||1;
      const len=b.type==="missile"?(b.source.branch==="bunker"?40:26):b.type==="cannon"?15:b.type==="flak"?19:12;
      const tx=b.x-dx/m*len,ty=b.y-dy/m*len;
      ctx.strokeStyle=b.type==="missile"?"#ff7b46":b.type==="cannon"?"#ffe49e":b.type==="flak"?"#60e7ff":"#f6f5d8";
      ctx.lineWidth=b.type==="missile"?(b.source.branch==="bunker"?9:5):b.type==="cannon"?3:b.type==="flak"?3:2;
      line(tx,ty,b.x,b.y,ctx.strokeStyle,ctx.lineWidth);
      circle(b.x,b.y,b.type==="missile"?5:3,b.type==="flak"?"#e8ffff":"#fff6ce");
      if(b.type==="missile"){
        circle(tx,ty,b.source.awakened?12:8,"#ff913b44");circle(tx+2,ty+2,4,"#ffb53f");
        if(b.source.branch==="swarm")line(tx-dy/m*5,ty+dx/m*5,b.x,b.y,"#ffe79f",1.8);
      }
      if(b.type==="flak"){circle(tx,ty,6,"#69e9ff48");}
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
    casings.forEach(p=>{ctx.save();ctx.globalAlpha=Math.min(1,p.life*3);ctx.translate(p.x,p.y);ctx.rotate(p.angle);
      rounded(-p.size/2,-1.3,p.size,2.6,1,p.color);line(-p.size/3,-.5,p.size/3,-.5,"#fff6d2",.8);ctx.restore();});
    flashes.forEach(p=>{ctx.save();ctx.globalAlpha=Math.min(1,p.life*8);
      ctx.translate(p.x,p.y);ctx.rotate(p.angle||0);ctx.shadowBlur=13;ctx.shadowColor=p.color;
      circle(0,0,p.size*.6,"#fff7cc");circle(0,0,p.size,"#ffb55f66");
      polygon([[p.size*1.65,0],[0,-p.size*.40],[-p.size*.85,0],[0,p.size*.40]],p.color);
      polygon([[0,-p.size*.85],[p.size*.3,0],[0,p.size*.85],[-p.size*.3,0]],"#fff9da");ctx.restore();});
    effects.forEach(p=>{
      ctx.globalAlpha=Math.max(0,p.life/p.max);
      circle(p.x,p.y,p.size,p.color);
    });
    ctx.globalAlpha=1;

    // Base
    ctx.save();ctx.translate(0,PATH.at(-1)[1]-160);ctx.shadowColor="#78edd366";ctx.shadowBlur=20;
    rounded(339,119,48,61,5,"#0d3030");
    ctx.shadowBlur=0;
    rounded(345,125,36,48,4,"#4c8884");
    rounded(351,115,23,19,3,"#274647");
    ctx.strokeStyle="#90f5de";ctx.lineWidth=2;ctx.strokeRect(345,125,36,48);
    ctx.fillStyle="#e4fff0";ctx.font="bold 10px 'Noto Sans JP',sans-serif";
    ctx.textAlign="center";ctx.fillText("基地",364,155);
    ctx.fillStyle="#b2ffe2";ctx.fillRect(353,163,22,3);
    ctx.restore();
    if(screenFlash>0){ctx.save();ctx.globalAlpha=Math.min(.45,screenFlash*.4);ctx.fillStyle="#fff7da";ctx.fillRect(0,0,W,H);ctx.restore();}
    if(comboClock>0&&combo>=3){ctx.save();ctx.textAlign="center";ctx.font="900 23px Rajdhani,sans-serif";
      ctx.strokeStyle="#102529";ctx.lineWidth=5;ctx.strokeText(combo+" COMBO",W/2,44);
      ctx.fillStyle=combo>=20?"#ffd45b":"#b9fff0";ctx.fillText(combo+" COMBO",W/2,44);ctx.restore();}
    ctx.restore();
    const thumb=$("map-scroll-thumb");
    if(thumb)thumb.style.top=Math.round(cameraY/(H-VIEW_H)*29)+"px";
    const up=$("map-up"),down=$("map-down");
    if(up)up.disabled=cameraY<2;
    if(down)down.disabled=cameraY>=H-VIEW_H-2;
  }

  function updateUI() {
    $("stage-caption").textContent=STAGES[stageIndex].icon+" "+STAGES[stageIndex].name;
    const labButton=$("dock-lab-button");
    if(labButton)labButton.textContent="🗺 ステージ";
    const nextButton=$("quick-next-wave");
    if(nextButton){
      const showNext=state.wave>0&&!state.active&&!state.choosing&&!state.finished;
      nextButton.classList.toggle("hidden",!showNext);
      if(showNext)nextButton.textContent="▶ 第"+(localWave(state.wave)+1)+"波へ進む";
    }
        $("base-hp").textContent=state.hp+" / "+state.maxHp;
    $("credits").textContent=state.money+" G";
    guide();
    document.querySelectorAll(".tower-card").forEach(card=>{
      const available=unlocked(card.dataset.tower);
      card.classList.toggle("locked",!available);
      card.dataset.unlock="🔒 第"+unlockAt[card.dataset.tower]+"波で解放";
      card.disabled=!available;
    });
    const current=towerAt(selectedPad);
    const evo=current&&current.branch;
    $("awakening-count").textContent=(state.awakenings||0)+" 機覚醒";
    $("awakening-clue").textContent=evo?
      (current.awakened?"覚醒済： "+current.evolution:
      current.type!=="machinegun"?"★ "+(current.evolution||"専用兵器"):
      current.branch==="gatling"?"ヴァルカン：跳弾＋弾幕増幅で覚醒":
      current.branch==="rail"?"レールガン：超貫通＋過充電で覚醒":
      "テスラ：感電＋広域伝播で覚醒"):
      "兵器を進化させると新たな戦い方を獲得！";
    $("upgrade-next").textContent=current?
      DEF[current.type].name+" Lv."+current.level+" → Lv."+(current.level+1):
      "機関銃 Lv.1 → Lv.3 二連装 → Lv.5 四連装";
    $("upgrade-detail").textContent=current&&current.branch?
      ("進化形態： "+(current.evolution||BRANCHES.find(b=>b.id===current.branch)?.name||"専用改造")+
       (current.awakened?" / ★覚醒済":" / 能力 "+current.mods.length+"/2")):
      current?
      (current.type==="machinegun"?"Lv.3で二連装、Lv.5で四連装！銃身と弾幕が増える":"強化で火力アップ、改造で特別な能力を獲得"):
      "兵器をタップすると次の成長を確認できます。";
    $("sound-button").textContent=soundOn?"♪":"×";
    $("wave-count").textContent=
      String(Math.max(0,localWave(state.wave))).padStart(2,"0")+" / 10";
    $("enemy-count").textContent="敵 "+(enemies.length+state.queue.length)+"体 ｜ 撃破 "+state.kills;
    const profile=waveProfile(Math.min(stageEnd(),state.wave+1));
    const anyEvolution=towers.some(t=>!t.branch||t.mods.length<2);
    const progress=anyEvolution?Math.min(100,Math.max(0,state.xp/state.xpNeed*100)):0;
    $("evolution-progress").style.width=progress+"%";
    $("evolution-meter-value").textContent=Math.floor(progress)+"%";
    $("evolution-meter-label").textContent=!anyEvolution&&towers.length?"全兵器の改造が完了！":state.choosing?"進化先を選択中":progress>=100?"進化準備完了！":"進化まであと "+Math.max(0,state.xpNeed-state.xp)+" XP";
    $("enemy-intel").textContent=state.active?
      "交戦中："+waveProfile(state.wave).label:
      "次は第"+(localWave(state.wave)+1)+"波："+profile.label;
    const dispatch=storyAt(state.wave+1);
    const storyPreview=$("story-preview");
    if(storyPreview)storyPreview.textContent=state.active?
      (storyLead(state.wave)?"📡 "+storyLead(state.wave).speaker+"："+storyLead(state.wave).line:""):
      (dispatch?"📡 次の通信："+dispatch.code:"📡 "+(storyLead(state.wave)?.code||"01 / 最終防衛線"));
    const storyLog=$("story-log");
    if(storyLog&&loggedStoryWave!==state.wave){
      loggedStoryWave=state.wave;
      storyLog.replaceChildren();
      STORY.filter(s=>s.wave<=state.wave).forEach(s=>{
        const entry=document.createElement("p");
        entry.textContent=s.code+"｜"+s.speaker+"「"+s.line+"」";
        storyLog.append(entry);
      });
      Object.keys(state.decisions).forEach(w=>{
        const entry=document.createElement("p");entry.textContent="第"+w+"波の決断｜"+state.decisions[w];storyLog.append(entry);
      });
      if(!state.wave){const entry=document.createElement("p");entry.textContent="記録は出撃後に解放されます。";storyLog.append(entry);}
    }
    $("build-summary").textContent=state.usedTactics.length?
      "採用作戦 "+state.usedTactics.length+"回 ｜ "+state.usedTactics.slice(-2).join("・"):
      "敵を倒して経験値をため、兵器を進化させよう。進化で攻撃方法が変わる！";
    const strike=$("airstrike-button");
    strike.disabled=state.strike<100||!state.active||state.paused||state.finished;
    strike.classList.toggle("ready",state.strike>=100);
    strike.classList.toggle("aiming",strikeAiming);
    $("strike-charge").textContent=Math.floor(state.strike)+"%";
    $("game-status").textContent=state.finished?"作戦終了":
      state.paused?"一時停止":state.active?"交戦中":"準備中";

    $("speed-button").textContent="×"+state.speed;
    $("pause-button").textContent=state.paused?"▶":"Ⅱ";

    $("start-wave").disabled=state.active||state.finished||state.choosing;
    $("start-wave").classList.toggle("next-action",!state.active&&localWave(state.wave)===0&&towers.length>0);
    $("start-wave").textContent=state.active?"迎撃中":
      state.finished?"作戦終了":
      "▶ 第"+(localWave(state.wave)+1)+"波 開始";
    const decisionPanel=$("decision-panel");
    if(decisionPanel){
      const n=pendingDecision();
      decisionPanel.classList.toggle("hidden",!n);
      if(n){
        $("decision-label").textContent="◆ 作戦決断："+DECISIONS[n].title;
        DECISIONS[n].options.forEach((opt,i)=>{
          const btn=$("decision-"+i);
          btn.replaceChildren();
          const head=document.createElement("strong"),detail=document.createElement("small");
          head.textContent=opt.label;detail.textContent=opt.hint;
          btn.append(head,detail);
          btn.title=opt.hint;
          btn.disabled=state.money<opt.cost;
          btn.onclick=()=>chooseDecision(n,i);
        });
      }
    }

    document.querySelectorAll(".tower-card").forEach(el=>{
      el.classList.toggle("selected",
        el.dataset.tower===selectedType);
      el.classList.toggle("recommended",state.wave>0&&!state.active&&!state.finished&&
        unlocked(el.dataset.tower)&&el.dataset.tower===state.suggestedTower);
    });

    const t=towerAt(selectedPad);
    const cost=t?upgradeCost(t):0;
    $("upgrade-button").disabled=!t||t.level>=10||state.money<cost;
    $("sell-button").disabled=!t;
    $("upgrade-button").textContent=t?
      "↑ 強化 "+(t.level>=10?"MAX":cost+"G"):"↑ 強化";

    const repair=$("repair-button");
    if(repair){repair.disabled=state.money<60||state.hp>=state.maxHp||state.choosing||state.finished;repair.textContent="♥ +4回復 60G";}
    const dockStatus=$("dock-status");
    if(dockStatus){
      const coming=state.wave+1;
      const advice=nextWaveAdvice(coming);
      dockStatus.textContent=state.choosing?"兵器進化を選択中":
        hoverPad>=0&&!towerAt(hoverPad)?padTrait(hoverPad).name+"："+padTrait(hoverPad).desc+"（"+padCost(selectedType,hoverPad)+"G）":
        localWave(state.wave)===0&&!towers.length?"① 光る＋に機関銃を置こう":
        localWave(state.wave)===0?"② 準備OK！ ▶ をタップ":
        state.towerHintTime>0?ROLE_HINT[selectedType]:
        state.active?"交戦中！兵器をタップして強化・追加配置できる":
        state.lastWaveReport||"次は第"+(localWave(state.wave)+1)+"波："+advice;
    }
    $("tower-info").textContent=t?
      DEF[t.type].name+" Lv."+t.level+(t.evolution?" ★ "+t.evolution:""):
      "光る＋をタップして兵器を設置";
  }

  const padFromPointer=event=>{
    const rect=canvas.getBoundingClientRect();
    const x=(event.clientX-rect.left)*W/rect.width;
    const y=(event.clientY-rect.top)*VIEW_H/rect.height+cameraY;
    let index=-1,nearest=25;
    PADS.forEach((p,i)=>{
      const d=Math.hypot(p[0]-x,p[1]-y);
      if(d<nearest){nearest=d;index=i;}
    });
    return {index,x,y};
  };
  canvas.addEventListener("pointermove",event=>{
    if(event.pointerType==="touch"&&pressedPad>=-1&&panStartY){
      const delta=(event.clientY-panStartY)*VIEW_H/canvas.getBoundingClientRect().height;
      if(Math.abs(delta)>12||isPanning){
        isPanning=true;cameraY=Math.max(0,Math.min(H-VIEW_H,panStartCamera-delta));
        hoverPad=-1;return;
      }
    }
    if(event.pointerType==="touch"&&pressedPad<0)return;
    const {index}=padFromPointer(event);
    if(hoverPad!==index){hoverPad=index;updateUI();}
  });
  canvas.addEventListener("pointerleave",()=>{
    if(pressedPad<0&&hoverPad!==-1){hoverPad=-1;updateUI();}
  });
  canvas.addEventListener("pointerdown",event=>{
    event.preventDefault();
    panStartY=event.clientY;panStartCamera=cameraY;isPanning=false;
    const {index}=padFromPointer(event);
    pressedPad=index;hoverPad=index;
    updateUI();
  });
  canvas.addEventListener("pointercancel",()=>{pressedPad=-1;hoverPad=-1;panStartY=0;isPanning=false;updateUI();});
  canvas.addEventListener("pointerup",event=>{
    const {index,x,y}=padFromPointer(event);
    const chosen=pressedPad;
    pressedPad=-1;
    panStartY=0;
    hoverPad=event.pointerType==="mouse"?index:-1;
    if(isPanning){isPanning=false;updateUI();return;}
    if(strikeAiming) {
      if(state.strike>=100 && state.active && !state.paused)useAirstrike(x,y);
      else{strikeAiming=false;$("strike-hint").classList.add("hidden");}
      updateUI();
      return;
    }
    if(chosen>=0&&chosen===index)selectPad(index);
    else updateUI();
  });
  canvas.addEventListener("wheel",event=>{
    event.preventDefault();cameraY=Math.max(0,Math.min(H-VIEW_H,cameraY+event.deltaY*.70));
  },{passive:false});
  $("map-up")?.addEventListener("click",()=>{cameraY=Math.max(0,cameraY-VIEW_H*.65);});
  $("map-down")?.addEventListener("click",()=>{cameraY=Math.min(H-VIEW_H,cameraY+VIEW_H*.65);});

  document.querySelectorAll(".tower-card").forEach(button=>{
    button.onclick=()=>{
      selectedType=button.dataset.tower;
      selectedPad=-1;
      hoverPad=-1;
      state.towerHintTime=3.5;
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
  const dockHead=document.createElement("div");dockHead.className="dock-head";
  const labButton=document.createElement("button");labButton.id="dock-lab-button";
  labButton.type="button";labButton.textContent="🗺 ステージ";
  labButton.addEventListener("click",()=>openLab(false));
  dockHead.append(dockTitle,labButton);dock.appendChild(dockHead);
  const panel=document.querySelector(".control-panel");
  dock.appendChild(panel.querySelector(".tower-grid"));
  const dockActions=panel.querySelector(".action-row");
  dockActions.appendChild(panel.querySelector("#airstrike-button"));
  const repairButton=document.createElement("button");
  repairButton.id="repair-button";repairButton.type="button";
  repairButton.textContent="♥ +4回復 60G";
  repairButton.addEventListener("click",()=>{
    if(state.finished||state.choosing||state.money<60||state.hp>=state.maxHp)return;
    const healed=Math.min(4,state.maxHp-state.hp);
    state.money-=60;state.hp+=healed;
    notice("基地を修復！体力＋"+healed+"（残り"+state.money+"G）");
    updateUI();
  });
  dockActions.appendChild(repairButton);
  dock.appendChild(dockActions);
  const decisionPanel=document.createElement("div");decisionPanel.id="decision-panel";
  decisionPanel.className="decision-panel hidden";
  decisionPanel.innerHTML='<strong id="decision-label"></strong><div><button id="decision-0" type="button"></button><button id="decision-1" type="button"></button></div>';
  dock.appendChild(decisionPanel);
  dock.appendChild(panel.querySelector("#start-wave"));
  document.querySelector(".game-shell").appendChild(dock);
  // Keep the map entirely tappable between waves. The dock already has a start button.
    $("start-wave").onclick=startWave;
  $("upgrade-button").onclick=upgradeTower;
  $("sell-button").onclick=sellTower;
  $("retry-button").onclick=()=>{
    if(state.finished&&state.hp>0&&stageIndex<STAGES.length-1)selectStage(stageIndex+1);
    else if(state.finished&&state.hp>0)openLab(true);
    else reset();
  };
  $("result-lab-button").onclick=()=>openLab(true);
  $("lab-close").onclick=()=>{
    $("lab-modal").classList.add("hidden");
    labOpenedFromResult=false;
    updateUI();
  };

  let labView="stages";
  function switchLabView(view){
    labView=view;
    $("lab-stage-view").classList.toggle("active",view==="stages");
    $("lab-research-view").classList.toggle("active",view==="research");
    $("lab-tab-stages").classList.toggle("active",view==="stages");
    $("lab-tab-research").classList.toggle("active",view==="research");
  }
  $("lab-tab-stages").onclick=()=>switchLabView("stages");
  $("lab-tab-research").onclick=()=>switchLabView("research");
  function openLab(fromResult){
    if(state.active||state.choosing){notice("司令部は戦闘と戦闘の間に利用できます");return;}
    labOpenedFromResult=fromResult;
    switchLabView(fromResult?"stages":labView);
    renderLab();
    $("lab-modal").classList.remove("hidden");
  }
  function renderLab(){
    $("lab-points").textContent=commander.points;
    $("lab-best").textContent="解放 "+commander.stages+"/4";
    const locked=localWave(state.wave)>0&&!state.finished;
    const stageBox=$("stage-grid");stageBox.replaceChildren();
    STAGES.forEach((s,i)=>{
      const open=i<commander.stages;
      const button=document.createElement("button");button.type="button";
      button.className="stage-card"+(i===stageIndex?" chosen":"")+(open?"":" locked");
      button.disabled=!open||state.active;
      const path=s.path.map(p=>[(p[0]+35)/460*100,(p[1]-50)/420*100]);
      const line=path.map(([x,y],k)=>(k?"L":"M")+x.toFixed(0)+","+y.toFixed(0)).join(" ");
      const art=document.createElement("span");art.className="stage-map "+s.theme;
      const landmarks={
        canyon:'<path d="M6 10L24 0L33 22L13 31Z M74 67L93 54L103 89L79 97Z" fill="#94ac80"/><path d="M15 29L27 7L36 22M76 91L89 62L101 89" stroke="#ebd5a7" fill="none" stroke-width="3"/>',
        desert:'<path d="M0 25Q22 1 49 29T100 16V0H0ZM0 85Q25 56 54 76T102 70V100H0Z" fill="#dfb87d" opacity=".7"/><circle cx="83" cy="21" r="11" fill="#fff0b3"/>',
        snow:'<path d="M0 32L19 2L34 21L47 0L66 32H100V0H0ZM36 100L70 59L85 79L99 60V100Z" fill="#d0f2f3"/><path d="M7 89l7-24 8 24M73 17l7-15 8 15" stroke="#ffffff" fill="none" stroke-width="3"/>',
        factory:'<path d="M0 0H100V100H0Z" fill="#53646b"/><path d="M0 13H100M0 43H100M0 73H100M15 0V100M59 0V100" stroke="#aabac3" stroke-width="2" opacity=".5"/><circle cx="23" cy="82" r="15" fill="#263740" stroke="#fdc46e" stroke-width="4"/><path d="M85 0V100" stroke="#ff8a41" stroke-width="9"/>'
      };
      art.innerHTML='<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'+landmarks[s.theme]+'<path d="'+line+'" fill="none" stroke="#182c2e" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/><path d="'+line+'" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const name=document.createElement("strong");name.textContent=(open?s.icon:"🔒")+" "+s.name;
      const tag=document.createElement("small");tag.textContent=open?(i===stageIndex?"▶ 選択中":"10 WAVE"):"未解放";
      button.append(art,name,tag);
      button.onclick=()=>selectStage(i);
      stageBox.append(button);
    });
    const doctrineBox=$("lab-doctrines");doctrineBox.replaceChildren();
    DOCTRINES.forEach(d=>{
      const button=document.createElement("button");button.type="button";
      button.className="lab-option"+(d.id===doctrine?" chosen":"");
      button.disabled=locked;
      const icon=document.createElement("span");icon.className="doctrine-icon";icon.textContent=d.icon;
      const head=document.createElement("strong");head.textContent=(d.id===doctrine?"✓ ":"")+d.name;
      const tag=document.createElement("small");tag.textContent=d.tag;
      const desc=document.createElement("span");desc.textContent=d.desc;
      button.append(icon,head,tag,desc);
      button.onclick=()=>{
        if(locked)return;
        doctrine=d.id;
        if(localWave(state.wave)===0){reset();$("lab-modal").classList.remove("hidden");}
        $("lab-notice").textContent="出撃作戦を「"+d.name+"」に変更";
        renderLab();updateUI();
      };
      doctrineBox.append(button);
    });
    const researchBox=$("lab-research");researchBox.replaceChildren();
    RESEARCH.forEach(r=>{
      const purchased=!!commander.levels[r.id];
      const button=document.createElement("button");button.type="button";
      button.className="lab-option research-option"+(purchased?" completed":"");
      button.disabled=purchased||commander.points<r.cost;
      const icon=document.createElement("span");icon.className="research-icon";icon.textContent=r.icon;
      const name=document.createElement("strong");name.textContent=r.name;
      const desc=document.createElement("span");desc.textContent=r.desc;
      const price=document.createElement("small");price.textContent=purchased?"研究済":r.cost+" ◆";
      button.append(icon,name,desc,price);
      button.onclick=()=>{
        if(commander.levels[r.id]||commander.points<r.cost)return;
        commander.points-=r.cost;commander.levels[r.id]=1;saveCommander();
        $("lab-notice").textContent=r.name+" 研究完了。次の出撃から有効。";
        renderLab();updateUI();
      };
      researchBox.append(button);
    });
  }

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

