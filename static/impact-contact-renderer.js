/* Local pixel highlights and water droplets. All positions use scene coordinates. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MiaoImpactContactRenderer=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const pixel=n=>Math.round(n/2)*2;
  function water(ctx,state){
    if(state.approachLines?.length)streaks(ctx,state.approachLines);
    ctx.save();
    for(const p of [...state.drops,...state.releaseDrops]){
      ctx.globalAlpha=p.alpha;const size=Math.max(2,pixel(p.size));
      ctx.fillStyle='#64cfe9';ctx.fillRect(pixel(p.x)-size/2,pixel(p.y)+2,size,size);
      ctx.fillStyle='#f0ffff';ctx.fillRect(pixel(p.x)-size/2,pixel(p.y)-size/2,size,size);
    }
    if(state.wake){
      const w=state.wake;ctx.globalAlpha=w.alpha;ctx.strokeStyle='#e7ffff';ctx.lineWidth=2;
      ctx.beginPath();ctx.ellipse(pixel(w.x),pixel(w.y),w.radius,w.radius*.35,0,w.angle+.6,w.angle+Math.PI*2-.6);ctx.stroke();
    }
    ctx.restore();
  }
  function flash(ctx,state){
    streaks(ctx,state.lines,'#fff8d7');
    if(state.flash<=0)return;
    ctx.save();ctx.translate(pixel(state.x),pixel(state.y));ctx.rotate(state.angle);
    ctx.globalAlpha=state.flash;const r=pixel(state.reach);
    if(state.impact){
      // A local contact spark needs a warm edge to stand out against the
      // existing cream float stripes and white water highlights.
      const points=[[-1,0],[-.34,-.18],[-.45,-.65],[-.12,-.28],[.06,-.85],[.22,-.28],
        [.85,-.45],[.36,-.08],[1,0],[.35,.18],[.5,.65],[.12,.28],[-.1,.9],[-.26,.28],[-.8,.5],[-.35,.08]];
      for(const [scale,color] of [[1,'#ed9358'],[.78,'#fffbea']]){
        ctx.fillStyle=color;ctx.beginPath();
        points.forEach(([x,y],i)=>{if(i)ctx.lineTo(pixel(x*r*scale),pixel(y*r*scale));
          else ctx.moveTo(pixel(x*r*scale),pixel(y*r*scale));});
        ctx.closePath();ctx.fill();
      }
      ctx.restore();return;
    }
    ctx.fillStyle='#fff1a8';
    ctx.fillRect(-r,-2,r*2,4);ctx.fillRect(-3,-r*.65,6,r*1.3);
    ctx.fillStyle='#fffef2';ctx.fillRect(-6,-6,12,12);
    ctx.fillRect(-r*.55,-r*.4,4,4);ctx.fillRect(r*.45,r*.3,4,4);
    ctx.restore();
  }
  function streaks(ctx,segments,color='#e8fbff'){
    ctx.save();ctx.strokeStyle=color;ctx.lineCap='butt';
    for(const p of segments){ctx.globalAlpha=p.alpha;ctx.lineWidth=Math.max(2,pixel(p.width));
      ctx.beginPath();ctx.moveTo(pixel(p.x),pixel(p.y));ctx.lineTo(pixel(p.endX),pixel(p.endY));ctx.stroke();}
    ctx.restore();
  }
  return {water,flash,streaks};
});
