/* BRAVIA V3.5 — deterministic mobile touch navigation, theme system, smoother UI and edge-aware paper trading. */
(() => {
  'use strict';
  const THEME_KEY='bravia-v35-theme';
  const THEMES={
    neon:{label:'Neon Pulse',icon:'💗'},
    ocean:{label:'Cyber Ocean',icon:'🌊'},
    matrix:{label:'Matrix',icon:'🟢'},
    ember:{label:'Ember',icon:'🔥'}
  };
  let touchLockUntil=0;

  // Preserve fast modes, but demand a measurable edge over paper friction.
  Object.assign(MODES.ULTRA,{threshold:.548,cooldown:2600,minHold:4500,maxHold:26000,tp:.0090,sl:.0048,size:.075,maxPositions:3});
  Object.assign(MODES.FAST,{threshold:.560,cooldown:4200,minHold:6500,maxHold:48000,tp:.0120,sl:.0058,size:.095,maxPositions:3});
  Object.assign(MODES.AUTO,{threshold:.570,cooldown:7000,minHold:7000,maxHold:105000,tp:.0110,sl:.0055,size:.13,maxPositions:3});
  Object.assign(MODES.BALANCED,{threshold:.610,tp:.016,sl:.007,size:.16,maxPositions:3});
  Object.assign(MODES.TREND,{threshold:.665,tp:.026,sl:.011,size:.20,maxPositions:2});

  const roundTripFriction=()=>state.feeRate*2+state.slippageRate*2;
  function expectedMove(pair){
    const h=getHistory(pair); if(h.length<8)return 0;
    const m2=Math.abs(momentum(h,Math.min(2,h.length-1)));
    const m5=Math.abs(momentum(h,Math.min(5,h.length-1)));
    const vol=volatility(h.slice(-30));
    return Math.max(m2*1.8,m5*1.25,vol*2.3);
  }
  function qualityGate(pair,s,cfg){
    const t=state.tickers[pair]; if(!t)return false;
    const spread=t.ask&&t.bid&&t.price?(t.ask-t.bid)/t.price:0;
    const friction=roundTripFriction()+spread;
    const edge=expectedMove(pair);
    const scorePad=state.mode==='ULTRA'?.018:state.mode==='FAST'?.012:.006;
    return s.score>=Math.min(.82,cfg.threshold+scorePad) && edge>=Math.max(friction*1.75,cfg.tp*.42);
  }

  // Replace the normal decision loop with an edge-aware version. It trades less junk, not fake profits.
  evaluateNormalBot=function(){
    if(!state.running||!state.connected)return;
    const candidates=[];
    for(const pair of state.products){
      const t=state.tickers[pair]; if(!t)continue;
      const cfg=currentConfig(pair),s=calculateSignal(pair,cfg); state.scores[pair]=s;
      const p=state.positions[pair];
      if(p){
        p.high=Math.max(p.high,t.price); const move=(t.price-p.entry)/p.entry,fromHigh=(t.price-p.high)/p.high,age=Date.now()-p.openedAt;
        if(move>=cfg.tp&&age>=cfg.minHold)sellNormal(pair,'take profit');
        else if(move<=-cfg.sl)sellNormal(pair,'stop loss');
        else if(move>cfg.tp*.52&&fromHigh<=-Math.max(cfg.sl*.34,.0022)&&age>=cfg.minHold)sellNormal(pair,'protected trailing exit');
        else if(age>=cfg.maxHold)sellNormal(pair,'max hold');
        else if(s.signal==='SELL'&&age>=cfg.minHold&&move<cfg.tp*.30)sellNormal(pair,'confirmed reversal');
      } else if(s.signal==='BUY'&&qualityGate(pair,s,cfg)&&Date.now()-(state.lastAction[pair]||0)>=cfg.cooldown){
        candidates.push({pair,s,cfg,edge:expectedMove(pair)});
      }
    }
    candidates.sort((a,b)=>(b.s.score+b.edge*12)-(a.s.score+a.edge*12));
    const slots=Math.max(0,currentConfig().maxPositions-Object.keys(state.positions).length);
    for(const c of candidates.slice(0,slots)){if(state.cash<1.2)break;buyNormal(c.pair,`quality ${(c.s.score*100).toFixed(0)} · edge ${(c.edge*100).toFixed(2)}%`,c.cfg)}
    updateRiskStats();
  };

  function applyTheme(name){
    if(!THEMES[name])name='neon'; document.documentElement.dataset.theme=name;
    try{localStorage.setItem(THEME_KEY,name)}catch{}
    document.querySelectorAll('[data-theme-choice]').forEach(b=>b.classList.toggle('active',b.dataset.themeChoice===name));
  }

  function rebuildMobileNav(){
    const nav=document.querySelector('.mobile-nav'); if(!nav)return;
    nav.innerHTML=`
      <button data-v35-view="overview" class="active"><b>⌂</b><span>Home</span></button>
      <button data-v35-view="markets"><b>◫</b><span>Markets</span></button>
      <button data-v35-view="memes"><b>✦</b><span>Memes</span></button>
      <button data-v35-view="sniper"><b>⌖</b><span>Sniper</span></button>
      <button data-v35-view="arena"><b>⚔</b><span>Arena</span></button>
      <button id="v35More"><b>•••</b><span>More</span></button>`;
  }

  function installMoreSheet(){
    if(document.getElementById('v35Sheet'))return;
    document.body.insertAdjacentHTML('beforeend',`<div id="v35Sheet" class="v35-sheet hidden"><button class="v35-sheet-backdrop" data-v35-close aria-label="Close menu"></button><section class="v35-sheet-card panel"><div class="v35-sheet-handle"></div><div class="card-head"><div><div class="eyebrow">BRAVIA CONTROL CENTER</div><h2>More</h2></div><button class="icon-btn" data-v35-close>✕</button></div><div class="v35-more-grid"><button data-v35-view="rugcheck"><b>🛡</b><span>RugCheck</span><small>Analyze any CA</small></button><button data-v35-view="setup"><b>⚙</b><span>Setup</span><small>APIs & paper settings</small></button></div><div class="panel-title v35-theme-title">INTERFACE THEME</div><div class="v35-theme-grid">${Object.entries(THEMES).map(([k,v])=>`<button data-theme-choice="${k}"><b>${v.icon}</b><span>${v.label}</span></button>`).join('')}</div><div class="v35-performance-note"><b>⚡ QUALITY-GATED EXECUTION</b><span>Normal modes now require estimated short-term movement to clear fees, slippage and spread before a paper entry is allowed.</span></div></section></div>`);
  }

  function setNavActive(view){document.querySelectorAll('.mobile-nav [data-v35-view]').forEach(b=>b.classList.toggle('active',b.dataset.v35View===view))}
  function go(view){
    if(typeof showView==='function')showView(view); else document.querySelector(`.desktop-nav [data-view="${view}"]`)?.click();
    setNavActive(view); document.getElementById('v35Sheet')?.classList.add('hidden');
  }

  // iOS: execute on pointerup itself, suppress the delayed synthetic click, and never need 5–50 taps.
  function installTouchEngine(){
    document.addEventListener('pointerup',e=>{
      if(e.pointerType!=='touch'&&e.pointerType!=='pen')return;
      const nav=e.target.closest('.mobile-nav button');
      const more=e.target.closest('#v35More');
      const sheetView=e.target.closest('#v35Sheet [data-v35-view]');
      const close=e.target.closest('[data-v35-close]');
      const theme=e.target.closest('[data-theme-choice]');
      const control=e.target.closest('button');
      if(!(nav||more||sheetView||close||theme||control))return;
      touchLockUntil=Date.now()+450; e.preventDefault(); e.stopPropagation();
      if(more){document.getElementById('v35Sheet')?.classList.remove('hidden');return}
      if(nav?.dataset.v35View){go(nav.dataset.v35View);return}
      if(sheetView){go(sheetView.dataset.v35View);return}
      if(close){document.getElementById('v35Sheet')?.classList.add('hidden');return}
      if(theme){applyTheme(theme.dataset.themeChoice);toast(`Theme: ${THEMES[theme.dataset.themeChoice].label}`);return}
      // For ordinary controls, programmatic click fires synchronously and reliably on the first touch.
      if(control&&!control.disabled){control.click()}
    },{capture:true,passive:false});
    document.addEventListener('click',e=>{if(Date.now()<touchLockUntil&&e.isTrusted){e.preventDefault();e.stopImmediatePropagation()}},{capture:true});
  }

  function installDesktopThemeControl(){
    const setup=document.querySelector('#view-setup .setup-grid'); if(!setup||document.getElementById('v35ThemeSetup'))return;
    setup.insertAdjacentHTML('beforeend',`<article id="v35ThemeSetup" class="panel setup-card"><div class="panel-title">APPEARANCE</div><div class="v35-theme-grid">${Object.entries(THEMES).map(([k,v])=>`<button data-theme-choice="${k}"><b>${v.icon}</b><span>${v.label}</span></button>`).join('')}</div><div class="small-copy">Themes change only the interface. Trading logic and paper balances stay untouched.</div></article>`);
  }

  function installStatusRibbon(){
    if(document.getElementById('v35Ribbon'))return;
    const top=document.querySelector('.topbar');
    top?.insertAdjacentHTML('afterend','<div id="v35Ribbon" class="v35-ribbon"><span>⚡ V3.5</span><span>FIRST-TAP TOUCH</span><span>EDGE-AWARE PAPER ENGINE</span><span>4 THEMES</span></div>');
  }

  function bindClicks(){
    document.addEventListener('click',e=>{
      const more=e.target.closest('#v35More');if(more){document.getElementById('v35Sheet')?.classList.remove('hidden');return}
      const view=e.target.closest('[data-v35-view]');if(view){go(view.dataset.v35View);return}
      if(e.target.closest('[data-v35-close]')){document.getElementById('v35Sheet')?.classList.add('hidden');return}
      const th=e.target.closest('[data-theme-choice]');if(th){applyTheme(th.dataset.themeChoice);return}
    });
  }

  function init(){
    rebuildMobileNav();installMoreSheet();installDesktopThemeControl();installStatusRibbon();installTouchEngine();bindClicks();
    applyTheme(localStorage.getItem(THEME_KEY)||'neon');
    log('SYSTEM','BRAVIA V3.5 active · deterministic first-touch navigation · edge-aware execution · themes');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0),{once:true});else setTimeout(init,0);
})();
