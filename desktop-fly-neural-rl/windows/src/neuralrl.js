// Connectome-constrained reinforcement learning for Desktop Fly.
//
// The environment never writes a movement command directly into the body.
// Observations are encoded into measured FlyWire populations, recurrent
// activity crosses the signed connectome, and policy/value heads read only
// descending-neuron activity.  Reward modulates local eligibility traces on
// connectome population edges (the three-factor rule used by FlyDoom).

import { LIFSim, SpikeBus } from './sim.js';
import { SignalBuilder } from './signals.js';
import {
  ACTIONS, OBSERVATIONS, REWARD_EVENTS, TERMINATIONS, EXPERIMENT_PRESETS,
  OpenRLSession, createExperiment as createOpenExperiment,
} from './openrl.js';

export { ACTIONS, OBSERVATIONS, REWARD_EVENTS, TERMINATIONS, EXPERIMENT_PRESETS };

export const RL_ALGORITHMS = Object.freeze([
  { id: 'three-factor', name: '三因子多巴胺学习', family: '生物可塑性', note: '局部突触痕迹 × TD 多巴胺；不使用反向传播', defaults: { learningRate: .035, gamma: .97, epsilon: .18 } },
  { id: 'a2c', name: 'Connectome A2C', family: 'Actor–Critic', note: '连接组状态作为策略与价值输入，同时保留局部突触可塑性', defaults: { learningRate: .025, gamma: .97, epsilon: .12 } },
  { id: 'ppo', name: 'Connectome PPO', family: '裁剪策略梯度', note: '对下降神经元读出做裁剪更新，并用多巴胺更新连接组', defaults: { learningRate: .02, gamma: .98, epsilon: .1 } },
]);

export function createExperiment(preset = 'navigation') {
  const value = createOpenExperiment(preset);
  value.algorithm = 'three-factor';
  value.learningRate = .035;
  value.gamma = .97;
  value.epsilon = .18;
  value.neural = { propagationSteps: 4, eligibilityDecay: .95, dopamineScale: .12,
    connectomeLearningRate: .0025, minGain: .25, maxGain: 4 };
  return value;
}

const SENSE_NAMES = ['sense-x+', 'sense-x-', 'sense-y+', 'sense-y-', 'sense-z+', 'sense-z-'];
const GROUPS = Object.freeze([
  ...SENSE_NAMES, 'loom-left', 'loom-right', 'central', 'ascending',
  'descending-left', 'descending-right', 'descending',
  'dna-left', 'dna-right', 'mdn', 'forward', 'groom', 'escape-wing', 'gf',
]);
const OUTPUT_GROUPS = Object.freeze([
  'dna-left', 'dna-right', 'mdn', 'forward', 'groom', 'escape-wing', 'gf',
  'descending-left', 'descending-right', 'descending',
]);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const distance = (a, b) => Math.abs(a.x-b.x) + Math.abs(a.y-b.y) + Math.abs((a.z||0)-(b.z||0));
const softmax = (values) => {
  const max = Math.max(...values), exp = values.map(v => Math.exp(clamp(v-max, -30, 30)));
  const sum = exp.reduce((a,b)=>a+b,0) || 1;
  return exp.map(v=>v/sum);
};

function groupName(neuron, index) {
  const role = neuron.role;
  if (role === 'lc4' || role === 'lplc2') return neuron.side === 'right' ? 'loom-right' : 'loom-left';
  if (role === 'dna01' || role === 'dna02') return neuron.side === 'right' ? 'dna-right' : 'dna-left';
  if (role === 'mdn') return 'mdn';
  if (role === 'dnp09') return 'forward';
  if (role === 'dng11') return 'groom';
  if (role === 'escw') return 'escape-wing';
  if (role === 'gf') return 'gf';
  const type = String(neuron.type || '').toLowerCase();
  if (type === 'sensory' || type === 'optic' || type.startsWith('visual_')) return SENSE_NAMES[index % SENSE_NAMES.length];
  if (type === 'ascending') return 'ascending';
  if (type === 'descending') return neuron.side === 'left' ? 'descending-left'
    : neuron.side === 'right' ? 'descending-right' : 'descending';
  return 'central';
}

export function connectomeFingerprint(circuit) {
  let hash = 2166136261 >>> 0;
  const mix = (text) => { for (let i=0;i<text.length;i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619) >>> 0; } };
  mix(`${circuit.neurons.length}:${circuit.edges.length}:`);
  for (let i=0;i<circuit.neurons.length;i+=Math.max(1,Math.floor(circuit.neurons.length/31))) mix(String(circuit.neurons[i].id));
  for (let i=0;i<circuit.edges.length;i+=Math.max(1,Math.floor(circuit.edges.length/61))) mix(circuit.edges[i].join(','));
  return `fnv1a-${hash.toString(16).padStart(8,'0')}`;
}

class ConnectomePopulationBrain {
  constructor(circuit, config = {}) {
    if (!circuit?.neurons?.length || !circuit?.edges?.length) throw new Error('缺少完整 FlyWire 神经元或突触数据');
    this.circuit = circuit;
    this.config = { propagationSteps:4, eligibilityDecay:.95, dopamineScale:.12,
      connectomeLearningRate:.0025, minGain:.25, maxGain:4, ...config };
    this.names = GROUPS.slice(); this.index = new Map(this.names.map((name,i)=>[name,i])); this.n = this.names.length;
    this.neuronGroup = Int16Array.from(circuit.neurons.map((neuron,i)=>this.index.get(groupName(neuron,i))));
    this.groupCounts = new Int32Array(this.n); for (const g of this.neuronGroup) this.groupCounts[g]++;
    this.edgeCounts = new Int32Array(this.n*this.n); this.base = new Float64Array(this.n*this.n);
    for (const [pre,post,weight] of circuit.edges) {
      const a=this.neuronGroup[pre],b=this.neuronGroup[post],k=a*this.n+b;
      this.edgeCounts[k]++; this.base[k]+=Math.sign(weight)*Math.log1p(Math.abs(weight));
    }
    // Each postsynaptic population receives a bounded recurrent drive while
    // retaining the sign and relative strength measured in the source data.
    for (let post=0;post<this.n;post++) {
      let norm=0; for(let pre=0;pre<this.n;pre++) norm+=Math.abs(this.base[pre*this.n+post]);
      if (norm>0) for(let pre=0;pre<this.n;pre++) this.base[pre*this.n+post]=this.base[pre*this.n+post]/norm*.82;
    }
    this.gain = new Float64Array(this.n*this.n); this.gain.fill(1);
    this.eligibility = new Float64Array(this.n*this.n); this.state = new Float64Array(this.n);
    this.homeostasis = new Float64Array(this.n); this.lastDopamine=0;
    this.outputIndex = OUTPUT_GROUPS.map(name=>this.index.get(name));
  }
  reset() { this.state.fill(0); this.eligibility.fill(0); }
  encode(sim, session) {
    const input = new Float64Array(this.n), p=sim.position, size=session.world.size;
    const nearestPoint=(items)=>{let point=null,d=Infinity;for(const item of items){const q=item.position||item,next=distance(p,q);if(next<d){d=next;point=q;}}return{point,d};};
    const goal=nearestPoint(session.goals), food=nearestPoint(sim.food||[]), threat=nearestPoint(sim.predators||[]);
    const addVector=(target,scale=1)=>{if(!target)return;const values=[(target.x-p.x)/size.x,(p.x-target.x)/size.x,(target.y-p.y)/size.y,(p.y-target.y)/size.y,((target.z||0)-(p.z||0))/size.z,((p.z||0)-(target.z||0))/size.z];for(let i=0;i<6;i++)input[i]+=Math.max(0,values[i])*scale;};
    if (session.experiment.observations.includes('goalVector')) addVector(goal.point,1.15);
    if (session.experiment.observations.includes('foodVector')) addVector(food.point,.75);
    if (session.experiment.observations.includes('predatorVector') && threat.point) {
      addVector(threat.point,.45); const closeness=clamp(1-threat.d/Math.max(size.x,size.y),0,1);
      input[this.index.get(threat.point.x<p.x?'loom-left':'loom-right')]+=closeness*1.4;
    }
    if (session.experiment.observations.includes('time')) input[this.index.get('ascending')]=sim.step/Math.max(1,session.experiment.maxSteps);
    return input;
  }
  forward(input) {
    let state=this.state;
    for(let pass=0;pass<this.config.propagationSteps;pass++) {
      const next=new Float64Array(this.n);
      for(let post=0;post<this.n;post++) {
        let net=input[post]*1.7+.008;
        for(let pre=0;pre<this.n;pre++) {const k=pre*this.n+post;if(this.edgeCounts[k])net+=state[pre]*this.base[k]*this.gain[k];}
        const firing=Math.max(0,Math.tanh(net)); next[post]=state[post]*.42+firing*.58;
      }
      state=next;
    }
    this.state=state;
    return this.outputIndex.map(i=>state[i]);
  }
  plasticStep(dopamine) {
    const decay=this.config.eligibilityDecay,lr=this.config.connectomeLearningRate;
    for(let pre=0;pre<this.n;pre++)for(let post=0;post<this.n;post++){
      const k=pre*this.n+post;if(!this.edgeCounts[k])continue;
      const centered=this.state[post]-this.homeostasis[post];
      this.eligibility[k]=this.eligibility[k]*decay+this.state[pre]*centered;
      this.gain[k]=clamp(this.gain[k]+lr*dopamine*this.eligibility[k],this.config.minGain,this.config.maxGain);
    }
    for(let i=0;i<this.n;i++)this.homeostasis[i]=this.homeostasis[i]*.995+this.state[i]*.005;
    this.lastDopamine=dopamine;
  }
  exportPlasticity() {
    const gains={}; let changed=0,total=0,max=0,plasticGroups=0;
    for(let i=0;i<this.gain.length;i++)if(this.edgeCounts[i]){plasticGroups++;const d=Math.abs(this.gain[i]-1);total+=d;max=Math.max(max,d);if(d>1e-5){changed++;gains[`${Math.floor(i/this.n)}:${i%this.n}`]=Number(this.gain[i].toFixed(7));}}
    return { groups:this.names, groupNeuronCounts:Array.from(this.groupCounts), groupEdgeCounts:Array.from(this.edgeCounts), baseWeights:Array.from(this.base), gains,
      changedGroupEdges:changed, plasticGroupEdges:plasticGroups, meanAbsoluteGainChange:total/Math.max(1,plasticGroups), maxGainChange:max,
      rule:'eligibility_trace × TD_dopamine', config:{...this.config} };
  }
}

export class NeuralRLSession extends OpenRLSession {
  constructor(world, experiment={}, brainData) {
    const merged={...createExperiment(),...experiment,neural:{...createExperiment().neural,...(experiment.neural||{})},traits:{...createExperiment().traits,...(experiment.traits||{})}};
    super(world,merged);
    if (!brainData?.circuit?.edges?.length) throw new Error('真实神经训练需要 circuit.json 的完整突触数据');
    this.brainData=brainData; this.brain=new ConnectomePopulationBrain(brainData.circuit,merged.neural);
    const f=this.brain.outputIndex.length,a=this.actions.length;
    this.readout=new Float64Array(a*f);this.readoutBias=new Float64Array(a);this.valueWeights=new Float64Array(f);
    this.actorEligibility=new Float64Array(a*f);this.biasEligibility=new Float64Array(a);this.valueEligibility=new Float64Array(f);
    for(let i=0;i<this.readout.length;i++)this.readout[i]=(this.random()-.5)*.02;
    // Calibrate an innate sensorimotor prior from this exact connectome: each
    // directional sensory channel is pulsed once and its descending response
    // seeds the corresponding action row. RL still changes every row and the
    // recurrent gains, but exploration no longer starts as a blind Q table.
    const directionChannel={east:0,west:1,north:2,south:3,up:4,down:5};
    this.actions.forEach((action,a)=>{const channel=directionChannel[action.id];if(channel===undefined){this.readoutBias[a]=-.18;return;}const input=new Float64Array(this.brain.n);input[channel]=1;this.brain.reset();const response=this.brain.forward(input),norm=Math.hypot(...response)||1;for(let i=0;i<f;i++)this.readout[a*f+i]+=response[i]/norm*.65;});
    this.brain.reset();
    this.valueBias=0;this.valueBiasEligibility=0;this.dopamineTotal=0;this.dopamineSamples=0;
  }
  resetTraces(){this.actorEligibility.fill(0);this.biasEligibility.fill(0);this.valueEligibility.fill(0);this.valueBiasEligibility=0;this.brain.reset();}
  policy(features, explore=true){const f=features.length,logits=this.actions.map((_,a)=>{let v=this.readoutBias[a];for(let i=0;i<f;i++)v+=this.readout[a*f+i]*features[i];return v;}),probs=softmax(logits);let action=0;if(explore&&this.random()<this.epsilon)action=Math.floor(this.random()*this.actions.length);else if(explore){let r=this.random();for(action=0;action<probs.length-1&&r>probs[action];action++)r-=probs[action];}else for(let i=1;i<probs.length;i++)if(probs[i]>probs[action])action=i;return{action,probs,logits};}
  value(features){let value=this.valueBias;for(let i=0;i<features.length;i++)value+=this.valueWeights[i]*features[i];return value;}
  learn(features,policy,reward,nextFeatures,done){const gamma=Number(this.experiment.gamma),delta=reward+(done?0:gamma*this.value(nextFeatures))-this.value(features),family=this.experiment.algorithm,rawAlpha=Number(this.experiment.learningRate),alpha=rawAlpha*(family==='ppo'?.45:family==='a2c'?.7:1),decay=.9;
    const clipped=family==='ppo'?clamp(delta,-.25,.25):delta,f=features.length;
    for(let a=0;a<this.actions.length;a++){const surprise=(a===policy.action?1:0)-policy.probs[a];this.biasEligibility[a]=this.biasEligibility[a]*decay+surprise;this.readoutBias[a]+=alpha*clipped*this.biasEligibility[a];for(let i=0;i<f;i++){const k=a*f+i;this.actorEligibility[k]=this.actorEligibility[k]*decay+surprise*features[i];this.readout[k]+=alpha*clipped*this.actorEligibility[k];}}
    this.valueBiasEligibility=this.valueBiasEligibility*.9+1;this.valueBias+=alpha*.45*delta*this.valueBiasEligibility;
    for(let i=0;i<f;i++){this.valueEligibility[i]=this.valueEligibility[i]*.9+features[i];this.valueWeights[i]+=alpha*.45*delta*this.valueEligibility[i];}
    const dopamine=clamp(delta*this.brain.config.dopamineScale,-1,1);this.brain.plasticStep(dopamine);this.dopamineTotal+=Math.abs(dopamine);this.dopamineSamples++;return dopamine;
  }
  trainEpisode(){const sim=this.reset(),trace=[{...sim.position}],eventTotals={};let totalReward=0,collisions=0,success=false;this.resetTraces();let features=this.brain.forward(this.brain.encode(sim,this)),policy=this.policy(features,true);
    for(let i=0;i<this.experiment.maxSteps;i++){const result=this.stepSim(sim,policy.action),nextFeatures=this.brain.forward(this.brain.encode(sim,this)),nextPolicy=this.policy(nextFeatures,true),reward=this.experiment.normalizeReward?Math.tanh(result.reward/8):result.reward;this.learn(features,policy,reward,nextFeatures,result.done);totalReward+=result.reward;collisions+=result.collision?1:0;for(const[k,v]of Object.entries(result.events))eventTotals[k]=(eventTotals[k]||0)+v;trace.push({...sim.position});features=nextFeatures;policy=nextPolicy;this.steps++;if(result.done){success=result.success;break;}}
    this.episodes++;this.successes+=success?1:0;this.caught+=sim.caught?1:0;this.collisions+=collisions;this.rewardTotal+=totalReward;this.recent.push(success?1:0);if(this.recent.length>100)this.recent.shift();this.epsilon=Math.max(.01,Number(this.experiment.epsilon)*Math.exp(-this.episodes/Math.max(300,this.experiment.episodes*.35)));if(this.episodes%Math.max(1,Math.round(this.experiment.episodes/80))===0)this.history.push(this.stats());return{success,totalReward,collisions,trace,eventTotals,dopamine:this.brain.lastDopamine};}
  evaluate(maxSteps=this.experiment.maxSteps){const sim=this.reset(),trace=[{...sim.position}];let totalReward=0,collisions=0;this.brain.reset();for(let i=0;i<maxSteps;i++){const features=this.brain.forward(this.brain.encode(sim,this)),choice=this.policy(features,false),r=this.stepSim(sim,choice.action);totalReward+=r.reward;collisions+=r.collision?1:0;trace.push({...sim.position});if(r.done)return{success:r.success,caught:sim.caught,totalReward,collisions,trace};}return{success:false,caught:sim.caught,totalReward,collisions,trace};}
  stats(){const base=super.stats(),p=this.brain.exportPlasticity();return{...base,meanAbsoluteDopamine:this.dopamineTotal/Math.max(1,this.dopamineSamples),changedGroupEdges:p.changedGroupEdges,meanSynapticGainChange:p.meanAbsoluteGainChange,brainNeurons:this.brainData.circuit.neurons.length,brainEdges:this.brainData.circuit.edges.length,maleCNSNeurons:this.brainData.locomotor?.neurons?.length||0};}
  exportManifest(name=this.experiment.name){return{kind:'desktop-fly-neural-rl-policy',version:2,name,createdAt:new Date().toISOString(),world:JSON.parse(JSON.stringify(this.world)),experiment:JSON.parse(JSON.stringify(this.experiment)),metrics:this.stats(),actions:this.actions,traits:{...this.experiment.traits},brain:{source:'FlyWire v783 + MaleCNS',neuronCount:this.brainData.circuit.neurons.length,edgeCount:this.brainData.circuit.edges.length,maleCNSNeuronCount:this.brainData.locomotor?.neurons?.length||0,fingerprint:connectomeFingerprint(this.brainData.circuit),controllerPath:['environment sensors','FlyWire sensory populations','signed recurrent connectome','descending neurons','MaleCNS motor circuit','embodied fly'],assumptions:['environment-to-sensory adapter','population-shared plastic gain','descending readout']},plasticity:this.brain.exportPlasticity(),policy:{featureOrder:OUTPUT_GROUPS,readout:Array.from(this.readout),bias:Array.from(this.readoutBias),valueWeights:Array.from(this.valueWeights),valueBias:this.valueBias}};}
}

function sensoryChannels(circuit){const channels=Array.from({length:6},()=>[]);circuit.neurons.forEach((neuron,i)=>{const type=String(neuron.type||'').toLowerCase();if(type==='sensory'||type==='optic'||type.startsWith('visual_'))channels[i%6].push(i);});return channels;}

export function applyPopulationPlasticity(sim,circuit,plasticity){const groups=plasticity.groups||GROUPS,index=new Map(groups.map((name,i)=>[name,i])),gains=plasticity.gains||{};for(let k=0;k<sim.edgeGain.length;k++){const pre=sim.edgeSource[k],post=sim.colIdx[k],a=index.get(groupName(circuit.neurons[pre],pre)),b=index.get(groupName(circuit.neurons[post],post));sim.edgeGain[k]=clamp(Number(gains[`${a}:${b}`]??1),.1,6);}return sim.plasticitySummary();}

export class NeuralPolicyRuntime {
  constructor(manifest,brainData){if(manifest?.kind!=='desktop-fly-neural-rl-policy'||!manifest.policy||!manifest.plasticity)throw new Error('不是完整的果蝇神经强化学习模型');if(!brainData?.circuit?.edges?.length)throw new Error('部署需要本机 FlyWire 连接组数据');if(manifest.brain?.fingerprint&&manifest.brain.fingerprint!==connectomeFingerprint(brainData.circuit))throw new Error('模型与本机 FlyWire 连接组版本不一致');this.manifest=manifest;this.actions=manifest.actions;this.featureOrder=manifest.policy.featureOrder||OUTPUT_GROUPS;this.readout=Float64Array.from(manifest.policy.readout);this.bias=Float64Array.from(manifest.policy.bias);this.bus=new SpikeBus();this.sim=new LIFSim(brainData.circuit,this.bus,brainData.locomotor);this.builder=new SignalBuilder();this.channels=sensoryChannels(brainData.circuit);this.plasticitySummary=applyPopulationPlasticity(this.sim,brainData.circuit,manifest.plasticity);this.lastProbabilities=[];}
  nearest(items,p){let point=null,d=Infinity;for(const item of items||[]){const q=item.position||item,next=distance(p,q);if(next<d){d=next;point=q;}}return{point,d};}
  encode(observation){const p=observation.position,size=this.manifest.world.size,goal=this.nearest(this.manifest.world.entities.filter(v=>v.enabled!==false&&v.type==='goal'),p),food=this.nearest(observation.food,p),threat=this.nearest(observation.predators,p),drive=new Float64Array(6);const add=(q,scale)=>{if(!q)return;const v=[(q.x-p.x)/size.x,(p.x-q.x)/size.x,(q.y-p.y)/size.y,(p.y-q.y)/size.y,((q.z||0)-(p.z||0))/size.z,((p.z||0)-(q.z||0))/size.z];for(let i=0;i<6;i++)drive[i]+=Math.max(0,v[i])*scale;};add(goal.point,1.15);add(food.point,.75);for(let i=0;i<6;i++)if(drive[i]>.005)this.sim.stimulate(this.channels[i],.08+.18*clamp(drive[i],0,1),8);const heading=Number(observation.heading||0),angle=threat.point?Math.atan2(threat.point.y-p.y,threat.point.x-p.x)-heading:0,loom=threat.point?clamp(1-threat.d/Math.max(size.x,size.y),0,1):0;this.sim.loomL=loom*(Math.sin(angle)<0?.85:.25);this.sim.loomR=loom*(Math.sin(angle)>=0?.85:.25);this.sim.airPuff=loom>.75?loom:0;this.sim.gaitDrive=Number(observation.gaitDrive||0);this.sim.gaitPhase=Number(observation.gaitPhase||0);this.sim.legFeedback=observation.legFeedback||[];}
  features(){const s=this.sim,n=v=>clamp(v/24,0,2);return[n(s.rateDNaL),n(s.rateDNaR),n(s.rateMDN),n(s.rateFwd),n(s.rateGroom),n(s.rateEscW),s.gfLatch?1:0,n((s.rateDNaL+s.rateMDN+s.rateFwd)/3),n((s.rateDNaR+s.rateMDN+s.rateFwd)/3),n(s.ratePop)];}
  choose(features){const f=features.length,logits=this.actions.map((_,a)=>{let v=this.bias[a]||0;for(let i=0;i<f;i++)v+=(this.readout[a*f+i]||0)*features[i];return v;}),probabilities=softmax(logits);let best=0;for(let i=1;i<probabilities.length;i++)if(probabilities[i]>probabilities[best])best=i;this.lastProbabilities=probabilities;return this.actions[best];}
  driveAction(action,observation){const heading=Number(observation.heading||0);if(action.dx||action.dy){const desired=Math.atan2(action.dy,action.dx),error=Math.atan2(Math.sin(desired-heading),Math.cos(desired-heading));this.sim.stimulate(this.sim.fwd,.18,12);if(error>.12)this.sim.stimulate(this.sim.dnaL,.22*Math.min(1,Math.abs(error)),12);if(error<-.12)this.sim.stimulate(this.sim.dnaR,.22*Math.min(1,Math.abs(error)),12);}if(action.dz>0){this.sim.stimulate(this.sim.escw,.22,12);this.sim.stimulate(this.sim.gf,.28,5);}if(action.dz<0)this.sim.stimulate(this.sim.mdn,.2,12);}
  step(observation,dt=.05){this.encode(observation);this.sim.step(12);const action=this.choose(this.features());this.driveAction(action,observation);this.sim.step(12);const signals=this.builder.make(this.sim,dt);signals.tempo=clamp(Number(this.manifest.traits?.speed||1),.5,2);return{action,signals,spikes:this.bus.popAll(),probabilities:this.lastProbabilities,neural:{simMs:this.sim.simMs,ratePop:this.sim.ratePop,rateFwd:this.sim.rateFwd,dopamineRule:this.manifest.plasticity.rule}};}
  actionFor(observation){return this.step(observation).action;}
}
