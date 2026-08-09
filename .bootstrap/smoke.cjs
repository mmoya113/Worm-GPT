const { chromium } = require('playwright');
const fs = require('fs');

(async()=>{
  const browser=await chromium.launch({headless:true});
  const results=[];
  async function run(name, viewport, mobile=false){
    const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(`pageerror: ${e.message}`));
    page.on('console',m=>{if(m.type()==='error')errors.push(`console: ${m.text()}`)});
    const r=await page.goto('http://127.0.0.1:4173/?demo=1',{waitUntil:'networkidle'});
    if(!r||!r.ok())throw new Error(`${name}: page did not load`);
    await page.locator('#choosePaper').click();
    await page.locator('#startBtn').click();
    await page.waitForTimeout(900);
    const title=await page.title();
    const equity=await page.locator('#equity').innerText();
    const canvas=await page.locator('#chart').boundingBox();
    if(title!=='BRAVIA // Trading Lab')errors.push(`bad title: ${title}`);
    if(!equity.includes('$'))errors.push(`bad equity: ${equity}`);
    if(!canvas||canvas.width<280||canvas.height<180)errors.push(`chart too small: ${JSON.stringify(canvas)}`);

    const views=['markets','memes','sniper','arena','setup'];
    for(const v of views){
      const nav=page.locator(`[data-view="${v}"]`).first();
      await nav.click();await page.waitForTimeout(120);
      const active=await page.locator(`#view-${v}`).evaluate(el=>el.classList.contains('active'));
      if(!active)errors.push(`view ${v} did not activate`);
    }
    await page.locator('[data-view="memes"]').first().click();
    await page.locator('#memeAutoToggle').click();
    await page.locator('[data-view="sniper"]').first().click();
    await page.locator('#armSniper').click();
    await page.locator('[data-preset="FAST"]').click();
    await page.locator('[data-view="arena"]').first().click();
    await page.locator('#arenaToggle').click();
    await page.waitForTimeout(900);
    const arenaRows=await page.locator('#arenaRows .leader-row').count();
    if(arenaRows!==8)errors.push(`arena rows: ${arenaRows}`);
    await page.locator('[data-view="overview"]').first().click();
    await page.waitForTimeout(350);
    await page.screenshot({path:`recovered/assets/screenshot-${name}.png`,fullPage:true});
    results.push({name,title,equity,chart:canvas,arenaRows,errors});
    await context.close();
  }
  try{
    await run('desktop',{width:1440,height:1050},false);
    await run('mobile',{width:393,height:852},true);
  }finally{await browser.close()}
  const bad=results.flatMap(x=>x.errors.map(e=>`${x.name}: ${e}`));
  const report=['BRAVIA V3 BROWSER UI QA',...results.map(x=>`${x.name}: title=${x.title}; equity=${x.equity}; chart=${Math.round(x.chart?.width||0)}x${Math.round(x.chart?.height||0)}; arenaRows=${x.arenaRows}; errors=${x.errors.length}`),`overall: ${bad.length?'FAIL':'PASS'}`,...bad].join('\n')+'\n';
  fs.writeFileSync('recovered/QA_BROWSER.txt',report);
  console.log(report);
  if(bad.length)process.exit(1);
})().catch(e=>{fs.writeFileSync('recovered/QA_BROWSER.txt',`BRAVIA V3 BROWSER UI QA\noverall: FAIL\n${e.stack||e}\n`);console.error(e);process.exit(1)});
