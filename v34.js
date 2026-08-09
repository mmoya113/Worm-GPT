/* BRAVIA V3.4 — reset controls, sub-60s sniper guard, richer meme radar, arena activity, mobile nav. */
(() => {
  'use strict';
  const MAX_SNIPER_AGE_MS = 60_000;
  const ARENA_SCAN_INTERVAL = 3500;
  let lastArenaScan = 0;

  // Safer/faster tuning: active without blindly churning fees.
  Object.assign(MODES.ULTRA,{threshold:.520,cooldown:1800,minHold:3000,maxHold:22000,tp:.0070,sl:.0042,size:.08,maxPositions:4});
  Object.assign(MODES.FAST,{threshold:.535,cooldown:3000,minHold:4500,maxHold:38000,tp:.0090,sl:.0050,size:.10,maxPositions:4});
  Object.assign(MODES.AUTO,{threshold:.550,cooldown:5200,minHold:5000,maxHold:90000,tp:.0075,sl:.0045,size:.15,maxPositions:4});
  Object.assign(MODES.BALANCED,{threshold:.580});
  Object.assign(SNIPER_PRESETS.SAFE,{maxAgeMin:1,tp:.07,sl:.04,maxHold:90_000,minScore:80});
  Object.assign(SNIPER_PRESETS.BALANCED,{maxAgeMin:1,tp:.09,sl:.05,maxHold:75_000,minScore:72});
  Object.assign(SNIPER_PRESETS.FAST,{maxAgeMin:1,tp:.12,sl:.065,maxHold:60_000,minScore:62});
  Object.assign(SNIPER_PRESETS.EXPERIMENTAL,{maxAgeMin:1,tp:.15,sl:.08,maxHold:45_000,minScore:52});

  const htmlEscape = s => String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const pairAgeMs = pair => pair?.pairCreatedAt ? Math.max(0,Date.now()-Number(pair.pairCreatedAt)) : Infinity;
  const socialsOf = pair => Array.isArray(pair?.info?.socials) ? pair.info.socials.filter(Boolean) : [];
  const websitesOf = pair => Array.isArray(pair?.info?.websites) ? pair.info.websites.filter(Boolean) : [];
  const hasX = pair => socialsOf(pair).some(s=>String(s.type||s.platform||'').toLowerCase().includes('twitter')||String(s.url||'').includes('x.com')||String(s.url||'').includes('twitter.com'));
  const socialScore = pair => Math.min(100,(socialsOf(pair).length*22)+(websitesOf(pair).length*14)+(hasX(pair)?28:0));

  function resetNormalWallet(){
    state.cash=10; state.startingCash=10; state.realizedPnl=0; state.frictionCost=0; state.positions={};
    state.trades=state.trades.filter(t=>t.type!=='NORMAL'); state.peakEquity=10; state.maxDrawdown=0; state.lastAction={};
    try{localStorage.removeItem(STORE_KEY)}catch{}
    renderWallet(); renderPositions(); renderStats();
    log('SYSTEM','Normal paper wallet reset to $10'); toast('Normal wallet reset to $10');
  }

  function installNormalReset(){
    if(document.getElementById('resetNormalWallet')) return;
    const row=document.querySelector('#view-overview .wallet-card .controls-row');
    if(row) row.insertAdjacentHTML('beforeend','<button id="resetNormalWallet" class="btn secondary">↻ RESET $10</button>');
  }

  // Enforce sniper freshness/social requirements at the final entry gate.
  const previousPaperBuyMeme = paperBuyMeme;
  paperBuyMeme = function(pair,reason){
    const isSniper=String(reason||'').toLowerCase().includes('sniper');
    if(isSniper){
      const age=pairAgeMs(pair); const socials=socialsOf(pair); const websites=websitesOf(pair);
      if(age>MAX_SNIPER_AGE_MS){
        state.sniperStats.rejected++; log('RISK',`SNIPER SKIP ${pair?.baseToken?.symbol||'TOKEN'} · ${(age/1000).toFixed(0)}s old (>60s)`); return false;
      }
      if(!socials.length){state.sniperStats.rejected++;log('RISK',`SNIPER SKIP ${pair?.baseToken?.symbol||'TOKEN'} · no linked socials`);return false;}
      if((state.sniperPreset==='SAFE'||state.sniperPreset==='BALANCED')&&!websites.length){state.sniperStats.rejected++;log('RISK',`SNIPER SKIP ${pair?.baseToken?.symbol||'TOKEN'} · no website`);return false;}
    }
    return previousPaperBuyMeme(pair,reason);
  };

  function installSniperFreshness(){
    const view=document.getElementById('view-sniper'); if(!view||document.getElementById('freshnessRule')) return;
    const head=view.querySelector('.section-head');
    head?.insertAdjacentHTML('afterend',`<div id="freshnessRule" class="freshness-strip"><b>⚡ HARD FRESHNESS RULE</b><span>Sniper entries are allowed only during the first <strong>60 seconds</strong> after pair creation. Older tokens can be shown for context, but BRAVIA will not buy them.</span><em>X follower/mention metrics require the optional X API backend.</em></div>`);
  }

  function memeOpportunity(pair){
    const r=pair._risk || (typeof scoreMeme==='function'?scoreMeme(pair):{score:50,liq:0,tx:0,buyRatio:.5,ageMin:999});
    const socials=socialScore(pair); const flow=Math.max(0,Math.min(100,50+((r.buyRatio||.5)-.5)*180+Math.min((r.tx||0)/2,30)));
    const risk=Math.max(0,Math.min(100,r.score||0));
    const momentum=Number(pair?.priceChange?.m5||0);
    const confidence=Math.round(Math.max(0,Math.min(99,risk*.46+socials*.22+flow*.24+Math.max(-15,Math.min(15,momentum))*1.2)));
    const horizon = momentum>18 ? 'VERY FAST · minutes' : momentum>6 ? 'FAST · 5–20m' : momentum>1 ? 'STEADY · 20–60m' : 'UNCLEAR';
    return {risk,socials,flow,confidence,horizon,momentum};
  }

  function renderOpportunityBoard(){
    const host=document.getElementById('memeOpportunityGrid'); if(!host) return;
    const ranked=(state.memePairs||[]).map(pair=>({pair,o:memeOpportunity(pair)})).sort((a,b)=>b.o.confidence-a.o.confidence).slice(0,8);
    host.innerHTML=ranked.length?ranked.map(({pair,o},i)=>{
      const sym=pair?.baseToken?.symbol||'MEME', ca=pair?.baseToken?.address||'', age=pairAgeMs(pair), fresh=age<=60000;
      const socials=socialsOf(pair), webs=websitesOf(pair);
      return `<article class="op-card"><div class="op-rank">#${i+1}</div><div class="op-top"><div><b>${htmlEscape(sym)}</b><span>${fresh?'⚡ NEW <60s':age===Infinity?'age unknown':`${Math.round(age/60000)}m old`}</span></div><strong>${o.confidence}%</strong></div><div class="op-meter"><i style="width:${o.confidence}%"></i></div><div class="op-grid"><div><span>Risk quality</span><b>${Math.round(o.risk)}/100</b></div><div><span>Social proof</span><b>${Math.round(o.socials)}/100</b></div><div><span>Buy flow</span><b>${Math.round(o.flow)}/100</b></div><div><span>5m move</span><b>${o.momentum>=0?'+':''}${o.momentum.toFixed(1)}%</b></div></div><div class="op-horizon">⏱ ${o.horizon}</div><div class="op-socials">${socials.length?`🔗 ${socials.length} social link${socials.length>1?'s':''}`:'⚠ no socials'} · ${webs.length?'🌐 website':'no website'} · ${hasX(pair)?'𝕏 linked':'no X link'}</div><div class="op-actions"><button class="text-btn" data-copy-ca="${htmlEscape(ca)}">COPY CA</button><button class="text-btn" data-rug-ca="${htmlEscape(ca)}">RUG CHECK</button></div></article>`;
    }).join(''):'<div class="empty">Waiting for meme market data…</div>';
  }

  function installMemeRadar(){
    const view=document.getElementById('view-memes'); if(!view||document.getElementById('memeOpportunityBoard')) return;
    const info=view.querySelector('.info-strip');
    info?.insertAdjacentHTML('afterend',`<section id="memeOpportunityBoard" class="op-board panel"><div class="card-head"><div><div class="panel-title">🔥 MEME OPPORTUNITY RADAR</div><div class="asset-sub">Ranks current candidates by liquidity/risk, buy flow, momentum and linked socials. It is research guidance, not a profit prediction.</div></div><span class="mini-badge pink">LIVE RANKING</span></div><div id="memeOpportunityGrid" class="op-grid-cards"></div></section>`);
  }

  function installMobileRugNav(){
    const nav=document.querySelector('.mobile-nav'); if(!nav||nav.querySelector('[data-view="rugcheck"]')) return;
    const setup=nav.querySelector('[data-view="setup"]');
    if(setup){setup.dataset.view='rugcheck';setup.innerHTML='<b>🛡</b><span>Rug</span>';}
  }

  // Arena should visibly work even while a strategy is waiting for a valid trade.
  const previousArenaTick=arenaTick;
  arenaTick=function(){
    previousArenaTick();
    if(!state.arenaRunning || Date.now()-lastArenaScan<ARENA_SCAN_INTERVAL) return;
    lastArenaScan=Date.now();
    for(const a of state.arena){
      a.activity ||= [];
      const last=a.activity[0]; if(last && Date.now()-last.at<2500) continue;
      if(a.type==='NORMAL'){
        const top=(state.products||[]).map(pair=>({pair,s:calculateSignal(pair,MODES[a.mode]||MODES.AUTO)})).sort((x,y)=>y.s.score-x.s.score)[0];
        if(top) a.activity.unshift({at:Date.now(),kind:'SCAN',asset:top.pair,note:`score ${(top.s.score*100).toFixed(0)} · ${top.s.signal}`});
      } else {
        const top=(state.memePairs||[]).map(pair=>({pair,o:memeOpportunity(pair)})).sort((x,y)=>y.o.confidence-x.o.confidence)[0];
        if(top) a.activity.unshift({at:Date.now(),kind:'SCAN',asset:top.pair?.baseToken?.symbol||'MEME',note:`confidence ${top.o.confidence}% · waiting filters`});
      }
      a.activity=a.activity.slice(0,120);
    }
    renderArena();
  };

  function installArenaStatus(){
    const info=document.querySelector('#view-arena .info-strip'); if(!info||document.getElementById('arenaLiveNote')) return;
    info.insertAdjacentHTML('afterend','<div id="arenaLiveNote" class="arena-live-note">🛰 <b>Activity timeline includes SCAN events</b> so a wallet that makes 0 trades is visibly evaluating the market rather than looking frozen. Trades still require its entry rules.</div>');
  }

  function instantFeedback(){
    document.addEventListener('click',e=>{
      const b=e.target.closest('button'); if(!b) return;
      b.classList.add('instant-flash'); setTimeout(()=>b.classList.remove('instant-flash'),180);
      if(b.id==='startBtn'&&!state.running){const old=b.textContent;b.textContent='⚡ STARTING…';setTimeout(()=>{if(!state.running)b.textContent=old},900)}
      if(b.id==='memeAutoToggle'&&!state.memeAuto){b.textContent='⚡ STARTING MEME…'}
      if(b.id==='armSniper'&&!state.sniperArmed){b.textContent='⚡ ARMING…'}
      const ca=b.dataset.copyCa;if(ca){navigator.clipboard?.writeText(ca);toast('CA copied')}
      const rug=b.dataset.rugCa;if(rug){const input=document.getElementById('caInput');if(input)input.value=rug;showView?.('rugcheck');document.querySelector('[data-view="rugcheck"]')?.click();setTimeout(()=>document.getElementById('analyzeCA')?.click(),80)}
    },true);
  }

  function markSniperFeedFreshness(){
    const feed=document.getElementById('sniperFeed'); if(!feed) return;
    const obs=new MutationObserver(()=>{
      feed.querySelectorAll('[data-address],.sniper-token,.sniper-row').forEach(el=>{ /* visual-only; hard gate lives in paperBuyMeme */ });
    });
    obs.observe(feed,{childList:true,subtree:true});
  }

  function init(){
    installNormalReset(); installSniperFreshness(); installMemeRadar(); installMobileRugNav(); installArenaStatus(); instantFeedback(); markSniperFeedFreshness();
    document.getElementById('resetNormalWallet')?.addEventListener('click',resetNormalWallet);
    setInterval(renderOpportunityBoard,1500); renderOpportunityBoard();
    log('SYSTEM','BRAVIA V3.4 active · 60s sniper gate · opportunity radar · arena scan telemetry');
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0),{once:true}); else setTimeout(init,0);
})();
