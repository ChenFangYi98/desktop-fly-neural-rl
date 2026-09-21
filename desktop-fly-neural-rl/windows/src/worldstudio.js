// World Studio is the shared, renderer-independent contract used by training
// and ecology. Presets are generators, never locked scenarios: every voxel,
// entity, property and task remains editable after creation.

export const WORLD_FORMAT = 'desktop-fly-open-world';
export const WORLD_VERSION = 3;

export const MATERIALS = Object.freeze({
  grass: { name: '草地', color: 0x4f8f43, solid: true },
  soil: { name: '泥土', color: 0x795338, solid: true },
  rock: { name: '岩石', color: 0x707977, solid: true },
  wood: { name: '木材', color: 0x8c633d, solid: true },
  leaf: { name: '树叶', color: 0x39763d, solid: true },
  sand: { name: '沙地', color: 0xc1a663, solid: true },
  water: { name: '水', color: 0x3d91aa, solid: false, hazard: true },
  nectar: { name: '蜜源', color: 0xe9be42, solid: false, food: true },
  safe: { name: '安全区', color: 0x50d895, solid: false, safe: true },
});

export const PLACEABLES = Object.freeze([
  ...Object.entries(MATERIALS).map(([id, spec]) => ({ id: `voxel:${id}`, type: 'voxel', kind: id, name: spec.name })),
  { id: 'fly:spawn', type: 'spawn', kind: 'fly', name: '果蝇出生点' },
  { id: 'marker:goal', type: 'goal', kind: 'goal', name: '任务目标' },
  { id: 'food:banana', type: 'food', kind: 'banana', name: '香蕉' },
  { id: 'food:apple', type: 'food', kind: 'apple', name: '苹果' },
  { id: 'food:sugar', type: 'food', kind: 'sugar', name: '糖滴' },
  { id: 'predator:frog', type: 'predator', kind: 'frog', name: '青蛙' },
  { id: 'predator:spider', type: 'predator', kind: 'spider', name: '蜘蛛' },
  { id: 'predator:mantis', type: 'predator', kind: 'mantis', name: '螳螂' },
]);

export const PREDATOR_LEVELS = Object.freeze({
  low: { name: '低级', speed: 1.4, vision: 5, reach: 1.15, cooldown: 4.2, captureChance: .38,
    description: '慢速追踪，视野 5 格，近身攻击；新手果蝇有充分逃生时间。' },
  medium: { name: '中级', speed: 2.2, vision: 8, reach: 1.55, cooldown: 2.7, captureChance: .68,
    description: '持续追踪，视野 8 格，攻击更快，要求及时识别威胁。' },
  high: { name: '高级', speed: 3.4, vision: 12, reach: 2.1, cooldown: 1.45, captureChance: .92,
    description: '高速预测拦截，视野 12 格，适合检验成熟逃生策略。' },
});

export const PREDATOR_SPECIES = Object.freeze({
  frog: { name: '青蛙', skills: [
    { id: 'tongue', name: '弹舌', effect: '攻击距离 ×1.65' }, { id: 'leap', name: '跳扑', effect: '每 4 秒短时速度 ×2' },
  ] },
  spider: { name: '蜘蛛', skills: [
    { id: 'web', name: '结网', effect: '3 格内使果蝇速度 ×0.55' }, { id: 'ambush', name: '伏击', effect: '静止时可见距离减半' },
  ] },
  mantis: { name: '螳螂', skills: [
    { id: 'claw', name: '镰足夹击', effect: '攻击距离 ×1.25' }, { id: 'camouflage', name: '伪装', effect: '5 格外威胁信号 ×0.5' },
  ] },
});

export const WORLD_PRESETS = Object.freeze([
  { id: 'meadow', name: '开阔草甸', description: '24 × 18 × 8；低丘、池塘、树林和完整生态素材。' },
  { id: 'forest', name: '立体森林', description: '32 × 24 × 10；密集树冠、林间通道和多层飞行空间。' },
  { id: 'canyon', name: '岩壁峡谷', description: '28 × 20 × 12；高低岩壁、洞口和狭窄逃生路线。' },
  { id: 'islands', name: '浮空群岛', description: '26 × 20 × 14；空中平台，强制训练升降与跨岛导航。' },
  { id: 'blank', name: '完全空白', description: '24 × 18 × 10；只有基础地面，从零自由搭建。' },
]);

const clamp = (value, low, high) => Math.max(low, Math.min(high, Math.round(Number(value) || 0)));
const point = (value, size, fallback = { x: 1, y: 1, z: 1 }) => ({
  x: clamp(value?.x ?? fallback.x, 0, size.x - 1), y: clamp(value?.y ?? fallback.y, 0, size.y - 1), z: clamp(value?.z ?? fallback.z, 0, size.z - 1),
});
const key = (x, y, z) => `${x},${y},${z}`;
let idCounter = 0;
export const newEntityId = (prefix = 'entity') => `${prefix}-${Date.now().toString(36)}-${(++idCounter).toString(36)}`;

function addVoxel(map, x, y, z, material) {
  if (x < 0 || y < 0 || z < 0 || x >= map.size.x || y >= map.size.y || z >= map.size.z) return;
  map.voxels.push([x, y, z, material]);
}

function ground(map, material = 'grass', layers = 1) {
  for (let z = 0; z < layers; z++) for (let x = 0; x < map.size.x; x++) for (let y = 0; y < map.size.y; y++) addVoxel(map, x, y, z, z ? 'soil' : material);
}

function tree(map, x, y, height = 4) {
  for (let z = 1; z <= height; z++) addVoxel(map, x, y, z, 'wood');
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = 0; dz <= 2; dz++) {
    if (Math.abs(dx) + Math.abs(dy) + dz > 4) continue;
    addVoxel(map, x + dx, y + dy, height + dz, 'leaf');
  }
}

function entity(type, kind, x, y, z, extra = {}) {
  return { id: newEntityId(type), type, kind, position: { x, y, z }, enabled: true, ...extra };
}

export function createWorldPreset(presetId = 'meadow') {
  const sizes = { meadow: { x: 24, y: 18, z: 8 }, forest: { x: 32, y: 24, z: 10 }, canyon: { x: 28, y: 20, z: 12 }, islands: { x: 26, y: 20, z: 14 }, blank: { x: 24, y: 18, z: 10 } };
  const size = sizes[presetId] || sizes.meadow;
  const map = { format: WORLD_FORMAT, version: WORLD_VERSION, name: WORLD_PRESETS.find((p) => p.id === presetId)?.name || '自定义世界', preset: presetId,
    size: { ...size }, cellSizeM: .25, voxels: [], entities: [], environment: { gravity: -9.81, wind: .08, light: .82, friction: .65 } };
  ground(map, presetId === 'canyon' ? 'sand' : 'grass');
  if (presetId === 'meadow') {
    for (let x = 3; x < 8; x++) for (let y = 3; y < 7; y++) addVoxel(map, x, y, 1, 'water');
    [[10,4,3],[14,13,4],[20,6,3],[5,14,4]].forEach(([x,y,h]) => tree(map,x,y,h));
    for (let x = 9; x < 14; x++) for (let y = 8; y < 12; y++) if ((x + y) % 3 !== 0) addVoxel(map, x, y, 1, 'soil');
  } else if (presetId === 'forest') {
    for (let x = 3; x < size.x - 2; x += 4) for (let y = 3; y < size.y - 2; y += 4) if ((x + y) % 3) tree(map, x, y, 4 + (x + y) % 3);
    for (let x = 0; x < size.x; x++) if (x % 5 !== 0) addVoxel(map, x, 11, 1, 'leaf');
  } else if (presetId === 'canyon') {
    for (let x = 0; x < size.x; x++) for (let y = 0; y < size.y; y++) {
      const wall = y < 5 || y > 14, ridge = Math.abs(y - (7 + Math.sin(x * .45) * 2)) < 1;
      const height = wall ? 4 + (x % 4) : ridge ? 2 : 0;
      for (let z = 1; z <= height; z++) if (!(x > 11 && x < 15 && y < 5 && z < 3)) addVoxel(map, x, y, z, 'rock');
    }
  } else if (presetId === 'islands') {
    map.voxels = [];
    const islands = [[5,5,3,4],[15,6,6,4],[9,15,9,3],[21,14,4,3]];
    for (const [cx, cy, cz, radius] of islands) for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      addVoxel(map, cx + dx, cy + dy, cz, 'grass');
      if (Math.abs(dx) + Math.abs(dy) < radius) addVoxel(map, cx + dx, cy + dy, cz - 1, 'soil');
    }
  }
  const spawn = presetId === 'islands' ? { x: 5, y: 5, z: 4 } : { x: 2, y: Math.floor(size.y / 2), z: 1 };
  const goal = presetId === 'islands' ? { x: 9, y: 15, z: 10 } : { x: size.x - 3, y: Math.floor(size.y / 2), z: 2 };
  map.entities.push(entity('spawn', 'fly', spawn.x, spawn.y, spawn.z), entity('goal', 'goal', goal.x, goal.y, goal.z),
    entity('food', 'banana', Math.floor(size.x * .48), 3, Math.min(2, size.z - 1)),
    entity('food', 'sugar', Math.floor(size.x * .72), size.y - 4, Math.min(2, size.z - 1)),
    entity('predator', 'frog', Math.floor(size.x * .68), Math.floor(size.y * .45), 1, { level: 'medium' }));
  const solid=new Set(map.voxels.filter(v=>MATERIALS[v[3]].solid).map(v=>key(v[0],v[1],v[2])));
  for(const item of map.entities) while(solid.has(key(item.position.x,item.position.y,item.position.z))&&item.position.z<size.z-1)item.position.z++;
  return normalizeWorld(map);
}

export function normalizeWorld(input) {
  const base = input?.format === WORLD_FORMAT ? input : createWorldPreset('blank');
  const size = { x: clamp(base.size?.x, 6, 48), y: clamp(base.size?.y, 6, 48), z: clamp(base.size?.z, 3, 20) };
  const voxels = [], occupied = new Set();
  for (const raw of base.voxels || []) {
    const x = clamp(raw[0], 0, size.x - 1), y = clamp(raw[1], 0, size.y - 1), z = clamp(raw[2], 0, size.z - 1), material = MATERIALS[raw[3]] ? raw[3] : 'rock';
    const id = key(x, y, z); if (occupied.has(id)) continue; occupied.add(id); voxels.push([x, y, z, material]);
  }
  const entities = (base.entities || []).filter((item) => ['spawn', 'goal', 'food', 'predator'].includes(item.type)).map((item) => ({
    id: item.id || newEntityId(item.type), type: item.type, kind: item.kind || item.type, position: point(item.position, size), enabled: item.enabled !== false,
    ...(item.type === 'predator' ? { level: PREDATOR_LEVELS[item.level] ? item.level : 'medium' } : {}),
  }));
  if (!entities.some((item) => item.type === 'spawn')) entities.push(entity('spawn', 'fly', 1, Math.floor(size.y / 2), 1));
  if (!entities.some((item) => item.type === 'goal')) entities.push(entity('goal', 'goal', size.x - 2, Math.floor(size.y / 2), 1));
  return { format: WORLD_FORMAT, version: WORLD_VERSION, name: String(base.name || '自定义世界').slice(0, 64), preset: base.preset || 'custom', size,
    cellSizeM: Math.max(.01, Math.min(10, Number(base.cellSizeM) || .25)), voxels, entities,
    environment: { gravity: Number(base.environment?.gravity ?? -9.81), wind: Number(base.environment?.wind ?? .08), light: Number(base.environment?.light ?? .82), friction: Number(base.environment?.friction ?? .65) } };
}

export function validateWorld(input) {
  const world = normalizeWorld(input), errors = [];
  const solid = new Set(world.voxels.filter((v) => MATERIALS[v[3]].solid).map((v) => key(v[0], v[1], v[2])));
  for (const item of world.entities) if (solid.has(key(item.position.x, item.position.y, item.position.z))) errors.push(`${item.type} ${item.id} 位于实体方块内部`);
  if (!world.entities.some((item) => item.type === 'spawn' && item.enabled)) errors.push('至少需要一个启用的果蝇出生点');
  return { valid: !errors.length, errors, world };
}

export function assetLabel(item) {
  if (item.type === 'predator') return `${PREDATOR_LEVELS[item.level]?.name || ''}${PREDATOR_SPECIES[item.kind]?.name || item.kind}`;
  return PLACEABLES.find((asset) => asset.type === item.type && asset.kind === item.kind)?.name || item.kind;
}

export function resizeWorld(source, nextSize) {
  const world = normalizeWorld(source); world.size = { x: clamp(nextSize.x, 6, 48), y: clamp(nextSize.y, 6, 48), z: clamp(nextSize.z, 3, 20) };
  world.voxels = world.voxels.filter(([x, y, z]) => x < world.size.x && y < world.size.y && z < world.size.z);
  world.entities = world.entities.map((item) => ({ ...item, position: point(item.position, world.size) }));
  world.preset = 'custom'; return normalizeWorld(world);
}

export function removeAt(world, position, { entityId = null } = {}) {
  const next = normalizeWorld(world);
  if (entityId) next.entities = next.entities.filter((item) => item.id !== entityId);
  else {
    next.voxels = next.voxels.filter((v) => v[0] !== position.x || v[1] !== position.y || v[2] !== position.z);
    next.entities = next.entities.filter((item) => item.position.x !== position.x || item.position.y !== position.y || item.position.z !== position.z);
  }
  next.preset = 'custom'; return next;
}

export function placeAsset(world, assetId, position, options = {}) {
  let next = removeAt(world, position); const asset = PLACEABLES.find((item) => item.id === assetId);
  if (!asset || assetId === 'erase') return next;
  if (asset.type === 'voxel') next.voxels.push([position.x, position.y, position.z, asset.kind]);
  else {
    if (asset.type === 'spawn' && options.singleSpawn !== false) next.entities = next.entities.filter((item) => item.type !== 'spawn');
    next.entities.push(entity(asset.type, asset.kind, position.x, position.y, position.z,
      asset.type === 'predator' ? { level: PREDATOR_LEVELS[options.predatorLevel] ? options.predatorLevel : 'medium' } : {}));
  }
  next.preset = 'custom'; return normalizeWorld(next);
}

export function worldSummary(world) {
  const counts = world.entities.reduce((result, item) => ({ ...result, [item.type]: (result[item.type] || 0) + 1 }), {});
  return `${world.size.x} × ${world.size.y} × ${world.size.z} · ${world.voxels.length} 方块 · ${counts.predator || 0} 天敌 · ${counts.food || 0} 食物`;
}
