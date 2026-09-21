// skilltrainer.js — a small, auditable reinforcement-learning layer.
//
// This file deliberately does NOT claim to retrain the biological FlyWire
// connectome. The measured adjacency graph remains fixed inside LIFSim. The
// trainer learns which identified output population should be stimulated for
// one documented input condition. This is a contextual-bandit policy: a user
// selects a trigger and desired action, exploratory choices receive a reward,
// and bounded action values are updated from that reward.
//
// Keeping the learner separate makes the data/model boundary inspectable and
// lets the same code run in the Electron renderer and in headless Node tests.

export const SKILL_TRIGGERS = [
  { id: 'loomLeft', label: '左侧威胁', description: '左眼的 LC4/LPLC2 逼近输入较强' },
  { id: 'loomRight', label: '右侧威胁', description: '右眼的 LC4/LPLC2 逼近输入较强' },
  { id: 'loomCenter', label: '正面逼近', description: '左右逼近感受器同时活跃' },
  { id: 'airPuff', label: '气流/震动', description: '快速鼠标或输入震动刺激感觉群' },
  { id: 'idle', label: '静止状态', description: '果蝇已停止行走' },
];

export const SKILL_ACTIONS = [
  { id: 'escape', label: '起飞逃生', population: 'DNp01 巨纤维' },
  { id: 'walk', label: '向前行走', population: 'DNp09' },
  { id: 'backward', label: '向后行走', population: 'MDN' },
  { id: 'steerLeft', label: '向左转', population: '左侧 DNa01/02' },
  { id: 'steerRight', label: '向右转', population: '右侧 DNa01/02' },
  { id: 'groom', label: '梳理身体', population: 'DNg11' },
  { id: 'wings', label: '抬翼警戒', population: 'DNp02/04/11' },
];

function argmax(values) {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

export class RewardSkillTrainer {
  constructor({ learningRate = 0.18, epsilon = 0.28, rng = Math.random } = {}) {
    this.learningRate = learningRate;
    this.initialEpsilon = epsilon;
    this.epsilon = epsilon;
    this.rng = rng;
    this.values = new Float64Array(SKILL_ACTIONS.length);
    this.episodes = 0;
    this.rewardTotal = 0;
    this.recentCorrect = [];
  }

  // Run one rewarded choice. Exploration prevents the requested answer from
  // simply being copied into the result; the learner must accumulate evidence
  // that the rewarded output has a higher value than alternatives.
  trainEpisode(targetActionId) {
    const target = SKILL_ACTIONS.findIndex((item) => item.id === targetActionId);
    if (target < 0) throw new Error(`Unknown training action: ${targetActionId}`);
    const explore = this.rng() < this.epsilon;
    const chosen = explore ? Math.floor(this.rng() * SKILL_ACTIONS.length) : argmax(this.values);
    const correct = chosen === target;
    const reward = correct ? 1 : -0.22;
    const old = this.values[chosen];
    this.values[chosen] = old + this.learningRate * (reward - old);
    this.episodes++;
    this.rewardTotal += reward;
    this.recentCorrect.push(correct ? 1 : 0);
    if (this.recentCorrect.length > 80) this.recentCorrect.shift();
    this.epsilon = Math.max(0.035, this.initialEpsilon * Math.exp(-this.episodes / 260));
    return { chosen: SKILL_ACTIONS[chosen].id, correct, reward };
  }

  // Confidence is a normalized softmax over learned action values. It is a
  // policy confidence, not a biological probability or scientific p-value.
  policy(trigger, name = '未命名技能') {
    if (!SKILL_TRIGGERS.some((item) => item.id === trigger)) throw new Error(`Unknown trigger: ${trigger}`);
    const temperature = 0.18;
    const max = Math.max(...this.values);
    const exp = Array.from(this.values, (value) => Math.exp((value - max) / temperature));
    const sum = exp.reduce((a, b) => a + b, 0);
    const best = argmax(this.values);
    return {
      version: 1,
      name,
      trigger,
      action: SKILL_ACTIONS[best].id,
      confidence: exp[best] / sum,
      episodes: this.episodes,
      averageReward: this.episodes ? this.rewardTotal / this.episodes : 0,
      recentAccuracy: this.recentCorrect.length
        ? this.recentCorrect.reduce((a, b) => a + b, 0) / this.recentCorrect.length : 0,
      actionValues: Object.fromEntries(SKILL_ACTIONS.map((item, index) => [item.id, this.values[index]])),
      learnedAt: new Date().toISOString(),
    };
  }

  reset() {
    this.values.fill(0);
    this.episodes = 0;
    this.rewardTotal = 0;
    this.recentCorrect.length = 0;
    this.epsilon = this.initialEpsilon;
  }
}
