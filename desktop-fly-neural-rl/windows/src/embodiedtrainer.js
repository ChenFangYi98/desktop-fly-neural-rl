// Lightweight, renderer-safe embodied RL laboratory.
//
// The FlyWire/MaleCNS connectome is treated as a frozen observation encoder.
// These trainers learn a policy/value layer on top of a small auditable task
// abstraction. They are useful for rapid experiments inside the desktop app;
// large neural policies can later consume the exported experiment manifest.

export const ALGORITHMS = Object.freeze([
  { id: 'ppo', name: 'PPO', family: '策略梯度', badge: '稳定首选', description: '截断目标保持策略更新稳定，适合多数具身控制基线。', defaults: { learningRate: 0.08, gamma: 0.97, epsilon: 0.16, clipRange: 0.2, entropy: 0.015 } },
  { id: 'a2c', name: 'A2C', family: 'Actor–Critic', badge: '快速基线', description: '同时学习策略和价值，反馈快，便于调试感觉–动作闭环。', defaults: { learningRate: 0.1, gamma: 0.96, epsilon: 0.12, clipRange: 0.3, entropy: 0.01 } },
  { id: 'discrete-sac', name: 'Discrete SAC', family: '最大熵 RL', badge: '探索性强', description: '离散动作版 SAC，通过熵奖励保持多样化的行为探索。', defaults: { learningRate: 0.09, gamma: 0.98, epsilon: 0.08, clipRange: 0.25, entropy: 0.09 } },
  { id: 'double-q', name: 'Double Q-learning', family: '价值学习', badge: '离散动作', description: '使用双价值表抑制过估，适合导航、觅食和躲障。', defaults: { learningRate: 0.24, gamma: 0.95, epsilon: 0.34, clipRange: 0.2, entropy: 0 } },
  { id: 'q-learning', name: 'Q-learning', family: '价值学习', badge: '可解释', description: '经典表格式离策略学习，适合验证奖励设计与场景可达性。', defaults: { learningRate: 0.26, gamma: 0.94, epsilon: 0.36, clipRange: 0.2, entropy: 0 } },
  { id: 'sarsa', name: 'SARSA', family: '价值学习', badge: '保守策略', description: '同策略更新会把探索风险纳入价值，在障碍密集场景中更保守。', defaults: { learningRate: 0.23, gamma: 0.94, epsilon: 0.3, clipRange: 0.2, entropy: 0 } },
  { id: 'dyna-q', name: 'Dyna-Q', family: '基于模型', badge: '样本高效', description: '真实交互与学得模型回放结合，减少环境采样需求。', defaults: { learningRate: 0.22, gamma: 0.95, epsilon: 0.3, clipRange: 0.2, entropy: 0, planningSteps: 8 } },
]);

export const SCENARIOS = Object.freeze([
  { id: 'custom', icon: '🧩', name: '自定义 3D 环境', description: '自由设置场地、起点、目标、障碍与危险区', signal: '可配置传感器', reward: '可配置任务目标' },
  { id: 'obstacles', icon: '🧱', name: '复杂障碍导航', description: '通过多段墙体找到无碰撞路径', signal: '视觉逼近 + 触觉', reward: '到达 +15 · 碰撞 -2.5' },
  { id: 'foraging', icon: '🍌', name: '多目标觅食', description: '在干扰物与障碍中寻找高价值食物', signal: '嗅觉 + 视觉', reward: '觅食 +12 · 路程成本' },
  { id: 'escape', icon: '🐸', name: '天敌逃生', description: '对逼近方向做出逃逸与转向决策', signal: 'LC4/LPLC2 + 气流', reward: '进入安全区 +18' },
  { id: 'target', icon: '🎯', name: '目标导航', description: '基础的感觉–动作定向与路径学习', signal: '目标方位 + 本体感觉', reward: '距离收益 + 到达' },
  { id: 'gait', icon: '🦿', name: '六足步态稳定', description: '将足部负载反馈映射为稳定前进动作', signal: '关节角 + 足部负载', reward: '前进 + 稳定 - 能耗' },
  { id: 'multitask', icon: '🌿', name: '生态多任务', description: '在觅食、躲障与逃生之间自主切换', signal: '多模态感觉', reward: '加权多目标' },
]);

export const ACTIONS = Object.freeze([
  { id: 'right', dx: 1, dy: 0 }, { id: 'up', dx: 0, dy: 1 },
  { id: 'left', dx: -1, dy: 0 }, { id: 'down', dx: 0, dy: -1 },
]);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function argmax(values, offset = 0, length = 4) {
  let best = 0;
  for (let i = 1; i < length; i++) if (values[offset + i] > values[offset + best]) best = i;
  return best;
}

function softmax(values, offset, temperature = 1) {
  const logits = [];
  let max = -Infinity;
  for (let i = 0; i < 4; i++) { const value = values[offset + i] / temperature; logits.push(value); max = Math.max(max, value); }
  const exp = logits.map((value) => Math.exp(value - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((value) => value / sum);
}

function courseFor(scenario) {
  const base = {
    width: 12, height: 8, start: { x: 0, y: 3 }, goal: { x: 11, y: 5 }, threat: null,
    obstacles: [[3,0],[3,1],[3,2],[3,4],[3,5],[3,6],[3,7],[6,0],[6,1],[6,3],[6,4],[6,5],[6,6],[6,7],[9,0],[9,1],[9,2],[9,3],[9,4],[9,6],[9,7]],
  };
  if (scenario === 'target') return { ...base, goal: { x: 10, y: 4 }, obstacles: [[4,2],[4,3],[4,4],[7,4],[7,5]] };
  if (scenario === 'foraging') return { ...base, goal: { x: 10, y: 6 }, obstacles: [[2,5],[3,5],[5,1],[5,2],[7,5],[8,5],[9,3]] };
  if (scenario === 'escape') return { ...base, start: { x: 5, y: 3 }, goal: { x: 11, y: 7 }, threat: { x: 2, y: 3 }, obstacles: [[4,5],[5,5],[6,5],[8,2],[8,3],[8,4]] };
  if (scenario === 'gait') return { ...base, goal: { x: 11, y: 3 }, obstacles: [[3,1],[3,6],[6,0],[6,7],[9,1],[9,6]] };
  if (scenario === 'multitask') return { ...base, goal: { x: 11, y: 6 }, threat: { x: 1, y: 1 }, obstacles: [[3,0],[3,2],[3,3],[3,4],[6,3],[6,4],[6,6],[9,1],[9,2],[9,4],[9,5]] };
  return base;
}

function normalizeCourse(input, fallback) {
  if (!input) return fallback;
  const width = Math.max(4, Math.min(40, Math.round(Number(input.width) || fallback.width)));
  const height = Math.max(4, Math.min(40, Math.round(Number(input.height) || fallback.height)));
  const inside = (point) => point && Number.isInteger(point.x) && Number.isInteger(point.y)
    && point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;
  const start = inside(input.start) ? { ...input.start } : { x: 0, y: Math.floor(height / 2) };
  const goal = inside(input.goal) ? { ...input.goal } : { x: width - 1, y: Math.floor(height / 2) };
  const reserved = new Set([`${start.x},${start.y}`, `${goal.x},${goal.y}`]);
  const obstacles = [];
  const seen = new Set();
  for (const cell of input.obstacles || []) {
    const point = { x: Math.round(Number(cell[0])), y: Math.round(Number(cell[1])) };
    const key = `${point.x},${point.y}`;
    if (!inside(point) || reserved.has(key) || seen.has(key)) continue;
    seen.add(key); obstacles.push([point.x, point.y]);
  }
  const hazards = [];
  for (const cell of input.hazards || []) {
    const point = { x: Math.round(Number(cell[0])), y: Math.round(Number(cell[1])) };
    const key = `${point.x},${point.y}`;
    if (!inside(point) || reserved.has(key) || seen.has(`hazard:${key}`)) continue;
    seen.add(`hazard:${key}`); hazards.push([point.x, point.y]);
  }
  const threat = inside(input.threat) ? { ...input.threat } : fallback.threat;
  return { width, height, start, goal, obstacles, hazards, threat };
}

export class EmbodiedTrainingSession {
  constructor(config = {}) {
    const algorithm = ALGORITHMS.find((item) => item.id === config.algorithm) || ALGORITHMS[0];
    this.config = { algorithm: algorithm.id, scenario: 'obstacles', episodes: 2400, maxSteps: 160, seed: 42, ...algorithm.defaults, ...config };
    this.course = normalizeCourse(config.course, courseFor(this.config.scenario));
    this.random = mulberry32(Number(this.config.seed) || 42);
    const size = this.course.width * this.course.height * 4;
    this.q = new Float64Array(size);
    this.q2 = new Float64Array(size);
    this.actor = new Float64Array(size);
    this.critic = new Float64Array(this.course.width * this.course.height);
    this.model = new Map();
    this.episodes = 0;
    this.steps = 0;
    this.successes = 0;
    this.collisions = 0;
    this.rewardTotal = 0;
    this.recent = [];
    this.history = [];
    this.epsilon = Number(this.config.epsilon);
  }

  stateIndex(x, y) { return y * this.course.width + x; }
  qIndex(x, y, action) { return this.stateIndex(x, y) * 4 + action; }
  isBlocked(x, y) { return this.course.obstacles.some(([ox, oy]) => ox === x && oy === y); }

  transition(x, y, actionIndex, randomize = false) {
    let executedAction = actionIndex;
    if (randomize && this.config.domainRandomization) {
      const noise = Math.min(0.35, Number(this.config.sensorNoise || 0)
        + Math.abs(0.75 - Number(this.config.friction || 0.65)) * 0.035
        + Math.min(0.12, Number(this.config.actionLatencyMs || 0) / 8000));
      if (this.random() < noise) executedAction = (actionIndex + (this.random() < 0.5 ? 1 : 3)) % 4;
    }
    const action = ACTIONS[executedAction];
    const nx = x + action.dx, ny = y + action.dy;
    const nearJitteredObstacle = randomize && this.config.obstacleJitter && this.course.obstacles.some(([ox, oy]) => Math.abs(ox - nx) + Math.abs(oy - ny) === 1)
      && this.random() < 0.025;
    const collision = nx < 0 || ny < 0 || nx >= this.course.width || ny >= this.course.height || this.isBlocked(nx, ny) || nearJitteredObstacle;
    if (collision) return { x, y, reward: -2.5, collision: true, done: false };
    const done = nx === this.course.goal.x && ny === this.course.goal.y;
    const oldDistance = Math.abs(this.course.goal.x - x) + Math.abs(this.course.goal.y - y);
    const newDistance = Math.abs(this.course.goal.x - nx) + Math.abs(this.course.goal.y - ny);
    let reward = done ? (this.config.scenario === 'escape' ? 18 : 15) : -0.05 + (oldDistance - newDistance) * 0.14;
    if (this.course.threat) {
      const oldThreat = Math.abs(this.course.threat.x - x) + Math.abs(this.course.threat.y - y);
      const newThreat = Math.abs(this.course.threat.x - nx) + Math.abs(this.course.threat.y - ny);
      reward += (newThreat - oldThreat) * 0.05;
      if (newThreat < 2) reward -= 1.2;
    }
    if (this.course.hazards?.some(([hx, hy]) => hx === nx && hy === ny)) reward -= 3.5;
    return { x: nx, y: ny, reward, collision: false, done };
  }

  qValues(x, y) {
    const offset = this.qIndex(x, y, 0);
    return [0, 1, 2, 3].map((i) => this.q[offset + i] + (this.config.algorithm === 'double-q' ? this.q2[offset + i] : 0));
  }

  choose(x, y, explore = true) {
    const offset = this.qIndex(x, y, 0);
    const policyBased = ['ppo', 'a2c', 'discrete-sac'].includes(this.config.algorithm);
    if (policyBased) {
      if (explore && this.random() < this.epsilon) return Math.floor(this.random() * 4);
      const logits = new Float64Array(4);
      for (let i = 0; i < 4; i++) logits[i] = this.actor[offset + i] + this.q[offset + i] * 0.35;
      const probabilities = softmax(logits, 0, this.config.algorithm === 'discrete-sac' ? 0.75 : 1);
      if (!explore) return argmax(probabilities);
      let draw = this.random();
      for (let i = 0; i < probabilities.length; i++) { draw -= probabilities[i]; if (draw <= 0) return i; }
      return 3;
    }
    if (explore && this.random() < this.epsilon) return Math.floor(this.random() * 4);
    return argmax(this.qValues(x, y));
  }

  update(x, y, action, next, nextAction) {
    const alpha = Number(this.config.learningRate), gamma = Number(this.config.gamma);
    const index = this.qIndex(x, y, action);
    const nextOffset = this.qIndex(next.x, next.y, 0);
    const family = this.config.algorithm;
    if (family === 'ppo' || family === 'a2c' || family === 'discrete-sac') {
      const state = this.stateIndex(x, y), nextState = this.stateIndex(next.x, next.y);
      const bestFuture = next.done ? 0 : this.q[nextOffset + argmax(this.q, nextOffset)];
      const oldActionValue = this.q[index];
      const tdTarget = next.reward + gamma * bestFuture;
      const advantage = tdTarget - oldActionValue;
      this.q[index] += alpha * advantage;
      const valueTd = next.reward + (next.done ? 0 : gamma * this.critic[nextState]) - this.critic[state];
      this.critic[state] += alpha * valueTd;
      const probabilities = softmax(this.actor, index);
      const clip = family === 'ppo' ? Number(this.config.clipRange) : 2;
      const entropy = family === 'discrete-sac' ? Number(this.config.entropy) : Number(this.config.entropy || 0);
      const improvedAction = argmax(this.q, index);
      for (let i = 0; i < 4; i++) {
        const gradient = (i === action ? 1 : 0) - probabilities[i];
        const policyImprovement = (i === improvedAction ? 1 : 0) - probabilities[i];
        this.actor[index + i] += alpha * Math.max(-clip, Math.min(clip, advantage)) * gradient
          + alpha * 0.22 * policyImprovement + alpha * entropy * (0.25 - probabilities[i]);
      }
      return;
    }
    if (family === 'double-q') {
      const updateFirst = this.random() < 0.5;
      const primary = updateFirst ? this.q : this.q2, secondary = updateFirst ? this.q2 : this.q;
      const best = argmax(primary, nextOffset);
      primary[index] += alpha * (next.reward + (next.done ? 0 : gamma * secondary[nextOffset + best]) - primary[index]);
      return;
    }
    const futureAction = family === 'sarsa' ? nextAction : argmax(this.q, nextOffset);
    const target = next.reward + (next.done ? 0 : gamma * this.q[nextOffset + futureAction]);
    this.q[index] += alpha * (target - this.q[index]);
    if (family === 'dyna-q') {
      this.model.set(index, { sourceX: x, sourceY: y, action, nextX: next.x, nextY: next.y,
        reward: next.reward, done: next.done });
      const entries = [...this.model.values()];
      for (let i = 0; i < Number(this.config.planningSteps || 8) && entries.length; i++) {
        const sample = entries[Math.floor(this.random() * entries.length)];
        const si = this.qIndex(sample.sourceX, sample.sourceY, sample.action);
        const nextBase = this.qIndex(sample.nextX, sample.nextY, 0);
        const sf = sample.reward + (sample.done ? 0 : gamma * this.q[nextBase + argmax(this.q, nextBase)]);
        this.q[si] += alpha * 0.5 * (sf - this.q[si]);
      }
    }
  }

  trainEpisode() {
    let { x, y } = this.course.start;
    let action = this.choose(x, y, true), totalReward = 0, collisions = 0, success = false;
    const trace = [{ x, y }];
    for (let step = 0; step < Number(this.config.maxSteps); step++) {
      const next = this.transition(x, y, action, true);
      const nextAction = this.choose(next.x, next.y, true);
      const learningNext = this.config.normalizeReward
        ? { ...next, reward: Math.tanh(next.reward / 5) } : next;
      this.update(x, y, action, learningNext, nextAction);
      totalReward += next.reward;
      if (next.collision) collisions++;
      x = next.x; y = next.y; action = nextAction;
      trace.push({ x, y });
      this.steps++;
      if (next.done) { success = true; break; }
    }
    this.episodes++;
    this.successes += success ? 1 : 0;
    this.collisions += collisions;
    this.rewardTotal += totalReward;
    this.recent.push(success ? 1 : 0);
    if (this.recent.length > 100) this.recent.shift();
    this.epsilon = Math.max(0.02, Number(this.config.epsilon) * Math.exp(-this.episodes / Math.max(250, Number(this.config.episodes) * 0.38)));
    if (this.episodes % Math.max(1, Math.round(Number(this.config.episodes) / 80)) === 0) this.history.push(this.stats());
    return { success, totalReward, collisions, trace };
  }

  policyPath(maxSteps = 120) {
    let { x, y } = this.course.start;
    const path = [{ x, y }];
    let collisions = 0;
    const visited = new Map();
    for (let step = 0; step < maxSteps && (x !== this.course.goal.x || y !== this.course.goal.y); step++) {
      const action = this.choose(x, y, false);
      const next = this.transition(x, y, action);
      if (next.collision) collisions++;
      x = next.x; y = next.y; path.push({ x, y });
      const key = `${x},${y}`;
      visited.set(key, (visited.get(key) || 0) + 1);
      if (visited.get(key) > 6) break;
    }
    return { path, collisions, reachedGoal: x === this.course.goal.x && y === this.course.goal.y };
  }

  stats() {
    const recentSuccess = this.recent.length ? this.recent.reduce((a, b) => a + b, 0) / this.recent.length : 0;
    return {
      episodes: this.episodes, steps: this.steps, recentSuccess,
      successRate: this.episodes ? this.successes / this.episodes : 0,
      averageReward: this.episodes ? this.rewardTotal / this.episodes : 0,
      collisions: this.collisions, epsilon: this.epsilon,
    };
  }

  exportManifest(name = '未命名实验') {
    return {
      version: 1, name, kind: 'desktop-fly-embodied-policy', createdAt: new Date().toISOString(),
      baseModel: 'FlyWire v783 + MaleCNS (frozen)', config: { ...this.config }, course: JSON.parse(JSON.stringify(this.course)), metrics: this.stats(),
      policy: { q: Array.from(this.q), q2: Array.from(this.q2), actor: Array.from(this.actor), critic: Array.from(this.critic) },
      note: '快速训练策略层；未修改原始连接组。',
    };
  }
}
