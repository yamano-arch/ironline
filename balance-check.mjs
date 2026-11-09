// Read-only model test of the actual IRONLINE combat engine.
// Runs without a browser by supplying a minimal, non-rendering DOM.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('./script.js',import.meta.url),'utf8');

function createHarness(seed=1){
  const all=new Map();
  const mk=()=>{
    const classes=new Set();
    const item={style:{},dataset:{},children:[],disabled:false,textContent:'',
      classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c)},
      append(...children){this.children.push(...children)},appendChild(child){this.children.push(child)},
      replaceChildren(...children){this.children=children},addEventListener(){},
      getBoundingClientRect(){return {left:0,top:0,width:390,height:520}},
      getContext(){return new Proxy({}, {get:()=>()=>{}})}
    };
    Object.defineProperty(item,'innerHTML',{get(){return ''},set(){this.children=[]}});
    return item;
  };
  const get=id=>{if(!all.has(id))all.set(id,mk());return all.get(id)};
  const cards=['machinegun','cannon','flak','missile','radar'].map(t=>{const c=mk();c.dataset.tower=t;return c});
  get('tower-grid').children=cards;
  const panel=mk();panel.querySelector=s=>s==='.tower-grid'?get('tower-grid'):s==='.action-row'?get('action-row'):get(s.replace('#',''));
  const doc={getElementById:get,createElement:()=>mk(),querySelector:s=>s==='.control-panel'?panel:s==='.game-shell'?get('game-shell'):s.startsWith('[data-tower=')?cards.find(c=>s.includes(c.dataset.tower)):get(s),querySelectorAll:s=>s==='.tower-card'?cards:[]};
  let rand=seed;
  const randomness=()=>{rand=(rand*1664525+1013904223)>>>0;return rand/4294967296};
  const MathSeeded=Object.create(Math);MathSeeded.random=randomness;
  const hooked=source.replace('  reset();\n  requestAnimationFrame(frame);',`  globalThis.__test={get state(){return state},get towers(){return towers},get enemies(){return enemies},get commander(){return commander},selectStage,selectPad,startWave,update,openEvolution,getDef:()=>DEF,findTarget,upgradeTower,waveProfile,waveKinds};\n  reset();`);
  const context={document:doc,window:{},localStorage:{getItem:()=>null,setItem(){}},requestAnimationFrame(){},Math:MathSeeded,console};
  vm.runInNewContext(hooked,context,{filename:'script.js'});
  return {game:context.__test, get};
}

function run({seed,style}){
  const {game,get}=createHarness(seed);
  const report=[];
  const buy=(type,pad)=>{
    const button=get('tower-grid').children.find(b=>b.dataset?.tower===type);
    if(button?.onclick&&game.state.money>=game.getDef()[type].cost){button.onclick();game.selectPad(pad)}
  };
  for(let stage=0;stage<4;stage++){
    if(stage)game.selectStage(stage);
    assert.equal(game.state.wave,stage*10,'Stage starts on its own ten-wave segment');
    assert.equal(game.towers.length,0,'A fresh map has empty build pads');
    buy('machinegun',2);
    if(stage&&style==='guided'){
      const openings=[[],[['cannon',1],['cannon',4],['radar',0]],
        [['flak',3],['flak',4],['flak',5],['radar',7],['missile',6]],
        [['missile',3],['missile',4],['missile',5],['radar',6],['cannon',7]]];
      for(const [type,pad] of openings[stage])buy(type,pad);
    }
    const placements=style==='only_machinegun'?{
      2:[["machinegun",4]],3:[["machinegun",5]],4:[["machinegun",7]],5:[["machinegun",8]],
      6:[["machinegun",6]],7:[["machinegun",9]],8:[["machinegun",1]],9:[["machinegun",10]],10:[["machinegun",11]]
    }:stage===1?{
      2:[["cannon",3]],3:[["cannon",8]],4:[["missile",5]],5:[["radar",7]],
      6:[["cannon",9]],7:[["cannon",10]],8:[["flak",11]],9:[["cannon",6]],10:[["missile",2]]
    }:stage===2?{
      2:[["flak",1]],3:[["cannon",8]],4:[["missile",2]],5:[["cannon",9]],
      6:[["cannon",10]],7:[["missile",0]],8:[["flak",11]],9:[["cannon",4]],10:[["missile",6]]
    }:stage===3?{
      2:[["missile",9]],3:[["missile",10]],4:[["missile",0]],5:[["radar",8]],
      6:[["missile",1]],7:[["missile",11]],8:[["cannon",6]],9:[["flak",10]],10:[["missile",0]]
    }:{
      2:[["cannon",4]],3:[["flak",5]],4:[["missile",6]],5:[["radar",7]],
      6:[["missile",9]],7:[["cannon",8]],8:[["flak",11]],9:[["missile",10]],10:[["cannon",1]]
    };
    for(let local=1;local<=10;local++){
      const wave=stage*10+local;
      for(const [type,pad] of placements[local]||[])buy(type,pad);
      if(style!=='only_machinegun'&&local%2===0&&game.state.money>=200){
        const focus=stage===1?'cannon':stage===2?'flak':stage===3?'missile':local>=6?'missile':local>=4?'cannon':'machinegun';
        const t=game.towers.find(t=>t.type===focus);
        if(t){game.selectPad(t.pad);game.upgradeTower()}
      }
      game.startWave();
      let ticks=0,peakEnemies=0;
      while(game.state.active&&ticks<2800&&!game.state.finished){
        game.update(.05);ticks++;peakEnemies=Math.max(peakEnemies,game.enemies.length);
      }
      if(game.state.choosing){
        const targets=get('evolution-options').children.filter(e=>e.className?.includes('evolution-choice'));
        // For the gun-only scenario force Gatling, which is deliberately poor against tanks.
        targets[0]?.onclick?.();
      }
      report.push({stage:stage+1,wave,hp:game.state.hp,money:game.state.money,towers:game.towers.length,peakEnemies,ticks,leaks:{...game.state.waveLeaks}});
      if(game.state.hp<=0||ticks>=2800)break;
    }
    if(game.state.hp<=0)break;
    if(style==='only_machinegun'&&game.state.hp<=0)break;
    assert.equal(game.state.finished,true,'Stage should end at its tenth wave');
    assert.equal(game.commander.stages,Math.min(stage+2,4),'Clearing unlocks the next map');
  }
  return report;
}

for(const style of ['guided','only_machinegun']){
  for(const seed of [11,27,42]){
    try {
      const waves=run({style,seed});
      assert.equal(waves[0].hp,20,'First wave should be welcoming');
      if(style==='guided'){
        assert.equal(waves.at(-1).wave,40,'All four maps should be completable');
        assert.ok(waves.every(w=>w.hp>0),'Balanced mixed-arms build should finish without repairs');
      }else{
        assert.ok(waves.at(-1).hp<20,'Gun-only strategy should suffer meaningfully');
        assert.ok(waves.at(-1).wave<40,'Gun-only strategy must not clear all four campaigns');
      }
      console.log(JSON.stringify({style,seed,stageHealth:waves.filter(w=>w.wave%10===0).map(w=>w.hp),lastWave:waves.at(-1).wave,lastHp:waves.at(-1).hp}));
    }
    catch(e){console.error(style,seed,e.stack);process.exitCode=1}
  }
}
