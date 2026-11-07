/* Inherited contact motion and a compact rolling unseat. Presentation only. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MiaoUnseatMomentum=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const CONFIG=Object.freeze({duration:1.25,impactEnd:.035,unseatStart:.07,
    releaseAt:.22,clearStart:.52,bodyExit:1.02,ringExit:1.12,faceRestY:-35});
  const RELEASE=Object.freeze({...CONFIG,clearStart:.26,bodyExit:.66,ringExit:.74,duration:.90});
  const clamp=n=>Math.max(0,Math.min(1,n));
  const smooth=n=>{n=clamp(n);return n*n*(3-2*n);};
  const vector=v=>({x:Number.isFinite(v?.x)?v.x:0,y:Number.isFinite(v?.y)?v.y:0});
  const unit=(v,fallback={x:1,y:0})=>{const l=Math.hypot(v.x,v.y);return l>1e-7?{x:v.x/l,y:v.y/l}:{...fallback};};
  const integral=(rate,t)=>(1-Math.exp(-rate*t))/rate;
  function create(event,{radius=40,faceRestY=CONFIG.faceRestY,profile='focus',alignedFlight=false}={}){
    const direction=unit(vector(event.direction)),m=event.motion||{},velocity=vector(m.velocity),source=vector(m.sourceVelocity);
    const mass=Number.isFinite(m.mass)&&m.mass>0?m.mass:1;
    const sourceMass=Number.isFinite(m.sourceMass)&&m.sourceMass>0?m.sourceMass:1;
    const closing=Math.max(0,(source.x-velocity.x)*direction.x+(source.y-velocity.y)*direction.y);
    const restitution=Number.isFinite(m.restitution)?Math.max(0,Math.min(1,m.restitution)):.94;
    const impulse=1.15*(1+restitution)*closing*sourceMass/(mass+sourceMass);
    const normalSpeed=velocity.x*direction.x+velocity.y*direction.y;
    // A small cartoon finishing kick keeps very gentle lethal touches readable.
    // Strong hits use mass/relative speed with 15% visual exaggeration because
    // the surviving attacker keeps moving through a removed physics body.
    const kick=Math.max(impulse,220*radius/40-normalSpeed,0);
    const outgoing={x:velocity.x+direction.x*kick,y:velocity.y+direction.y*kick};
    const fan=Math.abs(outgoing.x)>.15?Math.sign(outgoing.x):direction.x<0?-1:1;
    return {x:event.x,y:event.y,radius,faceRestY,direction,velocity,
      kick:{x:direction.x*kick,y:direction.y*kick},closing,fan,inertia:true,
      ...(profile==='release'?{config:RELEASE}:{}),
      ...(alignedFlight?{alignedFlight:true}:{}),
      bodySlip:30+10*clamp(closing/1000),ringSlip:8+4*clamp(closing/1000)};
  }
  function carry(track,t){
    const drag=.75,fast=drag+1/.012;
    const a=integral(drag,t),b=integral(fast,t);
    const decay=Math.exp(-drag*t),burst=decay-Math.exp(-fast*t);
    return {x:track.x+track.velocity.x*a+track.kick.x*(a-b),
      y:track.y+track.velocity.y*a+track.kick.y*(a-b),
      vx:track.velocity.x*decay+track.kick.x*burst,vy:track.velocity.y*decay+track.kick.y*burst};
  }
  function contact(track,t){
    const ground=carry(track,t),k=track.radius/40,d=track.direction,fan=track.fan;
    const z=clamp(t/.1),lift=6*k*smooth(z),liftV=t<.1?6*k*6*z*(1-z)/.1:0;
    const q=clamp(t/CONFIG.unseatStart),tilt=-fan*.22*smooth(q);
    const tiltV=t<CONFIG.unseatStart?-fan*.22*6*q*(1-q)/CONFIG.unseatStart:0;
    const span=CONFIG.releaseAt-CONFIG.unseatStart,u=clamp((t-CONFIG.unseatStart)/span);
    // The old unseat offset was still moving upward at release and became a
    // permanent flight velocity. Settle this local pose before free flight:
    // only the inherited collision momentum may choose the exit direction.
    const slip=track.alignedFlight?smooth(u):u*u*(2-u);
    const slipV=t>=CONFIG.unseatStart&&t<=CONFIG.releaseAt?
      (track.alignedFlight?6*u*(1-u):(4*u-3*u*u))/span:0;
    const ox=-Math.sin(tilt)*track.faceRestY,oy=Math.cos(tilt)*track.faceRestY;
    const part=(body)=>{
      const along=(body?24:-12)*k,rise=(body?track.bodySlip:track.ringSlip)*k;
      const verticalAlong=d.y*along*(track.alignedFlight?1:.25);
      return {x:ground.x+(body?ox:0)+d.x*along*slip,
        y:ground.y-lift+(body?oy:0)+(verticalAlong-rise)*slip,
        vx:ground.vx+(body?-Math.cos(tilt)*track.faceRestY*tiltV:0)+d.x*along*slipV,
        vy:ground.vy-liftV+(body?-Math.sin(tilt)*track.faceRestY*tiltV:0)+(verticalAlong-rise)*slipV,
        angle:tilt+fan*(body?-.18:.6)*slip};
    };
    return {body:part(true),ring:part(false),ground,waterlineY:ground.y+6*k};
  }
  function rawFlight(start,t,release){
    const q=Math.max(0,t-release),drag=.6,a=integral(drag,q),v=Math.exp(-drag*q);
    return {x:start.x+start.vx*a,y:start.y+start.vy*a,vx:start.vx*v,vy:start.vy*v};
  }
  function clearFlight(track,start,t,end,view){
    const config=track.config||CONFIG;
    const p=rawFlight(start,config.clearStart,config.releaseAt);
    if(t<=config.clearStart)return rawFlight(start,t,config.releaseAt);
    const speed=Math.hypot(p.vx,p.vy),d=unit({x:p.vx,y:p.vy},track.direction),margin=180*track.radius/40;
    const distances=[];
    if(d.x>1e-7)distances.push((view.right+margin-p.x)/d.x);
    if(d.x<-1e-7)distances.push((view.left-margin-p.x)/d.x);
    if(d.y>1e-7)distances.push((view.bottom+margin-p.y)/d.y);
    if(d.y<-1e-7)distances.push((view.top-margin-p.y)/d.y);
    const span=end-config.clearStart,distance=Math.max(speed*span*.8,0,Math.min(...distances));
    const u=clamp((t-config.clearStart)/span),v=1-u,a=speed*span/3;
    const b=Math.max(a,distance-Math.max(speed*span*.25,distance*.3));
    const travel=3*v*v*u*a+3*v*u*u*b+u*u*u*distance;
    return {x:p.x+d.x*travel,y:p.y+d.y*travel};
  }
  function sample(track,age,view={left:-200,top:-180,right:1400,bottom:900}){
    const config=track.config||CONFIG;
    const t=Math.max(0,Math.min(config.duration,age)),joint=contact(track,Math.min(t,config.releaseAt));
    const release=contact(track,config.releaseAt),free=Math.max(0,t-config.releaseAt),fan=track.fan;
    const b=t<=config.releaseAt?joint.body:clearFlight(track,release.body,t,config.bodyExit,view);
    const r=t<=config.releaseAt?joint.ring:clearFlight(track,release.ring,t,config.ringExit,view);
    const press=Math.sin(Math.PI*clamp(t/config.impactEnd)),active=age<config.duration?1:0;
    const spin=(body)=>fan*(body?-.18:.6)/(config.releaseAt-config.unseatStart)*
      (track.alignedFlight?integral(2,free)-integral(27,free):.5*(1-Math.exp(-free/.5)));
    const part=(p,body)=>({x:p.x,y:p.y,angle:(body?joint.body.angle:joint.ring.angle)+spin(body),
      scale:1-(body ? .07 : .05)*smooth(free/.8),scaleX:1-.08*Math.abs(track.direction.x)*press,
      scaleY:1-.08*Math.abs(track.direction.y)*press,alpha:active,...(body?{mirror:fan>0?-1:1}:{})});
    const ground=carry(track,Math.min(t,config.clearStart));
    return {age:t,duration:config.duration,releaseAt:config.releaseAt,
      pose:t<.1?'contact':t<.22?'release':t<.4?'tumble':'follow',
      phase:t<.07?'impact':t<.22?'release':t<.6?'tumble':'exit',
      body:part(b,true),ring:part(r,false),waterlineY:joint.waterlineY,
      frontRim:1-smooth((t-.14)/.08),
      shadow:{x:ground.x,y:ground.y,alpha:.14*(1-smooth((t-.22)/.22))}};
  }
  function elapsedSince(event,now){
    return Number.isFinite(event.simulationTime)&&Number.isFinite(now)?
      Math.max(0,Math.min(CONFIG.duration,now-event.simulationTime)):0;
  }
  return {CONFIG,RELEASE,create,sample,elapsedSince};
});
