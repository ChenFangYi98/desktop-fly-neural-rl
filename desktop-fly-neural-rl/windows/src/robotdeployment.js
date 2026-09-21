export const ROBOT_TYPES = Object.freeze([
  { id: 'differential', name: '差速轮式机器人', middleware: 'ROS 2 / Twist', linear: 0.35, angular: 0.9 },
  { id: 'quadruped', name: '四足机器人', middleware: 'ROS 2 / Twist', linear: 0.28, angular: 0.75 },
  { id: 'hexapod', name: '六足机器人', middleware: 'ROS 2 / Twist', linear: 0.22, angular: 0.7 },
  { id: 'drone', name: '微型无人机', middleware: 'ROS 2 / Twist', linear: 0.45, angular: 1.1 },
]);

export const DEFAULT_DEPLOYMENT = Object.freeze({
  robotType: 'differential', middleware: 'ros2', poseTopic: '/robot/pose', scanTopic: '/scan',
  commandTopic: '/cmd_vel', emergencyStopTopic: '/emergency_stop', controlHz: 20,
  mapResolution: 0.25, originX: 0, originY: 0, maxLinear: 0.35, maxAngular: 0.9,
  safeDistance: 0.28, commandTimeoutMs: 250, actionHoldMs: 180,
  physicsAlgorithm: 'ppo', physicsSteps: 500000, physicsDevice: 'auto',
});

function clamp(value, low, high) { return Math.max(low, Math.min(high, Number(value) || 0)); }

export function validateDeploymentConfig(config = {}) {
  const value = { ...DEFAULT_DEPLOYMENT, ...config };
  const errors = [];
  if (!ROBOT_TYPES.some((item) => item.id === value.robotType)) errors.push('不支持的机器人类型');
  for (const key of ['poseTopic', 'scanTopic', 'commandTopic', 'emergencyStopTopic']) {
    if (typeof value[key] !== 'string' || !value[key].startsWith('/')) errors.push(`${key} 必须是以 / 开头的 ROS 2 topic`);
  }
  if (!(Number(value.controlHz) >= 1 && Number(value.controlHz) <= 200)) errors.push('控制频率必须在 1–200 Hz');
  if (!(Number(value.mapResolution) > 0 && Number(value.mapResolution) <= 10)) errors.push('地图分辨率无效');
  if (!(Number(value.safeDistance) > 0)) errors.push('安全停车距离必须大于 0');
  if (!['ppo', 'sac', 'td3', 'a2c', 'dqn'].includes(value.physicsAlgorithm)) errors.push('不支持的物理训练算法');
  if (!(Number(value.physicsSteps) >= 10000)) errors.push('物理训练步数不能少于 10000');
  return { valid: errors.length === 0, errors, value };
}

export function attachDeployment(policyManifest, config = {}) {
  const validation = validateDeploymentConfig(config);
  if (!validation.valid) throw new Error(validation.errors.join('；'));
  const value = validation.value;
  const robot = ROBOT_TYPES.find((item) => item.id === value.robotType);
  const maxLinear = clamp(value.maxLinear, 0.01, 5);
  const maxAngular = clamp(value.maxAngular, 0.05, 8);
  const open = policyManifest?.kind === 'desktop-fly-open-rl-policy'
    || policyManifest?.kind === 'desktop-fly-neural-rl-policy';
  const neural = policyManifest?.kind === 'desktop-fly-neural-rl-policy';
  const volumetric = policyManifest?.kind === 'desktop-fly-volumetric-policy' || open;
  const sourceActions = open ? policyManifest.actions : policyManifest.actionSchema;
  const actionSchema = volumetric ? sourceActions.map((action) => ({
    id: action.id, name: action.name, gridDelta3D: [action.dx, action.dy, action.dz],
    desiredHeadingRad: action.dx || action.dy ? Math.atan2(action.dy, action.dx) : 0,
    linearZ: action.dz,
  })) : [
    { id: 'right', gridDelta: [1, 0], desiredHeadingRad: 0 },
    { id: 'up', gridDelta: [0, 1], desiredHeadingRad: Math.PI / 2 },
    { id: 'left', gridDelta: [-1, 0], desiredHeadingRad: Math.PI },
    { id: 'down', gridDelta: [0, -1], desiredHeadingRad: -Math.PI / 2 },
  ];
  return {
    ...policyManifest,
    deployment: {
      version: 1, runtime: 'ros2_policy_node.py', middleware: value.middleware,
      physicsTraining: { engine: 'PyBullet', framework: 'Stable-Baselines3', entrypoint: 'train_physics.py',
        algorithm: value.physicsAlgorithm, totalSteps: Number(value.physicsSteps), device: value.physicsDevice,
        supportedAlgorithms: ['ppo', 'sac', 'td3', 'a2c', 'dqn'] },
      robot: { type: robot.id, name: robot.name },
      topics: { pose: value.poseTopic, scan: value.scanTopic, command: value.commandTopic, emergencyStop: value.emergencyStopTopic },
      map: { resolutionM: Number(value.mapResolution), originM: [Number(value.originX), Number(value.originY)] },
      timing: { controlHz: Number(value.controlHz), commandTimeoutMs: Number(value.commandTimeoutMs), actionHoldMs: Number(value.actionHoldMs) },
      safety: { safeDistanceM: Number(value.safeDistance), maxLinearMps: maxLinear, maxAngularRadps: maxAngular, stopOnStaleInput: true, emergencyStopRequired: true },
      observationSchema: open
        ? policyManifest.experiment.observations
        : volumetric
          ? ['grid_x', 'grid_y', 'grid_z', 'front_range_m', 'left_range_m', 'right_range_m', 'heading_rad']
        : ['grid_x', 'grid_y', 'front_range_m', 'left_range_m', 'right_range_m', 'heading_rad'],
      actionSchema,
      spatialControl: open ? 'open-7-action-voxel' : volumetric ? '6-axis-voxel' : 'planar-grid',
      sensorContract: open ? {
        position: '机器人定位系统提供的三维网格坐标',
        predatorVector: '可选：视觉检测器提供天敌/动态障碍位置',
        foodVector: '可选：视觉检测器提供目标物位置',
        brainRates: neural ? 'ROS 2 运行时由导出的连接组群体矩阵内部生成；高保真生态部署使用 668 神经元 LIF' : '可选：神经活动适配器；缺失时使用训练默认值',
      } : undefined,
      neuralController: neural ? {
        required: true, fingerprint: policyManifest.brain?.fingerprint,
        path: policyManifest.brain?.controllerPath,
        plasticityRule: policyManifest.plasticity?.rule,
        note: '真实机器人端必须运行同版本连接组运行时；不得绕过下降神经元直接执行策略动作。',
      } : undefined,
      readinessChecklist: [
        '校准地图原点与分辨率', '确认传感器 topic 的方向和单位', '在架空轮/支撑状态下检查动作映射',
        '验证硬件急停与软件超时停车', '低速封闭场地逐步放大速度上限',
      ],
    },
  };
}

export class DeploymentPolicyRuntime {
  constructor(manifest) {
    const open = manifest?.kind === 'desktop-fly-open-rl-policy';
    if (!manifest?.policy || (!open && !manifest?.course) || !manifest?.deployment) throw new Error('部署包不完整');
    this.manifest = manifest;
    this.open = open;
  }

  actionFor({ worldX, worldY, worldZ = 0, headingRad = 0, frontRange = Infinity, emergencyStop = false, inputAgeMs = 0,
    step = 0, energy = 1, predators, food }) {
    const { deployment, policy } = this.manifest;
    if (emergencyStop || inputAgeMs > deployment.timing.commandTimeoutMs || frontRange < deployment.safety.safeDistanceM) {
      return { action: 'stop', linearX: 0, linearZ: 0, angularZ: 0, safetyStop: true };
    }
    const x = Math.round((worldX - deployment.map.originM[0]) / deployment.map.resolutionM);
    const y = Math.round((worldY - deployment.map.originM[1]) / deployment.map.resolutionM);
    if (this.open) return this.openAction({ x, y, z: Math.round(worldZ / deployment.map.resolutionM), headingRad, step, energy, predators, food });
    const { course, config } = this.manifest;
    if (x < 0 || y < 0 || x >= course.width || y >= course.height) return { action: 'stop', linearX: 0, angularZ: 0, safetyStop: true };
    const offset = (y * course.width + x) * 4;
    const policyGradient = ['ppo', 'a2c', 'discrete-sac'].includes(config.algorithm);
    const values = policyGradient
      ? policy.actor.map((value, index) => value + policy.q[index] * 0.35)
      : policy.q.map((value, index) => value + (policy.q2?.[index] || 0));
    let best = 0;
    for (let i = 1; i < 4; i++) if (values[offset + i] > values[offset + best]) best = i;
    const schema = deployment.actionSchema[best];
    const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
    const headingError = wrap(schema.desiredHeadingRad - headingRad);
    const angularZ = clamp(headingError * 1.8, -deployment.safety.maxAngularRadps, deployment.safety.maxAngularRadps);
    const linearX = Math.abs(headingError) > 1.25 ? 0 : deployment.safety.maxLinearMps * Math.max(0, Math.cos(headingError));
    return { action: schema.id, linearX, angularZ, desiredHeadingRad: schema.desiredHeadingRad,
      headingError, safetyStop: false, cell: { x, y } };
  }

  openAction({ x, y, z, headingRad, step, energy, predators, food }) {
    const { world, experiment, policy, deployment } = this.manifest;
    if (x < 0 || y < 0 || z < 0 || x >= world.size.x || y >= world.size.y || z >= world.size.z) {
      return { action: 'stop', linearX: 0, linearZ: 0, angularZ: 0, safetyStop: true };
    }
    const position = { x, y, z };
    const enabled = (type) => world.entities.filter((item) => item.enabled !== false && item.type === type);
    const nearest = (items) => {
      let item = null, d = Infinity;
      for (const value of items || []) { const p = value.position || value; const next = Math.abs(p.x-x)+Math.abs(p.y-y)+Math.abs((p.z||0)-z); if (next < d) { item = value; d = next; } }
      return { item, d };
    };
    const point = (value) => value?.position || value;
    const parts = [`${x},${y},${z}`];
    if (experiment.observations.includes('goalVector')) { const n=nearest(enabled('goal')),p=point(n.item); parts.push(`g${Math.sign((p?.x??x)-x)},${Math.sign((p?.y??y)-y)},${Math.sign((p?.z??z)-z)},${Math.min(4,n.d)}`); }
    if (experiment.observations.includes('predatorVector')) { const n=nearest(predators || enabled('predator')),p=point(n.item); parts.push(`p${p?Math.sign(p.x-x):0},${p?Math.sign(p.y-y):0},${Math.min(5,n.d)}`); }
    if (experiment.observations.includes('foodVector')) { const n=nearest(food || enabled('food')),p=point(n.item); parts.push(`f${p?Math.sign(p.x-x):0},${p?Math.sign(p.y-y):0},${Math.min(5,n.d)}`); }
    if (experiment.observations.includes('time')) parts.push(`t${Math.min(4,Math.floor(step/Math.max(1,experiment.maxSteps/4)))}`);
    const state = parts.join('|'), q = policy.q[state] || new Array(this.manifest.actions.length).fill(0), q2 = policy.q2?.[state] || [], actor = policy.actor?.[state] || [];
    const values = this.manifest.actions.map((_,index) => ['ppo','a2c','discrete-sac'].includes(experiment.algorithm)
      ? (actor[index] || 0) + (q[index] || 0) * .35
      : (q[index] || 0) + (experiment.algorithm === 'double-q' ? (q2[index] || 0) : 0));
    let best=0; for(let i=1;i<values.length;i++) if(values[i]>values[best]) best=i;
    const schema=deployment.actionSchema[best], vertical=Number(schema.linearZ||0), wait=schema.id==='wait';
    const wrap=(angle)=>Math.atan2(Math.sin(angle),Math.cos(angle)),headingError=wrap(schema.desiredHeadingRad-headingRad);
    const angularZ=vertical||wait?0:clamp(headingError*1.8,-deployment.safety.maxAngularRadps,deployment.safety.maxAngularRadps);
    const linearX=vertical||wait||Math.abs(headingError)>1.25?0:deployment.safety.maxLinearMps*Math.max(0,Math.cos(headingError));
    return {action:schema.id,linearX,linearZ:vertical*deployment.safety.maxLinearMps,angularZ,desiredHeadingRad:schema.desiredHeadingRad,headingError,safetyStop:false,cell:position,state,energy};
  }
}
