// Shared true-3D voxel world, task, predator and policy contracts.

export const VOXEL_MATERIALS = Object.freeze({
  grass: { name: '草地', color: 0x4e8d45, solid: true },
  soil: { name: '泥土', color: 0x76543b, solid: true },
  rock: { name: '岩石', color: 0x737b78, solid: true },
  wood: { name: '木材', color: 0x8a623e, solid: true },
  leaf: { name: '树叶', color: 0x397441, solid: true },
  water: { name: '水体', color: 0x3d91a8, solid: false, hazard: true },
  nectar: { name: '蜜源', color: 0xe6be43, solid: false, food: true },
  safe: { name: '安全区', color: 0x53d99b, solid: false, safe: true },
});

export const PREDATOR_LEVELS = Object.freeze({
  low: { name: '低级', speed: 0.72, vision: 0.72, reach: 0.82, cooldown: 1.3 },
  medium: { name: '中级', speed: 1, vision: 1, reach: 1, cooldown: 1 },
  high: { name: '高级', speed: 1.35, vision: 1.35, reach: 1.18, cooldown: 0.7 },
});

export const PREDATOR_SKILLS = Object.freeze({
  frog: Object.freeze([
    { id: 'tongue', name: '弹舌', description: '超远距离直线捕获', multiplier: 1.45 },
    { id: 'leap', name: '跳扑', description: '短时高速接近目标', multiplier: 1.25 },
  ]),
  spider: Object.freeze([
    { id: 'web', name: '结网', description: '降低附近果蝇速度', multiplier: 0.55 },
    { id: 'ambush', name: '伏击', description: '静止时降低被发现距离', multiplier: 1.2 },
  ]),
  mantis: Object.freeze([
    { id: 'claw', name: '镰足夹击', description: '扇形近距离捕获', multiplier: 1.15 },
    { id: 'camouflage', name: '伪装', description: '接近前降低视觉逼近信号', multiplier: 0.55 },
  ]),
});

export const TASK_TYPES = Object.freeze([
  { id: 'reach', name: '到达三维目标' },
  { id: 'forage', name: '寻找并摄取食物' },
  { id: 'escape', name: '逃离天敌并进入安全区' },
  { id: 'survive', name: '在规定时间内生存' },
  { id: 'patrol', name: '按顺序巡航多个目标' },
  { id: 'multitask', name: '觅食、逃生与导航多任务' },
]);

export const VOLUME_ACTIONS = Object.freeze([
  { id: 'east', dx: 1, dy: 0, dz: 0, name: '向东' },
  { id: 'north', dx: 0, dy: 1, dz: 0, name: '向北' },
  { id: 'west', dx: -1, dy: 0, dz: 0, name: '向西' },
  { id: 'south', dx: 0, dy: -1, dz: 0, name: '向南' },
  { id: 'up', dx: 0, dy: 0, dz: 1, name: '上升' },
  { id: 'down', dx: 0, dy: 0, dz: -1, name: '下降' },
]);

const key3 = (x, y, z) => `${x},${y},${z}`;
const copyPoint = (point, fallback = { x: 0, y: 0, z: 1 }) => ({
  x: Math.round(Number(point?.x ?? fallback.x)), y: Math.round(Number(point?.y ?? fallback.y)), z: Math.round(Number(point?.z ?? fallback.z)),
});

export function createVoxelWorld({ width = 12, depth = 8, height = 6 } = {}) {
  const world = { version: 1, width, depth, height, cellSize: 1, voxels: [], start: { x: 0, y: 3, z: 1 },
    goal: { x: width - 1, y: 5, z: 2 }, tasks: [{ id: 'task-1', type: 'reach', target: { x: width - 1, y: 5, z: 2 }, required: true }],
    reward: { goal: 20, progress: 0.18, collision: -3, step: -0.04, hazard: -5, food: 12, survival: 0.02, energy: -0.01, altitude: 0 },
  };
  for (let x = 0; x < width; x++) for (let y = 0; y < depth; y++) world.voxels.push([x, y, 0, 'grass']);
  for (let y = 0; y < depth - 1; y++) if (y !== 3) world.voxels.push([4, y, 1, 'rock']);
  for (let y = 1; y < depth; y++) if (y !== 5) world.voxels.push([8, y, 1, 'wood']);
  return world;
}

export function normalizeVoxelWorld(input) {
  const base = createVoxelWorld(input || {});
  const width = Math.max(4, Math.min(32, Math.round(Number(input?.width) || base.width)));
  const depth = Math.max(4, Math.min(32, Math.round(Number(input?.depth) || base.depth)));
  const height = Math.max(2, Math.min(16, Math.round(Number(input?.height) || base.height)));
  const inside = (p) => p.x >= 0 && p.y >= 0 && p.z >= 0 && p.x < width && p.y < depth && p.z < height;
  const start = copyPoint(input?.start, base.start), goal = copyPoint(input?.goal, base.goal);
  if (!inside(start)) Object.assign(start, { x: 0, y: Math.floor(depth / 2), z: 1 });
  if (!inside(goal)) Object.assign(goal, { x: width - 1, y: Math.floor(depth / 2), z: Math.min(2, height - 1) });
  const voxels = [];
  const occupied = new Set();
  for (const raw of input?.voxels || base.voxels) {
    const p = { x: Math.round(Number(raw[0])), y: Math.round(Number(raw[1])), z: Math.round(Number(raw[2])) };
    const material = VOXEL_MATERIALS[raw[3]] ? raw[3] : 'rock';
    const key = key3(p.x, p.y, p.z);
    if (!inside(p) || occupied.has(key)) continue;
    occupied.add(key); voxels.push([p.x, p.y, p.z, material]);
  }
  const tasks = Array.isArray(input?.tasks) && input.tasks.length ? input.tasks.map((task, i) => {
    const target = copyPoint(task.target, goal);
    return { id: task.id || `task-${i + 1}`, type: TASK_TYPES.some((item) => item.id === task.type) ? task.type : 'reach',
      target: inside(target) ? target : { ...goal }, required: task.required !== false };
  }) : base.tasks;
  return { version: 1, width, depth, height, cellSize: Number(input?.cellSize) || 1, voxels, start, goal,
    tasks, reward: { ...base.reward, ...(input?.reward || {}) } };
}

export function validateVoxelWorld(input) {
  const world = normalizeVoxelWorld(input);
  const errors = [];
  const solid = new Set(world.voxels.filter((voxel) => VOXEL_MATERIALS[voxel[3]].solid).map((v) => key3(v[0], v[1], v[2])));
  if (solid.has(key3(world.start.x, world.start.y, world.start.z))) errors.push('起点被实体方块占用');
  if (solid.has(key3(world.goal.x, world.goal.y, world.goal.z))) errors.push('目标被实体方块占用');
  return { valid: errors.length === 0, errors, world };
}

function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export class VolumetricTrainingSession {
  constructor(config = {}) {
    const validation = validateVoxelWorld(config.world);
    if (!validation.valid) throw new Error(validation.errors.join('；'));
    this.world = validation.world;
    // Keep the compact 2D course shape as a compatibility view for older UI
    // and deployment code, while retaining z on every point.
    this.course = {
      width: this.world.width,
      height: this.world.depth,
      depth: this.world.depth,
      start: { ...this.world.start },
      goal: { ...this.world.goal },
      obstacles: this.world.voxels
        .filter((voxel) => VOXEL_MATERIALS[voxel[3]].solid && voxel[2] > 0)
        .map((voxel) => [voxel[0], voxel[1], voxel[2]]),
      hazards: this.world.voxels
        .filter((voxel) => VOXEL_MATERIALS[voxel[3]].hazard)
        .map((voxel) => [voxel[0], voxel[1], voxel[2]]),
    };
    this.config = { algorithm: 'ppo', episodes: 4000, maxSteps: 240, learningRate: .18, gamma: .97, epsilon: .32, seed: 42,
      taskType: 'multitask', speedTrait: 1, intelligenceTrait: 1, ...config };
    this.actions = VOLUME_ACTIONS;
    this.solid = new Set(this.world.voxels.filter((v) => VOXEL_MATERIALS[v[3]].solid).map((v) => key3(v[0], v[1], v[2])));
    this.hazards = new Set(this.world.voxels.filter((v) => VOXEL_MATERIALS[v[3]].hazard).map((v) => key3(v[0], v[1], v[2])));
    this.food = new Set(this.world.voxels.filter((v) => VOXEL_MATERIALS[v[3]].food).map((v) => key3(v[0], v[1], v[2])));
    const states = this.world.width * this.world.depth * this.world.height;
    this.q = new Float64Array(states * this.actions.length);
    this.q2 = new Float64Array(states * this.actions.length);
    this.actor = new Float64Array(states * this.actions.length);
    this.critic = new Float64Array(states);
    this.model = new Map();
    this.random = mulberry32(this.config.seed);
    this.episodes = 0; this.steps = 0; this.successes = 0; this.collisions = 0; this.rewardTotal = 0; this.recent = []; this.history = [];
    this.epsilon = Number(this.config.epsilon);
  }

  stateIndex(x, y, z) { return (z * this.world.depth + y) * this.world.width + x; }
  qIndex(x, y, z, action) { return this.stateIndex(x, y, z) * this.actions.length + action; }
  argmax(values, offset = 0) { let best = 0; for (let i = 1; i < this.actions.length; i++) if (values[offset + i] > values[offset + best]) best = i; return best; }
  bestAction(p) {
    const offset = this.qIndex(p.x, p.y, p.z, 0);
    const family = this.config.algorithm;
    if (['ppo', 'a2c', 'discrete-sac'].includes(family)) {
      const scores = new Float64Array(this.actions.length);
      for (let i = 0; i < scores.length; i++) scores[i] = this.actor[offset + i] + this.q[offset + i] * .35;
      return this.argmax(scores);
    }
    if (family === 'double-q') {
      const scores = new Float64Array(this.actions.length);
      for (let i = 0; i < scores.length; i++) scores[i] = this.q[offset + i] + this.q2[offset + i];
      return this.argmax(scores);
    }
    return this.argmax(this.q, offset);
  }
  probabilities(offset, temperature = 1) {
    let maximum = -Infinity;
    for (let i = 0; i < this.actions.length; i++) maximum = Math.max(maximum, this.actor[offset + i]);
    const result = new Float64Array(this.actions.length); let total = 0;
    for (let i = 0; i < result.length; i++) { result[i] = Math.exp((this.actor[offset + i] - maximum) / temperature); total += result[i]; }
    for (let i = 0; i < result.length; i++) result[i] /= total || 1;
    return result;
  }
  choose(p, explore = true) {
    if (explore && this.random() < this.epsilon) return Math.floor(this.random() * this.actions.length);
    const family = this.config.algorithm;
    if (!explore || !['ppo', 'a2c', 'discrete-sac'].includes(family)) return this.bestAction(p);
    const offset = this.qIndex(p.x, p.y, p.z, 0), probabilities = this.probabilities(offset, family === 'discrete-sac' ? .75 : 1);
    let draw = this.random(); for (let i = 0; i < probabilities.length; i++) { draw -= probabilities[i]; if (draw <= 0) return i; }
    return probabilities.length - 1;
  }
  distance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z); }

  transition(point, actionIndex) {
    const action = this.actions[actionIndex];
    const next = { x: point.x + action.dx, y: point.y + action.dy, z: point.z + action.dz };
    const outside = next.x < 0 || next.y < 0 || next.z < 0 || next.x >= this.world.width || next.y >= this.world.depth || next.z >= this.world.height;
    const collision = outside || this.solid.has(key3(next.x, next.y, next.z));
    if (collision) return { ...point, reward: Number(this.world.reward.collision), collision: true, done: false };
    const oldDistance = this.distance(point, this.world.goal), newDistance = this.distance(next, this.world.goal);
    const done = newDistance === 0;
    let reward = Number(this.world.reward.step) + (oldDistance - newDistance) * Number(this.world.reward.progress)
      + Math.abs(action.dz) * Number(this.world.reward.energy) + next.z * Number(this.world.reward.altitude);
    if (this.hazards.has(key3(next.x, next.y, next.z))) reward += Number(this.world.reward.hazard);
    if (this.food.has(key3(next.x, next.y, next.z))) reward += Number(this.world.reward.food);
    if (this.config.taskType === 'survive' || this.config.taskType === 'escape') reward += Number(this.world.reward.survival);
    if (done) reward += Number(this.world.reward.goal);
    return { ...next, reward, collision: false, done };
  }

  update(point, action, next, nextAction) {
    const alpha = Number(this.config.learningRate), gamma = Number(this.config.gamma), family = this.config.algorithm;
    const index = this.qIndex(point.x, point.y, point.z, action), nextOffset = this.qIndex(next.x, next.y, next.z, 0);
    if (['ppo', 'a2c', 'discrete-sac'].includes(family)) {
      const state = this.stateIndex(point.x, point.y, point.z), nextState = this.stateIndex(next.x, next.y, next.z);
      const future = next.done ? 0 : this.q[nextOffset + this.argmax(this.q, nextOffset)];
      const advantage = next.reward + gamma * future - this.q[index]; this.q[index] += alpha * advantage;
      const valueTd = next.reward + (next.done ? 0 : gamma * this.critic[nextState]) - this.critic[state]; this.critic[state] += alpha * valueTd;
      const probabilities = this.probabilities(this.qIndex(point.x, point.y, point.z, 0));
      const clip = family === 'ppo' ? Number(this.config.clipRange || .2) : 2;
      const entropy = family === 'discrete-sac' ? Number(this.config.entropy || .015) : Number(this.config.entropy || 0);
      const improved = this.argmax(this.q, this.qIndex(point.x, point.y, point.z, 0));
      for (let i = 0; i < this.actions.length; i++) {
        const gradient = (i === action ? 1 : 0) - probabilities[i], improvement = (i === improved ? 1 : 0) - probabilities[i];
        this.actor[this.qIndex(point.x, point.y, point.z, i)] += alpha * Math.max(-clip, Math.min(clip, advantage)) * gradient
          + alpha * .22 * improvement + alpha * entropy * (1 / this.actions.length - probabilities[i]);
      }
      return;
    }
    if (family === 'double-q') {
      const first = this.random() < .5, primary = first ? this.q : this.q2, secondary = first ? this.q2 : this.q;
      const best = this.argmax(primary, nextOffset);
      primary[index] += alpha * (next.reward + (next.done ? 0 : gamma * secondary[nextOffset + best]) - primary[index]); return;
    }
    const futureAction = family === 'sarsa' ? nextAction : this.argmax(this.q, nextOffset);
    this.q[index] += alpha * (next.reward + (next.done ? 0 : gamma * this.q[nextOffset + futureAction]) - this.q[index]);
    if (family === 'dyna-q') {
      this.model.set(index, { point: { ...point }, action, next: { x: next.x, y: next.y, z: next.z, reward: next.reward, done: next.done } });
      const samples = [...this.model.values()], planning = Math.round(Number(this.config.planningSteps || 8) * Number(this.config.intelligenceTrait || 1));
      for (let i = 0; i < planning && samples.length; i++) {
        const sample = samples[Math.floor(this.random() * samples.length)], si = this.qIndex(sample.point.x, sample.point.y, sample.point.z, sample.action);
        const no = this.qIndex(sample.next.x, sample.next.y, sample.next.z, 0), best = this.argmax(this.q, no);
        this.q[si] += alpha * .5 * (sample.next.reward + (sample.next.done ? 0 : gamma * this.q[no + best]) - this.q[si]);
      }
    }
  }

  trainEpisode() {
    let point = { ...this.world.start }, totalReward = 0, collisions = 0, success = false;
    const trace = [{ ...point }]; let action = this.choose(point, true);
    for (let step = 0; step < Number(this.config.maxSteps); step++) {
      const next = this.transition(point, action), nextPoint = { x: next.x, y: next.y, z: next.z }, nextAction = this.choose(nextPoint, true);
      const learningNext = this.config.normalizeReward ? { ...next, reward: Math.tanh(next.reward / 5) } : next;
      this.update(point, action, learningNext, nextAction);
      totalReward += next.reward; collisions += next.collision ? 1 : 0; point = nextPoint; action = nextAction; trace.push({ ...point }); this.steps++;
      if (next.done) { success = true; break; }
    }
    this.episodes++; this.successes += success ? 1 : 0; this.collisions += collisions; this.rewardTotal += totalReward;
    this.recent.push(success ? 1 : 0); if (this.recent.length > 100) this.recent.shift();
    this.epsilon = Math.max(.015, Number(this.config.epsilon) * Math.exp(-this.episodes / Math.max(400, this.config.episodes * .32)));
    if (this.episodes % Math.max(1, Math.round(this.config.episodes / 80)) === 0) this.history.push(this.stats());
    return { success, totalReward, collisions, trace };
  }

  policyPath(maxSteps = 240) {
    let point = { ...this.world.start }; const path = [{ ...point }]; let collisions = 0; const seen = new Map();
    for (let i = 0; i < maxSteps && this.distance(point, this.world.goal) > 0; i++) {
      const next = this.transition(point, this.bestAction(point)); collisions += next.collision ? 1 : 0;
      point = { x: next.x, y: next.y, z: next.z }; path.push({ ...point }); const key = key3(point.x, point.y, point.z); seen.set(key, (seen.get(key) || 0) + 1); if (seen.get(key) > 7) break;
    }
    return { path, collisions, reachedGoal: this.distance(point, this.world.goal) === 0 };
  }

  stats() { return { episodes: this.episodes, steps: this.steps, recentSuccess: this.recent.length ? this.recent.reduce((a, b) => a + b, 0) / this.recent.length : 0,
    successRate: this.episodes ? this.successes / this.episodes : 0, averageReward: this.episodes ? this.rewardTotal / this.episodes : 0, collisions: this.collisions, epsilon: this.epsilon }; }

  exportManifest(name = '未命名三维技能') {
    return { version: 2, kind: 'desktop-fly-volumetric-policy', name, createdAt: new Date().toISOString(), baseModel: 'FlyWire v783 + MaleCNS (frozen)',
      world: JSON.parse(JSON.stringify(this.world)), course: { width: this.world.width, height: this.world.depth, start: this.world.start, goal: this.world.goal,
        obstacles: this.world.voxels.filter((v) => VOXEL_MATERIALS[v[3]].solid && v[2] === 1).map((v) => [v[0], v[1]]) },
      config: { ...this.config, world: undefined }, metrics: this.stats(), actionSchema: this.actions,
      traits: { speed: Number(this.config.speedTrait), intelligence: Number(this.config.intelligenceTrait), escapeSensitivity: Number(this.config.escapeSensitivity || 1) },
      policy: { q: Array.from(this.q), q2: Array.from(this.q2), actor: Array.from(this.actor), critic: Array.from(this.critic) } };
  }
}

export class VolumetricPolicyRuntime {
  constructor(manifest) { if (manifest?.kind !== 'desktop-fly-volumetric-policy') throw new Error('不是三维果蝇策略'); this.manifest = manifest; }
  actionFor(point) {
    const { world, policy } = this.manifest;
    const x = Math.max(0, Math.min(world.width - 1, Math.round(point.x))), y = Math.max(0, Math.min(world.depth - 1, Math.round(point.y))), z = Math.max(0, Math.min(world.height - 1, Math.round(point.z)));
    const offset = ((z * world.depth + y) * world.width + x) * VOLUME_ACTIONS.length;
    const family = this.manifest.config?.algorithm;
    const score = (i) => ['ppo', 'a2c', 'discrete-sac'].includes(family)
      ? (policy.actor?.[offset + i] || 0) + policy.q[offset + i] * .35
      : policy.q[offset + i] + (family === 'double-q' ? policy.q2?.[offset + i] || 0 : 0);
    let best = 0; for (let i = 1; i < VOLUME_ACTIONS.length; i++) if (score(i) > score(best)) best = i;
    return VOLUME_ACTIONS[best];
  }
}
