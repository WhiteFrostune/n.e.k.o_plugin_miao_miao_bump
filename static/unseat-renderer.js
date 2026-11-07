/* Four-pose unseating art and draw adapter. No battle state or animation clock. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MiaoUnseatRenderer=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  async function load(url){
    const response=await fetch(url,{cache:'no-cache'});
    if(!response.ok)throw new Error('Unseat art unavailable');
    const m=await response.json(),ids=['contact','release','tumble','follow'];
    if(!Array.isArray(m.frames)||m.frames.length!==4||!ids.every(id=>m.frames.some(f=>f.id===id))
      || !Number.isFinite(m.faceRestY)||!Number.isFinite(m.worldPerSourcePixel)
      ||m.worldPerSourcePixel<=0||m.worldPerSourcePixel>1)throw new Error('Invalid unseat registration');
    const image=new Image(); image.src = new URL(m.image,url).href; await image.decode();
    const sprites=new Map(m.frames.map(f=>{
      const s=f.source,a=f.anchor,k=m.worldPerSourcePixel;
      if(!s||!a||![s.x,s.y,s.width,s.height,a.x,a.y].every(Number.isFinite)
        ||s.x<0||s.y<0||s.width<=0||s.height<=0||s.x+s.width>image.naturalWidth||s.y+s.height>image.naturalHeight
        ||a.x<s.x||a.x>s.x+s.width||a.y<s.y||a.y>s.y+s.height)throw new Error('Invalid unseat crop');
      const bitmap=document.createElement('canvas');bitmap.width=96;bitmap.height=Math.round(96*s.height/s.width);
      const c=bitmap.getContext('2d');c.imageSmoothingEnabled=false;
      c.drawImage(image,s.x,s.y,s.width,s.height,0,0,bitmap.width,bitmap.height);
      const pixels=c.getImageData(0,0,bitmap.width,bitmap.height);
      for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=pixels.data[i]<128?0:255;
      c.putImageData(pixels,0,0);
      return [f.id,{bitmap,box:{x:(s.x-a.x)*k,y:(s.y-a.y)*k,width:s.width*k,height:s.height*k}}];
    }));
    return {faceRestY:m.faceRestY,draw(context,id){const {bitmap,box}=sprites.get(id);
      context.imageSmoothingEnabled=false;context.drawImage(bitmap,box.x,box.y,box.width,box.height);}};
  }
  function draw(ctx,art,state,event,bounds){
    // Hit-stop holds an early pose: keep the accent's contact solid instead of
    // freezing a translucent crossfade between the seated and split sprites.
    const blend=event.contactAccent?1:Math.max(0,Math.min(1,state.age/.022));
    const place=p=>{
      ctx.translate(p.x,p.y);
      if(p.deformAlong!==undefined){ctx.rotate(p.deformAngle);ctx.scale(p.deformAlong,p.deformAcross);ctx.rotate(-p.deformAngle);}
      ctx.rotate(p.angle);
    };
    const ring=(p,front=false)=>{
      ctx.save();place(p);ctx.scale(p.scale*p.scaleX,p.scale*p.scaleY);ctx.globalAlpha*=p.alpha;
      if(front){ctx.beginPath();ctx.rect(-50,3,100,30);ctx.clip();}
      art.knockout.draw(ctx,'float');ctx.restore();
    };
    if(blend<1){ctx.save();ctx.globalAlpha*=1-blend;ctx.translate(event.x,event.y);art.draw(ctx,1);ctx.restore();}
    ctx.save();ctx.globalAlpha*=blend;ring(state.ring);ctx.save();
    if(state.age<(state.releaseAt??.34)){ctx.beginPath();ctx.rect(bounds.left,bounds.top,bounds.right-bounds.left,
      Math.max(0,state.waterlineY-bounds.top));ctx.clip();}
    const p=state.body;place(p);
    ctx.scale(p.scale*p.scaleX*p.mirror,p.scale*p.scaleY);ctx.globalAlpha*=p.alpha;
    art.unseat.draw(ctx,state.pose);ctx.restore();
    if(state.frontRim>0){ctx.save();ctx.globalAlpha*=state.frontRim;ring(state.ring,true);ctx.restore();}
    ctx.restore();
  }
  return {load,draw};
});
