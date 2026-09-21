import assert from 'node:assert/strict';
import { loadBrainData } from '../src/data.js';
import { createWorldPreset } from '../src/worldstudio.js';
import { NeuralPolicyRuntime, NeuralRLSession, connectomeFingerprint, createExperiment } from '../src/neuralrl.js';

const brainData = loadBrainData();
assert.equal(brainData.circuit.neurons.length, 668);
assert.equal(brainData.circuit.edges.length, 18968);
assert.equal(brainData.locomotor.neurons.length, 1045);

const experiment = createExperiment('navigation');
experiment.episodes = 80;
experiment.maxSteps = 80;
const session = new NeuralRLSession(createWorldPreset('blank'), experiment, brainData);
const beforeReadout = Array.from(session.readout);
for (let i = 0; i < experiment.episodes; i++) session.trainEpisode();

const manifest = session.exportManifest('neural-core-test');
assert.equal(manifest.kind, 'desktop-fly-neural-rl-policy');
assert.equal(manifest.brain.fingerprint, connectomeFingerprint(brainData.circuit));
assert.equal(manifest.brain.neuronCount, 668);
assert.equal(manifest.brain.edgeCount, 18968);
assert.equal(manifest.brain.maleCNSNeuronCount, 1045);
assert.ok(manifest.plasticity.changedGroupEdges > 0, 'reward must change connectome group gains');
assert.equal(manifest.plasticity.baseWeights.length, manifest.plasticity.groups.length ** 2,
  'portable deployment must include the connectome population matrix');
assert.ok(manifest.policy.readout.some((value, i) => value !== beforeReadout[i]), 'reward must change descending readout');
assert.deepEqual(manifest.brain.controllerPath, [
  'environment sensors', 'FlyWire sensory populations', 'signed recurrent connectome',
  'descending neurons', 'MaleCNS motor circuit', 'embodied fly',
]);

const runtime = new NeuralPolicyRuntime(manifest, brainData);
assert.equal(runtime.sim.w.length, 18968, 'deployment must keep every measured edge');
assert.ok(runtime.plasticitySummary.changed > 0, 'learned gains must map onto LIF edges');
const decision = runtime.step({ position:{x:2,y:9,z:1}, heading:0, food:[], predators:[], legFeedback:[] }, .05);
assert.ok(manifest.actions.some(action => action.id === decision.action.id));
assert.equal(typeof decision.signals.turnBias, 'number');
assert.equal(typeof decision.signals.walkDrive, 'number');
assert.ok(runtime.sim.simMs >= 24, 'decision must advance the neural simulation');

console.log(`PASS neural RL: ${manifest.brain.neuronCount} neurons, ${manifest.brain.edgeCount} signed edges, ${manifest.plasticity.changedGroupEdges} plastic population edges`);
