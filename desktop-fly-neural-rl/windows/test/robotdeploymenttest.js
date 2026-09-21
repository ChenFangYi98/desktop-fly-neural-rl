import assert from 'node:assert/strict';
import { EmbodiedTrainingSession } from '../src/embodiedtrainer.js';
import { attachDeployment, DeploymentPolicyRuntime, validateDeploymentConfig } from '../src/robotdeployment.js';
import { createWorldPreset } from '../src/worldstudio.js';
import { createExperiment, OpenRLSession } from '../src/openrl.js';

const session = new EmbodiedTrainingSession({ algorithm: 'q-learning', scenario: 'target', episodes: 2000, seed: 42 });
for (let i = 0; i < 2000; i++) session.trainEpisode();
const manifest = attachDeployment(session.exportManifest('robot-test'), {
  robotType: 'differential', poseTopic: '/pose', scanTopic: '/scan', commandTopic: '/cmd_vel',
  emergencyStopTopic: '/estop', mapResolution: 0.25, maxLinear: 0.2, maxAngular: 0.6,
});
const runtime = new DeploymentPolicyRuntime(manifest);
const start = manifest.course.start;
const command = runtime.actionFor({ worldX: start.x * 0.25, worldY: start.y * 0.25, frontRange: 2 });
assert.equal(command.safetyStop, false);
assert.ok(Math.abs(command.linearX) <= 0.2);
assert.ok(Math.abs(command.angularZ) <= 0.6);
assert.equal(runtime.actionFor({ worldX: 0, worldY: 0, emergencyStop: true }).safetyStop, true);
assert.equal(runtime.actionFor({ worldX: 0, worldY: 0, frontRange: 0.1 }).safetyStop, true);
assert.equal(runtime.actionFor({ worldX: 0, worldY: 0, inputAgeMs: 999 }).safetyStop, true);
assert.equal(validateDeploymentConfig({ poseTopic: 'bad-topic' }).valid, false);

const openWorld=createWorldPreset('blank'),openExperiment=createExperiment('navigation');
openExperiment.episodes=2500;
const openSession=new OpenRLSession(openWorld,openExperiment);
for(let i=0;i<openExperiment.episodes;i++)openSession.trainEpisode();
const openManifest=attachDeployment(openSession.exportManifest('open-robot-test'),{robotType:'drone',mapResolution:openWorld.cellSizeM,maxLinear:.3,maxAngular:.7});
const openRuntime=new DeploymentPolicyRuntime(openManifest),spawn=openWorld.entities.find(item=>item.type==='spawn').position;
const openCommand=openRuntime.actionFor({worldX:spawn.x*openWorld.cellSizeM,worldY:spawn.y*openWorld.cellSizeM,worldZ:spawn.z*openWorld.cellSizeM,frontRange:2});
assert.equal(openManifest.deployment.spatialControl,'open-7-action-voxel');
assert.equal(openManifest.deployment.actionSchema.length,7);
assert.equal(openCommand.safetyStop,false);
assert.ok(Math.abs(openCommand.linearX)<=.3&&Math.abs(openCommand.linearZ)<=.3&&Math.abs(openCommand.angularZ)<=.7);
console.log('PASS robot deployment: legacy + open 3D policy mapping, estop, obstacle and timeout gates');
