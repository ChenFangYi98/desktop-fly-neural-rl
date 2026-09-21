import assert from 'node:assert/strict';
import { ALGORITHMS, SCENARIOS, EmbodiedTrainingSession } from '../src/embodiedtrainer.js';

for (const algorithm of ALGORITHMS) {
  const session = new EmbodiedTrainingSession({
    algorithm: algorithm.id,
    scenario: 'obstacles',
    episodes: 3000,
    seed: 42,
    ...algorithm.defaults,
  });
  for (let episode = 0; episode < 3000; episode++) session.trainEpisode();
  const evaluation = session.policyPath();
  assert.equal(evaluation.reachedGoal, true, `${algorithm.name} policy should reach the goal`);
  assert.equal(evaluation.collisions, 0, `${algorithm.name} greedy policy should avoid obstacles`);
  assert.ok(session.stats().recentSuccess >= 0.9, `${algorithm.name} recent success should reach 90%`);
}

for (const scenario of SCENARIOS) {
  const session = new EmbodiedTrainingSession({ algorithm: 'ppo', scenario: scenario.id, episodes: 2400, seed: 73 });
  for (let episode = 0; episode < 2400; episode++) session.trainEpisode();
  assert.equal(session.policyPath().reachedGoal, true, `PPO should solve ${scenario.name}`);
}

const manifestSession = new EmbodiedTrainingSession({ algorithm: 'double-q', scenario: 'foraging', episodes: 100 });
manifestSession.trainEpisode();
const manifest = manifestSession.exportManifest('导出测试');
assert.equal(manifest.baseModel, 'FlyWire v783 + MaleCNS (frozen)');
assert.equal(manifest.config.scenario, 'foraging');
assert.equal(manifest.policy.q.length, 12 * 8 * 4);

console.log(`PASS embodied trainer: ${ALGORITHMS.length} algorithms, ${SCENARIOS.length} scenarios`);
