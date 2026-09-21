import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';

const here=path.dirname(fileURLToPath(import.meta.url)),windowsRoot=path.dirname(here);
let latest=null,requested=null;
ipcMain.handle('brain-data',async()=>{const {loadBrainData}=await import('../src/data.js');return loadBrainData();});
ipcMain.handle('open-policy-save',(_event,value)=>{latest=value;return{name:value.name,episodes:value.metrics?.episodes||0};});
ipcMain.handle('open-policy-latest',()=>latest);
ipcMain.on('show-window',(_event,name)=>requested=name);
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

app.whenReady().then(async()=>{
  const options={show:false,width:1320,height:820,webPreferences:{preload:path.join(windowsRoot,'preload.mjs'),backgroundThrottling:false,sandbox:false,partition:'deployment-flow-smoke'}};
  const training=new BrowserWindow(options);await training.loadFile(path.join(windowsRoot,'renderer','training.html'));
  await training.webContents.executeJavaScript(`document.querySelector('[data-step="learn"]').click();document.querySelector('#algorithm').value='three-factor';document.querySelector('#algorithm').dispatchEvent(new Event('change'));document.querySelector('#episodes').value='800';document.querySelector('#trainButton').click();`,true);
  const deadline=Date.now()+12000;while(Date.now()<deadline){if(await training.webContents.executeJavaScript(`!document.querySelector('#exportPolicy').disabled`,true))break;await new Promise(resolve=>setTimeout(resolve,80));}
  await training.webContents.executeJavaScript(`document.querySelector('#openEcology').click()`,true);
  const publishDeadline=Date.now()+3000;while((!latest||requested!=='ecosystem')&&Date.now()<publishDeadline)await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(latest?.kind,'desktop-fly-neural-rl-policy');assert.equal(requested,'ecosystem');assert.equal(latest.metrics.episodes,800);assert.equal(latest.brain.edgeCount,18968);assert.ok(latest.plasticity.changedGroupEdges>0);assert.match(latest.modelId,/^DFM-\d{8}-\d{6}-[A-Z0-9]{4}$/);

  const ecosystem=new BrowserWindow(options);await ecosystem.loadFile(path.join(windowsRoot,'renderer','ecosystem.html'));await new Promise(resolve=>setTimeout(resolve,1000));
  const loaded=await ecosystem.webContents.executeJavaScript(`({ready:!document.querySelector('#deployModel').disabled,syncReady:!document.querySelector('#syncModelWorld').disabled,status:document.querySelector('#modelStatus').textContent})`,true);
  assert.equal(loaded.ready,true);assert.equal(loaded.syncReady,true);assert.match(loaded.status,/训练页最新模型已载入/);
  await ecosystem.webContents.executeJavaScript(`document.querySelector('#syncModelWorld').click();document.querySelector('#deployModel').click()`,true);await new Promise(resolve=>setTimeout(resolve,220));
  const deployed=await ecosystem.webContents.executeJavaScript(`({status:document.querySelector('#modelStatus').textContent,brain:document.querySelector('#brainFlyName').textContent,thought:document.querySelector('#thoughtText').textContent,runtime:document.querySelector('#deploymentRuntime').textContent,selected:document.querySelector('#deployFly').selectedOptions[0].textContent})`,true);
  assert.match(deployed.status,/已部署到 1 号果蝇/);assert.ok(deployed.brain.includes(latest.modelId)||deployed.thought.includes(latest.modelId));assert.match(deployed.runtime,/已决策 [1-9]\d* 次/);assert.match(deployed.selected,new RegExp(latest.modelId));
  console.log('PASS neural deployment flow: train connectome -> model store -> target fly LIF/MaleCNS runtime');
  training.destroy();ecosystem.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
