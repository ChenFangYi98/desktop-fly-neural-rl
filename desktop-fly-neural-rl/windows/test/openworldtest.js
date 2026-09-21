import assert from 'node:assert/strict';
import { PLACEABLES, PREDATOR_LEVELS, WORLD_PRESETS, createWorldPreset, placeAsset, removeAt, validateWorld } from '../src/worldstudio.js';
import { RL_ALGORITHMS, OpenPolicyRuntime, OpenRLSession, createExperiment } from '../src/openrl.js';

for(const preset of WORLD_PRESETS){
  const world=createWorldPreset(preset.id),result=validateWorld(world);
  assert.equal(result.valid,true,`${preset.name} should be valid`);
  assert.ok(world.size.x>=24&&world.size.y>=18&&world.size.z>=8,`${preset.name} should be a large 3D world`);
}
assert.equal(PLACEABLES.length,17);
assert.deepEqual({speed:PREDATOR_LEVELS.low.speed,vision:PREDATOR_LEVELS.low.vision,reach:PREDATOR_LEVELS.low.reach,cooldown:PREDATOR_LEVELS.low.cooldown,captureChance:PREDATOR_LEVELS.low.captureChance},{speed:1.4,vision:5,reach:1.15,cooldown:4.2,captureChance:.38});

let editable=createWorldPreset('blank');
editable=placeAsset(editable,'predator:frog',{x:5,y:5,z:1},{predatorLevel:'low'});
const predator=editable.entities.find(item=>item.type==='predator');
assert.ok(predator);
editable=removeAt(editable,null,{entityId:predator.id});
assert.equal(editable.entities.some(item=>item.id===predator.id),false);

for(const algorithm of RL_ALGORITHMS){
  const experiment=createExperiment('navigation');experiment.algorithm=algorithm.id;experiment.episodes=10;
  const session=new OpenRLSession(createWorldPreset('blank'),experiment);
  for(let i=0;i<10;i++)session.trainEpisode();
  assert.equal(session.stats().episodes,10);
  assert.equal(session.exportManifest().kind,'desktop-fly-open-rl-policy');
}

const experiment=createExperiment('navigation');experiment.algorithm='q-learning';experiment.episodes=2500;
const trained=new OpenRLSession(createWorldPreset('blank'),experiment);
for(let i=0;i<experiment.episodes;i++)trained.trainEpisode();
assert.ok(trained.stats().recentSuccess>.8);
const runtime=new OpenPolicyRuntime(trained.exportManifest('runtime-test'));
assert.ok(runtime.actionFor({position:{x:2,y:2,z:1}})?.id);
console.log(`PASS open world core: ${WORLD_PRESETS.length} large maps, ${PLACEABLES.length+1} editor tools, ${RL_ALGORITHMS.length} RL algorithms`);
