(async function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('study-canvas'), ctx = canvas.getContext('2d');
  const M = window.MiaoMotion, K = window.MiaoKnockoutAction;
  const map = { world: { width: 1200, height: 700 } };
  const stageNames = { impact: '受击 · 短促缩起', release: '脱圈 · 上身先起，腿随后', tumble: '翻飞 · 收腿、带动身体', exit: '离场 · 惯性延续' };
  let age = -0.3, playing = true, previous = null, width = 0, height = 0, dpr = 1;
  let candidate, currentParts, origin, current, sprites, poseMetadata;
  let candidateFrames = 0, currentFrames = 0;
  const status = { loaded: false, completeMotion: true, modeChangesGamePreference: false };

  function rebuild() {
    const direction = { right: {x:1,y:0}, left: {x:-1,y:0}, up: {x:0,y:-1}, down: {x:0,y:1} }[$('direction').value];
    origin = { x:600, y: {center:200,top:45,bottom:300}[$('origin').value] };
    candidate = K.create({ ...origin, direction }, {config:{headRestY:poseMetadata.headRestY}});
    currentParts = M.createFlightParts({ ...origin, direction, duration:M.KNOCKOUT.duration }, current.knockout.parts);
  }

  function resize() {
    const r = canvas.getBoundingClientRect(); width = r.width; height = r.height;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
    render();
  }

  function bitmap(image, source, targetWidth = 96) {
    const targetHeight = Math.round(targetWidth * source.height / source.width);
    const result = document.createElement('canvas'); result.width = targetWidth; result.height = targetHeight;
    const c = result.getContext('2d'); c.imageSmoothingEnabled = false;
    c.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, targetWidth, targetHeight);
    const pixels = c.getImageData(0,0,targetWidth,targetHeight);
    for(let i=3;i<pixels.data.length;i+=4) pixels.data[i] = pixels.data[i] < 128 ? 0 : 255;
    c.putImageData(pixels,0,0); return result;
  }

  function drawBody(id, pose) {
    const sprite = sprites[id];
    // Turn around the upper body's mass, keeping one registration for all poses.
    ctx.save(); ctx.translate(pose.x,pose.y+16); ctx.rotate(pose.angle); ctx.translate(0,-16);
    ctx.scale(pose.scale*pose.scaleX,pose.scale*pose.scaleY); ctx.globalAlpha *= pose.alpha;
    const box = sprite.box; ctx.drawImage(sprite.image,box.x,box.y,box.width,box.height); ctx.restore();
  }

  function drawFloat(pose, front = false) {
    ctx.save(); ctx.translate(pose.x,pose.y); ctx.rotate(pose.angle);
    ctx.scale(pose.scale*pose.scaleX,pose.scale*pose.scaleY); ctx.globalAlpha *= pose.alpha;
    if(front) {ctx.beginPath();ctx.rect(-50,3,100,30);ctx.clip();}
    current.knockout.draw(ctx,'float'); ctx.restore();
  }

  function water(view) {
    ctx.fillStyle = '#f4efdf'; ctx.fillRect(view.left,view.top,view.right-view.left,view.bottom-view.top);
    ctx.fillStyle = '#c8eae4'; ctx.fillRect(view.left,-10,view.right-view.left,10);
    ctx.fillStyle = '#fdf9e9'; ctx.fillRect(view.left,-3,view.right-view.left,14);
    ctx.fillStyle = '#86d8de'; ctx.fillRect(view.left,11,view.right-view.left,view.bottom-11);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#bcebf0'; ctx.globalAlpha = 0.5;
    for(let y=45;y<view.bottom;y+=66) for(let x=view.left-90;x<view.right;x+=160) {
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+28,y-8);ctx.lineTo(x+58,y-4);ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function rest() {
    ctx.save();ctx.translate(origin.x,origin.y); current.draw(ctx,0);ctx.restore();
  }

  function drawCandidate(view) {
    const a = K.sample(candidate,age,view);
    ctx.save();ctx.fillStyle='#398e9b';ctx.globalAlpha=a.shadow.alpha;
    ctx.beginPath();ctx.ellipse(a.shadow.x,a.shadow.y+8,36,11,0,0,Math.PI*2);ctx.fill();ctx.restore();
    const blend = Math.min(1,Math.max(0,age/0.018));
    if(blend<1) {ctx.save();ctx.globalAlpha=1-blend;ctx.translate(origin.x,origin.y);current.draw(ctx,1);ctx.restore();}
    ctx.save();ctx.globalAlpha=blend;
    drawFloat(a.ring);
    ctx.save();
    if(age<0.15) {ctx.beginPath();ctx.rect(view.left,view.top,view.right-view.left,origin.y+6-view.top);ctx.clip();}
    drawBody(a.pose,a.body);ctx.restore();
    if(a.frontRim>0) {ctx.save();ctx.globalAlpha*=a.frontRim;drawFloat(a.ring,true);ctx.restore();}
    ctx.restore(); candidateFrames++;
    return a;
  }

  function drawCurrent(view) {
    const t = Math.max(0,age), mix = Math.min(1,t/M.KNOCKOUT.splitBlend), blend=mix*mix*(3-2*mix);
    if(blend<1) {
      ctx.save();ctx.globalAlpha=1-blend;ctx.translate(origin.x+currentParts[0].direction.x*12*blend,origin.y-16*blend);
      current.draw(ctx,1);ctx.restore();
    }
    for(const track of currentParts) {
      const p=M.sampleFlight(track,t,map,view);
      ctx.save();
      if(track.partId==='character'&&t<0.14) {ctx.beginPath();ctx.rect(view.left,view.top,view.right-view.left,origin.y+6-view.top);ctx.clip();}
      ctx.translate(p.x+track.pivotX,p.y+track.pivotY);ctx.rotate(p.rotation);
      ctx.scale(p.scale*(p.stretchX??1),p.scale*(p.stretchY??1));ctx.translate(-track.pivotX,-track.pivotY);
      ctx.globalAlpha=p.alpha*blend;current.knockout.draw(ctx,track.partId);ctx.restore();
    }
    currentFrames++;
  }

  function lane(x,w,version) {
    const scale=Math.min(height/520,w/850);
    const view={left:600-w/scale/2,right:600+w/scale/2,top:-180,bottom:-180+height/scale};
    ctx.save();ctx.beginPath();ctx.rect(x,0,w,height);ctx.clip();
    ctx.translate(x+w/2-600*scale,180*scale);ctx.scale(scale,scale);
    ctx.imageSmoothingEnabled=false;water(view);
    if(age<0) rest(); else if(version==='candidate')drawCandidate(view);else drawCurrent(view);
    ctx.restore();
    if($('version').value==='both') {
      ctx.fillStyle='#fffdf2';ctx.fillRect(x+14,14,version==='candidate'?152:132,28);
      ctx.fillStyle='#557478';ctx.font='13px Microsoft YaHei';ctx.fillText(version==='candidate'?'新版 · 三个关键姿态':'上一版 · 单姿态',x+24,33);
    }
    return view;
  }

  function render() {
    if(!status.loaded || !width) return;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    let view;
    if($('version').value==='both') {lane(0,width/2,'current');view=lane(width/2,width/2,'candidate');ctx.fillStyle='#dfd9ca';ctx.fillRect(width/2-1,0,2,height);}
    else view=lane(0,width,$('version').value);
    const a=K.sample(candidate,age,view);
    const phase = age<0?'准备受击':age>=candidate.config.duration?'动作结束':stageNames[a.phase];
    $('phase-tag').textContent=$('version').value==='current'?'上一版 · 单姿态翻飞':$('version').value==='both'?`新版：${phase}`:phase;
    $('stage-label').hidden=$('version').value==='both';
    $('stage-label').textContent=$('version').value==='current'?'上一版 · 现有游戏动作':'新版 · 粗动作 / 三姿态';
    $('timeline').value=Math.min(candidate.config.duration,age);
    $('time').textContent=age<0?'准备':`${Math.min(age,candidate.config.duration).toFixed(2)} s`;
    $('play').textContent=playing?'暂停':'播放';
    document.querySelectorAll('[data-time]').forEach(b=>b.setAttribute('aria-current',age>=0&&a.phase===K.sample(candidate,Number(b.dataset.time)).phase?'true':'false'));
    $('check-status').textContent=JSON.stringify({playing,age:+age.toFixed(3),version:$('version').value,speed:Number($('speed').value),
      direction:$('direction').value,origin:$('origin').value,pose:age<0?'idle':a.pose,phase:age<0?'idle':a.phase,
      body:{x:+a.body.x.toFixed(2),y:+a.body.y.toFixed(2)},ring:{x:+a.ring.x.toFixed(2),y:+a.ring.y.toFixed(2)},
      duration:candidate.config.duration,kittenAttached:true,independentParts:2,completeMotion:true,
      candidateFrames,currentFrames,noScroll:document.documentElement.scrollHeight<=innerHeight+1},null,2);
  }

  function pauseAt(next) {playing=false;age=Math.max(-0.3,Math.min(candidate.config.duration,next));previous=null;render();}
  function replay() {age=-0.3;previous=null;playing=true;render();}

  try {
    const metadataUrl='/docs/art/juzi-motion-study-v1/poses.json';
    const response=await fetch(metadataUrl,{cache:'no-cache'});if(!response.ok)throw new Error('Pose metadata unavailable');
    const metadata=await response.json();poseMetadata=metadata;
    const image=new Image();image.src=new URL(metadata.image,new URL(metadataUrl,location.href)).href;
    [current]=await Promise.all([window.MiaoArt.load('juzi','concept-v2'),image.decode()]);
    if(!current.knockout)throw new Error('Current Juzi split art unavailable');
    sprites=Object.fromEntries(metadata.frames.map(frame=>{
      const s=frame.source, scale=metadata.headWidthInWorld/frame.headWidth;
      return [frame.id,{image:bitmap(image,s),box:{x:(s.x-frame.headAnchor.x)*scale,y:(s.y-frame.headAnchor.y)*scale,width:s.width*scale,height:s.height*scale}}];
    }));
    status.loaded=true;$('loading').hidden=true;rebuild();
    new ResizeObserver(resize).observe(canvas);resize();
    for(const id of ['version','direction','origin'])$(id).addEventListener('change',()=>{rebuild();replay();});
    $('play').addEventListener('click',()=>{playing=!playing;previous=null;render();});
    $('replay').addEventListener('click',replay);
    $('previous').addEventListener('click',()=>pauseAt(age-1/60));$('next').addEventListener('click',()=>pauseAt(age+1/60));
    $('timeline').addEventListener('input',()=>pauseAt(Number($('timeline').value)));
    document.querySelectorAll('[data-time]').forEach(b=>b.addEventListener('click',()=>pauseAt(Number(b.dataset.time))));
    document.addEventListener('visibilitychange',()=>{previous=null;});
    function frame(time) {
      const dt=previous===null?0:Math.min((time-previous)/1000,0.1);previous=time;
      if(playing&&!document.hidden) {
        age+=dt*Number($('speed').value);
        if(age>candidate.config.duration+0.65) {if($('loop').checked)age=-0.3;else{age=candidate.config.duration;playing=false;}}
      }
      render();requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch(error) {console.error(error);$('loading').textContent='素材载入失败，请刷新小样页。';$('check-status').textContent=String(error);}
})();
