/* Draw independent body poses and float. No clocks, rules or DOM access. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiaoKnockoutRenderer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function draw(context, art, state, event, bounds) {
    const blend = Math.min(1, Math.max(0, state.age / 0.018));
    const float = (pose, front = false) => {
      context.save();context.translate(pose.x,pose.y);context.rotate(pose.angle);
      context.scale(pose.scale*pose.scaleX,pose.scale*pose.scaleY);context.globalAlpha*=pose.alpha;
      if(front){context.beginPath();context.rect(-50,3,100,30);context.clip();}
      art.knockout.draw(context,'float');context.restore();
    };
    if(blend<1) {
      context.save();context.globalAlpha*=1-blend;context.translate(event.x,event.y);
      art.draw(context,1);context.restore();
    }
    context.save();context.globalAlpha*=blend;
    float(state.ring);
    context.save();
    if(state.age<0.15) {
      context.beginPath();context.rect(bounds.left,bounds.top,bounds.right-bounds.left,
        Math.max(0,event.y+6-bounds.top));context.clip();
    }
    const p=state.body,pivot=art.knockoutPoses.pivotBelowHead;
    context.translate(p.x,p.y+pivot);context.rotate(p.angle);context.translate(0,-pivot);
    context.scale(p.scale*p.scaleX,p.scale*p.scaleY);context.globalAlpha*=p.alpha;
    art.knockoutPoses.draw(context,state.pose);context.restore();
    if(state.frontRim>0){context.save();context.globalAlpha*=state.frontRim;float(state.ring,true);context.restore();}
    context.restore();
  }
  return {draw};
});
