import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const GOPLUS_ACCESS_TOKEN = process.env.GOPLUS_ACCESS_TOKEN || '';
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const LIVE_EXECUTION_ENABLED = false; // Deliberate hard lock. Do not change casually.

app.use(cors({origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN}));
app.use(express.json({limit:'200kb'}));
app.disable('x-powered-by');

const sseClients = new Set();
let birdeyeWs = null;
let birdeyeReconnect = null;
let lastBirdeyeEvent = 0;

const timeoutFetch = (url, options={}, ms=8000) => fetch(url,{...options,signal:AbortSignal.timeout(ms)});
const okJson = async r => { if(!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); };
const safe = v => Number.isFinite(Number(v)) ? Number(v) : 0;

app.get('/health', (_req,res) => res.json({
  ok:true,
  service:'bravia-backend',
  version:'3.0.0',
  liveExecutionEnabled:LIVE_EXECUTION_ENABLED,
  providers:{
    birdeye:Boolean(BIRDEYE_API_KEY),
    helius:Boolean(HELIUS_API_KEY),
    goplus:Boolean(GOPLUS_ACCESS_TOKEN),
    jupiter:Boolean(JUPITER_API_KEY),
    openai:Boolean(OPENAI_API_KEY),
    dexscreener:true
  },
  sniperStream:{connected:birdeyeWs?.readyState===WebSocket.OPEN,lastEventAt:lastBirdeyeEvent||null}
}));

app.get('/api/sniper/stream', (req,res) => {
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache, no-transform');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ok:true,source:BIRDEYE_API_KEY?'birdeye':'none'})}\n\n`);
  sseClients.add(res);
  const heartbeat=setInterval(()=>res.write(': ping\n\n'),20000);
  req.on('close',()=>{clearInterval(heartbeat);sseClients.delete(res)});
});

function broadcast(payload){const data=`data: ${JSON.stringify(payload)}\n\n`;for(const client of sseClients){try{client.write(data)}catch{sseClients.delete(client)}}}

async function dexPairForToken(address){
  try {
    const pairs=await okJson(await timeoutFetch(`https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(address)}`));
    return (pairs||[]).sort((a,b)=>safe(b.liquidity?.usd)-safe(a.liquidity?.usd))[0] || null;
  } catch { return null; }
}

function tokenAddressFromBirdeye(msg){
  const d=msg?.data || msg?.result || msg;
  return d?.address || d?.token_address || d?.tokenAddress || d?.mint || d?.base?.address || d?.baseToken?.address || '';
}

async function onBirdeyeMessage(raw){
  let msg; try{msg=JSON.parse(String(raw))}catch{return}
  const address=tokenAddressFromBirdeye(msg); if(!address)return;
  lastBirdeyeEvent=Date.now();
  const pair=await dexPairForToken(address);
  if(pair) broadcast({source:'birdeye-new-listing',receivedAt:Date.now(),address,pair});
  else broadcast({source:'birdeye-new-listing',receivedAt:Date.now(),address,raw:msg});
}

function connectBirdeye(){
  if(!BIRDEYE_API_KEY)return;
  clearTimeout(birdeyeReconnect);
  const url=`wss://public-api.birdeye.so/socket/solana?x-api-key=${encodeURIComponent(BIRDEYE_API_KEY)}`;
  birdeyeWs=new WebSocket(url,'echo-protocol',{headers:{Origin:'ws://public-api.birdeye.so'}});
  birdeyeWs.on('open',()=>{
    birdeyeWs.send(JSON.stringify({type:'SUBSCRIBE_TOKEN_NEW_LISTING',meme_platform_enabled:true}));
  });
  birdeyeWs.on('message',onBirdeyeMessage);
  birdeyeWs.on('error',()=>{});
  birdeyeWs.on('close',()=>{birdeyeReconnect=setTimeout(connectBirdeye,2500)});
}

app.get('/api/security/:ca', async (req,res) => {
  const ca=String(req.params.ca||'').trim();
  if(ca.length<30)return res.status(400).json({error:'Invalid Solana contract address'});
  const out={ca,dex:null,security:null,birdeye:null,errors:[]};
  const jobs=[];
  jobs.push((async()=>{try{out.dex=await okJson(await timeoutFetch(`https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(ca)}`))}catch(e){out.errors.push(`dex:${e.message}`)}})());
  if(BIRDEYE_API_KEY){
    jobs.push((async()=>{try{
      const headers={'X-API-KEY':BIRDEYE_API_KEY,'x-chain':'solana'};
      const [sec,profile]=await Promise.all([
        timeoutFetch(`https://public-api.birdeye.so/defi/token_security?address=${encodeURIComponent(ca)}`,{headers}).then(okJson),
        timeoutFetch(`https://public-api.birdeye.so/token/v1/holder-profile?token_address=${encodeURIComponent(ca)}&include_zero_balance=true`,{headers}).then(okJson)
      ]);
      const s=sec?.data||sec||{},p=profile?.data||profile||{};
      out.birdeye={
        tokenSecurity:s,
        holderProfile:p,
        top10_holder_percent:safe(p?.top10_holder?.percent_of_supply ?? p?.top10_holder?.percentage ?? p?.top10_holder_percent),
        dev_percent:safe(p?.tags?.dev?.percent_of_supply ?? p?.tags?.dev?.percentage),
        insider_percent:safe(p?.tags?.insider?.percent_of_supply ?? p?.tags?.insider?.percentage),
        bundler_percent:safe(p?.tags?.bundler?.percent_of_supply ?? p?.tags?.bundler?.percentage)
      };
    }catch(e){out.errors.push(`birdeye:${e.message}`)}})());
  }
  if(GOPLUS_ACCESS_TOKEN){
    jobs.push((async()=>{try{
      const j=await okJson(await timeoutFetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(ca)}`,{headers:{Authorization:`Bearer ${GOPLUS_ACCESS_TOKEN}`}}));
      out.security=j?.result?.[ca]||j?.result?.[ca.toLowerCase()]||j?.result||j;
    }catch(e){out.errors.push(`goplus:${e.message}`)}})());
  }
  await Promise.all(jobs);
  res.json(out);
});

app.get('/api/jupiter/quote', async (req,res) => {
  if(!JUPITER_API_KEY)return res.status(503).json({error:'JUPITER_API_KEY not configured'});
  const {inputMint,outputMint,amount,slippageBps='100'}=req.query;
  if(!inputMint||!outputMint||!amount)return res.status(400).json({error:'inputMint, outputMint and amount are required'});
  const u=new URL('https://api.jup.ag/swap/v2/order');
  u.searchParams.set('inputMint',String(inputMint));u.searchParams.set('outputMint',String(outputMint));u.searchParams.set('amount',String(amount));u.searchParams.set('slippageBps',String(slippageBps));
  try{const j=await okJson(await timeoutFetch(u,{headers:{'x-api-key':JUPITER_API_KEY}}));res.json(j)}catch(e){res.status(502).json({error:e.message})}
});

app.get('/api/wallet/:address/balance', async (req,res) => {
  if(!HELIUS_API_KEY)return res.status(503).json({error:'HELIUS_API_KEY not configured'});
  const address=String(req.params.address||'');
  try{
    const rpc=await okJson(await timeoutFetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(HELIUS_API_KEY)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getBalance',params:[address,{commitment:'confirmed'}]})}));
    res.json({address,lamports:rpc?.result?.value||0,sol:(rpc?.result?.value||0)/1e9});
  }catch(e){res.status(502).json({error:e.message})}
});


app.post('/api/ai/review', async (req,res) => {
  if(!OPENAI_API_KEY)return res.status(503).json({error:'OPENAI_API_KEY not configured'});
  const payload=JSON.stringify(req.body||{}).slice(0,30000);
  const input=`You are the BRAVIA paper-trading supervisor. Review only the supplied simulated performance data. Do not claim guaranteed profit and do not instruct the user to place a real-money trade. Identify: (1) best and worst strategy by risk-adjusted behavior, (2) whether trade density or friction is hurting results, (3) suspiciously small sample sizes, (4) what paper-test parameter should be tested next, and (5) a short verdict. Be concise and use clear bullets. Data: ${payload}`;
  try{
    const j=await okJson(await timeoutFetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${OPENAI_API_KEY}`},body:JSON.stringify({model:OPENAI_MODEL,input,store:false})},20000));
    const review=j.output_text || (j.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').join('\n').trim();
    res.json({review,model:j.model||OPENAI_MODEL});
  }catch(e){res.status(502).json({error:e.message})}
});

app.get('/api/live/capabilities', (_req,res)=>res.json({
  executionEnabled:LIVE_EXECUTION_ENABLED,
  walletReadOnly:true,
  message:'This build intentionally does not expose an autonomous real-money order endpoint.'
}));

app.use((_req,res)=>res.status(404).json({error:'Not found'}));
app.listen(PORT,()=>{console.log(`BRAVIA backend listening on :${PORT}`);connectBirdeye()});
