/* Shared contact, rolling unseat, then inherited free flight. Presentation only. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MiaoUnseatAction=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const CONFIG=Object.freeze({duration:1.25,impactEnd:.04,unseatStart:.16,
    bodyRelease:.34,ringRelease:.34,bodyExit:1,ringExit:1.1,faceRestY:-35});
  const clamp=n=>Math.max(0,Math.min(1,n));
  const smooth=n=>n*n*(3-2*n);
  function create(event,{radius=40,faceRestY=CONFIG.faceRestY}={}){
    const d=event.direction||{x:-1,y:0},length=Math.hypot(d.x,d.y);
    const direction=Number.isFinite(length)&&length>1e-7?{x:d.x/length,y:d.y/length}:{x:-1,y:0};
    return {x:event.x,y:event.y,direction,radius,faceRestY,fan:Math.abs(direction.x)>.15?Math.sign(direction.x):1};
  }
  function contact(track,t){
    const d=track.direction,k=track.radius/40,fan=track.fan;
    const q=Math.max(0,t-CONFIG.impactEnd),accelTime=.045;
    const distance=t<=CONFIG.impactEnd?4*smooth(clamp(t/CONFIG.impactEnd)):
      4+360*(q-accelTime*(1-Math.exp(-q/accelTime)));
    const velocity=t<=CONFIG.impactEnd?4*6*clamp(t/CONFIG.impactEnd)*(1-clamp(t/CONFIG.impactEnd))/CONFIG.impactEnd:
      360*(1-Math.exp(-q/accelTime));
    const tilt=-fan*.22*smooth(clamp(t/CONFIG.unseatStart));
    const tiltVelocity=t<CONFIG.unseatStart?-fan*.22*6*(t/CONFIG.unseatStart)*(1-t/CONFIG.unseatStart)/CONFIG.unseatStart:0;
    const lift=10*smooth(clamp(t/CONFIG.unseatStart));
    const liftVelocity=t<CONFIG.unseatStart?10*6*(t/CONFIG.unseatStart)*(1-t/CONFIG.unseatStart)/CONFIG.unseatStart:0;
    const span=CONFIG.bodyRelease-CONFIG.unseatStart,u=clamp((t-CONFIG.unseatStart)/span),slip=u*u;
    const slipVelocity=t>=CONFIG.unseatStart&&t<=CONFIG.bodyRelease?2*u/span:0;
    const x=track.x+d.x*distance*k,y=track.y+(d.y*distance-lift)*k;
    const vx=d.x*velocity*k,vy=(d.y*velocity-liftVelocity)*k;
    // The seated face offset rotates around the same ring pivot before release.
    const ox=-Math.sin(tilt)*track.faceRestY,oy=Math.cos(tilt)*track.faceRestY;
    return {
      body:{x:x+ox+d.x*24*k*slip,y:y+oy+(d.y*12-80)*k*slip,
        vx:vx-Math.cos(tilt)*track.faceRestY*tiltVelocity+d.x*24*k*slipVelocity,
        vy:vy-Math.sin(tilt)*track.faceRestY*tiltVelocity+(d.y*12-80)*k*slipVelocity,
        angle:tilt-fan*.18*slip},
      ring:{x:x-d.x*22*k*slip,y:y+(-d.y*5-40)*k*slip,
        vx:vx-d.x*22*k*slipVelocity,vy:vy+(-d.y*5-40)*k*slipVelocity,
        angle:tilt+fan*.6*slip},
      pivot:{x,y},waterlineY:track.y+d.y*distance*k+6*k,slip
    };
  }
  function airborne(start,t,end,release,endY){
    const span=end-release,u=clamp((t-release)/span),v=1-u;
    // Inherit horizontal velocity; do not aim at opposite screen corners.
    const p1=Math.max(endY+90,Math.min(start.y,start.y+start.vy*span/3));
    const p2=Math.min(start.y,endY+90);
    return {x:start.x+start.vx*span*u,
      y:v*v*v*start.y+3*v*v*u*p1+3*v*u*u*p2+u*u*u*endY};
  }
  function sample(track,age,view={left:-200,top:-180,right:1400,bottom:900}){
    const t=Math.max(0,Math.min(CONFIG.duration,age)),d=track.direction,k=track.radius/40,fan=track.fan;
    const seated=contact(track,Math.min(t,CONFIG.bodyRelease)),release=contact(track,CONFIG.bodyRelease);
    const free=Math.max(0,t-CONFIG.bodyRelease),endY=Math.min(track.y-650*k,view.top-155*k);
    const b=t<=CONFIG.bodyRelease?seated.body:airborne(release.body,t,CONFIG.bodyExit,CONFIG.bodyRelease,endY);
    const r=t<=CONFIG.ringRelease?seated.ring:airborne(release.ring,t,CONFIG.ringExit,CONFIG.ringRelease,endY-20*k);
    const press=Math.sin(Math.PI*clamp(t/CONFIG.impactEnd)),active=age<CONFIG.duration?1:0;
    const body={x:b.x,y:b.y,angle:seated.body.angle-fan*1.2*(1-Math.exp(-free/.6)),
      scale:1-.07*smooth(clamp(free/.66)),scaleX:1-.07*Math.abs(d.x)*press,
      scaleY:1-.07*Math.abs(d.y)*press,alpha:active,mirror:fan>0?-1:1};
    const ring={x:r.x,y:r.y,angle:seated.ring.angle+fan*(2*.6/(CONFIG.bodyRelease-CONFIG.unseatStart))*.5*(1-Math.exp(-free/.5)),
      scale:1-.05*smooth(clamp(free/.76)),scaleX:1-.1*Math.abs(d.x)*press,
      scaleY:1-.1*Math.abs(d.y)*press,alpha:active};
    return {age:t,duration:CONFIG.duration,pose:t<.22?'contact':t<.34?'release':t<.5?'tumble':'follow',
      phase:t<CONFIG.unseatStart?'impact':t<CONFIG.bodyRelease?'release':t<.75?'tumble':'exit',body,ring,
      frontRim:1-smooth(clamp((t-.25)/.09)),waterlineY:seated.waterlineY,
      shadow:{x:seated.pivot.x,y:seated.pivot.y,alpha:.14*Math.exp(-Math.max(0,track.y+track.faceRestY-body.y)/45)}};
  }
  function attacker(track,age){
    const distance=age<0?80+180*clamp(-age/.3):80-125*(1-Math.exp(-5*age));
    return {x:track.x-track.direction.x*distance,y:track.y-track.direction.y*distance};
  }
  return {CONFIG,create,sample,attacker};
});
