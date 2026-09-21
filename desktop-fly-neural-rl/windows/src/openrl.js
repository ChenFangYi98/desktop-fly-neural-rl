import { MATERIALS, PREDATOR_LEVELS, PREDATOR_SPECIES, normalizeWorld, validateWorld } from './worldstudio.js';

export const RL_ALGORITHMS = Object.freeze([
  { id: 'ppo', name: 'PPO', family: '策略梯度', note: '稳定、通用，适合作为默认方案', defaults: { learningRate: .08, gamma: .97, epsilon: .16 } },
  { id: 'a2c', name: 'A2C', family: 'Actor-Critic', note: '更新较快，适合快速迭代', defaults: { learningRate: .1, gamma: .96, epsilon: .18 } },
  { id: 'discrete-sac', name: '离散 SAC', family: '最大熵策略', note: '保持探索，适合多解任务', defaults: { learningRate: .07, gamma: .98, epsilon: .22 } },
  { id: 'double-q', name: 'Double Q-learning', family: '价值学习', note: '降低价值高估', defaults: { learningRate: .18, gamma: .96, epsilon: .3 } },
  { id: 'q-learning', name: 'Q-learning', family: '价值学习', note: '可解释的离散基线', defaults: { learningRate: .22, gamma: .95, epsilon: .34 } },
  { id: 'sarsa', name: 'SARSA', family: '在策略学习', note: '探索期间更保守', defaults: { learningRate: .2, gamma: .95, epsilon: .3 } },
  { id: 'dyna-q', name: 'Dyna-Q', family: '模型增强', note: '真实交互与规划回放结合', defaults: { learningRate: .18, gamma: .96, epsilon: .28 } },
]);

export const ACTIONS = Object.freeze([
  { id: 'east', name: '向东', dx: 1, dy: 0, dz: 0 }, { id: 'north', name: '向北', dx: 0, dy: 1, dz: 0 },
  { id: 'west', name: '向西', dx: -1, dy: 0, dz: 0 }, { id: 'south', name: '向南', dx: 0, dy: -1, dz: 0 },
  { id: 'up', name: '上升', dx: 0, dy: 0, dz: 1 }, { id: 'down', name: '下降', dx: 0, dy: 0, dz: -1 },
  { id: 'wait', name: '等待', dx: 0, dy: 0, dz: 0 },
]);

export const OBSERVATIONS = Object.freeze([
  { id: 'position', name: '自身三维位置', required: true }, { id: 'goalVector', name: '目标方向与距离' },
  { id: 'solidNeighbors', name: '六向碰撞感知' }, { id: 'predatorVector', name: '最近天敌方向/距离/等级' },
  { id: 'foodVector', name: '最近食物方向/距离' }, { id: 'energy', name: '剩余能量' },
  { id: 'time', name: '回合时间' }, { id: 'brainRates', name: '果蝇脑运动/逃生神经活动' },
]);

export const REWARD_EVENTS = Object.freeze([
  { id: 'step', name: '每执行一步', defaultWeight: -.04 }, { id: 'goal', name: '接触目标', defaultWeight: 20 },
  { id: 'goalProgress', name: '接近目标（每格）', defaultWeight: .2 }, { id: 'collision', name: '碰撞实体方块', defaultWeight: -3 },
  { id: 'food', name: '获取食物', defaultWeight: 12 }, { id: 'caught', name: '被天敌捕获', defaultWeight: -20 },
  { id: 'safe', name: '进入安全区', defaultWeight: 8 }, { id: 'predatorDistance', name: '远离天敌（每格）', defaultWeight: .3 },
  { id: 'survival', name: '每存活一步', defaultWeight: .02 }, { id: 'altitude', name: '高度（每层）', defaultWeight: 0 },
  { id: 'energy', name: '动作能耗', defaultWeight: -.01 }, { id: 'speed', name: '有效移动速度', defaultWeight: 0 },
]);

export const TERMINATIONS = Object.freeze([
  { id: 'goal', name: '接触任一目标' }, { id: 'food', name: '获得指定数量食物' }, { id: 'survive', name: '存活指定步数' },
  { id: 'caught', name: '被捕获即失败' }, { id: 'maxSteps', name: '达到最大步数' },
]);

export const EXPERIMENT_PRESETS = Object.freeze([
  { id: 'navigation', name: '三维导航', rules: [['step',-.04],['goalProgress',.22],['goal',20],['collision',-4]], termination: { success:'goal', failure:'maxSteps', target:1 } },
  { id: 'forage', name: '自主觅食', rules: [['step',-.03],['food',15],['collision',-3],['energy',-.01]], termination: { success:'food', failure:'caught', target:2 } },
  { id: 'escape', name: '逃离天敌', rules: [['survival',.04],['predatorDistance',.35],['safe',16],['caught',-25]], termination: { success:'survive', failure:'caught', target:180 } },
  { id: 'speed', name: '高速机动', rules: [['speed',.3],['goal',20],['step',-.08],['collision',-8],['energy',-.02]], termination: { success:'goal', failure:'maxSteps', target:1 } },
  { id: 'multitask', name: '全方位能力', rules: [['goal',12],['food',10],['survival',.02],['predatorDistance',.2],['collision',-4],['caught',-20]], termination: { success:'goal', failure:'caught', target:1 } },
  { id: 'blank', name: '完全自定义', rules: [['step',0]], termination: { success:'goal', failure:'maxSteps', target:1 } },
]);

export function createExperiment(preset = 'navigation') {
  const source = EXPERIMENT_PRESETS.find((item) => item.id === preset) || EXPERIMENT_PRESETS[0];
  return { format: 'desktop-fly-open-experiment', version: 1, name: source.name, preset,
    observations: OBSERVATIONS.filter((item) => item.required || ['goalVector','solidNeighbors','predatorVector','foodVector','time'].includes(item.id)).map((item) => item.id),
    actions: ACTIONS.map((item) => item.id), rewardRules: source.rules.map(([event, weight], index) => ({ id: `reward-${index}`, event, weight, enabled: true })),
    termination: { ...source.termination }, maxSteps: 240, episodes: 4000, seed: 42,
    algorithm: 'ppo', learningRate: .08, gamma: .97, epsilon: .16, normalizeReward: true,
    traits: { speed: 1, intelligence: 1, escapeSensitivity: 1 } };
}

const key3 = (p) => `${p.x},${p.y},${p.z}`;
const distance = (a, b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.z-b.z);
const mulberry32 = (seed) => { let a=seed>>>0; return () => { a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };

export class OpenRLSession {
  constructor(worldInput, experimentInput = {}) {
    const check = validateWorld(worldInput); if (!check.valid) throw new Error(check.errors.join('；'));
    this.world = check.world; this.experiment = { ...createExperiment(), ...experimentInput, traits: { ...createExperiment().traits, ...(experimentInput.traits || {}) } };
    this.actions = ACTIONS.filter((item) => this.experiment.actions.includes(item.id));
    this.solid = new Set(this.world.voxels.filter((v) => MATERIALS[v[3]].solid).map((v) => `${v[0]},${v[1]},${v[2]}`));
    this.features = new Map(this.world.voxels.filter((v) => !MATERIALS[v[3]].solid).map((v) => [`${v[0]},${v[1]},${v[2]}`, v[3]]));
    this.spawn = this.world.entities.find((item) => item.type === 'spawn' && item.enabled)?.position;
    this.goals = this.world.entities.filter((item) => item.type === 'goal' && item.enabled).map((item) => item.position);
    this.foodSource = this.world.entities.filter((item) => item.type === 'food' && item.enabled);
    this.predatorSource = this.world.entities.filter((item) => item.type === 'predator' && item.enabled);
    this.q = new Map(); this.q2 = new Map(); this.actor = new Map(); this.model = new Map(); this.random = mulberry32(Number(this.experiment.seed));
    this.episodes=0; this.steps=0; this.successes=0; this.caught=0; this.collisions=0; this.rewardTotal=0; this.recent=[]; this.history=[]; this.epsilon=Number(this.experiment.epsilon);
  }
  values(map, state) { if (!map.has(state)) map.set(state, new Float64Array(this.actions.length)); return map.get(state); }
  nearest(list, p) { let item=null, d=Infinity; for (const value of list) { const next=distance(value.position,p); if (next<d) {d=next;item=value;} } return {item,d}; }
  stateOf(sim) {
    const parts=[key3(sim.position)];
    if (this.experiment.observations.includes('goalVector')) { const n=this.nearest(this.goals.map(position=>({position})),sim.position); parts.push(`g${Math.sign(n.item?.position.x-sim.position.x||0)},${Math.sign(n.item?.position.y-sim.position.y||0)},${Math.sign(n.item?.position.z-sim.position.z||0)},${Math.min(4,n.d)}`); }
    if (this.experiment.observations.includes('predatorVector')) { const n=this.nearest(sim.predators,sim.position); parts.push(`p${n.item?Math.sign(n.item.position.x-sim.position.x):0},${n.item?Math.sign(n.item.position.y-sim.position.y):0},${Math.min(5,n.d)}`); }
    if (this.experiment.observations.includes('foodVector')) { const n=this.nearest(sim.food,sim.position); parts.push(`f${n.item?Math.sign(n.item.position.x-sim.position.x):0},${n.item?Math.sign(n.item.position.y-sim.position.y):0},${Math.min(5,n.d)}`); }
    if (this.experiment.observations.includes('time')) parts.push(`t${Math.min(4,Math.floor(sim.step/Math.max(1,this.experiment.maxSteps/4)))}`);
    return parts.join('|');
  }
  best(state, map=this.q) { const values=this.values(map,state); let best=0; for(let i=1;i<values.length;i++) if(values[i]>values[best]) best=i; return best; }
  choose(state, explore=true) {
    if (explore && this.random()<this.epsilon) return Math.floor(this.random()*this.actions.length);
    if (this.experiment.algorithm==='double-q') { const a=this.values(this.q,state),b=this.values(this.q2,state),scores=a.map((v,i)=>v+b[i]); let best=0; for(let i=1;i<scores.length;i++)if(scores[i]>scores[best])best=i; return best; }
    if (['ppo','a2c','discrete-sac'].includes(this.experiment.algorithm)) { const a=this.values(this.actor,state),q=this.values(this.q,state),scores=a.map((v,i)=>v+q[i]*.35); let best=0; for(let i=1;i<scores.length;i++)if(scores[i]>scores[best])best=i; return best; }
    return this.best(state);
  }
  reset() { return { position:{...this.spawn}, step:0, energy:1, food:this.foodSource.map(v=>({...v,position:{...v.position}})), predators:this.predatorSource.map(v=>({...v,position:{...v.position},phase:this.random()*5})), eaten:0, caught:false }; }
  reward(events) { let total=0; for(const rule of this.experiment.rewardRules) if(rule.enabled!==false) total+=(events[rule.event]||0)*Number(rule.weight||0); return total; }
  stepSim(sim, actionIndex) {
    const action=this.actions[actionIndex], before={...sim.position}, previousGoal=this.nearest(this.goals.map(position=>({position})),before).d, previousThreat=this.nearest(sim.predators,before).d;
    const candidate={x:before.x+action.dx,y:before.y+action.dy,z:before.z+action.dz};
    const outside=candidate.x<0||candidate.y<0||candidate.z<0||candidate.x>=this.world.size.x||candidate.y>=this.world.size.y||candidate.z>=this.world.size.z;
    const collision=outside||this.solid.has(key3(candidate)); if(!collision) sim.position=candidate;
    sim.step++; sim.energy=Math.max(0,sim.energy-.001*(action.id==='wait'? .2:1));
    let eaten=0; sim.food=sim.food.filter((item)=>{if(distance(item.position,sim.position)<=0){eaten++;return false;}return true;}); sim.eaten+=eaten;
    for(const predator of sim.predators) {
      const spec=PREDATOR_LEVELS[predator.level], d=distance(predator.position,sim.position); predator.phase+=1;
      if(d<=spec.vision && predator.phase%(predator.kind==='frog'?3:2)===0) {
        const axes=['x','y','z'].sort((a,b)=>Math.abs(sim.position[b]-predator.position[b])-Math.abs(sim.position[a]-predator.position[a]));
        const axis=axes[0], move=Math.sign(sim.position[axis]-predator.position[axis]); const p={...predator.position,[axis]:predator.position[axis]+move};
        if(!this.solid.has(key3(p))) predator.position=p;
      }
      const reach=spec.reach*(predator.kind==='frog'?1.65:predator.kind==='mantis'?1.25:1);
      if(distance(predator.position,sim.position)<=reach && this.random()<spec.captureChance*.35) sim.caught=true;
    }
    const nextGoal=this.nearest(this.goals.map(position=>({position})),sim.position).d, nextThreat=this.nearest(sim.predators,sim.position).d;
    const feature=this.features.get(key3(sim.position));
    const events={step:1,goal:nextGoal===0?1:0,goalProgress:previousGoal-nextGoal,collision:collision?1:0,food:eaten,caught:sim.caught?1:0,
      safe:feature==='safe'?1:0,predatorDistance:Number.isFinite(previousThreat)&&Number.isFinite(nextThreat)?nextThreat-previousThreat:0,survival:sim.caught?0:1,
      altitude:sim.position.z,energy:action.id==='wait'?.2:1,speed:collision?0:1};
    const success=(this.experiment.termination.success==='goal'&&events.goal)||(this.experiment.termination.success==='food'&&sim.eaten>=Number(this.experiment.termination.target||1))
      ||(this.experiment.termination.success==='survive'&&sim.step>=Number(this.experiment.termination.target||180));
    const failure=(this.experiment.termination.failure==='caught'&&sim.caught)||(this.experiment.termination.failure==='maxSteps'&&sim.step>=this.experiment.maxSteps);
    return {reward:this.reward(events),events,collision,success:!!success,failure:!!failure,done:!!success||!!failure||sim.step>=this.experiment.maxSteps};
  }
  update(state,action,reward,nextState,nextAction,done) {
    const alpha=Number(this.experiment.learningRate),gamma=Number(this.experiment.gamma),family=this.experiment.algorithm,q=this.values(this.q,state),next=this.values(this.q,nextState);
    if(family==='double-q') { const first=this.random()<.5,a=first?this.q:this.q2,b=first?this.q2:this.q,values=this.values(a,state),future=this.values(b,nextState),best=this.best(nextState,a); values[action]+=alpha*(reward+(done?0:gamma*future[best])-values[action]); return; }
    const future=family==='sarsa'?next[nextAction]:next[this.best(nextState)],td=reward+(done?0:gamma*future)-q[action]; q[action]+=alpha*td;
    if(['ppo','a2c','discrete-sac'].includes(family)) { const actor=this.values(this.actor,state),best=this.best(state); actor[action]+=alpha*Math.max(-.25,Math.min(.25,td)); actor[best]+=alpha*.06; }
    if(family==='dyna-q') { this.model.set(`${state}:${action}`,{state,action,reward,nextState,done}); const samples=[...this.model.values()]; for(let i=0;i<8*this.experiment.traits.intelligence;i++){const s=samples[Math.floor(this.random()*samples.length)];const v=this.values(this.q,s.state),n=this.values(this.q,s.nextState);v[s.action]+=alpha*.5*(s.reward+(s.done?0:gamma*n[this.best(s.nextState)])-v[s.action]);} }
  }
  trainEpisode() {
    const sim=this.reset(),trace=[{...sim.position}],eventTotals={}; let totalReward=0,collisions=0,success=false,state=this.stateOf(sim),action=this.choose(state,true);
    for(let i=0;i<this.experiment.maxSteps;i++) { const result=this.stepSim(sim,action),nextState=this.stateOf(sim),nextAction=this.choose(nextState,true); const reward=this.experiment.normalizeReward?Math.tanh(result.reward/8):result.reward;
      this.update(state,action,reward,nextState,nextAction,result.done); totalReward+=result.reward; collisions+=result.collision?1:0; for(const [k,v] of Object.entries(result.events))eventTotals[k]=(eventTotals[k]||0)+v;
      trace.push({...sim.position}); state=nextState; action=nextAction; this.steps++; if(result.done){success=result.success;break;} }
    this.episodes++;this.successes+=success?1:0;this.caught+=sim.caught?1:0;this.collisions+=collisions;this.rewardTotal+=totalReward;this.recent.push(success?1:0);if(this.recent.length>100)this.recent.shift();
    this.epsilon=Math.max(.015,Number(this.experiment.epsilon)*Math.exp(-this.episodes/Math.max(500,this.experiment.episodes*.35))); if(this.episodes%Math.max(1,Math.round(this.experiment.episodes/80))===0)this.history.push(this.stats());
    return {success,totalReward,collisions,trace,eventTotals};
  }
  evaluate(maxSteps=this.experiment.maxSteps) { const sim=this.reset(),trace=[{...sim.position}]; let totalReward=0,collisions=0; for(let i=0;i<maxSteps;i++){const state=this.stateOf(sim),r=this.stepSim(sim,this.choose(state,false));totalReward+=r.reward;collisions+=r.collision?1:0;trace.push({...sim.position});if(r.done)return {success:r.success,caught:sim.caught,totalReward,collisions,trace};}return {success:false,caught:sim.caught,totalReward,collisions,trace}; }
  stats(){return{episodes:this.episodes,steps:this.steps,recentSuccess:this.recent.length?this.recent.reduce((a,b)=>a+b,0)/this.recent.length:0,successRate:this.episodes?this.successes/this.episodes:0,averageReward:this.episodes?this.rewardTotal/this.episodes:0,collisions:this.collisions,caught:this.caught,epsilon:this.epsilon};}
  exportManifest(name=this.experiment.name){const table=(map)=>Object.fromEntries([...map].map(([k,v])=>[k,Array.from(v)]));return{kind:'desktop-fly-open-rl-policy',version:1,name,createdAt:new Date().toISOString(),baseModel:'FlyWire v783 + MaleCNS (frozen)',world:normalizeWorld(this.world),experiment:JSON.parse(JSON.stringify(this.experiment)),metrics:this.stats(),actions:this.actions,traits:{...this.experiment.traits},policy:{q:table(this.q),q2:table(this.q2),actor:table(this.actor)}};}
}

export class OpenPolicyRuntime {
  constructor(manifest){if(manifest?.kind!=='desktop-fly-open-rl-policy')throw new Error('不是开放式强化学习策略包');this.manifest=manifest;this.session=new OpenRLSession(manifest.world,manifest.experiment);for(const [name,values]of Object.entries(manifest.policy.q||{}))this.session.q.set(name,Float64Array.from(values));for(const [name,values]of Object.entries(manifest.policy.q2||{}))this.session.q2.set(name,Float64Array.from(values));for(const [name,values]of Object.entries(manifest.policy.actor||{}))this.session.actor.set(name,Float64Array.from(values));}
  actionFor(observation){const sim={position:{...observation.position},step:observation.step||0,energy:observation.energy??1,food:observation.food||[],predators:observation.predators||[],eaten:observation.eaten||0,caught:false};const state=this.session.stateOf(sim);return this.session.actions[this.session.choose(state,false)];}
}
