// main.js — the Electron main process: the Windows counterpart of AppDelegate
// in main.swift. It owns the transparent click-through overlay, the brain
// panel, the tray menu, and the permission-free environment senses.
//
// AppKit -> Electron/Win32 mapping:
//   NSPanel .borderless + ignoresMouseEvents -> BrowserWindow transparent,
//                                               frame:false, setIgnoreMouseEvents
//   NSStatusItem                             -> Tray
//   NSEvent.mouseLocation                    -> screen.getCursorScreenPoint()
//   CGEventSource idle                       -> powerMonitor.getSystemIdleTime()
//   CGWindowListCopyWindowInfo               -> win32.listWindows (see win32.js)
//   NSScreen.screens                         -> screen.getAllDisplays()

import { app, BrowserWindow, Tray, Menu, screen, ipcMain, powerMonitor, nativeImage }
  from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

import { loadBrainData } from './src/data.js';
import { circadianActivity, ThermalTempo } from './src/environment.js';
import { listWindows, pollMouseButtons, win32Available } from './src/win32.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEBUG = !!process.env.DESKTOPFLY_DEBUG;
const APP_MODE = ['training', 'observation'].includes(process.env.DESKTOPFLY_APP_MODE)
  ? process.env.DESKTOPFLY_APP_MODE : 'all';
// The one-click launcher enables laboratory mode. The overlay renderer still
// computes the neural simulation while hidden, so live telemetry and learned
// skills work without placing a fly above unrelated desktop applications.
const LAB_ONLY = process.env.DESKTOPFLY_LAB_ONLY === '1' || APP_MODE !== 'all';

let overlay = null;
let brain = null;
let ecosystem = null;
let training = null;
let tray = null;
let desktop = null;          // union of every display, in DIP
let paused = false;
let brainVisible = true;
let overlayVisible = !LAB_ONLY;
let mouseTimer = null;
let windowTimer = null;
let typingLevel = 0;
let prevCursor = null;
let mouseMovedAt = 0;
const thermal = new ThermalTempo();

let brainData = null;
let dataInfo = 'no data — run etl.py';

// The overlay spans every display, so the fly can walk and fly from one
// monitor to the next the way it crosses any other part of the desktop.
// macOS pins the fly to one NSScreen and hops on a menu command; here the
// whole virtual desktop is one scene.
function virtualBounds() {
  const all = screen.getAllDisplays();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of all) {
    x0 = Math.min(x0, d.bounds.x); y0 = Math.min(y0, d.bounds.y);
    x1 = Math.max(x1, d.bounds.x + d.bounds.width);
    y1 = Math.max(y1, d.bounds.y + d.bounds.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// scene coordinates: origin at the center of the virtual desktop, +Y up
function toScene(x, y) {
  return {
    x: x - (desktop.x + desktop.width / 2),
    y: (desktop.y + desktop.height / 2) - y,
  };
}

// each display as a scene-space rect, so the fly never targets the dead
// corners of a non-rectangular multi-monitor layout
function screenRects() {
  return screen.getAllDisplays().map((d) => {
    const tl = toScene(d.bounds.x, d.bounds.y);
    const br = toScene(d.bounds.x + d.bounds.width, d.bounds.y + d.bounds.height);
    return { id: d.id, x0: tl.x, x1: br.x, y0: br.y, y1: tl.y };
  });
}

function createOverlay(b) {
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    show: overlayVisible,
    transparent: true,
    frame: false,
    // resizable/movable must stay true: Windows clamps a fixed-size window to
    // one monitor's work area, which would cut the overlay down to a single
    // display while the scene still believes it spans the whole desktop.
    // (enableLargerThanScreen is macOS-only and does not help here.)
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.mjs'),
      backgroundThrottling: false,
      sandbox: false,
    },
  });
  // Windows applies its own clamp at creation time; re-assert the full
  // virtual-desktop rect afterwards, then verify (see checkOverlayFit).
  win.setMinimumSize(1, 1);
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  win.setIgnoreMouseEvents(true);                       // clicks pass through to the desktop
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pipeConsole(win, 'overlay');
  win.loadFile(path.join(HERE, 'renderer', 'overlay.html'));
  return win;
}

function createBrain(d) {
  // The neural lab needs enough room for the anatomical view, live telemetry,
  // synaptic event stream and the bounded skill trainer. Keep it inside the
  // current work area on smaller displays.
  const W = Math.min(1180, Math.max(900, d.workArea.width - 100));
  const H = Math.min(820, Math.max(650, d.workArea.height - 90));
  const win = new BrowserWindow({
    x: d.workArea.x + Math.round((d.workArea.width - W) / 2),
    y: d.workArea.y + Math.round((d.workArea.height - H) / 2),
    width: W,
    height: H,
    minWidth: 860,
    minHeight: 620,
    title: '果蝇神经训练实验室 — FlyWire v783',
    backgroundColor: '#080a10',
    // Laboratory mode uses an ordinary window that the user can minimize and
    // switch to. The legacy desktop-pet launch retains the floating panel.
    skipTaskbar: !LAB_ONLY,
    alwaysOnTop: !LAB_ONLY,
    webPreferences: {
      preload: path.join(HERE, 'preload.mjs'),
      backgroundThrottling: false,
      sandbox: false,
    },
  });
  win.setMenu(null);
  win.on('close', (e) => {           // closing hides, like orderOut on the NSPanel
    if (!app.isQuitting) { e.preventDefault(); win.hide(); brainVisible = false; }
  });
  pipeConsole(win, 'brain');
  win.loadFile(path.join(HERE, 'renderer', 'brain.html'));
  return win;
}

function createEcosystem(d) {
  const W = Math.min(1320, Math.max(980, d.workArea.width - 120));
  const H = Math.min(820, Math.max(680, d.workArea.height - 100));
  const win = new BrowserWindow({
    x: d.workArea.x + Math.round((d.workArea.width - W) / 2),
    y: d.workArea.y + Math.round((d.workArea.height - H) / 2),
    width: W,
    height: H,
    minWidth: 900,
    minHeight: 620,
    title: '果蝇生态观察室',
    backgroundColor: '#101912',
    show: APP_MODE !== 'training',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.mjs'),
      backgroundThrottling: false,
      sandbox: false,
    },
  });
  win.setMenu(null);
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
  pipeConsole(win, 'ecosystem');
  win.loadFile(path.join(HERE, 'renderer', 'ecosystem.html'));
  return win;
}

function createTraining(d) {
  const W = Math.min(1440, Math.max(1060, d.workArea.width - 80));
  const H = Math.min(900, Math.max(720, d.workArea.height - 70));
  const win = new BrowserWindow({
    x: d.workArea.x + Math.round((d.workArea.width - W) / 2),
    y: d.workArea.y + Math.round((d.workArea.height - H) / 2),
    width: W,
    height: H,
    minWidth: 980,
    minHeight: 680,
    title: '果蝇具身智能训练中心',
    backgroundColor: '#07100f',
    show: APP_MODE !== 'observation',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.mjs'),
      backgroundThrottling: false,
      sandbox: false,
    },
  });
  win.setMenu(null);
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
  pipeConsole(win, 'training');
  win.loadFile(path.join(HERE, 'renderer', 'training.html'));
  return win;
}

// Renderer errors are invisible in a windowless tray app; surface them.
function pipeConsole(win, tag) {
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (DEBUG || level >= 2) {
      process.stderr.write(`[${tag}] ${message} (${source}:${line})
`);
    }
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    process.stderr.write(`[${tag}] load failed: ${desc} (${code})
`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    process.stderr.write(`[${tag}] renderer gone: ${details.reason}
`);
  });
}

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function launchIndependentMode(mode) {
  const child = spawn(process.execPath, ['.'], {
    cwd: HERE,
    env: { ...process.env, DESKTOPFLY_APP_MODE: mode, DESKTOPFLY_LAB_ONLY: '1' },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function buildTrayMenu() {
  if (APP_MODE === 'training') return Menu.buildFromTemplate([
    { label: '果蝇具身训练项目', enabled: false },
    { label: dataInfo, enabled: false },
    { type: 'separator' },
    { label: '显示训练中心', click: () => { training?.show(); training?.focus(); } },
    { label: '启动生态·大脑观察项目', click: () => launchIndependentMode('observation') },
    { type: 'separator' },
    { label: '退出训练项目', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  if (APP_MODE === 'observation') return Menu.buildFromTemplate([
    { label: '果蝇生态·大脑观察项目', enabled: false },
    { label: dataInfo, enabled: false },
    { type: 'separator' },
    { label: '显示联合观察室', click: () => { ecosystem?.show(); ecosystem?.focus(); } },
    { label: '启动独立具身训练项目', click: () => launchIndependentMode('training') },
    { type: 'separator' },
    { label: '退出观察项目', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  const multi = screen.getAllDisplays().length > 1;
  return Menu.buildFromTemplate([
    { label: 'Desktop Fly', enabled: false },
    { label: dataInfo, enabled: false },
    { type: 'separator' },
    {
      label: overlayVisible ? '隐藏桌面果蝇' : '显示桌面果蝇',
      click: () => {
        if (!overlay) return;
        overlayVisible = !overlayVisible;
        if (overlayVisible) overlay.showInactive(); else overlay.hide();
        refreshTray();
      },
    },
    {
      label: paused ? 'Resume' : 'Pause',
      click: () => { paused = !paused; send(overlay, 'cmd', { name: 'pause', value: paused }); refreshTray(); },
    },
    {
      label: '打开/隐藏生态·大脑联合观察',
      click: () => {
        if (!ecosystem) return;
        if (ecosystem.isVisible()) ecosystem.hide(); else { ecosystem.show(); ecosystem.focus(); }
      },
    },
    {
      label: '打开/隐藏具身训练中心',
      click: () => {
        if (!training) return;
        if (training.isVisible()) training.hide(); else training.show();
      },
    },
    { label: 'Escape Test (loom)', click: () => send(overlay, 'cmd', { name: 'escapeTest' }) },
    {
      // Same electrode as clicking the cluster in the brain window, without
      // having to aim at a rotating point cloud.
      label: 'Stimulate Neurons',
      submenu: [
        ['Grooming — DNg11', 'groom'],
        ['Walk forward — DNp09', 'walk'],
        ['Backward walk — MDN', 'backward'],
        ['Escape takeoff — giant fiber DNp01', 'escape'],
        ['Raise wings — DNp02/04/11', 'wings'],
        ['Startle — sensory (tap)', 'tap'],
        ['Steer left — DNa left', 'steerLeft'],
        ['Steer right — DNa right', 'steerRight'],
      ].map(([label, group]) => ({
        label,
        click: () => send(overlay, 'cmd', { name: 'stim', group }),
      })),
    },
    ...(multi ? [{ label: 'Send Fly to Next Display', click: sendFlyToNextDisplay }] : []),
    { label: 'Add Fly', click: () => send(overlay, 'cmd', { name: 'addFly' }) },
    { label: 'Remove Fly', click: () => send(overlay, 'cmd', { name: 'removeFly' }) },
    { label: 'Scare Flies', click: () => send(overlay, 'cmd', { name: 'scareAll' }) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function refreshTray() { if (tray) tray.setContextMenu(buildTrayMenu()); }

// The fly crosses monitors on its own now; this just gives it a nudge.
function sendFlyToNextDisplay() {
  send(overlay, 'cmd', { name: 'flyToNextDisplay' });
}

// A display was plugged in or unplugged: resize the overlay to the new
// virtual desktop and tell the scene about it.
function refitDesktop() {
  const want = virtualBounds();
  if (overlay && !overlay.isDestroyed()) {
    overlay.setBounds({ x: want.x, y: want.y, width: want.width, height: want.height });
  }
  publishGeometry();
  placeBrain();
  refreshTray();
}

// The window manager gets the final say on the overlay's rect, so the scene is
// always told the size the window actually has. Anything else and the fly
// walks into coordinates that are not on screen — it simply vanishes.
function publishGeometry() {
  if (!overlay || overlay.isDestroyed()) return;
  const b = overlay.getBounds();
  const want = virtualBounds();
  if (DEBUG && (b.width !== want.width || b.height !== want.height)) {
    process.stderr.write(`overlay clamped by Windows: wanted ${want.width}x${want.height}, `
      + `got ${b.width}x${b.height}
`);
  }
  desktop = b;
  send(overlay, 'retarget', { width: b.width, height: b.height, screens: screenRects() });
}

function placeBrain() {
  if (!brain || brain.isDestroyed()) return;
  const d = screen.getPrimaryDisplay();
  const [W, H] = brain.getSize();
  brain.setPosition(d.workArea.x + d.workArea.width - W - 18,
                    d.workArea.y + d.workArea.height - H - 18);
}

// ---- environment senses ----

// 30 Hz: cursor, taps, typing, circadian hour, idleness, thermal tempo
function pollAmbient() {
  const cursor = screen.getCursorScreenPoint();
  const scene = toScene(cursor.x, cursor.y);

  const now = Date.now();
  const moved = prevCursor && Math.hypot(cursor.x - prevCursor.x, cursor.y - prevCursor.y) > 1.5;
  if (moved) mouseMovedAt = now;
  prevCursor = cursor;

  const buttons = pollMouseButtons();
  if (buttons.left || buttons.right) {
    mouseMovedAt = now;
    // a global click = a tap on the fly's substrate -> sensory pathway
    send(overlay, 'tap', scene);
  }

  const idle = powerMonitor.getSystemIdleTime();   // seconds
  // typing = substrate vibration (when, never what). The system idle timer
  // says "someone touched an input device"; if the cursor did not move and no
  // button went down, that input was the keyboard.
  const typingNow = (idle < 1 && now - mouseMovedAt > 400) ? 1 : 0;
  typingLevel += (typingNow - typingLevel) * 0.15;

  const t = new Date();
  const h = t.getHours() + t.getMinutes() / 60;
  const sleepy = (idle > 600 && (h >= 22 || h < 6)) || idle > 1800;

  send(overlay, 'ambient', {
    mouse: scene,
    typing: typingLevel,
    sleepy,
    tempo: thermal.poll(),
    activity: circadianActivity(h),
  });
}

// ~1.4 Hz: window terrain and new-window looms
function pollWindows() {
  const W = desktop.width, H = desktop.height;
  const ledges = [];
  const newWindows = [];

  for (const w of listWindows(process.pid)) {
    // Win32 reports physical pixels; Electron's geometry is in DIP
    const tlp = screen.screenToDipPoint({ x: w.left, y: w.top });
    const brp = screen.screenToDipPoint({ x: w.right, y: w.bottom });
    const tl = toScene(tlp.x, tlp.y);
    const br = toScene(brp.x, brp.y);

    const topY = tl.y;
    const x0 = Math.max(tl.x, -W / 2 + 15);
    const x1 = Math.min(br.x, W / 2 - 15);
    if (topY < H / 2 - 8 && topY > -H / 2 + 8 && x1 - x0 > 100 && ledges.length < 12) {
      ledges.push({ y: topY, x0, x1, id: w.id });
    }
    newWindows.push({
      id: w.id,
      center: { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 },
      size: Math.max(br.x - tl.x, tl.y - br.y),
    });
  }
  if (DEBUG) {
    process.stderr.write(`terrain: ${newWindows.length} windows on display, `
      + `${ledges.length} walkable ledges`
      + (ledges.length ? ` [${ledges.map((l) => Math.round(l.y)).join(', ')}]` : '') + '\n');
  }
  send(overlay, 'terrain', { ledges, windows: newWindows });
}

// ---- app lifecycle ----

app.setAppUserModelId(`com.desktopfly.windows.${APP_MODE}`);
// Training and observation are intentionally independent applications. Their
// user-data roots and single-instance locks do not block each other.
if (APP_MODE !== 'all') app.setPath('userData', path.join(app.getPath('appData'), `DesktopFly-${APP_MODE}`));
// A transparent, always-on-top overlay does not need to steal focus.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const instanceLock = app.requestSingleInstanceLock();
if (!instanceLock) app.quit();

// A second double-click should reveal the already running laboratory instead
// of creating duplicate simulations and duplicate tray icons.
app.on('second-instance', () => {
  const target = APP_MODE === 'training' ? training : ecosystem;
  if (target && !target.isDestroyed()) { target.show(); target.focus(); }
});

app.whenReady().then(() => {
  if (!instanceLock) return;
  brainData = loadBrainData();
  if (brainData) {
    dataInfo = `FlyWire v783 · ${brainData.points.points.length} somas · `
      + `circuit ${brainData.circuit.neurons.length}n/${brainData.circuit.edges.length}e`;
    if (brainData.locomotor) dataInfo += ` · MaleCNS ${brainData.locomotor.neurons.length}n`;
  }
  if (!win32Available()) {
    process.stderr.write('win32: running without window terrain (koffi unavailable)\n');
  }

  desktop = virtualBounds();
  if (APP_MODE === 'all') {
    overlay = createOverlay(desktop);
    overlay.webContents.once('did-finish-load', publishGeometry);
    overlay.on('resize', publishGeometry);
    overlay.on('move', publishGeometry);
  }
  // Neural activity is rendered inside the ecology/first-person window. The
  // legacy standalone brain window is no longer created.
  if (APP_MODE !== 'training') ecosystem = createEcosystem(screen.getPrimaryDisplay());
  if (APP_MODE !== 'observation') training = createTraining(screen.getPrimaryDisplay());

  if (DEBUG) process.stderr.write(`launch mode: ${LAB_ONLY ? 'laboratory' : 'desktop pet'}; `
    + `desktop overlay visible=${overlay.isVisible()}\n`);

  tray = new Tray(nativeImage.createFromPath(path.join(HERE, 'assets', 'tray.png')));
  tray.setToolTip('Desktop Fly');
  refreshTray();

  if (APP_MODE === 'all') {
    mouseTimer = setInterval(pollAmbient, 1000 / 30);
    windowTimer = setInterval(pollWindows, 700);
  }

  // a monitor came or went: the virtual desktop changed shape
  screen.on('display-removed', refitDesktop);
  screen.on('display-added', refitDesktop);
  screen.on('display-metrics-changed', refitDesktop);
});

ipcMain.handle('brain-data', () => brainData);
ipcMain.handle('open-policy-save', async (_e, manifest) => {
  if (manifest?.kind !== 'desktop-fly-neural-rl-policy' || !manifest.world || !manifest.experiment || !manifest.policy || !manifest.plasticity || !manifest.brain) throw new Error('神经训练包格式不完整');
  const json = JSON.stringify(manifest);
  if (json.length > 80 * 1024 * 1024) throw new Error('训练包超过 80 MB，请减少状态空间后重试');
  await writeFile(path.join(app.getPath('userData'), 'latest-open-policy.json'), json, 'utf8');
  send(ecosystem, 'open-policy-available', manifest);
  return { name: manifest.name, episodes: manifest.metrics?.episodes || 0 };
});
ipcMain.handle('open-policy-latest', async () => {
  try {
    const value = JSON.parse(await readFile(path.join(app.getPath('userData'), 'latest-open-policy.json'), 'utf8'));
    return value?.kind === 'desktop-fly-neural-rl-policy' ? value : null;
  } catch { return null; }
});
ipcMain.on('spikes', (_e, list) => send(brain, 'spikes', list));
ipcMain.on('stimulate', (_e, req) => send(overlay, 'stimulate', req));
ipcMain.on('neural-telemetry', (_e, snapshot) => {
  send(brain, 'neural-telemetry', snapshot);
  send(training, 'neural-telemetry', snapshot);
});
ipcMain.on('apply-skill', (_e, skill) => send(overlay, 'trained-skill', skill));
ipcMain.on('show-window', (_e, name) => {
  const target = name === 'brain' ? ecosystem
    : name === 'ecosystem' ? ecosystem
      : name === 'training' ? training : null;
  if (!target && name === 'training') { launchIndependentMode('training'); return; }
  if (!target && (name === 'ecosystem' || name === 'brain')) { launchIndependentMode('observation'); return; }
  if (!target || target.isDestroyed()) return;
  target.show();
  target.focus();
  if (name === 'brain') brainVisible = true;
});

app.on('window-all-closed', () => { /* tray-only app: stay alive */ });
app.on('before-quit', () => {
  app.isQuitting = true;
  clearInterval(mouseTimer);
  clearInterval(windowTimer);
});
