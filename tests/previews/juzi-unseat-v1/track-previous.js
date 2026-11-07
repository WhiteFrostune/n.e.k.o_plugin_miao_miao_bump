/* Reference-led unseating study. Isolated from the actual game. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MiaoUnseatPrevious=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const CONFIG=Object.freeze({duration:1.05,bodyRelease:.045,ringRelease:.085,bodyExit:.825,ringExit:.88,faceRestY:-35});
  const clamp=n=>Math.max(0,Math.min(1,n));
  const smooth=n=>n*n*(3-2*n);
  const bezier=(p0,p1,p2,p3,u)=>{
    const v=1-u;
    return {x:v*v*v*p0.x+3*v*v*u*p1.x+3*v*u*u*p2.x+u*u*u*p3.x,
      y:v*v*v*p0.y+3*v*v*u*p1.y+3*v*u*u*p2.y+u*u*u*p3.y};
  };
  function create(event,{radius=40,faceRestY=CONFIG.faceRestY}={}){
    const d=event.direction||{x:-1,y:0},length=Math.hypot(d.x,d.y);
    const direction=Number.isFinite(length)&&length>1e-7?{x:d.x/length,y:d.y/length}:{x:-1,y:0};
    return {x:event.x,y:event.y,direction,radius,faceRestY,fan:Math.abs(direction.x)>.15?Math.sign(direction.x):1};
  }
  function sample(track,age,view={left:-200,top:-180,right:1400,bottom:900}){
    const t=Math.max(0,Math.min(CONFIG.duration,age)),d=track.direction,fan=track.fan,k=track.radius/40;
    const push=5*k*smooth(clamp(t/CONFIG.bodyRelease));
    const press=Math.sin(Math.PI*clamp(t/CONFIG.bodyRelease));
    const jitter=1.1*k*Math.sin(t*400)*Math.exp(-t*75)*(1-clamp(t/CONFIG.bodyRelease));
    const base={x:track.x+d.x*5*k,y:track.y+d.y*5*k};
    const bodyStart={x:base.x,y:base.y+track.faceRestY};
    const bodyU=clamp((t-CONFIG.bodyRelease)/(CONFIG.bodyExit-CONFIG.bodyRelease));
    const ringU=clamp((t-CONFIG.ringRelease)/(CONFIG.ringExit-CONFIG.ringRelease));
    const endY=Math.min(track.y-620*k,view.top-125*k);
    const b=bezier(bodyStart,{x:bodyStart.x+d.x*200*k,y:bodyStart.y+(d.y*45-65)*k},
      {x:track.x+fan*280*k,y:track.y-255*k},{x:track.x+fan*420*k,y:endY},bodyU);
    const r=bezier(base,{x:base.x-fan*90*k,y:base.y+(d.y*30-70)*k},
      {x:track.x-fan*260*k,y:track.y-220*k},{x:track.x-fan*380*k,y:endY-20*k},ringU);
    const bodyAngle=-fan*.7*smooth(clamp((t-.12)/.62));
    const ringAngle=fan*.22*smooth(clamp(t/.065))+fan*3.0*(1-Math.exp(-4*Math.max(0,t-CONFIG.ringRelease)));
    const active=age<CONFIG.duration?1:0;
    const body={x:t<CONFIG.bodyRelease?track.x+d.x*push+d.x*jitter:b.x,
      y:t<CONFIG.bodyRelease?track.y+track.faceRestY+d.y*push+d.y*jitter:b.y,
      angle:bodyAngle,scale:1-.10*smooth(clamp((t-.28)/.55)),
      scaleX:1-.07*Math.abs(d.x)*press,scaleY:1-.07*Math.abs(d.y)*press,alpha:active,
      mirror:fan>0?-1:1};
    const ring={x:t<CONFIG.ringRelease?track.x+d.x*push:r.x,y:t<CONFIG.ringRelease?track.y+d.y*push:r.y,
      angle:ringAngle,scale:1-.08*smooth(ringU),scaleX:1-.1*Math.abs(d.x)*press,
      scaleY:1-.1*Math.abs(d.y)*press,alpha:active};
    return {age:t,duration:CONFIG.duration,pose:t<.09?'contact':t<.2?'release':t<.34?'tumble':'follow',
      phase:t<.055?'impact':t<.2?'release':t<.65?'tumble':'exit',body,ring,
      frontRim:1-smooth(clamp((t-.065)/.055)),
      shadow:{x:track.x+d.x*push,y:track.y+d.y*push,alpha:.14*Math.exp(-Math.max(0,bodyStart.y-body.y)/45)}};
  }
  function attacker(track,age){
    const distance=age<0?80+180*clamp(-age/.3):80-125*(1-Math.exp(-5*age));
    return {x:track.x-track.direction.x*distance,y:track.y-track.direction.y*distance};
  }
  return {CONFIG,create,sample,attacker};
});
