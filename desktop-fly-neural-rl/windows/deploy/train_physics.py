"""Train an exported DesktopFly 3D scene in PyBullet with Stable-Baselines3.

Example:
  pip install -r requirements-robot.txt
  python train_physics.py scene-policy.json --algorithm ppo --steps 500000

The resulting .zip model and .metadata.json are consumed by
ros2_sb3_policy_node.py. Train with several seeds and validate in a protected
test area before allowing the model to command real hardware.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import gymnasium as gym
import numpy as np
import pybullet as pb
import pybullet_data
from gymnasium import spaces
from stable_baselines3 import A2C, DQN, PPO, SAC, TD3
from stable_baselines3.common.monitor import Monitor


ALGORITHMS = {"ppo": PPO, "sac": SAC, "td3": TD3, "a2c": A2C, "dqn": DQN}


class DesktopFlyPhysicsEnv(gym.Env):
    metadata = {"render_modes": ["human", "direct"]}

    def __init__(self, manifest: dict, algorithm: str, render_mode: str = "direct"):
        super().__init__()
        self.manifest = manifest
        self.world = manifest.get("world", {})
        self.open = manifest.get("kind") == "desktop-fly-open-rl-policy"
        self.spawn_entity = next((item for item in self.world.get("entities", []) if item.get("type") == "spawn" and item.get("enabled", True)), None)
        self.goal_entity = next((item for item in self.world.get("entities", []) if item.get("type") == "goal" and item.get("enabled", True)), None)
        if self.open:
            size = self.world["size"]
            start = self.spawn_entity["position"]
            goal = self.goal_entity["position"]
            self.course = {"width": size["x"], "height": size["y"], "start": start, "goal": goal,
                "obstacles": [voxel[:2] for voxel in self.world.get("voxels", []) if voxel[2] > 0 and voxel[3] in {"grass", "soil", "rock", "wood", "leaf", "sand"}]}
        else:
            self.course = manifest["course"]
        self.deploy = manifest["deployment"]
        self.algorithm = algorithm
        self.resolution = float(self.deploy["map"]["resolutionM"])
        self.max_linear = float(self.deploy["safety"]["maxLinearMps"])
        self.max_angular = float(self.deploy["safety"]["maxAngularRadps"])
        config = manifest.get("config", manifest.get("experiment", {}))
        self.max_steps = int(config.get("maxSteps", 300))
        self.randomize = bool(config.get("domainRandomization", True))
        if self.open:
            self.rewards = {}
            for rule in manifest["experiment"].get("rewardRules", []):
                if rule.get("enabled", True): self.rewards[rule["event"]] = self.rewards.get(rule["event"], 0.0) + float(rule.get("weight", 0.0))
            self.rewards["progress"] = self.rewards.get("goalProgress", 0.0)
        else:
            self.rewards = self.world.get("reward", {})
        self.feature_voxels = {(int(v[0]), int(v[1]), int(v[2])): v[3]
            for v in self.world.get("voxels", []) if v[3] in {"water", "nectar", "safe"}}
        for item in self.world.get("entities", []):
            if item.get("enabled", True) and item.get("type") == "food":
                p = item["position"]; self.feature_voxels[(int(p["x"]), int(p["y"]), int(p.get("z", 0)))] = "nectar"
        self.flying = (self.open or manifest.get("kind") == "desktop-fly-volumetric-policy") and self.deploy.get("robot", {}).get("type") == "drone"
        self.client = pb.connect(pb.GUI if render_mode == "human" else pb.DIRECT)
        pb.setAdditionalSearchPath(pybullet_data.getDataPath(), physicsClientId=self.client)
        self.observation_size = 16 if self.flying else 13
        self.action_size = 3 if self.flying else 2
        self.observation_space = spaces.Box(-5.0, 5.0, shape=(self.observation_size,), dtype=np.float32)
        self.action_space = spaces.Discrete(7 if self.flying else 5) if algorithm == "dqn" else spaces.Box(-1.0, 1.0, shape=(self.action_size,), dtype=np.float32)
        self.robot = None
        self.obstacles = []
        self.step_count = 0
        self.last_action = np.zeros(self.action_size, dtype=np.float32)
        self.previous_distance = 0.0

    def _world(self, point):
        ox, oy = self.deploy["map"]["originM"]
        return float(ox) + point[0] * self.resolution, float(oy) + point[1] * self.resolution

    def _world3(self, point):
        x, y = self._world(point)
        return x, y, float(point[2]) * self.resolution

    def _pose(self):
        position, quaternion = pb.getBasePositionAndOrientation(self.robot, physicsClientId=self.client)
        yaw = pb.getEulerFromQuaternion(quaternion)[2]
        linear, angular = pb.getBaseVelocity(self.robot, physicsClientId=self.client)
        return position, yaw, linear, angular

    def _rays(self, position, yaw):
        angles = np.linspace(-math.pi / 2, math.pi / 2, 5) + yaw
        starts = [[position[0], position[1], position[2]]] * 5
        ends = [[position[0] + math.cos(a) * 3.0, position[1] + math.sin(a) * 3.0, position[2]] for a in angles]
        results = pb.rayTestBatch(starts, ends, physicsClientId=self.client)
        return np.asarray([result[2] for result in results], dtype=np.float32)

    def _observation(self):
        position, yaw, linear, _ = self._pose()
        gx, gy = self._world((self.course["goal"]["x"], self.course["goal"]["y"]))
        span = max(self.course["width"], self.course["height"]) * self.resolution
        if self.flying:
            gz = float(self.goal_entity["position"]["z"] if self.open else self.world["goal"]["z"]) * self.resolution
            return np.asarray([
                (gx - position[0]) / span, (gy - position[1]) / span, (gz - position[2]) / span,
                linear[0], linear[1], linear[2], math.sin(yaw), math.cos(yaw),
                *self._rays(position, yaw), *self.last_action,
            ], dtype=np.float32)
        return np.asarray([
            (gx - position[0]) / span, (gy - position[1]) / span,
            linear[0], linear[1], math.sin(yaw), math.cos(yaw),
            *self._rays(position, yaw), *self.last_action,
        ], dtype=np.float32)

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        pb.resetSimulation(physicsClientId=self.client)
        pb.setGravity(0, 0, 0 if self.flying else -9.81, physicsClientId=self.client)
        pb.setTimeStep(1 / 120, physicsClientId=self.client)
        pb.loadURDF("plane.urdf", physicsClientId=self.client)
        start = self._world((self.course["start"]["x"], self.course["start"]["y"]))
        start_z = float(self.spawn_entity["position"].get("z", 0) if self.open else self.world.get("start", {}).get("z", 0)) * self.resolution if self.flying else 0.11
        collision = pb.createCollisionShape(pb.GEOM_SPHERE if self.flying else pb.GEOM_CYLINDER,
            radius=0.12, **({} if self.flying else {"height": 0.20}), physicsClientId=self.client)
        visual = pb.createVisualShape(pb.GEOM_SPHERE if self.flying else pb.GEOM_CYLINDER,
            radius=0.12, **({} if self.flying else {"length": 0.20}), rgbaColor=[0.9, 0.8, 0.25, 1], physicsClientId=self.client)
        self.robot = pb.createMultiBody(1.0, collision, visual, [start[0], start[1], start_z], physicsClientId=self.client)
        friction = float(self.world.get("environment", {}).get("friction", self.manifest.get("config", {}).get("friction", 0.65)))
        if self.randomize: friction *= float(self.np_random.uniform(0.72, 1.28))
        pb.changeDynamics(self.robot, -1, lateralFriction=max(0.05, friction), linearDamping=0.3, angularDamping=0.4, physicsClientId=self.client)
        self.obstacles = []
        half = self.resolution * 0.42
        obstacle_shape = pb.createCollisionShape(pb.GEOM_BOX, halfExtents=[half, half, half if self.flying else 0.28], physicsClientId=self.client)
        obstacle_visual = pb.createVisualShape(pb.GEOM_BOX, halfExtents=[half, half, half if self.flying else 0.28], rgbaColor=[0.18, 0.38, 0.33, 1], physicsClientId=self.client)
        raw_obstacles = ([voxel[:3] for voxel in self.manifest["world"].get("voxels", [])
            if voxel[2] > 0 and voxel[3] in {"grass", "soil", "rock", "wood", "leaf"}]
            if self.flying else self.course.get("obstacles", []))
        for obstacle in raw_obstacles:
            x, y = obstacle[:2]
            wx, wy = self._world((x, y))
            if self.randomize:
                wx += float(self.np_random.uniform(-0.06, 0.06) * self.resolution)
                wy += float(self.np_random.uniform(-0.06, 0.06) * self.resolution)
            wz = float(obstacle[2]) * self.resolution if self.flying else 0.28
            self.obstacles.append(pb.createMultiBody(0, obstacle_shape, obstacle_visual, [wx, wy, wz], physicsClientId=self.client))
        self.step_count = 0
        self.last_action[:] = 0
        self.consumed_food = set()
        gx, gy = self._world((self.course["goal"]["x"], self.course["goal"]["y"]))
        goal_z = float(self.goal_entity["position"].get("z", 0) if self.open else self.world.get("goal", {}).get("z", 0)) * self.resolution if self.flying else start_z
        self.previous_distance = math.dist((gx, gy, goal_z), (start[0], start[1], start_z))
        return self._observation(), {}

    def step(self, action):
        if self.algorithm == "dqn":
            commands = ([(0, 0, 0), (1, 0, 0), (0.4, 1, 0), (0.4, -1, 0), (-0.4, 0, 0), (0, 0, 1), (0, 0, -1)]
                if self.flying else [(0, 0), (1, 0), (0.4, 1), (0.4, -1), (-0.4, 0)])
            command = commands[int(action)]
        else:
            command = tuple(float(value) for value in action)
        linear_cmd, angular_cmd = command[:2]
        vertical_cmd = command[2] if self.flying else 0.0
        self.last_action[:] = command
        position, yaw, _, _ = self._pose()
        linear = max(-0.35, linear_cmd) * self.max_linear
        angular = angular_cmd * self.max_angular
        pb.resetBaseVelocity(self.robot, [math.cos(yaw) * linear, math.sin(yaw) * linear, vertical_cmd * self.max_linear], [0, 0, angular], physicsClientId=self.client)
        for _ in range(6): pb.stepSimulation(physicsClientId=self.client)
        self.step_count += 1
        position, _, _, _ = self._pose()
        gx, gy = self._world((self.course["goal"]["x"], self.course["goal"]["y"]))
        goal_z = float(self.goal_entity["position"].get("z", 0) if self.open else self.world.get("goal", {}).get("z", 0)) * self.resolution if self.flying else position[2]
        distance = math.dist((gx, gy, goal_z), position)
        progress = self.previous_distance - distance
        self.previous_distance = distance
        contacts = any(pb.getContactPoints(self.robot, obstacle, physicsClientId=self.client) for obstacle in self.obstacles)
        reached = distance < self.resolution * 0.45
        reward = (float(self.rewards.get("step", -0.04))
            + progress / max(self.resolution, 1e-6) * float(self.rewards.get("progress", 0.18))
            + float(self.rewards.get("energy", -0.01)) * sum(value * value for value in command))
        if self.flying: reward += position[2] / max(self.resolution, 1e-6) * float(self.rewards.get("altitude", 0.0))
        ox, oy = self.deploy["map"]["originM"]
        voxel = (round((position[0] - ox) / self.resolution), round((position[1] - oy) / self.resolution),
            round(position[2] / self.resolution) if self.flying else 1)
        feature = self.feature_voxels.get(voxel)
        if feature == "water": reward += float(self.rewards.get("hazard", -5.0))
        elif feature == "nectar" and voxel not in self.consumed_food:
            reward += float(self.rewards.get("food", 12.0)); self.consumed_food.add(voxel)
        elif feature == "safe": reward += float(self.rewards.get("survival", 0.02))
        if contacts: reward += float(self.rewards.get("collision", -3.0))
        if reached: reward += float(self.rewards.get("goal", 20.0))
        terminated = reached
        truncated = self.step_count >= self.max_steps
        return self._observation(), reward, terminated, truncated, {"reached_goal": reached, "collision": contacts}

    def close(self):
        if pb.isConnected(self.client): pb.disconnect(self.client)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("scene", type=Path)
    parser.add_argument("--algorithm", choices=ALGORITHMS)
    parser.add_argument("--steps", type=int)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.scene.read_text(encoding="utf-8"))
    if "deployment" not in manifest:
        raise SystemExit("Export the scene with a deployment profile from the training center first.")
    physics = manifest["deployment"].get("physicsTraining", {})
    args.algorithm = args.algorithm or physics.get("algorithm", "ppo")
    args.steps = args.steps or int(physics.get("totalSteps", 500_000))
    env = Monitor(DesktopFlyPhysicsEnv(manifest, args.algorithm, "human" if args.render else "direct"))
    model_class = ALGORITHMS[args.algorithm]
    policy = "MlpPolicy"
    model = model_class(policy, env, verbose=1, seed=args.seed, tensorboard_log="./runs")
    model.learn(total_timesteps=args.steps, progress_bar=True)
    output = args.output or args.scene.with_name(f"{args.scene.stem}-{args.algorithm}")
    model.save(str(output))
    metadata = {
        "version": 1, "algorithm": args.algorithm, "model": f"{output.name}.zip",
        "scene": args.scene.name, "observationSize": env.unwrapped.observation_size, "continuousAction": args.algorithm != "dqn",
        "deployment": manifest["deployment"], "course": env.unwrapped.course, "world": manifest.get("world"),
    }
    output.with_suffix(".metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    env.close()
    print(f"Saved {output}.zip and {output.with_suffix('.metadata.json')}")


if __name__ == "__main__":
    main()
