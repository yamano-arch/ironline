// Read-only model test of the actual IRONLINE combat engine.
// Runs without a browser by supplying a minimal, non-rendering DOM.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../script.js',import.meta.url),'utf8');

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
  const cards=['machinegun','cannon','missile','radar'].map(t=>{const c=mk();c.dataset.tower=t;return c});
  get('tower-grid').children=cards;
  const panel=mk();panel.querySelector=s=>s==='.tower-grid'?get('tower-grid'):s==='.action-row'?get('action-row'):get(s.replace('#',''));
  const doc={getElementById:get,createElement:()=>mk(),querySelector:s=>s==='.control-panel'?panel:s==='.game-shell'?get('game-shell'):s.startsWith('[data-tower=')?cards.find(c=>s.includes(c.dataset.tower)):get(s),querySelectorAll:s=>s==='.tower-card'?cards:[]};
  let rand=seed;
  const randomness=()=>{rand=(rand*1664525+1013904223)>>>0;return rand/4294967296};
  const MathSeeded=Object.create(Math);MathSeeded.random=randomness;
  const hooked=source.replace('  reset();\n  requestAnimationFrame(frame);',`  globalThis.__test={get state(){return state},get towers(){return towers},get enemies(){return enemies},selectPad,startWave,update,openEvolution,getDef:()=>DEF,findTarget,upgradeTower};\n  reset();`);
  const context={document:doc,window:{},localStorage:{getItem:()=>null,setItem(){}},requestAnimationFrame(){},Math:MathSeeded,console};
  vm.runInNewContext(hooked,context,{filename:'script.js'});
  return {game:context.__test, get};
}

function run({seed,style}){
  const {game,get}=createHarness(seed);
  // The first selection uses the default machine gun, as a new player would.
  game.selectPad(2);
  if(style==='three_guns'){game.selectPad(4);game.selectPad(5)}
  const report=[];
  for(let wave=1;wave<=20;wave++){
    if(style!=='one_gun'){
      // Rotate build priorities, subject to unlock and actual funds.
      const plans=style==='three_guns'?
        {2:[["cannon",1]],3:[["missile",7]],4:[["radar",0]],5:[["missile",6]],6:[["cannon",8]],7:[["missile",9]],8:[["cannon",3]],9:[["missile",10]],10:[["radar",11]]}:
        {2:[["cannon",4]],3:[["missile",5]],4:[["radar",7]],5:[["missile",6]],6:[["cannon",1]],7:[["missile",9]],8:[["cannon",8]],9:[["missile",10]],10:[["radar",11]],11:[["missile",3]]};
      for(const [type,pad] of plans[wave]||[]){
        // UI-controlled weapon selection, identical to clicking its card.
        const buttons=[...get('tower-grid').children];
        const button=buttons.find(b=>b.dataset?.tower===type);
        if(button?.onclick&&game.state.money>=game.getDef()[type].cost){button.onclick();game.selectPad(pad)}
      }
      // Upgrade the main tower when money allows and cash reserve survives.
      if(wave>1&&wave%2===0&&game.state.money>=230){
        const t=game.towers.find(t=>t.type==='machinegun');
        if(t){game.selectPad(t.pad);game.upgradeTower()}
      }
    }
    game.startWave();
    if(!game.state.active&&!game.state.choosing){get('decision-1').onclick?.();game.startWave()}
    let ticks=0,peakEnemies=0;
    while(game.state.active&&ticks<2400&&!game.state.finished){
      game.update(.05);ticks++;peakEnemies=Math.max(peakEnemies,game.enemies.length);
    }
    if(game.state.choosing){
      const buttons=get('evolution-options').children.filter(e=>e.className?.includes('evolution-choice'));
      const selected=buttons.find(e=>e.children?.[1]?.children?.[0]?.textContent==='レールガン')||buttons[0];
      selected?.onclick?.();
    }
    report.push({wave,hp:game.state.hp,money:game.state.money,kills:game.state.kills,towers:game.towers.length,peakEnemies,ticks,choosing:game.state.choosing,leaks:{...game.state.waveLeaks}});
    if(game.state.finished||ticks>=2400)break;
  }
  return report;
}

for(const style of ['one_gun','guided','three_guns']){
  for(const seed of [11,27,42]){
    try {
      const waves=run({style,seed});
      if(style==='one_gun'){
        assert.equal(waves[0].hp,20,'First wave should be welcoming');
        assert.equal(waves.at(-1).wave,3,'One machine gun alone should not win all waves');
      }else{
        assert.equal(waves.at(-1).wave,20,'Common build path should reach the last wave');
        assert.ok(waves.at(-1).hp>0,'Common build path should finish without mandatory repairs');
        assert.ok(waves[1].hp>=11,'Second wave should not force immediate repairs');
      }
      console.log(JSON.stringify({style,seed,first: waves[0].hp,second:waves[1].hp,lastWave:waves.at(-1).wave,lastHp:waves.at(-1).hp}));
    }
    catch(e){console.error(style,seed,e.stack);process.exitCode=1}
  }
}
