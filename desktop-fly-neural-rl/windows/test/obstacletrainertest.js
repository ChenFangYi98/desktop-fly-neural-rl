import assert from 'node:assert/strict';
import { COURSE, ObstacleCourseTrainer, validateObstacleCourse } from '../src/obstacletrainer.js';

// Fixed random numbers make convergence failures reproducible in CI.
let seed = 0x31f2ac09;
const rng = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const trainer = new ObstacleCourseTrainer({ rng });
for (let i = 0; i < 2600; i++) trainer.trainEpisode();
const result = trainer.policyPath();
const stats = trainer.stats();

assert.equal(result.reachedGoal, true, 'greedy learned policy must reach the goal');
assert.equal(result.collisions, 0, 'learned route must not collide with a wall');
assert.ok(result.path.length < 35, `route should be efficient, got ${result.path.length} cells`);
assert.ok(stats.recentSuccessRate > 0.9, `recent success should exceed 90%, got ${stats.recentSuccessRate}`);
for (const point of result.path) {
  assert.ok(point.x >= 0 && point.y >= 0 && point.x < COURSE.width && point.y < COURSE.height);
  assert.equal(trainer.isObstacle(point.x, point.y), false, `path entered obstacle ${point.x},${point.y}`);
}

console.log(`PASS obstacle Q-learning: ${(stats.recentSuccessRate * 100).toFixed(1)}% recent success, `
  + `${result.path.length} cells, zero greedy collisions`);

const custom = { width: 6, height: 5, start: { x: 0, y: 2 }, goal: { x: 5, y: 4 },
  obstacles: [[2, 0], [2, 1], [2, 2], [2, 4]] };
assert.equal(validateObstacleCourse(custom).reachable, true, 'custom map gap should be reachable');
const customTrainer = new ObstacleCourseTrainer({ course: custom, rng });
for (let i = 0; i < 1800; i++) customTrainer.trainEpisode();
assert.equal(customTrainer.policyPath().reachedGoal, true, 'custom course policy should reach custom goal');

const impossible = { ...custom, obstacles: [...custom.obstacles, [2, 3]] };
assert.equal(validateObstacleCourse(impossible).reachable, false, 'closed wall should be rejected before training');
console.log('PASS custom goal/obstacle validation: reachable custom map learns; closed map is rejected');
