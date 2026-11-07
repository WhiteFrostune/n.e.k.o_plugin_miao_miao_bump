(async function(){
  'use strict';
  const $=id=>document.getElementById(id),canvas=$('study-canvas'),ctx=canvas.getContext('2d');
  const N=window.MiaoUnseatStudy,P=window.MiaoUnseatPrevious,K=window.MiaoKnockoutAction,KR=window.MiaoKnockoutRenderer,C=window.MiaoStudyCamera;
  let art,metadata,sprites,track,previousTrack,oldTrack,origin,age=-.3,playing=true,previous=null,width=0,height=0,dpr=1,loaded=false;
  const names={impact:'共同受击 · 一起移动、倾斜',release:'翻出圈沿 · 仍有重叠',tumble:'脱离后 · 延续各自速度',exit:'离场'};
  const limit=()=>$('version').value==='old'?K.IMPACT.duration:$('version').value==='previous'?P.CONFIG.duration:N.CONFIG.duration;

  function rebuild(){
    const direction={left:{x:-1,y:0},right:{x:1,y:0},up:{x:0,y:-1},down:{x:0,y:1}}[$('direction').value];
    origin={x:600,y:{center:150,top:45,bottom:240}[$('origin').value]};
    track=N.create({...origin,direction},{faceRestY:metadata.faceRestY});
    previousTrack=P.create({...origin,direction},{faceRestY:metadata.faceRestY});
    oldTrack=K.create({...origin,direction},{config:{...K.IMPACT,headRestY:art.knockoutPoses.headRestY}});
    $('timeline').max=limit();
  }
  function bitmap(image,s){
    const c=document.createElement('canvas');c.width=96;c.height=Math.round(96*s.height/s.width);
    const p=c.getContext('2d');p.imageSmoothingEnabled=false;
    p.drawImage(image,s.x,s.y,s.width,s.height,0,0,c.width,c.height);
    const data=p.getImageData(0,0,c.width,c.height);
    for(let i=3;i<data.data.length;i+=4)data.data[i]=data.data[i]<128?0:255;
    p.putImageData(data,0,0);return c;
  }
  function water(view){
    ctx.fillStyle='#f4efdf';ctx.fillRect(view.left,view.top,view.right-view.left,view.bottom-view.top);
    ctx.fillStyle='#c8eae4';ctx.fillRect(view.left,-10,view.right-view.left,10);
    ctx.fillStyle='#fff9e8';ctx.fillRect(view.left,0,view.right-view.left,10);
    ctx.fillStyle='#87d8de';ctx.fillRect(view.left,10,view.right-view.left,view.bottom-10);
    ctx.strokeStyle='#bcebf0';ctx.lineWidth=1.5;
    for(let y=40;y<view.bottom;y+=65)for(let x=Math.floor(view.left/150)*150;x<view.right;x+=150){
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+26,y-7);ctx.lineTo(x+53,y-3);ctx.stroke();
    }
  }
  function drawFloat(p,front=false){
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle);ctx.scale(p.scale*p.scaleX,p.scale*p.scaleY);ctx.globalAlpha*=p.alpha;
    if(front){ctx.beginPath();ctx.rect(-50,3,100,30);ctx.clip();}
    art.knockout.draw(ctx,'float');ctx.restore();
  }
  function drawNew(state,view,version){
    const blend=Math.max(0,Math.min(1,age/.022));
    if(blend<1){ctx.save();ctx.globalAlpha=1-blend;ctx.translate(origin.x,origin.y);art.draw(ctx,1);ctx.restore();}
    ctx.save();ctx.globalAlpha=blend;drawFloat(state.ring);
    ctx.save();
    if(age<(version==='previous'?.11:N.CONFIG.bodyRelease)){
      const waterline=version==='previous'?origin.y+6:state.waterlineY;
      ctx.beginPath();ctx.rect(view.left,view.top,view.right-view.left,Math.max(0,waterline-view.top));ctx.clip();
    }
    const p=state.body,s=sprites[state.pose];
    ctx.translate(p.x,p.y);ctx.rotate(p.angle);ctx.scale(p.scale*p.scaleX*p.mirror,p.scale*p.scaleY);ctx.globalAlpha*=p.alpha;
    ctx.drawImage(s.bitmap,s.box.x,s.box.y,s.box.width,s.box.height);ctx.restore();
    if(state.frontRim>0){ctx.save();ctx.globalAlpha*=state.frontRim;drawFloat(state.ring,true);ctx.restore();}
    ctx.restore();
  }
  function lane(x,w,version,cameraMode,label){
    const scale=Math.min(height/500,w/820),view={left:600-w/scale/2,right:600+w/scale/2,top:-150,bottom:-150+height/scale};
    const center={x:600,y:(view.top+view.bottom)/2};
    const camera=C.sample(age,{center,origin,direction:track.direction,enabled:cameraMode==='cinematic'});
    // Both lanes sample motion using the SAME base viewport. Camera changes
    // only the final projection, so zoom cannot move an off-screen flight target.
    const sceneView={left:view.left-300,right:view.right+300,top:view.top-300,bottom:view.bottom+300};
    ctx.save();ctx.beginPath();ctx.rect(x,0,w,height);ctx.clip();
    ctx.translate(x+w/2,height/2);ctx.scale(scale*camera.zoom,scale*camera.zoom);
    ctx.translate(-camera.x,-camera.y);ctx.imageSmoothingEnabled=false;water(sceneView);
    if($('show-attacker').checked){
      const p=N.attacker(track,age);
      ctx.save();ctx.translate(p.x,p.y);art.draw(ctx,age>=0&&age<.12?1:0);ctx.restore();
      ctx.fillStyle='#4c7c83';ctx.textAlign='center';ctx.font='12px Microsoft YaHei';ctx.fillText('来撞的猫',p.x,p.y+31);
    }
    if(age<0){ctx.save();ctx.translate(origin.x,origin.y);art.draw(ctx,0);ctx.restore();}
    else {
      const state=version==='new'?N.sample(track,age,view):version==='previous'?P.sample(previousTrack,age,view):K.sample(oldTrack,age,view);
      ctx.save();ctx.globalAlpha=state.shadow.alpha;ctx.fillStyle='#3b8d9a';ctx.beginPath();
      ctx.ellipse(state.shadow.x,state.shadow.y+8,34,10,0,0,Math.PI*2);ctx.fill();ctx.restore();
      if(version==='old')KR.draw(ctx,art,state,origin,view);else drawNew(state,view,version);
    }
    ctx.restore();
    if(label){
      ctx.fillStyle='#fffdf3ed';ctx.fillRect(x+12,12,232,28);
      ctx.fillStyle='#58777c';ctx.font='13px Microsoft YaHei';ctx.fillText(label,x+22,31);
    }
    return view;
  }
  function render(){
    if(!loaded||!width)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    let view;
    const cameraMode=$('camera').value,split=cameraMode==='compare'||$('version').value==='both';
    if(cameraMode==='compare'){
      lane(0,width/2,$('version').value,'fixed','固定镜头 · 同一套动作');
      view=lane(width/2,width/2,$('version').value,'cinematic','移动镜头 · 同一套动作');
    }else if($('version').value==='both'){
      lane(0,width/2,'previous',cameraMode,'上次小样 · 过早分叉');
      view=lane(width/2,width/2,'new',cameraMode,'本次修改 · 共同受击后脱圈');
    }else view=lane(0,width,$('version').value,cameraMode);
    if(split){ctx.fillStyle='#ddd8ca';ctx.fillRect(width/2-1,0,2,height);}
    const state=$('version').value==='previous'?P.sample(previousTrack,age,view):N.sample(track,age,view);
    const phase=age<0?'准备碰撞':age>=N.CONFIG.duration?'新版动作结束':names[state.phase];
    $('stage-label').hidden=split;
    $('stage-label').textContent=$('version').value==='old'?'当前实机版 · 对比保留':$('version').value==='previous'?'上次小样 · 对比保留':'本次修改 · 先一起受击，再脱圈';
    $('phase-tag').textContent=$('version').value==='old'?'当前实机版':$('version').value==='previous'?'上次小样':$('version').value==='both'?`本次：${phase}`:phase;
    $('timeline').value=Math.min(limit(),age);$('time').textContent=age<0?'准备':`${Math.min(age,limit()).toFixed(2)} s`;
    $('play').textContent=playing?'暂停':'播放';
    const beat=age<.16?0:age<.27?1:age<.34?2:age<.75?3:4;
    document.querySelectorAll('[data-time]').forEach((b,i)=>b.setAttribute('aria-current',age>=0&&beat===i?'true':'false'));
    $('check-status').textContent=JSON.stringify({playing,age:+age.toFixed(3),version:$('version').value,
      speed:Number($('speed').value),direction:$('direction').value,origin:$('origin').value,camera:cameraMode,
      cameraSample:C.sample(age,{center:{x:600,y:(view.top+view.bottom)/2},origin,direction:track.direction,enabled:cameraMode!=='fixed'}),
      pose:age<0?'idle':state.pose,phase:age<0?'idle':state.phase,
      body:{x:+state.body.x.toFixed(2),y:+state.body.y.toFixed(2)},ring:{x:+state.ring.x.toFixed(2),y:+state.ring.y.toFixed(2)},
      completeMotion:true,kittenAttached:true,battleRulesActive:false,liveGameChanged:false,
      noScroll:document.documentElement.scrollHeight<=innerHeight+1},null,2);
  }
  function resize(){const r=canvas.getBoundingClientRect();width=r.width;height=r.height;dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);render();}
  function replay(){age=-.3;previous=null;playing=true;render();}
  function pauseAt(next){age=Math.max(-.3,Math.min(limit(),next));playing=false;previous=null;render();}
  try {
    const url='/docs/art/juzi-unseat-study-v1/poses.json',response=await fetch(url,{cache:'no-cache'});
    if(!response.ok)throw new Error('Pose metadata unavailable');metadata=await response.json();
    const image=new Image();image.src=new URL(metadata.image,new URL(url,location.href)).href;
    [art]=await Promise.all([window.MiaoArt.load('juzi','concept-v2'),image.decode()]);
    if(!art.knockout||!art.knockoutPoses)throw new Error('Comparison art unavailable');
    sprites=Object.fromEntries(metadata.frames.map(f=>{
      const s=f.source,k=metadata.worldPerSourcePixel;
      return [f.id,{bitmap:bitmap(image,s),box:{x:(s.x-f.anchor.x)*k,y:(s.y-f.anchor.y)*k,width:s.width*k,height:s.height*k}}];
    }));
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)$('camera').value='fixed';
    loaded=true;$('loading').hidden=true;rebuild();new ResizeObserver(resize).observe(canvas);resize();
    for(const id of ['version','direction','origin'])$(id).addEventListener('change',()=>{rebuild();replay();});
    $('version').addEventListener('change',()=>{
      if($('version').value==='both'&&$('camera').value==='compare')$('camera').value='cinematic';render();
    });
    $('camera').addEventListener('change',()=>{
      if($('camera').value==='compare'&&$('version').value==='both'){$('version').value='new';rebuild();}
      render();
    });
    $('show-attacker').addEventListener('change',render);
    $('play').addEventListener('click',()=>{playing=!playing;previous=null;render();});$('replay').addEventListener('click',replay);
    $('previous').addEventListener('click',()=>pauseAt(age-1/60));$('next').addEventListener('click',()=>pauseAt(age+1/60));
    $('timeline').addEventListener('input',()=>pauseAt(Number($('timeline').value)));
    document.querySelectorAll('[data-time]').forEach(b=>b.addEventListener('click',()=>pauseAt(Number(b.dataset.time))));
    document.addEventListener('visibilitychange',()=>{previous=null;});
    function frame(time){const dt=previous===null?0:Math.min((time-previous)/1000,.1);previous=time;
      if(playing&&!document.hidden){age+=dt*Number($('speed').value);if(age>limit()+.35){if($('loop').checked)age=-.3;else{age=limit();playing=false;}}}
      render();requestAnimationFrame(frame);}
    requestAnimationFrame(frame);
  }catch(error){console.error(error);$('loading').textContent='小样素材载入失败，请刷新重试。';$('check-status').textContent=String(error);}
})();
