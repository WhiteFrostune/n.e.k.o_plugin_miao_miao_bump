/* Shared scene clock for an opt-in knockout close-up. No physics parameters change. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MiaoImpactBeat=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const CONFIG=Object.freeze({contactEnd:.016,stopEnd:.056,slowEnd:.276,recoverEnd:.436,
    slowScale:.30,end:1.4});
  const RELEASE=Object.freeze({contactEnd:.016,stopEnd:.048,slowEnd:.188,recoverEnd:.268,slowScale:.35,end:1.4});
  const IMPACT=Object.freeze({contactEnd:.028,stopEnd:.064,slowEnd:.30,recoverEnd:.39,slowScale:.22,end:1.4});
  const IMPACT_UNSEAT=Object.freeze({...IMPACT,slowEnd:.42,recoverEnd:.51});
  function configFor(profile){
    if(profile==='impact-unseat')return IMPACT_UNSEAT;
    if(profile==='impact')return IMPACT;
    return profile==='release'?RELEASE:CONFIG;
  }
  const clamp=n=>Math.max(0,Math.min(1,n));
  function sceneTime(age,profile='focus'){
    const t=Math.max(0,Number.isFinite(age)?age:0),c=configFor(profile);
    if(t<=c.contactEnd)return t;
    if(t<=c.stopEnd)return c.contactEnd;
    const slow=c.contactEnd+c.slowScale*(Math.min(t,c.slowEnd)-c.stopEnd);
    if(t<=c.slowEnd)return slow;
    const span=c.recoverEnd-c.slowEnd,u=clamp((t-c.slowEnd)/span);
    const recovered=span*(c.slowScale*u+(1-c.slowScale)*(u*u*u-.5*u*u*u*u));
    return slow+recovered+Math.max(0,t-c.recoverEnd);
  }
  function sample(age,profile='focus'){
    const t=Math.max(0,Number.isFinite(age)?age:0),c=configFor(profile);
    let scale=1,phase='normal';
    if(t<c.contactEnd)phase='contact';
    else if(t<c.stopEnd){scale=0;phase='hit-stop';}
    else if(t<c.slowEnd){scale=c.slowScale;phase='slow-motion';}
    else if(t<c.recoverEnd){
      const u=(t-c.slowEnd)/(c.recoverEnd-c.slowEnd);
      scale=c.slowScale+(1-c.slowScale)*u*u*(3-2*u);phase='release';
    }
    return {age:t,sceneAge:sceneTime(t,profile),scale,phase};
  }
  function create(profile='focus'){return {age:0,profile,lastAccentAt:0};}
  // Later impacts share this clock. A new envelope begins at the current speed
  // and slope; neither elapsed wall time nor elapsed scene time is reset.
  const RELAY=Object.freeze({groupWindow:.10,down:.032,hold:.060,recover:.140,scale:.35});
  function curve(a,b,c,d,u){const v=1-u;return a*v*v*v+3*b*v*v*u+3*c*v*u*u+d*u*u*u;}
  function integral(a,b,c,d,u){
    return a*u+(-3*a+3*b)*u*u/2+(3*a-6*b+3*c)*u*u*u/3+(-a+3*b-3*c+d)*u*u*u*u/4;
  }
  function relaySample(segment,age){
    const t=Math.max(0,age-segment.at),{down,hold,recover,from,control,target}=segment;
    const u=clamp(t/down),downTime=down*integral(from,control,target,target,u);
    if(t<down){
      const v=1-u;
      return {scale:curve(from,control,target,target,u),slope:3*((control-from)*v*v+2*(target-control)*v*u)/down,
        elapsed:downTime,phase:'chain-brake'};
    }
    const held=Math.min(Math.max(0,t-down),hold),r=clamp((t-down-hold)/recover);
    const elapsed=downTime+target*held+recover*(target*r+(1-target)*(r*r*r-.5*r*r*r*r));
    if(t<down+hold)return {scale:target,slope:0,elapsed,phase:'chain-hold'};
    return {scale:target+(1-target)*r*r*(3-2*r),slope:(1-target)*6*r*(1-r)/recover,
      elapsed:elapsed+Math.max(0,t-down-hold-recover),phase:r<1?'chain-release':'normal'};
  }
  function sampleBeat(beat,age=beat?.age??0){
    if(!beat)return {age,sceneAge:age,scale:1,slope:0,phase:'normal'};
    const segment=beat.relay;
    if(segment&&age>=segment.at){
      const result=relaySample(segment,age);
      return {age,sceneAge:segment.scene+result.elapsed,scale:result.scale,slope:result.slope,phase:result.phase};
    }
    if(beat.normal)return {age,sceneAge:age,scale:1,slope:0,phase:'normal'};
    const result=sample(age,beat.profile),c=configFor(beat.profile);
    const u=clamp((age-c.slowEnd)/(c.recoverEnd-c.slowEnd));
    return {...result,slope:(1-c.slowScale)*6*u*(1-u)/(c.recoverEnd-c.slowEnd)};
  }
  function reaccent(beat){
    if(beat.age-(beat.lastAccentAt??-Infinity)<RELAY.groupWindow-1e-8)return false;
    const current=sampleBeat(beat),target=Math.min(RELAY.scale,current.scale);
    // A positive recovering slope is allowed to finish bending smoothly. The
    // control must stay within [0,1], even when a hit arrives near full speed.
    let down=RELAY.down;
    if(current.slope>0)down=Math.min(down,3*(1-current.scale)/current.slope);
    down=Math.max(1e-6,down);
    beat.relay={at:beat.age,scene:current.sceneAge,from:current.scale,
      control:Math.max(0,Math.min(1,current.scale+current.slope*down/3)),target,
      down,hold:RELAY.hold,recover:RELAY.recover};
    beat.lastAccentAt=beat.age;
    return true;
  }
  function followup(profile='release'){
    const beat={age:0,profile,normal:true,lastAccentAt:-Infinity};
    reaccent(beat);return beat;
  }
  function finished(beat){
    if(!beat)return true;
    const end=beat.relay?beat.relay.at+beat.relay.down+beat.relay.hold+beat.relay.recover+.05:CONFIG.end;
    return beat.age>=end;
  }
  // Earliest wall-clock time reaching a scene beat, including the hit-stop.
  // Used only to schedule camera handoffs; it never changes the scene clock.
  function realTime(sceneAge,profile='focus'){
    if(!Number.isFinite(sceneAge)||sceneAge<=0)return 0;
    const c=configFor(profile);
    let left=0,right=sceneAge+c.recoverEnd;
    for(let i=0;i<50;i++){
      const middle=(left+right)/2;
      if(sceneTime(middle,profile)<sceneAge)left=middle;else right=middle;
    }
    return right;
  }
  function advance(beat,milliseconds){
    if(!Number.isFinite(milliseconds)||milliseconds<=0)return 0;
    if(!beat)return milliseconds;
    const before=sampleBeat(beat).sceneAge;
    beat.age+=milliseconds/1000;
    return Math.max(0,(sampleBeat(beat).sceneAge-before)*1000);
  }
  return {CONFIG,RELEASE,IMPACT,configFor,RELAY,sceneTime,realTime,sample,sampleBeat,create,reaccent,followup,finished,advance};
});
