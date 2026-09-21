import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';

const here=path.dirname(fileURLToPath(import.meta.url)),windowsRoot=path.dirname(here);
let requested=null;
ipcMain.on('show-window',(_event,name)=>requested=name);
ipcMain.handle('brain-data',async()=>{const {loadBrainData}=await import('../src/data.js');return loadBrainData();});
ipcMain.handle('open-policy-save',()=>({}));ipcMain.handle('open-policy-latest',()=>null);
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1320,height:820,webPreferences:{preload:path.join(windowsRoot,'preload.mjs'),backgroundThrottling:false,sandbox:false,partition:'ecosystem-smoke'}});
  await win.loadFile(path.join(windowsRoot,'renderer','ecosystem.html'));
  await new Promise(resolve=>setTimeout(resolve,900));
  const state=await win.webContents.executeJavaScript(`({neurons:document.querySelector('#brainPanel').dataset.neuronCount,source:document.querySelector('#brainPanel').dataset.source,sim:Number(document.querySelector('#brainPanel').dataset.simMs||0),maps:document.querySelector('#presetSelect').options.length,assets:document.querySelectorAll('#palette button').length,flies:Number(document.querySelector('#flyCount').textContent),predators:Number(document.querySelector('#predatorCount').textContent),levelText:document.querySelector('#predatorInfo').textContent,navigation:document.querySelector('body>canvas').dataset.worldNavigation,motion:document.querySelector('body>canvas').dataset.predatorMotion,travel:Number(document.querySelector('body>canvas').dataset.predatorTravel||0),hasGoal:[...document.querySelectorAll('#palette button')].some(button=>button.textContent==='任务目标')})`,true);
  assert.equal(state.neurons,'668');assert.equal(state.source,'followedFly');assert.ok(state.sim>0);
  assert.equal(state.maps,5);assert.equal(state.assets,18);assert.ok(state.flies>=1);assert.ok(state.predators>=1);
  assert.equal(state.navigation,'drag-orbit-zoom');assert.equal(state.motion,'autonomous-collision');assert.ok(state.travel>0);assert.equal(state.hasGoal,true);
  assert.match(state.levelText,/速度 2.2 格\/秒/);
  const exact=await win.webContents.executeJavaScript(`(()=>{document.querySelector('#ecoExactX').value='1';document.querySelector('#ecoExactY').value='1';document.querySelector('#ecoExactZ').value='5';document.querySelector('#ecoPlaceExact').click();const saved=JSON.parse(localStorage.getItem('desktopFly.openEcologyWorld.v1'));return{placed:saved.voxels.some(v=>v[0]===1&&v[1]===1&&v[2]===5&&v[3]==='rock'),quickModel:!!document.querySelector('#quickChooseModel'),runtime:!!document.querySelector('#deploymentRuntime')};})()`,true);
  assert.equal(exact.placed,true);assert.equal(exact.quickModel,true);assert.equal(exact.runtime,true);
  const deleted=await win.webContents.executeJavaScript(`(()=>{const rows=[...document.querySelectorAll('#entityList .entity-row')];const predator=rows.find(row=>/青蛙|蜘蛛|螳螂/.test(row.textContent));const before=rows.length;const predatorsBefore=Number(document.querySelector('#predatorCount').textContent);predator.querySelector('button').click();return{before,after:document.querySelectorAll('#entityList .entity-row').length,predatorsBefore,predatorsAfter:Number(document.querySelector('#predatorCount').textContent)};})()`,true);
  assert.equal(deleted.after,deleted.before-1);assert.equal(deleted.predatorsAfter,deleted.predatorsBefore-1);
  await win.webContents.executeJavaScript("document.querySelector('#openTraining').click()",true);
  await new Promise(resolve=>setTimeout(resolve,80));assert.equal(requested,'training');
  if(process.env.DESKTOPFLY_VISUAL_CAPTURE){
    win.show();await win.webContents.executeJavaScript("document.querySelector('#editorBtn').click()",true);
    await win.capturePage();await new Promise(resolve=>setTimeout(resolve,320));
    await writeFile(process.env.DESKTOPFLY_VISUAL_CAPTURE,(await win.capturePage()).toPNG());
  }
  console.log(`PASS open ecology UI: ${state.maps} large maps, ${state.assets} placeables, live followed brain`);
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
