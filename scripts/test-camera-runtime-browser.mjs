// Install the browser test dependency in ignored local storage, as documented.
import { chromium } from '../.local/camera-browser/node_modules/playwright/index.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
const samples=[];
async function login(){const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.url().endsWith('/samples')&&r.ok()){const data=await r.json();samples.push(data.observation);}});await page.goto('http://127.0.0.1:5183/#/cameras');await page.locator('input[type=email]').fill('camera-browser@example.test');await page.locator('input[type=password]').fill('Camera-test-123!');await page.locator('button[type=submit]').click();await page.waitForSelector('.camera-wall-card .camera-live-stage img',{timeout:25000});return {context,page};}
try {
const owner=await login();await owner.page.waitForFunction(()=>document.querySelectorAll('.camera-wall-card .camera-live-stage img').length===6,{},{timeout:25000});
await owner.page.evaluate(()=>location.hash='/status');await owner.page.waitForTimeout(2200);await owner.page.evaluate(()=>location.hash='/cameras');
await owner.page.waitForSelector('.camera-wall-card .camera-live-stage img');
const ids=new Set(samples.map(s=>s.cameraId));if(ids.size!==6)throw Error('Not all six Cameras processed');
const first=Object.fromEntries(samples.map(s=>[s.cameraId,s.episodeId]));
await owner.page.locator('.camera-wall-card').first().click();await owner.page.getByRole('button',{name:'Watch live video'}).waitFor();
const viewer=await login();await viewer.page.locator('.camera-wall-card').first().click();if(await viewer.page.getByRole('button',{name:'Watch live video'}).count())throw Error('Viewer became duplicate source');
await owner.page.close();
await viewer.page.getByRole('button',{name:'Watch live video'}).waitFor({timeout:45000});
await viewer.page.getByRole('button',{name:'Disable',exact:true}).click();await viewer.page.getByRole('button',{name:'Enable',exact:true}).waitFor();
await viewer.page.getByRole('button',{name:'Enable',exact:true}).click();await viewer.page.getByRole('button',{name:'Disable',exact:true}).waitFor();
await viewer.page.waitForSelector('.camera-live-stage img');
await viewer.page.screenshot({path:'.local/camera-acceptance-detail.png',fullPage:true});
await viewer.page.setViewportSize({width:760,height:1000});await viewer.page.screenshot({path:'.local/camera-acceptance-tablet.png',fullPage:true});
console.log(JSON.stringify({processedCameraCount:ids.size,totalSamples:samples.length,firstEpisodes:first,errors,failoverPassed:true,togglePassed:true}));
} finally {await browser.close();}
if(errors.length)process.exitCode=1;
