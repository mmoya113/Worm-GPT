function renderMemePositions(){renderPositions()}

function showView(view){
  const target=$(`view-${view}`);if(!target)return;
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x===target));
  document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  if(view==='memes')renderMemes();if(view==='sniper')renderSniper();if(view==='arena')renderArena();if(view==='setup')renderProviders();
  if(view==='overview')setTimeout(renderChart,30);
  try{window.scrollTo({top:0,behavior:'smooth'})}catch{window.scrollTo(0,0)}
}

function selectPairHandler(e){
  const el=e.target.closest('[data-select],[data-pair]');if(!el)return;
  const pair=el.dataset.select||el.dataset.pair;if(!pair||!state.products.includes(pair))return;
  state.selectedPair=pair;renderQuickPairs();renderChart();renderMode();
  if(!document.getElementById('view-overview').classList.contains('active'))showView('overview');
}

async function requestAIReview(){
  const out=$('aiReview');
  if(!state.backendOk){out.className='ai-review';out.textContent='Backend is not online. Add the BRAVIA backend URL in Setup and configure OPENAI_API_KEY on the server.';toast('AI review needs the backend');return}
  out.className='ai-review';out.textContent='Reviewing paper-session statistics…';
  const payload={mode:state.mode,equity:equity(),startingCash:state.startingCash,realizedPnl:state.realizedPnl,frictionCost:state.frictionCost,maxDrawdown:state.maxDrawdown,trades:state.trades.slice(0,100),arena:state.arena.map(a=>({name:a.name,type:a.type,mode:a.mode,equity:arenaEquity(a),start:a.start,trades:a.trades.length,wins:a.trades.filter(t=>t.pnl>0).length,maxDD:a.maxDD}))};
  try{const r=await fetch(`${state.backend.replace(/\/$/,'')}/api/ai/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(22000)});const j=await r.json();if(!r.ok)throw Error(j.error||r.status);out.innerHTML=escapeHtml(j.review||'No review returned.').replace(/\n/g,'<br>');toast('AI review complete')}catch(e){out.textContent=`AI review unavailable: ${e.message}`;toast('AI review failed')}
}

async function connectReadOnlyWallet(){
  const provider=window.phantom?.solana||window.solana;
  if(!provider?.connect){$('walletState').textContent='WALLET NOT FOUND';$('walletAddress').textContent='Open BRAVIA inside a compatible Solana wallet browser or install its extension.';toast('No Solana wallet provider found');return}
  try{const result=await provider.connect({onlyIfTrusted:false});const address=String(result?.publicKey||provider.publicKey||'');if(!address)throw Error('No public address returned');state.walletAddress=address;$('walletState').textContent='READ-ONLY CONNECTED';$('walletAddress').textContent=address;$('executionBadge').textContent='LIVE PREVIEW · LOCKED';toast('Public wallet connected — signing stays disabled');if(state.backendOk){try{const r=await fetch(`${state.backend.replace(/\/$/,'')}/api/wallet/${encodeURIComponent(address)}/balance`,{signal:AbortSignal.timeout(6000)});if(r.ok){const j=await r.json();$('walletAddress').textContent=`${address} · ${safeNum(j.sol).toFixed(4)} SOL (read-only)`}}catch{}}}catch(e){$('walletState').textContent='NOT CONNECTED';$('walletAddress').textContent=e.message||'Connection cancelled';toast('Wallet connection cancelled')}
}

function savePaperAssumptions(){
  const cash=Math.max(1,safeNum($('settingCash').value)||10),fee=clamp(safeNum($('settingFee').value)/100,0,.02),slip=clamp(safeNum($('settingSlippage').value)/100,0,.02);
  if(cash!==state.startingCash&&(state.trades.length||openPositionCount())){if(!confirm('Changing starting balance resets the current paper session. Continue?'))return;state.cash=cash;state.startingCash=cash;state.realizedPnl=0;state.frictionCost=0;state.positions={};state.memePositions={};state.trades=[];state.peakEquity=cash;state.maxDrawdown=0}
  else if(!state.trades.length&&!openPositionCount()){state.cash=cash;state.startingCash=cash;state.peakEquity=cash}
  state.feeRate=fee;state.slippageRate=slip;persist();renderAll();toast('Paper assumptions saved')
}

function resetArena(){state.arenaRunning=false;state.arena=[];initArena();renderArena();persist();toast('Strategy Arena reset')}

function bindUI(){
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  $('openSetup').addEventListener('click',()=>showView('setup'));
  $('choosePaper').addEventListener('click',()=>{state.executionMode='paper';$('bootModal').classList.add('hidden');$('executionBadge').textContent='PAPER MODE';toast('Paper engine ready')});
  $('chooseLive').addEventListener('click',()=>{state.executionMode='live-preview';$('bootModal').classList.add('hidden');$('executionBadge').textContent='LIVE PREVIEW · LOCKED';showView('setup');toast('Live execution is locked; wallet connection is read-only')});
  $('startBtn').addEventListener('click',()=>{state.running=true;$('startBtn').disabled=true;$('stopBtn').disabled=false;log('SIGNAL',`Paper bot started · ${state.mode} · ${state.products.length} markets`);toast('Paper bot started')});
  $('stopBtn').addEventListener('click',()=>{state.running=false;$('startBtn').disabled=false;$('stopBtn').disabled=true;log('RISK','Paper bot stopped by user');toast('Bot stopped')});
  $('modeGrid').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;state.mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x.dataset.mode===state.mode));renderMode();persist();log('SIGNAL',`Mode changed to ${state.mode}`)});
  $('clearLog').addEventListener('click',()=>{state.logs=[];renderLog()});
  $('scannerSearch').addEventListener('input',e=>{state.scannerQuery=e.target.value;renderScanner()});
  $('marketSearch').addEventListener('input',e=>{state.marketQuery=e.target.value;renderMarketTable()});
  $('scanner').addEventListener('click',selectPairHandler);$('marketTable').addEventListener('click',selectPairHandler);$('quickPairs').addEventListener('click',selectPairHandler);
  document.querySelector('.range-switch').addEventListener('click',e=>{const b=e.target.closest('[data-range]');if(!b)return;state.chartRange=Number(b.dataset.range);document.querySelectorAll('[data-range]').forEach(x=>x.classList.toggle('active',x===b));renderChart()});
  $('positions').addEventListener('click',e=>{const b=e.target.closest('[data-close]');if(!b)return;b.dataset.type==='MEME'?sellMeme(b.dataset.close,'manual close'):sellNormal(b.dataset.close,'manual close');renderAll()});
  $('refreshMemes').addEventListener('click',()=>refreshMemes());
  $('memeGrid').addEventListener('click',e=>{const b=e.target.closest('[data-rug-ca]');if(!b)return;$('caInput').value=b.dataset.rugCa;showView('rugcheck');analyzeCA(b.dataset.rugCa)});
  $('sniperPresets').addEventListener('click',e=>{const b=e.target.closest('[data-preset]');if(!b)return;state.sniperPreset=b.dataset.preset;renderSniper();persist();toast(`${SNIPER_PRESETS[state.sniperPreset].label} preset selected`)});
  $('armSniper').addEventListener('click',()=>{state.sniperArmed=!state.sniperArmed;renderSniper();log('SNIPER',state.sniperArmed?`Paper sniper armed · ${state.sniperPreset}`:'Paper sniper disarmed');toast(state.sniperArmed?'Paper sniper armed':'Sniper disarmed')});
  $('analyzeCA').addEventListener('click',()=>analyzeCA($('caInput').value));$('caInput').addEventListener('keydown',e=>{if(e.key==='Enter')analyzeCA(e.currentTarget.value)});
  $('arenaToggle').addEventListener('click',()=>{state.arenaRunning=!state.arenaRunning;renderArena();persist();toast(state.arenaRunning?'All strategy wallets running':'Strategy Arena paused')});$('arenaReset').addEventListener('click',resetArena);
  $('aiReviewBtn').addEventListener('click',requestAIReview);
  $('saveBackend').addEventListener('click',async()=>{state.backend=$('backendUrl').value.trim().replace(/\/$/,'');if(state.backend)localStorage.setItem(BACKEND_KEY,state.backend);else localStorage.removeItem(BACKEND_KEY);$('backendStatus').textContent=state.backend?'Testing backend…':'Not configured. Public browser feeds remain available.';await connectBackendStream();renderProviders();toast(state.backendOk?'Backend connected':'Public feeds only')});
  $('savePaperSettings').addEventListener('click',savePaperAssumptions);$('connectWallet').addEventListener('click',connectReadOnlyWallet);
  window.addEventListener('resize',()=>{if(document.getElementById('view-overview').classList.contains('active'))renderChart()},{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)renderAll()});
}

async function boot(){
  restore();initArena();
  $('backendUrl').value=state.backend;$('settingCash').value=state.startingCash;$('settingFee').value=(state.feeRate*100).toFixed(2);$('settingSlippage').value=(state.slippageRate*100).toFixed(2);
  document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x.dataset.mode===state.mode));
  bindUI();renderProviders();renderAll();log('SYSTEM','BRAVIA V3 initialized · real-money execution hard-locked');
  await discoverProducts();renderAll();connectMarket();refreshMemes();if(state.backend)connectBackendStream();
  setInterval(evaluateNormalBot,500);setInterval(evaluateMemePositions,700);setInterval(arenaTick,800);setInterval(()=>{if(!document.hidden)refreshMemes()},6500);setInterval(()=>{updateRiskStats();scheduleRender()},1200);
  if('serviceWorker'in navigator&&!DEMO)navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

boot().catch(e=>{console.error(e);log('ERROR',`Boot error: ${e.message}`);toast('BRAVIA boot error — check console')});
