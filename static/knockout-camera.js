/* Presentation-only camera. Never feeds a changed viewport into motion sampling. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MiaoKnockoutCamera=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=n=>Math.max(0,Math.min(1,n));
  const smooth=n=>{n=clamp(n);return n*n*(3-2*n);};
  const smoother=n=>{n=clamp(n);return clamp(n*n*n*(n*(n*6-15)+10));};
  const GENTLE=Object.freeze({pushEnd:.30,holdEnd:.50,end:1.15,zoom:.16,lag:.06});

  // Observe the actual body trajectory a little late, then ease the observation
  // clock to rest before its fast exit. The camera never chases an off-screen cat.
  function followTime(age,startAt=0){
    const t=Math.max(0,age-GENTLE.lag),start=.30,span=.16;
    if(t<=start)return Math.max(startAt,t);
    const u=clamp((t-start)/span);
    return Math.max(startAt,start+span*(u-.5*u*u));
  }
  function gentle(age,{width,height,origin,follow={x:0,y:0},enabled=true}){
    const center={x:width/2,y:height/2};
    if(!enabled||age<=0||age>=GENTLE.end)return {...center,zoom:1};
    const weight=smoother(age/GENTLE.pushEnd)*(1-smoother((age-GENTLE.holdEnd)/(GENTLE.end-GENTLE.holdEnd)));
    const zoom=1+GENTLE.zoom*weight;
    const gain=smoother((age-.08)/.24);
    const finite=n=>Number.isFinite(n)?n:0;
    const dx=((finite(origin.x)-center.x)*.45+finite(follow.x)*.30*gain)*weight;
    const dy=((finite(origin.y)-25-center.y)*.45+finite(follow.y)*.30*gain)*weight;
    // Smooth saturation avoids a hard stop at the map edge while leaving no blank margin.
    const bounded=(offset,size)=>{
      const limit=size/2-size/(2*zoom);
      return limit>1e-9?limit*Math.tanh(offset/limit):0;
    };
    return {x:center.x+bounded(dx,width),y:center.y+bounded(dy,height),zoom};
  }
  const FOCUS=Object.freeze({pushEnd:.09,holdEnd:.50,end:1.4,zoom:.32});
  function focus(age,{width,height,origin,follow={x:0,y:0},enabled=true}){
    const center={x:width/2,y:height/2};
    if(!enabled||age<=0||age>=FOCUS.end)return {...center,zoom:1};
    const weight=smoother(age/FOCUS.pushEnd)*(1-smoother((age-FOCUS.holdEnd)/(FOCUS.end-FOCUS.holdEnd)));
    const zoom=1+FOCUS.zoom*weight,gain=smoother((age-.12)/.25);
    const bounded=(offset,size)=>{
      const limit=size/2-size/(2*zoom);
      return limit>1e-9?limit*Math.tanh(offset*weight/limit):0;
    };
    return {x:center.x+bounded((origin.x-center.x)*.75+follow.x*.25*gain,width),
      y:center.y+bounded((origin.y-30-center.y)*.75+follow.y*.25*gain,height),zoom};
  }
  const RELEASE=Object.freeze({pushEnd:.09,holdEnd:.46,end:.94,zoom:.32});
  // Optional rate comparison. Keep the same peak and impact hold, but spread
  // the entry and pullback over more wall time. It does not retime the cat.
  const READABLE_RELEASE=Object.freeze({pushEnd:.15,holdEnd:.46,end:1.06,zoom:.32});
  const IMPACT_RELEASE=Object.freeze({pushEnd:.085,holdEnd:.55,end:1.02,zoom:.42});
  const READABLE_IMPACT_RELEASE=Object.freeze({...IMPACT_RELEASE,pushEnd:.135,holdEnd:.60,end:1.07});
  const UNSEAT_IMPACT_RELEASE=Object.freeze({...READABLE_IMPACT_RELEASE,holdEnd:.70,end:1.17});
  const CONTACT_IMPACT_RELEASE=Object.freeze({...READABLE_IMPACT_RELEASE,pushEnd:.10,followAfterRelease:true});
  function impactReadTiming(separationAt){
    return {...CONTACT_IMPACT_RELEASE,holdEnd:separationAt,end:separationAt+.36};
  }
  function impactReadOrigin(hit,body,sceneAge,releaseAt){
    // Let the spark establish the hit before shifting attention to the body.
    // Use an inboard pose so the pullback leaves room for the departure.
    const blend=smoother((sceneAge-.06)/(releaseAt-.06));
    return {x:hit.x+(body.x-hit.x)*blend,y:hit.y+(body.y+30-hit.y)*blend};
  }
  function release(age,{width,height,origin,follow={x:0,y:0},enabled=true,timing=RELEASE}){
    const center={x:width/2,y:height/2};
    if(!enabled||age<=0||age>=timing.end)return {...center,zoom:1};
    const weight=smoother(age/timing.pushEnd)*(1-smoother((age-timing.holdEnd)/(timing.end-timing.holdEnd)));
    const zoom=1+timing.zoom*weight,gain=smoother((age-.12)/.25);
    const bounded=(offset,size)=>{
      const limit=size/2-size/(2*zoom);
      return limit>1e-9?limit*Math.tanh(offset*weight/limit):0;
    };
    return {x:center.x+bounded((origin.x-center.x)*.75+follow.x*.08*gain,width),
      y:center.y+bounded((origin.y-30-center.y)*.75+follow.y*.08*gain,height),zoom};
  }
  function sample(age,{center,origin,direction,enabled=true}){
    if(!enabled)return {x:center.x,y:center.y,zoom:1};
    const push=smooth((age+.12)/.22),pull=smooth((age-.18)/.58),settle=smooth((age-.8)/.4);
    const focus=push*(1-smooth((age-.26)/.6));
    const follow=smooth((age-.22)/.32)*(1-smooth((age-.64)/.42));
    return {x:center.x+((origin.x-center.x)*.65+direction.x*30)*focus,
      y:center.y+(origin.y-25-center.y)*.65*focus-35*follow,
      zoom:1+.32*push*(1-pull)-.06*pull*(1-settle)};
  }
  function live(age,{width,height,origin,direction,enabled=true}){
    const center={x:width/2,y:height/2};
    // A live collision cannot anticipate itself: start at identity at age zero.
    const p=sample(age*1.2-.12,{center,origin,direction,enabled});
    const zoom=Math.max(1,p.zoom),halfX=width/(2*zoom),halfY=height/(2*zoom);
    return {x:Math.max(halfX,Math.min(width-halfX,p.x)),
      y:Math.max(halfY,Math.min(height-halfY,p.y)),zoom};
  }
  function projection(camera,width,height){
    return {scale:camera.zoom,x:width/2-camera.x*camera.zoom,y:height/2-camera.y*camera.zoom};
  }
  function unproject(point,p){return {x:(point.x-p.x)/p.scale,y:(point.y-p.y)/p.scale};}
  // A chain hands the current shot back to the board instead of opening another
  // close-up. Interpolate projection controls: valid map projections are convex.
  function createOverview(from,velocity,{width,height,duration=.24}){
    const inside=p=>p.scale>=1&&p.x<=1e-7&&p.y<=1e-7&&
      p.x>=width*(1-p.scale)-1e-7&&p.y>=height*(1-p.scale)-1e-7;
    let span=duration,control;
    const point=()=>Object.fromEntries(['scale','x','y'].map(k=>[k,from[k]+(velocity[k]||0)*span/3]));
    control=point();
    while(!inside(control)&&span>.015){span/=2;control=point();}
    control.scale=Math.max(1,control.scale);
    control.x=Math.max(width*(1-control.scale),Math.min(0,control.x));
    control.y=Math.max(height*(1-control.scale),Math.min(0,control.y));
    return {from:{...from},control,duration:span};
  }
  function overview(track,age){
    if(age<=0)return {...track.from};
    if(age>=track.duration)return {scale:1,x:0,y:0};
    const u=age/track.duration,v=1-u,a=v*v*v,b=3*v*v*u,c=1-a-b;
    return {scale:a*track.from.scale+b*track.control.scale+c,
      x:a*track.from.x+b*track.control.x,y:a*track.from.y+b*track.control.y};
  }
  // A relay pans within the existing close-up instead of pulling out between
  // impacts. Convex projection controls keep all intermediate views on-map.
  function createRelay(from,velocity,to,{width,height,duration=.18}){
    const inside=p=>p.scale>=1-1e-8&&p.x<=1e-7&&p.y<=1e-7&&
      p.x>=width*(1-p.scale)-1e-7&&p.y>=height*(1-p.scale)-1e-7;
    const point=t=>Object.fromEntries(['scale','x','y'].map(k=>[k,from[k]+(velocity[k]||0)*t]));
    const control=point(duration/3);
    if(inside(control))return {from:{...from},control,to:{...to},duration};
    // Near a pool edge, first brake the existing momentum in a short valid
    // segment, then pan. Clamping its tangent would cause a velocity jump.
    let span=Math.min(.04,duration/4);
    while((!inside(point(span/3))||!inside(point(span/2)))&&span>1e-8)span/=2;
    const brake={from:{...from},control:point(span/3),to:point(span/2),duration:span};
    return {from:{...from},control:{...brake.to},to:{...to},duration,brake};
  }
  function relay(track,age){
    if(age<=0)return {...track.from};
    if(age>=track.duration)return {...track.to};
    if(track.brake&&age<track.brake.duration)return relay(track.brake,age);
    const offset=track.brake?.duration??0,from=track.brake?.to??track.from;
    const u=(age-offset)/(track.duration-offset),v=1-u,a=v*v*v,b=3*v*v*u,c=1-a-b;
    return Object.fromEntries(['scale','x','y'].map(k=>[k,a*from[k]+b*track.control[k]+c*track.to[k]]));
  }
  return {sample,live,gentle,focus,release,RELEASE,READABLE_RELEASE,IMPACT_RELEASE,READABLE_IMPACT_RELEASE,UNSEAT_IMPACT_RELEASE,CONTACT_IMPACT_RELEASE,impactReadTiming,impactReadOrigin,followTime,GENTLE,FOCUS,projection,unproject,createOverview,overview,createRelay,relay};
});
