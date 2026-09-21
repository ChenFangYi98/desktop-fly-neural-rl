import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';

const here=path.dirname(fileURLToPath(import.meta.url)),windowsRoot=path.dirname(here);
ipcMain.handle('brain-data',async()=>{const {loadBrainData}=await import('../src/data.js');return loadBrainData();});ipcMain.on('show-window',()=>{});
ipcMain.handle('open-policy-save',(_event,value)=>({name:value.name,episodes:value.metrics?.episodes||0}));ipcMain.handle('open-policy-latest',()=>null);
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1320,height:820,webPreferences:{preload:path.join(windowsRoot,'preload.mjs'),backgroundThrottling:false,sandbox:false,partition:'training-smoke'}});
  await win.loadFile(path.join(windowsRoot,'renderer','training.html'));
  await new Promise(resolve=>setTimeout(resolve,350));
  const worldInteraction=await win.webContents.executeJavaScript(`(()=>{document.querySelector('#exactX').value='1';document.querySelector('#exactY').value='1';document.querySelector('#exactZ').value='5';document.querySelector('#placeExact').click();const saved=JSON.parse(localStorage.getItem('desktopFly.openTrainingProject.v1'));return{navigation:document.querySelector('#worldCanvas').dataset.worldNavigation,motion:document.querySelector('#worldCanvas').dataset.predatorMotion,travel:Number(document.querySelector('#worldCanvas').dataset.predatorTravel||0),hasGoal:[...document.querySelectorAll('#assetPalette button')].some(button=>button.textContent==='任务目标'),exactPlaced:saved.world.voxels.some(v=>v[0]===1&&v[1]===1&&v[2]===5&&v[3]==='rock')};})()`,true);
  assert.equal(worldInteraction.navigation,'drag-orbit-zoom');assert.equal(worldInteraction.motion,'autonomous-collision');assert.ok(worldInteraction.travel>0);assert.equal(worldInteraction.hasGoal,true);assert.equal(worldInteraction.exactPlaced,true);
  await win.webContents.executeJavaScript(`document.querySelector('[data-step="learn"]').click();document.querySelector('#algorithm').value='three-factor';document.querySelector('#algorithm').dispatchEvent(new Event('change'));document.querySelector('#episodes').value='800';document.querySelector('#trainButton').click();`,true);
  const deadline=Date.now()+12000;let state;
  while(Date.now()<deadline){
    state=await win.webContents.executeJavaScript(`({episodes:document.querySelector('#metricEpisodes').textContent,success:document.querySelector('#metricSuccess').textContent,exportReady:!document.querySelector('#exportPolicy').disabled,maps:document.querySelectorAll('#worldPresets .preset').length,skills:document.querySelectorAll('#skillPresets .preset').length,assets:document.querySelectorAll('#assetPalette button').length,rewards:document.querySelectorAll('#rewardRules .rule').length,observations:document.querySelectorAll('#observationList input').length,actions:document.querySelectorAll('#actionList input').length,status:document.querySelector('#statusText').textContent})`,true);
    if(state.exportReady)break;await new Promise(resolve=>setTimeout(resolve,80));
  }
  assert.equal(state.maps,5);assert.equal(state.skills,6);assert.equal(state.assets,18);assert.ok(state.rewards>=1);
  assert.equal(state.observations,8);assert.equal(state.actions,7);assert.equal(state.episodes,'800');assert.match(state.success,/\d+%/);
  assert.equal(state.exportReady,true);assert.match(state.status,/训练完成/);assert.match(state.status,/DFM-\d{8}-\d{6}-[A-Z0-9]{4}/);
  if(process.env.DESKTOPFLY_VISUAL_CAPTURE){win.show();await win.webContents.executeJavaScript(`document.querySelector('[data-step="world"]').click()`,true);await win.capturePage();await new Promise(resolve=>setTimeout(resolve,140));await writeFile(process.env.DESKTOPFLY_VISUAL_CAPTURE,(await win.capturePage()).toPNG());}
  console.log(`PASS open training UI: draggable world, moving predators, target material, ${state.maps} maps, ${state.episodes} episodes`);
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
