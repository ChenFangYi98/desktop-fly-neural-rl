import assert from 'node:assert/strict';
import { ALGORITHMS } from '../src/embodiedtrainer.js';
import { createVoxelWorld, validateVoxelWorld, VolumetricPolicyRuntime, VolumetricTrainingSession } from '../src/volumetricworld.js';
import { attachDeployment } from '../src/robotdeployment.js';

const world = createVoxelWorld({ width: 12, depth: 8, height: 6 });
assert.equal(validateVoxelWorld(world).valid, true);

for (const algorithm of ALGORITHMS) {
  const session = new VolumetricTrainingSession({ world, algorithm: algorithm.id, episodes: 4000, maxSteps: 240, seed: 42, ...algorithm.defaults });
  for (let episode = 0; episode < 4000; episode++) session.trainEpisode();
  const evaluation = session.policyPath();
  assert.equal(evaluation.reachedGoal, true, `${algorithm.name} should solve the X/Y/Z world`);
  assert.equal(evaluation.collisions, 0, `${algorithm.name} should avoid solid voxels`);
  assert.ok(evaluation.path.some((point) => point.z !== world.start.z), `${algorithm.name} must learn a vertical action`);
  assert.ok(session.stats().recentSuccess >= .9, `${algorithm.name} should exceed 90% recent success`);
}

const occupied = createVoxelWorld();
occupied.voxels.push([occupied.start.x, occupied.start.y, occupied.start.z, 'rock']);
assert.equal(validateVoxelWorld(occupied).valid, false, 'solid start voxel must be rejected');

const session = new VolumetricTrainingSession({ world, algorithm: 'q-learning', episodes: 1200, speedTrait: 1.8, intelligenceTrait: 1.5, escapeSensitivity: 2 });
for (let episode = 0; episode < 1200; episode++) session.trainEpisode();
const manifest = attachDeployment(session.exportManifest('三维部署测试'), { robotType: 'drone' });
assert.equal(manifest.kind, 'desktop-fly-volumetric-policy');
assert.equal(manifest.deployment.spatialControl, '6-axis-voxel');
assert.equal(manifest.deployment.actionSchema.length, 6);
assert.deepEqual(manifest.traits, { speed: 1.8, intelligence: 1.5, escapeSensitivity: 2 });
const action = new VolumetricPolicyRuntime(manifest).actionFor(manifest.world.start);
assert.ok(['east', 'north', 'west', 'south', 'up', 'down'].includes(action.id));

console.log(`PASS volumetric world: ${ALGORITHMS.length} algorithms, X/Y/Z actions, validation and deployment traits`);
