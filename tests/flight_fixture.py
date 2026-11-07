"""Build a local, explicitly labelled CUA fixture; never ships in the plugin.

Serve the repository root, then open /tests/artifacts/flight-1/index.html.
Only this copy exposes controlled contacts and a stepped animation clock.
"""

import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests/artifacts/flight-1"
FULL_OUT = OUT.parent / "full-playtest"

CLOCK = """<script>
const nativeFrame = window.requestAnimationFrame.bind(window);
const nativeCancelFrame = window.cancelAnimationFrame.bind(window);
const pendingFrames = new Map(); let frameId = 0, clockTime = 1, playing = false;
let nativeFrameId = null, playbackGeneration = 0, replayDelay = 0;
window.requestAnimationFrame = callback => { pendingFrames.set(++frameId, callback); return frameId; };
window.cancelAnimationFrame = id => pendingFrames.delete(id);
function stepClock(ms = 0) {
  clockTime += ms;
  const pending = [...pendingFrames.values()]; pendingFrames.clear();
  for (const callback of pending) callback(clockTime);
  document.dispatchEvent(new Event('fixture-report'));
}
function pauseClock() {
  playing = false; playbackGeneration++;
  if (nativeFrameId !== null) nativeCancelFrame(nativeFrameId);
  nativeFrameId = null;
  const button = document.querySelector('#fixture-pause');
  if (button) button.textContent = '继续播放';
}
function startPreview() {
  pauseClock(); replayDelay = 0;
  document.dispatchEvent(new CustomEvent('fixture-start',
    {detail:document.querySelector('#fixture-case').value}));
  stepClock(0); playClock();
}
function playClock() {
  if (playing) { pauseClock(); return; }
  playing = true; let previous = null;
  const generation = ++playbackGeneration;
  document.querySelector('#fixture-pause').textContent = '暂停';
  function run(time) {
    if (!playing || generation !== playbackGeneration) return;
    const milliseconds = previous === null ? 0 : Math.min(100, time - previous); previous = time;
    if (replayDelay > 0) {
      replayDelay -= milliseconds;
      if (replayDelay <= 0) { startPreview(); return; }
    } else {
      stepClock(milliseconds * Number(document.querySelector('#fixture-speed').value));
      document.dispatchEvent(new Event('fixture-auto-step'));
    }
    if (playing && generation === playbackGeneration) nativeFrameId = nativeFrame(run);
  }
  nativeFrameId = nativeFrame(run);
}
</script>"""

CONTROLS = """<aside style="position:fixed;bottom:4px;left:8px;right:8px;z-index:30;
background:#fff9ecf5;border:2px solid #e4b66c;border-radius:8px;padding:5px;
font:12px sans-serif;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
<b>演出预览 · 开发测试</b>
<select id="fixture-case" aria-label="演示场景" style="width:110px" onchange="startPreview()">
<option value="centre">中央向右</option><option value="top">上沿向上</option>
<option value="trait-guard">奶盖：软垫减伤</option>
<option value="trait-bounce">布丁：撞墙回弹</option>
<option value="trait-heavy">橘子：重身受撞</option>
<option value="live-contact">真实碰撞：橘子</option><option value="live-pudding">真实碰撞：布丁</option><option value="live-milkcap">真实碰撞：奶盖</option>
<option value="moving-target">真实碰撞：移动目标</option>
<option value="bottom">下沿向下</option><option value="left">左沿向左</option>
<option value="parallel">三猫同时</option><option value="chain-staggered">真实连锁：先后淘汰</option><option value="last">最后一分</option>
<option value="match-point">赛点实战：胜利</option><option value="match-point-loss">赛点实战：失败</option><option value="match-point-draw">结算测试：平局</option>
<option value="return">下一轮返场</option></select>
<button id="fixture-live" onclick="pauseClock();replayDelay=0;document.dispatchEvent(new CustomEvent('fixture-start',
{detail:'live-contact'}));stepClock(0);playClock()">真实碰撞触发（测试）</button>
<button onclick="startPreview()">重播场景</button>
<button id="fixture-pause" onclick="playClock()">播放</button>
<label><input id="fixture-loop" type="checkbox" checked>循环预览</label>
<select id="fixture-speed" aria-label="播放速度" style="width:100px">
<option value="1">正常速度</option><option value="0.5">半速看动作</option></select>
<output id="fixture-summary">加载中</output>
<small>仅淘汰时击飞；普通碰撞不触发。</small>
<details style="max-width:100%"><summary>逐帧与检查</summary>
<button onclick="pauseClock();replayDelay=0;document.dispatchEvent(new CustomEvent('fixture-start',
{detail:document.querySelector('#fixture-case').value}));stepClock(0)">开始场景</button>
<button onclick="pauseClock();stepClock(70)">+70ms</button>
<button onclick="pauseClock();stepClock(100)">+100ms</button>
<button onclick="pauseClock();document.dispatchEvent(new Event('fixture-check'))">检查生命周期</button>
<button onclick="pauseClock();document.dispatchEvent(new Event('fixture-impact-check'))">检查慢动作同步</button>
<button onclick="pauseClock();document.dispatchEvent(new Event('fixture-contact-check'))">检查受力表现</button><button onclick="pauseClock();document.dispatchEvent(new Event('fixture-trio-check'))">检查三猫复用</button>
<button onclick="pauseClock();document.dispatchEvent(new Event('fixture-chain-check'))">检查连锁节奏</button>
<pre id="fixture-report" style="max-height:170px;overflow:auto;font-size:11px"></pre></details>
</aside>"""

HOOK = """
    const traitFixtureKinds = ['trait-guard', 'trait-bounce', 'trait-heavy'];

    // Fixture-only controls; no test mutation API is added to production.
    function fixtureStart(kind) {
      reset(); stepClock(0);
      match.targetScore = 5;
      const b = map.world.bounds, cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
      if (traitFixtureKinds.includes(kind)) {
        const setups = {
          'trait-guard': { attacker: 0, speed: 460, spots: [[0, cx - 115], [5, cx]] },
          'trait-bounce': { attacker: 1, speed: -540, spots: [[1, b.left + 150]] },
          'trait-heavy': { attacker: 4, speed: 460, spots: [[4, cx - 115], [0, cx]] },
        };
        const { attacker, speed, spots } = setups[kind];
        match.side = attacker < 3 ? 0 : 1;
        for (const [id, x] of spots) {
          Matter.Body.setPosition(world.rings.find(ring => ring.id === id).body, {x, y: cy});
        }
        launchShot(attacker, {x: speed, y: 0});
        return;
      }
      if (['match-point', 'match-point-loss', 'match-point-draw'].includes(kind)) {
        const lose = kind === 'match-point-loss';
        const attacker = lose ? 3 : 0;
        const defender = lose ? 0 : 3;
        const direction = lose ? -1 : 1;
        match.side = lose ? 1 : 0;
        match.scores = lose ? [2, 4] : [4, kind === 'match-point-draw' ? 5 : 1];
        for (const [id, x] of [[attacker, cx - direction * 90], [defender, cx]]) {
          Matter.Body.setPosition(world.rings.find(ring => ring.id === id).body, {x, y: cy});
        }
        match.actors[defender].hp = 1;
        launchShot(attacker, {x: direction * 460, y: 0});
        return;
      }
      const cases = {
        centre: [cx, cy, 1, 0], top: [cx, b.top + 110, 0, -1],
        bottom: [cx, b.bottom - 45, 0, 1], left: [b.left + 48, cy, -1, 0],
      };
      const [x, y, dx, dy] = cases[kind] || cases.centre;
      const source = match.world.rings.find(ring => ring.id === 0).body;
      Matter.Body.setPosition(source, {x: x - dx * 90, y: y - dy * 90});
      const ids = ['parallel','chain-staggered'].includes(kind) ? [3, 4, 5] : kind==='live-pudding'?[4]:kind==='live-milkcap'?[5]:[3];
      ids.forEach((id, index) => {
        const body = match.world.rings.find(ring => ring.id === id).body;
        Matter.Body.setPosition(body, kind === 'parallel'
          ? {x: cx + 140, y: cy - 130 + index * 130} : {x, y});
        match.actors[id].hp = 1;
      });
      if(kind==='chain-staggered'){
        const width=b.right-b.left,positions=[.31,.60,.94];
        Matter.Body.setPosition(source,{x:b.left+width*positions[0]-90,y:cy});
        ids.forEach((id,i)=>Matter.Body.setPosition(match.world.rings.find(r=>r.id===id).body,{x:b.left+width*positions[i],y:cy}));
        for(const [id,y] of [[1,b.top+80],[2,b.bottom-80]])Matter.Body.setPosition(match.world.rings.find(r=>r.id===id).body,{x:b.left+100,y});
      }
      if (kind === 'last') match.targetScore = 1;
      const realContact=['live-contact','moving-target','live-pudding','live-milkcap','chain-staggered'].includes(kind);
      match.launch(0, {x: dx*(kind==='chain-staggered'?1100:realContact?1200:20), y: dy*(realContact?1200:20)});
      if(kind==='moving-target'){
        const target=match.world.rings.find(ring=>ring.id===3).body;
        Matter.Body.setVelocity(target,{x:180/60,y:-120/60});
      }
      if (!realContact) {
        for (const id of ids) match.handleContact({wall:false, ringIds:[0,id]});
        match.world._stop();
      }
      if (kind === 'return') for (const cat of match.actors) cat.usedThisRound = true;
    }
    const fixtureChecks = [];
    let fixtureFlightSeen = false;
    let fixtureTraitSeen = false;
    function check(condition, name) {
      if (!condition) throw new Error(name);
      fixtureChecks.push(name);
    }
    document.addEventListener('fixture-start', event => {
      fixtureChecks.length = 0;
      fixtureFlightSeen = false;
      fixtureTraitSeen = false;
      fixtureStart(event.detail);
    });
    document.addEventListener('fixture-auto-step', () => {
      if (traitFixtureKinds.includes(document.querySelector('#fixture-case').value)) {
        if (traitEffects.size) { fixtureTraitSeen = true; return; }
        if (!fixtureTraitSeen) return;
        if (document.querySelector('#fixture-loop').checked) replayDelay = 650;
        else pauseClock();
        return;
      }
      if (retreats.length) { fixtureFlightSeen = true; return; }
      // A real collision needs clock time before its first flight. Do not
      // mistake that approach for the end of a playback and restart too soon.
      if (!playing || !fixtureFlightSeen) return;
      if (match.phase === 'over') { fixtureFlightSeen = false; return; }
      if (match.scores.some(score => score >= match.targetScore)) return;
      if (!document.querySelector('#round-score').hidden) return;
      const repeat = document.querySelector('#fixture-loop').checked;
      if (repeat) replayDelay = 900;
      else pauseClock();
      document.querySelector('#fixture-summary').textContent = repeat ? '播放完毕，即将重播' : '播放完毕';
    });
    document.addEventListener('fixture-check', () => {
      pauseClock(); fixtureChecks.length = 0;
      try {
        fixtureStart('parallel'); stepClock(0);
        check(retreats.length === 3 && world.snapshot().length === 3 && match.scores[0] === 3,
          '三猫同时起飞、立即移除实体且每只只计一分');
        check(cameraProjection().scale === 1, '淘汰开始镜头不跳变');
        if(contactEnabled&&!reducedMotion&&knockoutVersion.startsWith('unseat-inertia')&&art[0]?.unseat)
          check(contactEffects.length===retreats.filter(g=>g.contactAccent).length&&contactEffects.length>0,'每只支持惯性脱圈的猫产生一组局部撞击表现');
        stepClock(100);
        if(['unseat','unseat-inertia'].includes(knockoutVersion) && !reducedMotion && art[0]?.unseat)
          check(cameraProjection().scale > 1, '真实淘汰事件驱动镜头推近');
        const before = JSON.stringify(window.miaoPlayground.snapshot().flights);
        const beforeCamera = JSON.stringify(cameraProjection());
        suspend(true); for (let i=0; i<6; i++) stepClock(100);
        check(JSON.stringify(window.miaoPlayground.snapshot().flights) === before, '暂停冻结动画');
        check(JSON.stringify(cameraProjection()) === beforeCamera, '暂停冻结镜头');
        suspend(false); stepClock(0); stepClock(100);
        check(JSON.stringify(window.miaoPlayground.snapshot().flights) !== before, '恢复后继续动画');
        document.querySelector('#reset').click(); document.querySelector('#confirm-restart').click(); stepClock(0);
        check(retreats.length === 0 && match.scores[0] === 0 && world.snapshot().length === 6,
          '真实重开按钮清除击飞和旧比分');
        check(cameraBeat === null && cameraProjection().scale === 1, '重开清除镜头且回到正常视野');
        check(contactEffects.length===0,'重开清除闪光和定向水花');
        fixtureStart('last'); stepClock(0);
        const profile=impactFeedback&&cameraStyle==='release'?'impact':cameraStyle;
        const clockConfig=IB.configFor(profile);
        const timeLoss=['focus','release'].includes(cameraStyle)&&!reducedMotion&&
          ['unseat','unseat-inertia'].includes(knockoutVersion)&&art[0]?.unseat
          ?clockConfig.recoverEnd-IB.sceneTime(clockConfig.recoverEnd,profile):0;
        const steps = Math.ceil((Math.max(match.flightDuration, ...match.flightDurations)+timeLoss) * 1000 / 50);
        for (let i=0; i<steps-1; i++) stepClock(50);
        check(!document.querySelector('#result-dialog').open && match.phase === 'resolving',
          '最后一分在击飞完成前不弹结算');
        stepClock(50);
        check(document.querySelector('#result-dialog').open && retreats.length === 0 && match.phase === 'over',
          '击飞完成后只结算一次');
        fixtureStart('return'); stepClock(0);
        for (let i=0; i<steps; i++) stepClock(50);
        check(match.round === 2 && match.actors[3].hp === 120 && retreats.length === 0,
          '返场等待击飞结束，恢复生命且没有旧动画残留');
        fixtureStart('centre'); stepClock(0); stepClock(70);
        document.querySelector('#show-tuning').click();
        const mode = document.querySelector('#game-mode'); mode.value = 'practice';
        mode.dispatchEvent(new Event('change')); document.querySelector('#tuning-dialog').close(); stepClock(0);
        check(match === null && retreats.length === 0, '切到练习清除旧对局动画');
        mode.value = 'battle'; mode.dispatchEvent(new Event('change')); stepClock(0);
        check(match.round === 1 && match.scores[0] === 0 && world.snapshot().length === 6,
          '返回对战是干净的新局');
        document.querySelector('#fixture-summary').textContent = 'PASS · ' + fixtureChecks.length + ' 项';
      } catch (error) {
        fixtureChecks.push('FAIL: ' + error.message);
        document.querySelector('#fixture-summary').textContent = 'FAIL: ' + error.message;
      }
      fixtureReport();
    });
    document.addEventListener('fixture-impact-check',()=>{
      pauseClock();fixtureChecks.length=0;
      try{
        check(['focus','release'].includes(cameraStyle)&&!reducedMotion,'当前启用完整碰撞特写');
        fixtureStart('moving-target');stepClock(0);
        for(let i=0;i<200&&!impactBeat;i++)stepClock(5);
        check(Boolean(impactBeat)&&match.scores[0]===1,'真实物理碰撞触发一次淘汰和特写');
        stepClock(impactFeedback?28:16);
        check(IB.sample(impactBeat.age,impactBeat.profile).phase==='hit-stop','受力姿态后进入短暂停顿');
        const frozen=JSON.stringify({rings:world.snapshot(),ages:retreats.map(g=>g.age),
          effects:effects.map(e=>e.age),contacts:contactEffects.map(e=>e.age),reactions:[...reactions.values()].map(r=>r.age)});
        const cameraBefore=cameraProjection().scale;
        stepClock(20);
        check(JSON.stringify({rings:world.snapshot(),ages:retreats.map(g=>g.age),
          effects:effects.map(e=>e.age),contacts:contactEffects.map(e=>e.age),reactions:[...reactions.values()].map(r=>r.age)})===frozen,
          '停顿期间场内角色、离场猫、泳圈、水花与受击反应一起冻结');
        check(cameraProjection().scale>cameraBefore,'停顿期间镜头仍继续推近');
        stepClock(45);
        const age=retreats[0].age,sim=world.elapsed,water=effects[0].age,wall=impactBeat.age;
        const advanceMs=cameraStyle==='release'?60:100;
        const expected=IB.sceneTime(wall+advanceMs/1000,impactBeat.profile)-IB.sceneTime(wall,impactBeat.profile);
        stepClock(advanceMs);
        check(Math.abs(retreats[0].age-age-expected)<1e-7&&Math.abs(effects[0].age-water-expected)<1e-7,
          '离场与水花使用选定节奏的精确时间映射');
        check(Math.abs(world.elapsed-sim-expected)<=P.STEP_MS/1000+1e-7,
          '其余角色物理运动使用同一慢动作时间');
        check(Math.abs(impactBeat.age-wall-advanceMs/1000)<1e-7,'镜头使用真实时间而非被放慢的动作时间');
        const previousAge=impactBeat.age;
        match.actors[4].hp=1;match.handleContact({wall:false,ringIds:[0,4]});stepClock(0);
        check(impactBeat.age===previousAge&&impactUsedThisAction&&match.scores[0]===2,
          '连锁淘汰不重置已经推进的共享时钟');
        for(let i=0;i<20&&impactBeat?.age<.5;i++)stepClock(20);
        check(!impactBeat||IB.sampleBeat(impactBeat).scale===1,'短暂慢动作后恢复正常速度');
        const normalAge=retreats[0].age;stepClock(100);
        check(Math.abs(retreats[0].age-normalAge-.1)<1e-7,'恢复后100ms推进100ms动作');
        document.querySelector('#reset').click();document.querySelector('#confirm-restart').click();stepClock(0);
        check(!impactBeat&&!cameraBeat&&!impactUsedThisAction&&match.scores[0]===0,
          '重开清除镜头、时间演出和本次行动标记');
        document.querySelector('#fixture-summary').textContent='PASS · '+fixtureChecks.length+' 项慢动作检查';
      }catch(error){fixtureChecks.push('FAIL: '+error.message);
        document.querySelector('#fixture-summary').textContent='FAIL: '+error.message;}
      fixtureReport();
    });
    document.addEventListener('fixture-contact-check',()=>{
      pauseClock();fixtureChecks.length=0;
      try{
        check(contactEnabled&&!reducedMotion&&knockoutVersion.startsWith('unseat-inertia'),'当前启用完整强化撞击表现');
        fixtureStart('moving-target');stepClock(0);
        for(let i=0;i<200&&!retreats.length;i++)stepClock(5);
        check(retreats[0]?.contactAccent&&contactEffects.length===1,'真实碰撞产生一组受力表现');
        stepClock(16);
        const ghost=retreats[0],base=IM.sample(ghost.unseat,ghost.age,ghost.sampleBounds),p=unseatState(ghost);
        check(p.ring.deformAlong<p.body.deformAlong&&p.ring.deformAlong<1,'泳圈先于身体明显压缩');
        const d=ghost.direction;
        check((p.body.x-base.body.x)*d.x+(p.body.y-base.body.y)*d.y<0,'身体沿受力方向短暂滞后');
        const fx=IC.sample(contactEffects[0],contactEffects[0].age);
        check(fx.flash>0&&fx.drops.length===7,'接触点局部闪光和定向水花可见');
        const camera=JSON.stringify(cameraProjection()),clock=JSON.stringify(impactBeat);
        const input=document.querySelector('#impact-contact');input.checked=false;input.dispatchEvent(new Event('change'));
        check(JSON.stringify(unseatState(ghost))===JSON.stringify(p),'关闭开关不截断当前受力动作');
        check(JSON.stringify(cameraProjection())===camera&&JSON.stringify(impactBeat)===clock,'切换受力表现不修改镜头和慢动作节奏');
        fixtureStart('moving-target');stepClock(0);
        for(let i=0;i<200&&!retreats.length;i++)stepClock(5);
        check(!retreats[0].contactAccent&&contactEffects.length===0,'下一次碰撞恢复原表现且没有残留水花');
        check(JSON.stringify(unseatState(retreats[0]))===JSON.stringify(IM.sample(retreats[0].unseat,retreats[0].age,retreats[0].sampleBounds)),
          '原轨迹与变形保持可用');
        input.checked=true;input.dispatchEvent(new Event('change'));
        document.querySelector('#reset').click();document.querySelector('#confirm-restart').click();stepClock(0);
        check(contactEffects.length===0&&retreats.length===0,'重开清除全部局部效果');
        document.querySelector('#fixture-summary').textContent='PASS · '+fixtureChecks.length+' 项受力检查';
      }catch(error){fixtureChecks.push('FAIL: '+error.message);
        document.querySelector('#fixture-summary').textContent='FAIL: '+error.message;}
      fixtureReport();
    });
    function fixtureReport() {
      const state = window.miaoPlayground.snapshot();
      const info = {viewport:[innerWidth,innerHeight], map:map.id, checks:fixtureChecks,
        traits:[...traitEffects].map(([id, effect])=>({id, kind:effect.kind, age:effect.age,
          hp:match?.actors[id]?.hp, axis:effect.contact?.axis})),
        splitCharacters:state.art.characters.filter(c => c.splitKnockout).map(c => c.key),
        poseCharacters:state.art.characters.filter(c => c.knockoutPoses).map(c => c.key),
        unseatCharacters:state.art.characters.filter(c => c.unseat).map(c => c.key),
        camera:state.motion.camera,cameraAge:state.motion.cameraAge,
        cameraStyle:state.motion.cameraStyle,activeCameraStyle:state.motion.activeCameraStyle,
        readableCameraRate:state.motion.readableCameraRate,
        impactFeedback:state.motion.impactFeedback,
        cameraUsedThisAction:state.motion.cameraUsedThisAction,continuousChain:state.motion.continuousChain,coordinatedChain:state.motion.coordinatedChain,overview:state.motion.overview,
        relayChain:state.motion.relayChain,relay:state.motion.relay,
        beat:state.motion.impactBeat,impactUsedThisAction:state.motion.impactUsedThisAction,
        contactEnabled:state.motion.contactEnabled,
        registeredArt:state.art.characters.map(c=>({key:c.key,knockoutSet:c.knockoutSet})),
        contacts:state.motion.contactEffects.map(e=>({...e,sample:IC.sample(e,e.age)})),
        simulationTime:world.elapsed,
        liveRings:state.rings.map(r=>({id:r.id,x:r.x,y:r.y,vx:r.vx,vy:r.vy})),
        knockoutVersion:state.motion.knockoutVersion,
        phase:match?.phase, scores:match?.scores, live:state.rings.length,
        flights:state.flights.map(f => ({id:f.id, age:+f.age.toFixed(2), x:Math.round(f.x),
          y:Math.round(f.y), rotation:+f.rotation.toFixed(2), scale:+f.scale.toFixed(2), alpha:+f.alpha.toFixed(2),
          version:f.version,pose:f.pose,duration:f.duration,
          contactAccent:f.contactAccent,
          incoming:f.motion?.velocity,sourceVelocity:f.motion?.sourceVelocity,impulse:f.unseat?.kick,
          simulationTime:f.simulationTime,
          parts:f.parts.map(p => ({id:p.partId,x:Math.round(p.x),y:Math.round(p.y),rotation:+p.rotation.toFixed(2),
            scale:+p.scale.toFixed(2),alpha:+p.alpha.toFixed(2),
            deformAlong:p.deformAlong,deformAcross:p.deformAcross,deformAngle:p.deformAngle}))})),
        noScroll:document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight+1,
        overlay:[flightCanvas.width,flightCanvas.height], reducedMotion, playing};
      document.querySelector('#fixture-report').textContent = JSON.stringify(info, null, 2);
      if (!fixtureChecks.length) document.querySelector('#fixture-summary').textContent =
        state.flights.length ? `${state.flights.length} 只 · ${state.flights[0].age.toFixed(2)}s` :
          info.traits.length ? I.t(`skill.${roleFor(info.traits[0].id)}.name`) : match?.phase || 'practice';
    }
    document.addEventListener('fixture-report', fixtureReport);
    document.addEventListener('fixture-trio-check',()=>{
      pauseClock();fixtureChecks.length=0;
      try{
        check(art.every(a=>a?.unseat&&a?.knockout&&a.metadata.knockoutSetUsed==='swim-v2'),'三只角色均加载新泳装四姿态和独立泳圈');
        for(const [kind,role] of [['live-contact',0],['live-pudding',1],['live-milkcap',2]]){
          fixtureStart(kind);stepClock(0);
          for(let i=0;i<200&&!retreats.length;i++)stepClock(5);
          const ghost=retreats.find(g=>g.role===role);
          check(Boolean(ghost?.unseat?.inertia)&&match.scores[0]===1,'角色 '+role+' 由真实物理碰撞淘汰并只计一分');
          check(ghost.unseat.alignedFlight&&ghost.unseat.config===IM.RELEASE,'角色 '+role+' 共用已认可的方向和释放节奏');
          check(ghost.contactAccent&&contactEffects.length===1,'角色 '+role+' 使用同一局部特效触发');
          for(let i=0;i<5;i++)stepClock(100);
          const pose=unseatState(retreats.find(g=>g.role===role));
          check(['body','ring'].every(k=>Object.values(pose[k]).every(Number.isFinite)),'角色 '+role+' 独立部件姿态有限且可采样');
        }
        fixtureStart('parallel');stepClock(0);
        check(retreats.length===3&&retreats.every(g=>g.unseat?.alignedFlight)&&contactEffects.length===3,'三猫同时淘汰分别产生轨迹和特效');
        const beat=impactBeat;stepClock(100);
        check(impactBeat===beat&&impactUsedThisAction&&match.scores[0]===3,'同时淘汰共用一次特写且不重复计分');
        reset();stepClock(0);check(!retreats.length&&!contactEffects.length&&!cameraBeat&&!impactBeat,'重开清空三猫轨迹、镜头和特效');
        document.querySelector('#fixture-summary').textContent='PASS · '+fixtureChecks.length+' 项三猫复用检查';
      }catch(error){document.querySelector('#fixture-summary').textContent='FAIL · '+error.message;throw error;}
      fixtureReport();
    });
    function fixtureRelayChecks(){
      pauseClock();fixtureChecks.length=0;
      try{
        check(relayChain&&cameraStyle==='release'&&!reducedMotion,'当前启用连续重点交接');
        fixtureStart('live-contact');stepClock(0);
        for(let i=0;i<200&&!impactBeat;i++)stepClock(5);
        world._stop();
        const firstCamera=cameraBeat,firstBeat=impactBeat;
        check(Boolean(firstBeat)&&match.scores[0]===1,'首次真实物理碰撞启动原有单猫演出');
        stepClock(100);stepClock(50);
        const before=cameraProjection(),speed=IB.sampleBeat(impactBeat).scale,wall=impactBeat.age;
        const firstAge=retreats[0].age;
        match.phase='moving';match.actors[4].hp=1;match.handleContact({wall:false,ringIds:[0,4]});stepClock(0);
        check(cameraBeat===firstCamera&&impactBeat===firstBeat&&impactBeat.age===wall,'后续碰撞接续同一镜头和共享时钟');
        check(['scale','x','y'].every(k=>Math.abs(before[k]-cameraProjection()[k])<1e-7),'交接第一帧位置和缩放不跳变');
        check(Math.abs(IB.sampleBeat(impactBeat).scale-speed)<1e-8,'后续慢动作从当前速度接续');
        check(Boolean(cameraBeat.relay)&&!cameraBeat.overview,'第二次重点转向碰撞位置而非强制全景');
        const target=cameraBeat.relay.pan.to,oldAge=retreats[0].age;
        stepClock(100);
        check(retreats[0].age>oldAge&&oldAge>=firstAge,'第一只飞行继续前进而非重播');
        check(cameraProjection().scale>1.3,'交接期间保持特写缩放');
        check(IB.sampleBeat(impactBeat).scale>0,'后续强调不重复完全冻结');
        stepClock(100);
        check(['scale','x','y'].every(k=>Math.abs(cameraProjection()[k]-target[k])<1e-7),'镜头到达第二次碰撞的目标构图');
        const thirdBefore=cameraProjection(),secondWall=impactBeat.age;
        match.phase='moving';match.actors[5].hp=1;match.handleContact({wall:false,ringIds:[0,5]});stepClock(0);
        check(['scale','x','y'].every(k=>Math.abs(thirdBefore[k]-cameraProjection()[k])<1e-7),'第三次重点也从现有画面接续');
        check(impactBeat.age===secondWall&&match.scores[0]===3,'三次淘汰分别计分且不重置时间');
        for(let i=0;i<10;i++)stepClock(100);
        check(cameraProjection().scale===1&&!cameraBeat,'最后一次重点读完后回全场');
        check(!impactBeat||IB.sampleBeat(impactBeat).scale===1,'连锁结束恢复正常场景速度');

        fixtureStart('parallel');stepClock(0);
        check(match.scores[0]===3&&cameraBeat.cluster.count===3,'同时淘汰合成包含三只的共同重点');
        check(impactBeat.lastAccentAt===0&&!impactBeat.relay,'同时淘汰共享原停顿，不叠三份慢动作');

        fixtureStart('centre');stepClock(0);
        for(let i=0;i<60&&cameraBeat;i++)stepClock(20);
        check(!cameraBeat&&match.side===0,'构造首镜头已结束但出手仍未结算的晚到碰撞');
        match.phase='moving';match.actors[4].hp=1;match.handleContact({wall:false,ringIds:[0,4]});stepClock(0);
        check(cameraBeat?.style==='release','晚到重点仍可获得特写，不被本轮已用标记屏蔽');
        check(IB.sampleBeat(impactBeat).scale===1&&IB.sampleBeat(impactBeat).phase==='chain-brake','晚到慢动作从正常速度进入，不重播首撞硬停顿');
        stepClock(100);if(readableCameraRate||impactFeedback)stepClock(60);
        check(cameraProjection().scale>1.3,'晚到镜头实际推近');

        fixtureStart('chain-staggered');stepClock(0);
        const times=[];let oldScore=0;
        for(let i=0;i<1200&&match.scores[0]<3;i++){
          stepClock(5);
          if(match.scores[0]>oldScore){
            times.push({scene:world.elapsed,cameraAge:cameraBeat?.age??null,style:cameraBeat?.style,
              speed:IB.sampleBeat(impactBeat).scale,relay:Boolean(cameraBeat?.relay)});
            oldScore=match.scores[0];
          }
        }
        check(match.scores[0]===3&&times.length===3,'真实 Matter 连锁产生三个先后淘汰');
        check(times.every(t=>t.cameraAge!==null&&t.style==='release'),'三次真实淘汰均获得重点镜头');
        check(times.slice(1).every(t=>t.speed>0),'后续真实淘汰不造成重复完全冻结');
        check(retreats.every(g=>g.unseat?.alignedFlight),'连锁仍保留已认可的受力方向轨迹');
        reset();stepClock(0);
        check(!cameraBeat&&!impactBeat&&!cameraUsedThisAction&&!impactUsedThisAction,'重开清空全部连锁状态');
        check(launchShot(0,{x:1100,y:0})&&!cameraUsedThisAction&&!impactUsedThisAction,'下一次合法出手重新获得首撞演出');
        reset();stepClock(0);
        document.querySelector('#fixture-summary').textContent='PASS · '+fixtureChecks.length+' 项连锁交接检查';
      }catch(error){fixtureChecks.push('FAIL: '+error.message);document.querySelector('#fixture-summary').textContent='FAIL: '+error.message;}
      fixtureReport();
    }
    document.addEventListener('fixture-chain-check',()=>{
      if(relayChain){fixtureRelayChecks();return;}
      pauseClock();fixtureChecks.length=0;
      try{
        check(continuousChain&&cameraStyle==='release'&&!reducedMotion,'当前启用连续连锁节奏');
        fixtureStart('live-contact');stepClock(0);
        for(let i=0;i<200&&!impactBeat;i++)stepClock(5);
        const firstBeat=impactBeat,firstCamera=cameraBeat;
        check(Boolean(firstBeat)&&cameraUsedThisAction,'第一只实际碰撞启动一次特写和停顿');
        stepClock(100);const before=cameraProjection(),beatAge=impactBeat.age;
        match.actors[4].hp=1;match.handleContact({wall:false,ringIds:[0,4]});stepClock(0);
        const after=cameraProjection();
        check(cameraBeat===firstCamera&&impactBeat===firstBeat&&impactBeat.age===beatAge,'第二只不重建镜头或重启时间演出');
        check(['scale','x','y'].every(k=>Math.abs(before[k]-after[k])<1e-7),'转入全场的第一帧不跳变');
        check(Boolean(cameraBeat.overview),'后续碰撞平顺移交全场视野');
        if(coordinatedChain){
          check(cameraBeat.overview.start>=IB.realTime(firstCamera.track.config?.releaseAt??(firstCamera.track.inertia?IM.CONFIG.releaseAt:U.CONFIG.releaseAt),firstCamera.style)+.04-1e-7,'移交全场等待首次脱圈读清');
          const deadline=cameraBeat.overview.start;
          while(cameraBeat.age+.01<deadline)stepClock(10);
          check(cameraProjection().scale>1.3,'首次脱圈之前不因第二只淘汰提前拉远');
          const originalBeat=impactBeat;
          stepClock(20);
          check(impactBeat===originalBeat&&IB.sample(impactBeat.age,impactBeat.profile).scale===1,'移交镜头时共享慢动作已恢复且没有重启');
        }

        for(let i=0;i<5;i++)stepClock(100);
        check(cameraProjection().scale===1,'连锁期间镜头已回到全场');
        for(let i=0;i<15&&cameraBeat;i++)stepClock(100);
        check(cameraBeat===null&&cameraUsedThisAction,'首段镜头结束后仍记住本次已用特写');
        const clockBefore=impactBeat?.age??null;
        match.actors[5].hp=1;match.handleContact({wall:false,ringIds:[0,5]});stepClock(0);
        check(cameraBeat===null&&cameraProjection().scale===1,'第三只晚到淘汰也不另起轻推镜头');
        check((impactBeat?.age??null)===clockBefore&&match.scores[0]===3,'晚到淘汰不重启停顿并保持一次计分');
        reset();stepClock(0);check(!cameraUsedThisAction&&!cameraBeat&&!impactBeat,'重开清除连锁镜头状态');
        fixtureStart('chain-staggered');stepClock(0);
        const times=[];let oldScore=0,cameraStarts=0,lastCamera=null;
        for(let i=0;i<650&&match.scores[0]<3;i++){
          stepClock(5);
          if(match.scores[0]>oldScore){times.push({scene:world.elapsed,cameraAge:cameraBeat?.age??null,score:match.scores[0]});oldScore=match.scores[0];}
          if(cameraBeat&&cameraBeat!==lastCamera){cameraStarts++;lastCamera=cameraBeat;}
        }
        check(match.scores[0]===3&&times.length===3,'真实三猫连锁碰撞产生三个先后淘汰');
        check(cameraStarts===1,'整个真实连锁过程只创建一次镜头');
        check(times[2].cameraAge===null&&cameraProjection().scale===1,'第三只在首段镜头结束后仍使用全场');
        reset();stepClock(0);
        check(launchShot(0,{x:1100,y:0})&&!cameraUsedThisAction&&!impactUsedThisAction,'下一次合法出手重新获得演出机会');
        reset();stepClock(0);
        document.querySelector('#fixture-summary').textContent='PASS · '+fixtureChecks.length+' 项连锁节奏检查';
      }catch(error){fixtureChecks.push('FAIL: '+error.message);document.querySelector('#fixture-summary').textContent='FAIL: '+error.message;}
      fixtureReport();
    });
    const initialCase = new URLSearchParams(location.search).get('fixture-case');
    if([...document.querySelector('#fixture-case').options].some(option=>option.value===initialCase))
      document.querySelector('#fixture-case').value=initialCase;
    fixtureReport();
"""


def development_html() -> str:
    html = (ROOT / "static/index.html").read_text(encoding="utf-8")
    controls = (ROOT / "tests/fixtures/development-controls.html").read_text(encoding="utf-8")
    settings, character = controls.split("<!-- dev-character -->", 1)
    return html.replace("<!-- dev-settings -->", settings).replace("<!-- dev-character -->", character)


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    html = development_html()
    html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8"><base href="/static/">' + CLOCK)
    html = re.sub(r'src="game\.js(?:\?[^\"]*)?"',
        'src="/tests/artifacts/flight-1/game-fixture.js?v=fixture-revision"', html)
    html = html.replace('src="maps.js?v=formation-1"', 'src="/tests/artifacts/flight-1/maps-fixture.js"')
    html = html.replace("</body>", CONTROLS + "</body>")
    source = (ROOT / "static/game.js").read_text(encoding="utf-8")
    build_full_playtest(source)
    # Default preview uses the same system and saved preference as the real game.
    # Only an explicit fixture-motion query overrides it for controlled checks.
    anchor_motion = "const requestedMotion = previewParams.get('motion');"
    assert source.count(anchor_motion) == 1
    source = source.replace(anchor_motion,
        "const requestedMotion = new URLSearchParams(location.search).get('fixture-motion') || "
        "previewParams.get('motion');")
    anchor = "    reset();\n    startOpeningFrameLoop();"
    assert source.count(anchor) == 1
    source = source.replace(anchor, "    reset();\n" + HOOK + "\n    raf = requestAnimationFrame(frame);\n"
        "    const fixtureCase = new URLSearchParams(location.search).get('fixture-case');\n"
        "    const fixtureSelect = document.querySelector('#fixture-case');\n"
        "    if ([...fixtureSelect.options].some(option => option.value === fixtureCase)) fixtureSelect.value = fixtureCase;\n"
        "    if (new URLSearchParams(location.search).get('fixture-manual') !== '1') startPreview();")
    revision = hashlib.sha256(source.encode("utf-8")).hexdigest()[:12]
    html = html.replace("game-fixture.js?v=fixture-revision", f"game-fixture.js?v={revision}")
    maps = (ROOT / "static/maps.js").read_text(encoding="utf-8")
    square = (ROOT / "tests/fixtures/square-map.json").read_text(encoding="utf-8")
    (OUT / "maps-fixture.js").write_text(maps + "\nMiaoMaps.register(" + square + ");", encoding="utf-8")
    (OUT / "game-fixture.js").write_text(source, encoding="utf-8")
    (OUT / "index.html").write_text(html, encoding="utf-8")
    # A separate test-only page verifies that one missing split image cannot
    # prevent normal character art or the original knockout fallback loading.
    art = (ROOT / "static/art.js").read_text(encoding="utf-8")
    image_source = "new URL(part.image, metadataUrl).href"
    assert art.count(image_source) == 1
    (OUT / "art-missing-split.js").write_text(
        art.replace(image_source, "new URL('intentionally-missing-part.png', metadataUrl).href"), encoding="utf-8")
    fallback_html = re.sub(r'src="art\.js(?:\?[^\"]*)?"',
        'src="/tests/artifacts/flight-1/art-missing-split.js"', html)
    (OUT / "missing-split.html").write_text(fallback_html, encoding="utf-8")
    pose_source = "image.src=new URL(metadata.image,metadataUrl).href"
    assert art.count(pose_source) == 1
    (OUT / "art-missing-poses.js").write_text(
        art.replace(pose_source, "image.src=new URL('intentionally-missing-poses.png',metadataUrl).href"),
        encoding="utf-8")
    pose_fallback_html = re.sub(r'src="art\.js(?:\?[^\"]*)?"',
        'src="/tests/artifacts/flight-1/art-missing-poses.js"', html)
    (OUT / "missing-poses.html").write_text(pose_fallback_html, encoding="utf-8")
    unseat_renderer = (ROOT / "static/unseat-renderer.js").read_text(encoding="utf-8")
    unseat_image = "image.src = new URL(m.image,url).href"
    assert unseat_renderer.count(unseat_image) == 1
    (OUT / "unseat-missing.js").write_text(unseat_renderer.replace(
        unseat_image, "image.src = new URL('intentionally-missing-unseat.png',url).href"), encoding="utf-8")
    unseat_html = re.sub(r'src="unseat-renderer\.js(?:\?[^\"]*)?"',
        'src="/tests/artifacts/flight-1/unseat-missing.js"', html)
    (OUT / "missing-unseat.html").write_text(unseat_html, encoding="utf-8")
    print(OUT / "index.html")


def build_full_playtest(game_source: str) -> None:
    FULL_OUT.mkdir(parents=True, exist_ok=True)
    base = '<meta charset="utf-8"><base href="/static/">'
    revision = hashlib.sha256(game_source.encode("utf-8")).hexdigest()[:12]
    battle = development_html().replace('<meta charset="utf-8">', base)
    battle = battle.replace('<html lang="en">', '<html lang="en" data-full-playtest>')
    battle = re.sub(r'src="game\.js(?:\?[^\"]*)?"', f'src="game.js?v={revision}"', battle)
    lobby = (ROOT / "static/preparation.html").read_text(encoding="utf-8")
    lobby = lobby.replace('<meta charset="utf-8">', base)
    lobby = lobby.replace("<h1>备战大厅</h1>", "<h1>备战大厅 · 完整测试版</h1>")
    (FULL_OUT / "index.html").write_text(battle, encoding="utf-8")
    (FULL_OUT / "preparation.html").write_text(lobby, encoding="utf-8")
    print(FULL_OUT / "preparation.html")


if __name__ == "__main__":
    build()
