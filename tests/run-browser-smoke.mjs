import {chromium} from 'playwright-core';

const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1600,height:1100},acceptDownloads:true});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
try{
  await page.goto('http://127.0.0.1:8844/tests/browser.integration.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const value=document.getElementById('result')?.textContent||'';
    return value.startsWith('PASS')||value.startsWith('FAIL');
  },null,{timeout:90000,polling:150});
  const status=await page.locator('#result').innerText();
  const appMessage=await page.frameLocator('#app').locator('#message').innerText().catch(()=>'?');
  console.log('Browser integration:',status);
  console.log('App status:',appMessage);
  if(errors.length)console.log('Browser console:',errors.join('\n'));
  if(!status.startsWith('PASS'))throw new Error(status);
  if(errors.length)throw new Error('Browser errors: '+errors.join('\n'));
}catch(e){
  await page.screenshot({path:'/tmp/mapfox-phase-c-failure.png',fullPage:true}).catch(()=>{});
  const appStatus=await page.frameLocator('#app').locator('#message').innerText().catch(()=>'?');
  const state=await page.locator('#result').innerText().catch(()=>'?');
  console.error('Browser test failed:',e.message,'Result:',state,'App message:',appStatus,'Errors:',errors);
  process.exitCode=1;
}finally{await browser.close();}
