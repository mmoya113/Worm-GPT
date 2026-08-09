/* BRAVIA V3.2 runtime patch: mobile UX, isolated wallets, safer high-frequency modes, richer arena. */
(() => {
  'use strict';
  const V32_STORE='bravia-v32-wallets';
  const MEME_EXIT={tp:.14,sl:.065,maxHold:360000};

  // Recalibrate high-frequency modes: still active, but far less fee-churn than V3.
  Object.assign(MODES.ULTRA,{threshold:.535,cooldown:2200,minHold:3500,maxHold:28000,tp:.0080,sl:.0045,size:.085,maxPositions:4});
  Object.assign(MODES.FAST,{threshold:.548,cooldown:3800,minHold:5500,maxHold:45000,tp:.0100,sl:.0055,size:.11,maxPositions:4});
  Object.assign(MODES.AUTO,{threshold:.565,cooldown:6500,minHold:5500,maxHold:110000,tp:.0080,sl:.0048,size:.16,maxPositions:4});

  function loadV32(){
    let saved={};try{saved=JSON.parse(localStorage.getItem(V32_STORE)||'{}')}catch{}
    state.memeCash=Number.isFinite(saved.memeCash)?saved.memeCash:10;
    state.sniperCash=Number.isFinite(saved.sniperCash)?saved.sniperCash:10;
    state.memeStart=Number.isFinite(saved.memeStart)?saved.memeStart:10;
    state.sniperStart=Number.isFinite(saved.sniperStart)?saved.sniperStart:10;
    state.memeRealized=Number.isFinite(saved.memeRealized)?saved.memeRealized:0;
    state.sniperRealized=Number.isFinite(saved.sniperRealized)?saved.sniperRealized:0;
    state.memeFriction=Number.isFinite(saved.memeFriction)?saved.memeFriction:0;
    state.sniperFriction=Number.isFinite(saved.sniperFriction)?saved.sniperFriction:0;
    state.arena.forEach(a=>{a.activity ||= [];a.start ||= 10;a.peak ||= a.start;a.maxDD ||=0});
  }
  function persistV32(){try{localStorage.setItem(V32_STORE,JSON.stringify({memeCash:state.memeCash,sniperCash:state.sniperCash,memeStart:state.memeStart,sniperStart:state.sniperStart,memeRealized:state.memeRealized,sniperRealized:state.sniperRealized,memeFriction:state.memeFriction,sniperFriction:state.sniperFriction}))}catch{}}

  // The Overview wallet is now NORMAL-only instead of silently mixing meme/sniper capital.
  equity = function(){return state.cash+Object.values(state.positions).reduce((s,p)=>s+normalPositionValue(p),0)};
  openPositionCount = function(){return Object.keys(state.positions).length};
  canSpend = function(amount=.25){return state.cash>=amount};

  function walletOpenValue(wallet){return Object.values(state.memePositions).filter(p=>p.wallet===wallet).reduce((sum,p)=>sum+memePositionValue(p),0)}
  function walletOpenCount(wallet){return Object.values(state.memePositions).filter(p=>p.wallet===wallet).length}
  function walletEquity(wallet){const cash=wallet==='sniper'?state.sniperCash:state.memeCash;return cash+walletOpenValue(wallet)}

  paperBuyMeme = function(pair,reason){
    const ca=pair.baseToken?.address,price=safeNum(pair.priceUsd);if(!ca||!price||state.memePositions[ca])return false;
    const wallet=String(reason||'').toLowerCase().includes('sniper')?'sniper':'meme';
    const cashKey=wallet==='sniper'?'sniperCash':'memeCash', frictionKey=wallet==='sniper'?'sniperFriction':'memeFriction';
    const cash=state[cashKey];if(cash<.30||walletOpenCount(wallet)>=3)return false;
    const reserve=1.25,budget=Math.max(.25,Math.min(cash*.12,1.00,Math.max(0,cash-reserve)));if(budget<.25)return false;
    const slip=Math.max(state.slippageRate,.0035),fill=price*(1+slip),notional=budget/(1+state.feeRate),fee=notional*state.feeRate,qty=notional/fill;
    state[cashKey]-=notional+fee;state[frictionKey]+=fee+notional*slip;
    state.memePositions[ca]={type:'MEME',wallet,address:ca,symbol:pair.baseToken?.symbol||'MEME',qty,entry:fill,cost:notional,buyFee:fee,openedAt:Date.now(),high:fill,reason};
    if(wallet==='sniper')state.sniperStats.entries++;
    log(wallet==='sniper'?'SNIPER':'BUY',`${wallet==='sniper'?'SNIPER':'MEME'} PAPER BUY ${pair.baseToken?.symbol||shortCA(ca)} ${fmtMoney(notional)} · ${reason}`);
    renderModeWallets();persistV32();return true;
  };

  sellMeme = function(ca,reason){
    const p=state.memePositions[ca],pair=state.memeByAddress[ca],price=safeNum(pair?.priceUsd);if(!p||!price)return false;
    const wallet=p.wallet||'meme',cashKey=wallet==='sniper'?'sniperCash':'memeCash',realKey=wallet==='sniper'?'sniperRealized':'memeRealized',frictionKey=wallet==='sniper'?'sniperFriction':'memeFriction';
    const slip=Math.max(state.slippageRate,.004),fill=price*(1-slip),gross=p.qty*fill,fee=gross*state.feeRate,proceeds=gross-fee,pnl=proceeds-p.cost-p.buyFee,pnlPct=pnl/(p.cost+p.buyFee)*100;
    state[cashKey]+=proceeds;state[realKey]+=pnl;state[frictionKey]+=fee+gross*slip;
    state.trades.unshift({type:'MEME',wallet,pair:p.symbol,pnl,pnlPct,entry:p.entry,exit:fill,duration:Date.now()-p.openedAt,reason,at:Date.now()});
    delete state.memePositions[ca];log('SELL',`${wallet==='sniper'?'SNIPER':'MEME'} ${p.symbol} ${pnl>=0?'+':''}${fmtMoney(pnl,4)} (${fmtPct(pnlPct)}) · ${reason}`);
    renderModeWallets();persistV32();return true;
  };

  evaluateMemePositions = function(){
    for(const [ca,p] of Object.entries(state.memePositions)){
      const pair=state.memeByAddress[ca],price=safeNum(pair?.priceUsd);if(!price)continue;p.high=Math.max(p.high,price);
      const move=(price-p.entry)/p.entry,age=Date.now()-p.openedAt,fromHigh=(price-p.high)/p.high,cfg=p.wallet==='sniper'?SNIPER_PRESETS[state.sniperPreset]:MEME_EXIT;
      if(move>=cfg.tp)sellMeme(ca,'take profit');else if(move<=-cfg.sl)sellMeme(ca,'stop loss');else if(move>.07&&fromHigh<=-.04)sellMeme(ca,'trailing exit');else if(age>=cfg.maxHold)sellMeme(ca,'max hold');
    }
  };

  // Meme Normal can run independently; it no longer secretly depends on START BOT in Overview.
  evaluateMemeNormalBot = function(){
    if(!state.memeAuto||!state.memePairs.length)return;state.memeLastAction||={};
    const candidates=state.memePairs.map(pair=>({pair,r:pair._risk||scoreMeme(pair)})).filter(x=>x.r.score>=68&&x.r.liq>=9000&&x.r.tx>=16&&x.r.buyRatio>=.515&&x.r.ageMin<=240).sort((a,b)=>b.r.score-a.r.score);
    for(const {pair,r} of candidates){const ca=pair.baseToken?.address;if(!ca||state.memePositions[ca]||Date.now()-(state.memeLastAction[ca]||0)<12000)continue;if(walletOpenCount('meme')>=3||state.memeCash<1.5)break;if(paperBuyMeme(pair,`meme normal score ${r.score}`))state.memeLastAction[ca]=Date.now()}
    syncMemeAutoButton();renderModeWallets();
  };

  const oldRenderWallet=renderWallet;
  renderWallet = function(){
    const eq=equity(),pnl=eq-state.startingCash,pct=state.startingCash?pnl/state.startingCash*100:0,exposure=Object.values(state.positions).reduce((s,p)=>s+normalPositionValue(p),0);
    $('equity').textContent=fmtMoney(eq);$('pnl').textContent=`${pnl>=0?'+':''}${fmtMoney(pnl)} · ${fmtPct(pct)}`;$('pnl').className=`pnl ${pnl<0?'negative':'positive'}`;
    $('cash').textContent=fmtMoney(state.cash);$('exposure').textContent=fmtMoney(exposure);$('tradeCount').textContent=state.trades.filter(t=>t.type==='NORMAL').length;$('openCount').textContent=Object.keys(state.positions).length;$('positionsValue').textContent=fmtMoney(exposure);
  };

  renderStats = function(){
    const trades=state.trades.filter(t=>t.type==='NORMAL'),wins=trades.filter(t=>t.pnl>0),best=[...trades].sort((a,b)=>b.pnl-a.pnl)[0],worst=[...trades].sort((a,b)=>a.pnl-b.pnl)[0];
    $('winRate').textContent=trades.length?`${(wins.length/trades.length*100).toFixed(1)}%`:'0%';$('realized').textContent=`${state.realizedPnl>=0?'+':''}${fmtMoney(state.realizedPnl,4)}`;$('realized').className=state.realizedPnl<0?'negative':'positive';$('fees').textContent=fmtMoney(state.frictionCost,4);$('drawdown').textContent=`${state.maxDrawdown.toFixed(2)}%`;$('bestTrade').textContent=best?`${best.pair} ${fmtPct(best.pnlPct)}`:'—';$('worstTrade').textContent=worst?`${worst.pair} ${fmtPct(worst.pnlPct)}`:'—';
  };

  function walletCardHtml(wallet,title,subtitle){return `<article class="panel mode-wallet" id="${wallet}WalletCard"><div class="mode-wallet-head"><div><div class="panel-title">${title}</div><div class="asset-sub">${subtitle}</div></div><span class="mini-badge" id="${wallet}WalletStatus">IDLE</span></div><div class="mode-wallet-balance" id="${wallet}WalletEquity">$10.00</div><div class="pnl positive" id="${wallet}WalletPnl">+$0.00 · +0.00%</div><div class="mode-wallet-grid"><div><span>Cash</span><b id="${wallet}WalletCash">$10.00</b></div><div><span>Exposure</span><b id="${wallet}WalletExposure">$0.00</b></div><div><span>Open</span><b id="${wallet}WalletOpen">0</b></div><div><span>Closed</span><b id="${wallet}WalletTrades">0</b></div></div><div class="wallet-mini-log" id="${wallet}WalletLog"></div><button class="text-btn wallet-reset" data-reset-wallet="${wallet}">RESET THIS WALLET</button></article>`}
  function installWalletCards(){
    if(!$('memeWalletCard'))document.querySelector('#view-memes .section-head')?.insertAdjacentHTML('afterend',walletCardHtml('meme','MEME NORMAL WALLET','Independent $10 simulator · does not share Normal/Sniper cash'));
    if(!$('sniperWalletCard'))document.querySelector('#view-sniper .section-head')?.insertAdjacentHTML('afterend',walletCardHtml('sniper','SNIPER WALLET','Independent $10 simulator · entries only after your selected preset passes'));
  }
  function renderModeWallet(wallet){
    const eq=walletEquity(wallet),start=wallet==='sniper'?state.sniperStart:state.memeStart,cash=wallet==='sniper'?state.sniperCash:state.memeCash,real=wallet==='sniper'?state.sniperRealized:state.memeRealized,pnl=eq-start,pct=start?pnl/start*100:0,trades=state.trades.filter(t=>t.type==='MEME'&&t.wallet===wallet),open=walletOpenCount(wallet);
    const q=id=>$(`${wallet}Wallet${id}`);if(!q('Equity'))return;q('Equity').textContent=fmtMoney(eq);q('Pnl').textContent=`${pnl>=0?'+':''}${fmtMoney(pnl)} · ${fmtPct(pct)}`;q('Pnl').className=`pnl ${pnl<0?'negative':'positive'}`;q('Cash').textContent=fmtMoney(cash);q('Exposure').textContent=fmtMoney(walletOpenValue(wallet));q('Open').textContent=open;q('Trades').textContent=trades.length;q('Status').textContent=wallet==='sniper'?(state.sniperArmed?'ARMED':'DISARMED'):(state.memeAuto?'RUNNING':'STOPPED');
    q('Log').innerHTML=trades.length?trades.slice(0,5).map(t=>`<div><span>${new Date(t.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · ${escapeHtml(t.pair)}</span><b class="${t.pnl<0?'negative':'positive'}">${t.pnl>=0?'+':''}${fmtMoney(t.pnl,4)}</b></div>`).join(''):'<div class="empty tiny">No closed trades yet.</div>';
  }
  function renderModeWallets(){renderModeWallet('meme');renderModeWallet('sniper')}

  // Arena: reserve capital, record every action, and expose a drill-down per strategy.
  arenaOpen = function(a,key,type,price,cfg){
    a.activity ||= [];if(a.positions[key]||a.cash<2||Object.keys(a.positions).length>=3)return false;
    const friction=type==='MEME'?.004:state.slippageRate,fill=price*(1+friction),budget=Math.max(.25,Math.min(a.cash*.12,1.0)),notional=budget/(1+state.feeRate),fee=notional*state.feeRate;
    a.cash-=notional+fee;a.positions[key]={key,type,qty:notional/fill,entry:fill,cost:notional,buyFee:fee,openedAt:Date.now(),high:fill,cfg};a.lastAction[key]=Date.now();a.activity.unshift({at:Date.now(),kind:'BUY',asset:key,amount:notional,price:fill,note:`${a.mode} entry`});a.activity=a.activity.slice(0,120);return true;
  };
  arenaClose = function(a,key,price,friction,reason){
    const p=a.positions[key];if(!p)return false;const fill=price*(1-friction),gross=p.qty*fill,fee=gross*state.feeRate,proceeds=gross-fee,pnl=proceeds-p.cost-p.buyFee;a.cash+=proceeds;a.trades.push({pnl,reason,asset:key,at:Date.now()});a.activity ||= [];a.activity.unshift({at:Date.now(),kind:'SELL',asset:key,pnl,price:fill,note:reason});a.activity=a.activity.slice(0,120);delete a.positions[key];a.lastAction[key]=Date.now();return true;
  };
  arenaTick = function(){
    if(!state.arenaRunning)return;initArena();
    for(const a of state.arena){a.activity ||= [];
      if(a.type==='NORMAL'){
        const base=MODES[a.mode],cfg={...base,threshold:Math.max(.515,base.threshold-(a.mode==='ULTRA'?.012:a.mode==='FAST'?.008:0)),cooldown:Math.max(base.cooldown,a.mode==='ULTRA'?1800:a.mode==='FAST'?2800:base.cooldown)};
        const ranked=state.products.map(pair=>({pair,s:calculateSignal(pair,cfg),t:state.tickers[pair]})).filter(x=>x.t).sort((x,y)=>y.s.score-x.s.score);
        for(const [key,p] of Object.entries(a.positions)){const price=state.tickers[key]?.price;if(!price)continue;p.high=Math.max(p.high,price);const move=(price-p.entry)/p.entry,age=Date.now()-p.openedAt,rev=calculateSignal(key,cfg).signal==='SELL';if(move>=cfg.tp||move<=-cfg.sl||age>=cfg.maxHold||(rev&&age>=cfg.minHold))arenaClose(a,key,price,state.slippageRate,move>=cfg.tp?'take profit':move<=-cfg.sl?'stop loss':age>=cfg.maxHold?'max hold':'signal reversal')}
        const candidate=ranked.find(x=>x.s.score>=cfg.threshold&&Date.now()-(a.lastAction[x.pair]||0)>=cfg.cooldown);if(candidate)arenaOpen(a,candidate.pair,'NORMAL',candidate.t.price,cfg);
      } else {
        const pp=SNIPER_PRESETS[a.mode]||SNIPER_PRESETS.BALANCED;for(const [key,p] of Object.entries(a.positions)){const px=safeNum(state.memeByAddress[key]?.priceUsd);if(!px)continue;const move=(px-p.entry)/p.entry,age=Date.now()-p.openedAt;if(move>=pp.tp||move<=-pp.sl||age>=pp.maxHold)arenaClose(a,key,px,.004,move>=pp.tp?'take profit':move<=-pp.sl?'stop loss':'max hold')}
        const candidates=state.memePairs.slice(0,12).filter(pair=>{const r=pair._risk||scoreMeme(pair);return a.type==='SNIPER'?passesPreset(pair,pp).pass:r.score>=64&&r.liq>=6500&&r.tx>=10}).sort((x,y)=>(y._risk?.score||0)-(x._risk?.score||0));const pair=candidates[0],ca=pair?.baseToken?.address,price=safeNum(pair?.priceUsd);if(ca&&price&&Date.now()-(a.lastAction[ca]||0)>5500)arenaOpen(a,ca,'MEME',price,pp);
      }
      const eq=arenaEquity(a);a.peak=Math.max(a.peak||a.start,eq);a.maxDD=Math.max(a.maxDD||0,a.peak?((a.peak-eq)/a.peak)*100:0);
    }renderArena();
  };

  renderArena = function(){
    initArena();state.arena.forEach(a=>a.activity ||= []);const sorted=[...state.arena].sort((a,b)=>arenaEquity(b)-arenaEquity(a));
    $('arenaRows').innerHTML=sorted.map((a,i)=>{const eq=arenaEquity(a),pnl=(eq-a.start)/a.start*100,wins=a.trades.filter(t=>t.pnl>0).length,win=a.trades.length?wins/a.trades.length*100:0,score=Math.round(clamp(50+pnl*1.8-(a.maxDD||0)*2+Math.min(a.trades.length,20)*.5,0,100));return`<button class="leader-row arena-click" data-arena-id="${a.id}"><b class="rank">${i+1}</b><div class="strategy-name"><b>${a.name}</b><span>${a.type} · ${a.mode} · tap for details</span></div><b>${fmtMoney(eq)}</b><b class="${pnl<0?'negative':'positive'}">${fmtPct(pnl)}</b><span>${a.trades.length}</span><span>${win.toFixed(0)}%</span><span>${(a.maxDD||0).toFixed(1)}%</span><b>${score}</b></button>`}).join('');$('arenaToggle').textContent=state.arenaRunning?'■ STOP ALL':'⚔ START ALL';
  };

  function installArenaGuide(){
    const info=document.querySelector('#view-arena .info-strip');if(info&&!$('arenaGuide'))info.insertAdjacentHTML('afterend',`<section id="arenaGuide" class="arena-guide"><div><b>HOW TO READ IT</b><span>Each strategy has its own $10. Equity = cash + open positions. PnL is independent. Max DD shows the worst fall from that wallet's peak.</span></div><div><b>WHY SOME TRADE LESS</b><span>They wait for their own signal/filter. More trades is not automatically better; fees and slippage punish useless churn.</span></div><div><b>TAP A WALLET</b><span>Open its full action timeline: buys, sells, reasons, current positions, wins and losses.</span></div></section>`);
    if(!$('arenaDetailModal'))document.body.insertAdjacentHTML('beforeend',`<div id="arenaDetailModal" class="arena-modal hidden"><div class="arena-modal-card panel"><button id="arenaModalClose" class="arena-modal-close">✕</button><div id="arenaModalBody"></div></div></div>`);
  }
  function showArenaDetail(id){const a=state.arena.find(x=>x.id===Number(id));if(!a)return;const eq=arenaEquity(a),pnl=eq-a.start,win=a.trades.length?a.trades.filter(t=>t.pnl>0).length/a.trades.length*100:0,positions=Object.values(a.positions);$('arenaModalBody').innerHTML=`<div class="eyebrow">STRATEGY WALLET ${a.id+1}</div><h2>${escapeHtml(a.name)}</h2><div class="detail-kpis"><div><span>Equity</span><b>${fmtMoney(eq)}</b></div><div><span>PnL</span><b class="${pnl<0?'negative':'positive'}">${pnl>=0?'+':''}${fmtMoney(pnl,4)}</b></div><div><span>Trades</span><b>${a.trades.length}</b></div><div><span>Win rate</span><b>${win.toFixed(1)}%</b></div><div><span>Max DD</span><b>${(a.maxDD||0).toFixed(2)}%</b></div><div><span>Cash</span><b>${fmtMoney(a.cash)}</b></div></div><h3>Open positions</h3><div class="detail-list">${positions.length?positions.map(p=>`<div><b>${escapeHtml(p.key)}</b><span>Entry ${fmtMoney(p.entry,p.entry<1?6:2)} · ${Math.round((Date.now()-p.openedAt)/1000)}s open</span></div>`).join(''):'<div class="empty">No open positions.</div>'}</div><h3>Action timeline</h3><div class="arena-timeline">${a.activity?.length?a.activity.map(x=>`<div><time>${new Date(x.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><b class="${x.kind==='SELL'?(x.pnl<0?'negative':'positive'):''}">${x.kind}</b><span>${escapeHtml(x.asset)} · ${escapeHtml(x.note||'')}${x.pnl!=null?` · ${x.pnl>=0?'+':''}${fmtMoney(x.pnl,4)}`:''}</span></div>`).join(''):'<div class="empty">No actions yet. This strategy is still waiting for a valid signal.</div>'}</div>`;$('arenaDetailModal').classList.remove('hidden');}

  function resetModeWallet(wallet){
    for(const [ca,p] of Object.entries(state.memePositions))if((p.wallet||'meme')===wallet)delete state.memePositions[ca];
    state.trades=state.trades.filter(t=>!(t.type==='MEME'&&t.wallet===wallet));if(wallet==='sniper'){state.sniperCash=state.sniperStart=10;state.sniperRealized=0;state.sniperFriction=0;state.sniperStats.entries=0}else{state.memeCash=state.memeStart=10;state.memeRealized=0;state.memeFriction=0}persistV32();renderModeWallets();renderPositions();toast(`${wallet==='sniper'?'Sniper':'Meme'} wallet reset to $10`);
  }

  function installInteractions(){
    document.addEventListener('click',e=>{const reset=e.target.closest('[data-reset-wallet]');if(reset){resetModeWallet(reset.dataset.resetWallet);return}const row=e.target.closest('[data-arena-id]');if(row){showArenaDetail(row.dataset.arenaId);return}if(e.target.closest('#arenaModalClose')||e.target.id==='arenaDetailModal')$('arenaDetailModal')?.classList.add('hidden')});
    // Prevent accidental double-tap zoom / delayed taps on actual controls without synthesizing duplicate clicks.
    document.addEventListener('pointerdown',e=>{if(e.target.closest('button,[data-view],[data-select],[data-pair]'))e.target.closest('button,[data-view],[data-select],[data-pair]')?.classList.add('tap-active')},{passive:true});
    document.addEventListener('pointerup',e=>e.target.closest('.tap-active')?.classList.remove('tap-active'),{passive:true});
  }

  function init(){loadV32();installWalletCards();installArenaGuide();installInteractions();renderModeWallets();renderArena();setInterval(()=>{renderModeWallets();persistV32()},1200);log('SYSTEM','BRAVIA V3.2 UX + isolated-wallet patch active');}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0),{once:true});else setTimeout(init,0);
})();
