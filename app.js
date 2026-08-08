const PRODUCTS = ["BTC-USD", "ETH-USD", "SOL-USD"];
const STARTING_CASH = 10;
const FEE_RATE = 0.004;
const SLIPPAGE_RATE = 0.0005;

const MODES = {
  AUTO:     { threshold: 0.60, cooldown: 20_000, minHold: 10_000, maxHold: 180_000, tp: 0.012, sl: 0.007, size: 0.40 },
  ULTRA:    { threshold: 0.53, cooldown: 5_000,  minHold: 4_000,  maxHold: 45_000,  tp: 0.007, sl: 0.004, size: 0.32 },
  FAST:     { threshold: 0.58, cooldown: 15_000, minHold: 8_000,  maxHold: 120_000, tp: 0.010, sl: 0.006, size: 0.38 },
  BALANCED: { threshold: 0.64, cooldown: 45_000, minHold: 20_000, maxHold: 300_000, tp: 0.016, sl: 0.009, size: 0.42 },
  TREND:    { threshold: 0.69, cooldown: 90_000, minHold: 60_000, maxHold: 900_000, tp: 0.026, sl: 0.013, size: 0.48 },
  CUSTOM:   { threshold: 0.62, cooldown: 30_000, minHold: 15_000, maxHold: 240_000, tp: 0.014, sl: 0.008, size: 0.40 },
};

const state = {
  connected: false,
  running: false,
  selectedPair: "BTC-USD",
  mode: "AUTO",
  cash: STARTING_CASH,
  realizedPnl: 0,
  totalFees: 0,
  positions: {},
  tickers: {},
  history: Object.fromEntries(PRODUCTS.map(p => [p, []])),
  scores: Object.fromEntries(PRODUCTS.map(p => [p, { score: 0.5, signal: "WAIT", detail: "Collecting data" }])),
  trades: [],
  lastAction: Object.fromEntries(PRODUCTS.map(p => [p, 0])),
  logs: [],
  peakEquity: STARTING_CASH,
  maxDrawdown: 0,
};

const $ = (id) => document.getElementById(id);
const fmtMoney = (n, max = 2) => `$${Number(n || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:max})}`;
const fmtPct = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const nowTime = () => new Date().toLocaleTimeString([], { hour12:false, hour:"2-digit", minute:"2-digit", second:"2-digit" });

function log(type, message) {
  state.logs.unshift({ time: nowTime(), type, message });
  state.logs = state.logs.slice(0, 160);
  renderLog();
}

function currentConfig(pair) {
  if (state.mode !== "AUTO") return MODES[state.mode];
  const h = state.history[pair] || [];
  const vol = volatility(h.slice(-50));
  if (vol > 0.0018) return { ...MODES.FAST, threshold: 0.61, size: 0.34 };
  if (vol < 0.00045 && h.length > 25) return { ...MODES.TREND, threshold: 0.67, size: 0.42 };
  return MODES.AUTO;
}

function volatility(points) {
  if (!points || points.length < 4) return 0;
  const rets = [];
  for (let i=1;i<points.length;i++) rets.push((points[i].price - points[i-1].price) / points[i-1].price);
  const mean = rets.reduce((a,b)=>a+b,0)/rets.length;
  return Math.sqrt(rets.reduce((a,b)=>a+(b-mean)**2,0)/rets.length);
}

function momentum(h, n) {
  if (h.length < n + 1) return 0;
  const a = h[h.length - 1].price;
  const b = h[h.length - 1 - n].price;
  return (a - b) / b;
}

function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }

function calculateSignal(pair) {
  const ticker = state.tickers[pair];
  const h = state.history[pair];
  if (!ticker || h.length < 12) return { score: 0.5, signal:"WAIT", detail:`Warming ${h.length}/12` };

  const m5 = momentum(h, 5);
  const m10 = momentum(h, 10);
  const m20 = momentum(h, Math.min(20, h.length - 1));
  const accel = m5 - (m10 - m5);
  const day = (ticker.change24h || 0) / 100;
  const spread = ticker.bid && ticker.ask ? (ticker.ask - ticker.bid) / ticker.price : 0.001;
  const vol = volatility(h.slice(-40));

  let raw = 0;
  raw += clamp(m5 / 0.0018, -1, 1) * 0.29;
  raw += clamp(m10 / 0.0030, -1, 1) * 0.23;
  raw += clamp(m20 / 0.0050, -1, 1) * 0.18;
  raw += clamp(accel / 0.0014, -1, 1) * 0.12;
  raw += clamp(day / 0.06, -1, 1) * 0.10;
  raw -= clamp(spread / 0.0020, 0, 1) * 0.10;
  raw -= clamp(vol / 0.0040, 0, 1) * 0.06;

  const score = clamp(0.5 + raw / 2, 0, 1);
  const cfg = currentConfig(pair);
  let signal = "WAIT";
  if (score >= cfg.threshold) signal = "BUY";
  if (score <= 1 - cfg.threshold) signal = "SELL";
  return { score, signal, detail:`m5 ${fmtPct(m5*100)} · spread ${(spread*100).toFixed(3)}%` };
}

function markPrice(pair) {
  const t = state.tickers[pair];
  return t?.price || 0;
}

function positionValue(pos) {
  return pos.qty * markPrice(pos.pair);
}

function equity() {
  return state.cash + Object.values(state.positions).reduce((sum,p)=>sum+positionValue(p),0);
}

function buy(pair, reason) {
  const t = state.tickers[pair];
  if (!t?.price || state.positions[pair]) return;
  const cfg = currentConfig(pair);
  if (state.cash < 1) return log("RISK", `${pair} skipped — less than $1 cash available`);

  const base = t.ask || t.price;
  const fill = base * (1 + SLIPPAGE_RATE);
  const budget = state.cash * cfg.size;
  const notional = budget / (1 + FEE_RATE);
  const fee = notional * FEE_RATE;
  const qty = notional / fill;
  if (notional < 0.5) return log("RISK", `${pair} skipped — order too small`);

  state.cash -= (notional + fee);
  state.totalFees += fee;
  state.positions[pair] = {
    pair, qty, entry: fill, cost: notional, buyFee: fee, openedAt: Date.now(), high: fill, reason
  };
  state.lastAction[pair] = Date.now();
  log("BUY", `${pair} ${fmtMoney(notional)} @ ${fmtMoney(fill, 4)} · fee ${fmtMoney(fee,4)}`);
  renderAll();
}

function sell(pair, reason) {
  const pos = state.positions[pair];
  const t = state.tickers[pair];
  if (!pos || !t?.price) return;
  const base = t.bid || t.price;
  const fill = base * (1 - SLIPPAGE_RATE);
  const gross = pos.qty * fill;
  const fee = gross * FEE_RATE;
  const proceeds = gross - fee;
  const pnl = proceeds - pos.cost - pos.buyFee;
  const pnlPct = pnl / (pos.cost + pos.buyFee) * 100;

  state.cash += proceeds;
  state.totalFees += fee;
  state.realizedPnl += pnl;
  state.trades.unshift({ pair, pnl, pnlPct, entry:pos.entry, exit:fill, duration:Date.now()-pos.openedAt, reason, at:Date.now() });
  delete state.positions[pair];
  state.lastAction[pair] = Date.now();
  log("SELL", `${pair} ${pnl >= 0 ? "+" : ""}${fmtMoney(pnl,4)} (${fmtPct(pnlPct)}) · ${reason}`);
  renderAll();
}

function evaluateBot() {
  if (!state.running || !state.connected) return;
  for (const pair of PRODUCTS) {
    state.scores[pair] = calculateSignal(pair);
    const t = state.tickers[pair];
    if (!t) continue;
    const cfg = currentConfig(pair);
    const pos = state.positions[pair];
    const elapsed = Date.now() - (state.lastAction[pair] || 0);

    if (pos) {
      pos.high = Math.max(pos.high, t.price);
      const grossMove = (t.price - pos.entry) / pos.entry;
      const drawFromHigh = (t.price - pos.high) / pos.high;
      const age = Date.now() - pos.openedAt;
      if (grossMove >= cfg.tp && age >= cfg.minHold) sell(pair, "take profit");
      else if (grossMove <= -cfg.sl) sell(pair, "stop loss");
      else if (grossMove > cfg.tp * 0.55 && drawFromHigh <= -cfg.sl * 0.45 && age >= cfg.minHold) sell(pair, "trailing exit");
      else if (age >= cfg.maxHold) sell(pair, "max hold");
      else if (state.scores[pair].signal === "SELL" && age >= cfg.minHold) sell(pair, "signal reversal");
    } else if (elapsed >= cfg.cooldown && state.scores[pair].signal === "BUY") {
      buy(pair, `score ${(state.scores[pair].score*100).toFixed(0)}`);
    }
  }
  updateRiskStats();
}

function updateRiskStats() {
  const eq = equity();
  state.peakEquity = Math.max(state.peakEquity, eq);
  const dd = state.peakEquity ? ((state.peakEquity - eq)/state.peakEquity)*100 : 0;
  state.maxDrawdown = Math.max(state.maxDrawdown, dd);
}

function connectMarket() {
  let ws;
  let reconnectTimer;
  const open = () => {
    clearTimeout(reconnectTimer);
    setFeed(false, "CONNECTING");
    ws = new WebSocket("wss://advanced-trade-ws.coinbase.com");
    ws.onopen = () => {
      ws.send(JSON.stringify({ type:"subscribe", product_ids:PRODUCTS, channel:"ticker" }));
      ws.send(JSON.stringify({ type:"subscribe", channel:"heartbeats" }));
      setFeed(true, "LIVE COINBASE");
      log("MARKET", "Connected to Coinbase Advanced Trade public WebSocket");
    };
    ws.onmessage = ({data}) => {
      let msg; try { msg = JSON.parse(data); } catch { return; }
      if (msg.channel !== "ticker") return;
      for (const event of msg.events || []) {
        for (const x of event.tickers || []) {
          if (!PRODUCTS.includes(x.product_id)) continue;
          const price = Number(x.price);
          if (!Number.isFinite(price)) continue;
          state.tickers[x.product_id] = {
            pair:x.product_id,
            price,
            bid:Number(x.best_bid) || price,
            ask:Number(x.best_ask) || price,
            change24h:Number(x.price_percent_chg_24_h) || 0,
            volume24h:Number(x.volume_24_h) || 0,
            at:Date.now()
          };
          const h = state.history[x.product_id];
          if (!h.length || Date.now() - h[h.length-1].t >= 900) {
            h.push({t:Date.now(), price});
            if (h.length > 900) h.shift();
          } else {
            h[h.length-1] = {t:h[h.length-1].t, price};
          }
          state.scores[x.product_id] = calculateSignal(x.product_id);
        }
      }
      scheduleRender();
    };
    ws.onerror = () => setFeed(false, "FEED ERROR");
    ws.onclose = () => {
      setFeed(false, "RECONNECTING");
      log("ERROR", "Market feed disconnected; reconnecting automatically");
      reconnectTimer = setTimeout(open, 1800);
    };
  };
  open();
}

function setFeed(ok, label) {
  state.connected = ok;
  $("feedStatus").textContent = label;
  $("feedDot").style.background = ok ? "var(--green)" : "var(--yellow)";
}

let renderQueued = false;
function scheduleRender(){
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(()=>{ renderQueued=false; renderAll(); });
}

function renderAll() {
  const eq = equity();
  const pnl = eq - STARTING_CASH;
  $("equity").textContent = fmtMoney(eq);
  $("cash").textContent = fmtMoney(state.cash);
  $("exposure").textContent = fmtMoney(eq - state.cash);
  $("tradeCount").textContent = state.trades.length;
  $("pnl").textContent = `${pnl >= 0 ? "+" : ""}${fmtMoney(pnl)} · ${fmtPct((pnl/STARTING_CASH)*100)}`;
  $("pnl").className = `pnl ${pnl < 0 ? "negative" : "positive"}`;
  renderChart();
  renderScanner();
  renderPositions();
  renderMode();
  renderStats();
}

function renderMode(){
  const cfg = currentConfig(state.selectedPair);
  $("cfgThreshold").textContent = `${Math.round(cfg.threshold*100)}%`;
  $("cfgCooldown").textContent = `${Math.round(cfg.cooldown/1000)}s`;
  $("cfgExit").textContent = `${(cfg.tp*100).toFixed(1)}% / ${(cfg.sl*100).toFixed(1)}%`;
  $("cfgSize").textContent = `${Math.round(cfg.size*100)}% cash`;
}

function renderScanner(){
  $("scanner").innerHTML = PRODUCTS.map(pair => {
    const t = state.tickers[pair];
    const s = state.scores[pair];
    const score = Math.round((s?.score ?? .5)*100);
    const spread = t ? ((t.ask-t.bid)/t.price*100) : 0;
    return `<article class="panel asset-card" data-select="${pair}">
      <div class="asset-head"><div><div class="asset-symbol">${pair.replace("-USD","")}</div><div class="asset-sub">${pair} · LIVE SPOT</div></div><div><div class="asset-price">${t ? fmtMoney(t.price, t.price < 1000 ? 4 : 2) : "—"}</div><div class="asset-sub ${t?.change24h < 0 ? "negative" : "positive"}">${t ? fmtPct(t.change24h) : "waiting"} 24h</div></div></div>
      <div class="score-row"><span>SCORE</span><div class="score-bar"><div class="score-fill" style="width:${score}%"></div></div><b>${score}</b></div>
      <div class="asset-meta"><div><span>Signal</span><br><b class="signal ${s?.signal||"WAIT"}">${s?.signal||"WAIT"}</b></div><div><span>Spread</span><br><b>${t ? spread.toFixed(3)+"%" : "—"}</b></div><div><span>Bid</span><br><b>${t ? fmtMoney(t.bid,4) : "—"}</b></div><div><span>Ask</span><br><b>${t ? fmtMoney(t.ask,4) : "—"}</b></div></div>
    </article>`;
  }).join("");
  document.querySelectorAll("[data-select]").forEach(el => el.onclick = () => selectPair(el.dataset.select));
}

function renderPositions(){
  const vals = Object.values(state.positions);
  if (!vals.length) { $("positions").className="empty"; $("positions").textContent="No open positions."; return; }
  $("positions").className="";
  $("positions").innerHTML = vals.map(p => {
    const mark = markPrice(p.pair); const pnlPct = (mark-p.entry)/p.entry*100;
    return `<div class="position"><div class="position-head"><span>${p.pair}</span><span class="${pnlPct>=0?"positive":"negative"}">${fmtPct(pnlPct)}</span></div><div class="position-grid"><span>Entry<br><b>${fmtMoney(p.entry,4)}</b></span><span>Mark<br><b>${fmtMoney(mark,4)}</b></span><span>Value<br><b>${fmtMoney(p.qty*mark)}</b></span></div></div>`;
  }).join("");
}

function renderLog(){
  $("log").innerHTML = state.logs.map(l => `<div class="log-line ${l.type}"><span class="log-time">${l.time}</span><b class="log-type">${l.type}</b><span>${l.message}</span></div>`).join("");
}

function renderStats(){
  const closed = state.trades;
  const wins = closed.filter(t=>t.pnl>0);
  $("winRate").textContent = closed.length ? `${(wins.length/closed.length*100).toFixed(1)}%` : "0%";
  $("realized").textContent = `${state.realizedPnl>=0?"+":""}${fmtMoney(state.realizedPnl)}`;
  $("fees").textContent = fmtMoney(state.totalFees);
  $("drawdown").textContent = `${state.maxDrawdown.toFixed(2)}%`;
  const sorted = [...closed].sort((a,b)=>b.pnl-a.pnl);
  $("bestTrade").textContent = sorted[0] ? `${sorted[0].pair} ${fmtPct(sorted[0].pnlPct)}` : "—";
  $("worstTrade").textContent = sorted.length ? `${sorted[sorted.length-1].pair} ${fmtPct(sorted[sorted.length-1].pnlPct)}` : "—";
}

function renderChart(){
  const pair = state.selectedPair, t = state.tickers[pair], h = state.history[pair];
  $("chartPair").textContent = pair;
  $("chartPrice").textContent = t ? fmtMoney(t.price, t.price < 1000 ? 4 : 2) : "—";
  $("chartChange").textContent = t ? `${fmtPct(t.change24h)} 24h` : "Waiting for market data";
  $("chartChange").className = t?.change24h < 0 ? "negative" : "positive";

  const canvas=$("chart"), rect=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  if (canvas.width!==Math.round(rect.width*dpr)||canvas.height!==Math.round(rect.height*dpr)){canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr)}
  const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);
  const pts=h.slice(-180); if(pts.length<2){ctx.fillStyle="#61747d";ctx.font="11px monospace";ctx.fillText("COLLECTING LIVE TICKS…",12,rect.height/2);return}
  const prices=pts.map(p=>p.price), min=Math.min(...prices), max=Math.max(...prices), pad=Math.max((max-min)*.15,max*.0002); const lo=min-pad, hi=max+pad;
  ctx.strokeStyle="rgba(98,245,255,.08)";ctx.lineWidth=1; for(let i=1;i<5;i++){const y=rect.height*i/5;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(rect.width,y);ctx.stroke()}
  const grad=ctx.createLinearGradient(0,0,rect.width,0);grad.addColorStop(0,"#62f5ff");grad.addColorStop(1,"#ff2bd6");ctx.strokeStyle=grad;ctx.lineWidth=2;ctx.shadowColor="#62f5ff";ctx.shadowBlur=8;ctx.beginPath();pts.forEach((p,i)=>{const x=i/(pts.length-1)*rect.width;const y=rect.height-((p.price-lo)/(hi-lo))*rect.height;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.shadowBlur=0;
}

function selectPair(pair){
  state.selectedPair=pair;
  document.querySelectorAll("[data-pair]").forEach(b=>b.classList.toggle("active",b.dataset.pair===pair));
  renderAll();
}

document.querySelectorAll("[data-pair]").forEach(b=>b.onclick=()=>selectPair(b.dataset.pair));
document.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{
  state.mode=b.dataset.mode;
  document.querySelectorAll("[data-mode]").forEach(x=>x.classList.toggle("active",x.dataset.mode===state.mode));
  log("SYSTEM", `Mode changed to ${state.mode}`);
  renderMode();
});
$("startBtn").onclick=()=>{
  state.running=true; $("startBtn").disabled=true; $("stopBtn").disabled=false;
  log("SYSTEM", `Paper bot started in ${state.mode} mode with ${fmtMoney(equity())}`);
};
$("stopBtn").onclick=()=>{
  state.running=false; $("startBtn").disabled=false; $("stopBtn").disabled=true;
  log("SYSTEM", "Paper bot stopped; live market feed remains connected");
};
$("clearLog").onclick=()=>{state.logs=[];renderLog()};
window.addEventListener("resize",()=>renderChart());

setInterval(evaluateBot, 500);
setInterval(()=>{ if(state.running) log("SCAN", `${PRODUCTS.map(p=>`${p.split("-")[0]} ${Math.round(state.scores[p].score*100)}`).join(" · ")}`); }, 15_000);
log("SYSTEM", "BRAVIA Phase 1 loaded — paper trading only");
connectMarket();
renderAll();
