// obstacletrainer.js — deterministic-testable Q-learning for a small course.
//
// The learner receives only a grid cell and four possible movement actions.
// It is rewarded for reaching the goal, lightly rewarded for reducing goal
// distance, and penalized for time and collisions. No path is hard-coded into
// the policy. Keeping this module independent from Three.js lets automated
// tests verify that the learned route reaches the goal without crossing walls.

export const COURSE = Object.freeze({
  width: 12,
  height: 8,
  start: Object.freeze({ x: 0, y: 3 }),
  goal: Object.freeze({ x: 11, y: 5 }),
  // Three offset walls force the animal to learn a sequence of detours.
  obstacles: Object.freeze([
    [3, 0], [3, 1], [3, 2], [3, 4], [3, 5], [3, 6], [3, 7],
    [6, 0], [6, 1], [6, 3], [6, 4], [6, 5], [6, 6], [6, 7],
    [9, 0], [9, 1], [9, 2], [9, 3], [9, 4], [9, 6], [9, 7],
  ]),
});

export const COURSE_ACTIONS = Object.freeze([
  Object.freeze({ id: 'right', dx: 1, dy: 0, label: '向右前进' }),
  Object.freeze({ id: 'up', dx: 0, dy: 1, label: '向上转向' }),
  Object.freeze({ id: 'left', dx: -1, dy: 0, label: '向左后退' }),
  Object.freeze({ id: 'down', dx: 0, dy: -1, label: '向下转向' }),
]);

const keyOf = (x, y) => `${x},${y}`;

// Validate user-authored maps before spending training time on them. Breadth-
// first search only checks reachability; it does not provide a route to the
// learner, so Q-learning still has to discover its own policy.
export function validateObstacleCourse(course) {
  if (!course || !Number.isInteger(course.width) || !Number.isInteger(course.height)
      || course.width < 2 || course.height < 2) {
    return { valid: false, reachable: false, reason: '地图尺寸无效' };
  }
  const inside = (point) => point && Number.isInteger(point.x) && Number.isInteger(point.y)
    && point.x >= 0 && point.y >= 0 && point.x < course.width && point.y < course.height;
  if (!inside(course.start) || !inside(course.goal)) {
    return { valid: false, reachable: false, reason: '起点或终点超出地图' };
  }
  const blocked = new Set((course.obstacles || []).map(([x, y]) => keyOf(x, y)));
  if (blocked.has(keyOf(course.start.x, course.start.y))) {
    return { valid: false, reachable: false, reason: '起点不能放置障碍' };
  }
  if (blocked.has(keyOf(course.goal.x, course.goal.y))) {
    return { valid: false, reachable: false, reason: '终点不能放置障碍' };
  }
  const queue = [{ ...course.start }];
  const visited = new Set([keyOf(course.start.x, course.start.y)]);
  for (let index = 0; index < queue.length; index++) {
    const point = queue[index];
    if (point.x === course.goal.x && point.y === course.goal.y) {
      return { valid: true, reachable: true, reason: '', reachableCells: visited.size };
    }
    for (const action of COURSE_ACTIONS) {
      const x = point.x + action.dx;
      const y = point.y + action.dy;
      const key = keyOf(x, y);
      if (x < 0 || y < 0 || x >= course.width || y >= course.height
          || blocked.has(key) || visited.has(key)) continue;
      visited.add(key);
      queue.push({ x, y });
    }
  }
  return { valid: true, reachable: false, reason: '起点与终点之间没有可通行路线', reachableCells: visited.size };
}

export class ObstacleCourseTrainer {
  constructor({ course = COURSE, alpha = 0.24, gamma = 0.94,
    epsilon = 0.38, rng = Math.random } = {}) {
    this.course = course;
    this.alpha = alpha;
    this.gamma = gamma;
    this.initialEpsilon = epsilon;
    this.epsilon = epsilon;
    this.rng = rng;
    this.obstacles = new Set(course.obstacles.map(([x, y]) => keyOf(x, y)));
    this.q = new Float64Array(course.width * course.height * COURSE_ACTIONS.length);
    this.episodes = 0;
    this.successes = 0;
    this.collisions = 0;
    this.recentSuccess = [];
  }

  stateIndex(x, y) { return y * this.course.width + x; }
  qIndex(x, y, action) { return this.stateIndex(x, y) * COURSE_ACTIONS.length + action; }
  isObstacle(x, y) { return this.obstacles.has(keyOf(x, y)); }
  isGoal(x, y) { return x === this.course.goal.x && y === this.course.goal.y; }

  bestAction(x, y) {
    let best = 0;
    let bestValue = this.q[this.qIndex(x, y, 0)];
    for (let action = 1; action < COURSE_ACTIONS.length; action++) {
      const value = this.q[this.qIndex(x, y, action)];
      if (value > bestValue) { best = action; bestValue = value; }
    }
    return best;
  }

  transition(x, y, actionIndex) {
    const action = COURSE_ACTIONS[actionIndex];
    const nx = x + action.dx;
    const ny = y + action.dy;
    const blocked = nx < 0 || ny < 0 || nx >= this.course.width || ny >= this.course.height
      || this.isObstacle(nx, ny);
    if (blocked) return { x, y, reward: -2.5, collision: true, done: false };
    if (this.isGoal(nx, ny)) return { x: nx, y: ny, reward: 15, collision: false, done: true };
    const oldDistance = Math.abs(this.course.goal.x - x) + Math.abs(this.course.goal.y - y);
    const newDistance = Math.abs(this.course.goal.x - nx) + Math.abs(this.course.goal.y - ny);
    // Progress shaping speeds learning but does not reveal which turn to take.
    const reward = -0.055 + (oldDistance - newDistance) * 0.12;
    return { x: nx, y: ny, reward, collision: false, done: false };
  }

  trainEpisode(maxSteps = 180) {
    let { x, y } = this.course.start;
    let totalReward = 0;
    let success = false;
    let episodeCollisions = 0;
    for (let step = 0; step < maxSteps; step++) {
      const exploring = this.rng() < this.epsilon;
      const action = exploring ? Math.floor(this.rng() * COURSE_ACTIONS.length) : this.bestAction(x, y);
      const next = this.transition(x, y, action);
      if (next.collision) episodeCollisions++;
      const currentIndex = this.qIndex(x, y, action);
      const future = next.done ? 0 : this.q[this.qIndex(next.x, next.y, this.bestAction(next.x, next.y))];
      this.q[currentIndex] += this.alpha * (next.reward + this.gamma * future - this.q[currentIndex]);
      totalReward += next.reward;
      x = next.x; y = next.y;
      if (next.done) { success = true; break; }
    }
    this.episodes++;
    if (success) this.successes++;
    this.collisions += episodeCollisions;
    this.recentSuccess.push(success ? 1 : 0);
    if (this.recentSuccess.length > 100) this.recentSuccess.shift();
    this.epsilon = Math.max(0.025, this.initialEpsilon * Math.exp(-this.episodes / 850));
    return { success, totalReward, collisions: episodeCollisions };
  }

  // Return the greedy route currently encoded by Q values. Repeated cells are
  // allowed in an immature policy but evaluation reports that it did not pass.
  policyPath(maxSteps = 100) {
    let { x, y } = this.course.start;
    const path = [{ x, y }];
    let collisions = 0;
    for (let step = 0; step < maxSteps && !this.isGoal(x, y); step++) {
      const next = this.transition(x, y, this.bestAction(x, y));
      if (next.collision) collisions++;
      x = next.x; y = next.y;
      path.push({ x, y });
    }
    return { path, reachedGoal: this.isGoal(x, y), collisions };
  }

  stats() {
    const recent = this.recentSuccess.length
      ? this.recentSuccess.reduce((sum, value) => sum + value, 0) / this.recentSuccess.length : 0;
    return {
      episodes: this.episodes,
      successRate: this.episodes ? this.successes / this.episodes : 0,
      recentSuccessRate: recent,
      collisions: this.collisions,
      epsilon: this.epsilon,
    };
  }
}
