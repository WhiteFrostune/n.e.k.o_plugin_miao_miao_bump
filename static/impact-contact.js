/* Optional contact accents: read-only pose decoration and deterministic hit particles. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MiaoImpactContact=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=n=>Math.max(0,Math.min(1,n));
  const smooth=n=>{n=clamp(n);return n*n*(3-2*n);};
  function pulse(t,start,peak,end){
    if(t<=start||t>=end)return 0;
    return t<peak?smooth((t-start)/(peak-start)):1-smooth((t-peak)/(end-peak));
  }
  function apply(state,track,{impact=false}={}){
    const t=state.age;
    if(t<=0||t>=.13)return state;
    const d=track.direction,k=track.radius/40,strength=.65+.35*clamp(track.closing/1000);
    const axis=Math.atan2(d.y,d.x),fan=track.fan;
    const ringPress=pulse(t,0,.014,.05),ringReturn=pulse(t,.03,.06,.10);
    const bodyPress=pulse(t,.008,.027,.064),bodyReturn=pulse(t,.05,.082,.125);
    const lag=pulse(t,.004,.026,.085);
    const ringAlong=1+strength*((impact?-.26:-.20)*ringPress+.07*ringReturn);
    const bodyAlong=1+strength*((impact?-.18:-.12)*bodyPress+.045*bodyReturn);
    const bodyOffset=-(impact?10:6)*k*strength*lag,ringOffset=2.5*k*strength*ringPress;
    return {...state,
      body:{...state.body,x:state.body.x+d.x*bodyOffset,y:state.body.y+d.y*bodyOffset,
        angle:state.body.angle-fan*.10*strength*lag+fan*.04*bodyReturn,
        scaleX:1,scaleY:1,deformAngle:axis,deformAlong:bodyAlong,deformAcross:Math.pow(1/bodyAlong,.65)},
      ring:{...state.ring,x:state.ring.x+d.x*ringOffset,y:state.ring.y+d.y*ringOffset,
        angle:state.ring.angle+fan*.06*strength*ringPress-fan*.02*ringReturn,
        scaleX:1,scaleY:1,deformAngle:axis,deformAlong:ringAlong,deformAcross:Math.pow(1/ringAlong,.65)}};
  }
  function create(event,{radius=40,departure=null,impact=false,departureAt=.12,showApproach=false}={}){
    const d=event.direction,length=Math.hypot(d.x,d.y)||1;
    const point=event.contactPoint||{x:event.x-d.x*radius,y:event.y-d.y*radius};
    const source=event.motion?.sourceVelocity;
    const speed=Math.hypot(source?.x??0,source?.y??0);
    const approach=showApproach&&speed>80?
      {x:source.x/speed,y:source.y/speed,strength:clamp(speed/750)}:null;
    return {x:point.x,y:point.y,dx:d.x/length,dy:d.y/length,radius,approach,
      departure:departure?{x:departure.x,y:departure.y}:null,impact,departureAt,
      duration:departure ? .65 : .30,age:0};
  }
  function sample(effect,age){
    const t=Math.max(0,age),k=effect.radius/40;
    const flash=effect.impact?pulse(t,0,.026,.060):pulse(t,0,.014,.052);
    const drops=t<.30?[-1.05,-.7,-.35,0,.35,.7,1.05].map((angle,i)=>{
      const speed=(i%2?210:270)*k,travel=speed*t;
      const along=4*k+Math.cos(angle)*travel,across=Math.sin(angle)*travel;
      return {x:effect.x+effect.dx*along-effect.dy*across,
        y:effect.y+effect.dy*along+effect.dx*across-8*k*Math.sin(Math.PI*clamp(t/.30)),
        size:(i%2?3:4)*k,alpha:smooth(t/.012)*(1-smooth(t/.30))};
    }):[];
    // A short fan behind the impulse, leaving the face and head kitten clear.
    const lines=[-.85,-.5,.5,.85].map(a=>{
      const dx=effect.dx*Math.cos(a)-effect.dy*Math.sin(a),dy=effect.dy*Math.cos(a)+effect.dx*Math.sin(a);
      const near=(18+28*clamp(t/.09))*k,length=(10+14*Math.abs(a))*k;
      return {x:effect.x-dx*near,y:effect.y-dy*near,
        endX:effect.x-dx*(near+length),endY:effect.y-dy*(near+length),
        alpha:pulse(t,0,.018,.09)*.8,width:2*k};
    }).filter(p=>p.alpha>0);
    const q=t-(effect.departureAt??.12),life=effect.impact ? .32 : .48,origin=effect.departure;
    const releaseDrops=origin&&q>0&&q<life?[-1,-.65,-.3,.3,.65,1].map((a,i)=>{
      const across=a*(10+100*q)*k,along=-(5+65*q)*k;
      return {x:origin.x+effect.dx*along-effect.dy*across,
        y:origin.y+effect.dy*along+effect.dx*across-(28+8*(i%2))*k*Math.sin(Math.PI*q/life),
        size:(i%2?2:3)*k,alpha:smooth(q/.025)*(1-smooth(q/life))};
    }):[];
    const approach=effect.approach,approachAlpha=pulse(t,0,.024,.09);
    const approachLines=approach&&approachAlpha>0?[-1,0,1].map(side=>{
      const offset=side*12*k,start=(56+Math.abs(side)*12)*k;
      const end=start+(side?38:64)*k;
      const x=effect.x-approach.y*offset,y=effect.y+approach.x*offset;
      return {x:x-approach.x*start,y:y-approach.y*start,
        endX:x-approach.x*end,endY:y-approach.y*end,
        alpha:approachAlpha*approach.strength*(side?.56:.86),width:(side?2:4)*k};
    }):[];
    return {x:effect.x,y:effect.y,angle:Math.atan2(effect.dy,effect.dx),impact:Boolean(effect.impact),
      flash,reach:(12+(effect.impact?17:9)*flash)*k,drops,lines,approachLines,releaseDrops,
      wake:origin&&q>0&&q<life?{x:origin.x,y:origin.y,radius:(24+40*q/life)*k,
        alpha:.55*pulse(q,0,.045,life),angle:Math.atan2(effect.dy,effect.dx)}:null};
  }
  // Short velocity strokes sampled from the same trajectory, never a second clock
  // or a duplicate character image. They begin only after the body leaves the ring.
  function trail(track,age,samplePose){
    if(age<=.24||age>=.94)return [];
    const envelope=pulse(age,.24,.42,.94),k=track.radius/40,segments=[];
    for(const part of ['body','ring']){
      const now=samplePose(age)[part],before=samplePose(age-.025)[part];
      const dx=now.x-before.x,dy=now.y-before.y,speed=Math.hypot(dx,dy)/.025;
      if(speed<240)continue;
      const length=Math.hypot(dx,dy),ux=dx/length,uy=dy/length;
      const reach=Math.min(34*k,speed*.035),offset=(part==='body'?23:14)*k;
      for(const side of [-1,1])segments.push({x:now.x-ux*offset-uy*side*14*k,
        y:now.y-uy*offset+ux*side*14*k,
        endX:now.x-ux*(offset+reach)-uy*side*14*k,
        endY:now.y-uy*(offset+reach)+ux*side*14*k,
        alpha:.45*envelope*clamp((speed-240)/500),width:2*k});
    }
    return segments;
  }
  return {apply,create,sample,trail};
});
