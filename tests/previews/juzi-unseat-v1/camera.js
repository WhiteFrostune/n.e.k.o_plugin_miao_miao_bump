/* Presentation-only camera. Never feeds a changed viewport into motion sampling. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MiaoStudyCamera=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=n=>Math.max(0,Math.min(1,n));
  const smooth=n=>{n=clamp(n);return n*n*(3-2*n);};
  function sample(age,{center,origin,direction,enabled=true}){
    if(!enabled)return {x:center.x,y:center.y,zoom:1};
    const push=smooth((age+.12)/.22),pull=smooth((age-.18)/.58),settle=smooth((age-.8)/.4);
    const focus=push*(1-smooth((age-.26)/.6));
    const follow=smooth((age-.22)/.32)*(1-smooth((age-.64)/.42));
    return {x:center.x+direction.x*30*focus,
      y:center.y+(origin.y-25-center.y)*.65*focus-35*follow,
      zoom:1+.32*push*(1-pull)-.06*pull*(1-settle)};
  }
  return {sample};
});
