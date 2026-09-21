"""ROS 2 node for a PyBullet/Stable-Baselines3 policy trained by train_physics.py.

Usage: python ros2_sb3_policy_node.py model.zip model.metadata.json
"""

from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import rclpy
from geometry_msgs.msg import PoseStamped, Twist
from rclpy.node import Node
from sensor_msgs.msg import LaserScan
from stable_baselines3 import A2C, DQN, PPO, SAC, TD3
from std_msgs.msg import Bool


ALGORITHMS = {"ppo": PPO, "sac": SAC, "td3": TD3, "a2c": A2C, "dqn": DQN}


class DeepPolicyNode(Node):
    def __init__(self, model_path: str, metadata: dict):
        super().__init__("desktop_fly_deep_embodied_policy")
        self.meta = metadata
        self.deploy = metadata["deployment"]
        self.course = metadata["course"]
        self.algorithm = metadata["algorithm"]
        self.flying = int(metadata.get("observationSize", 13)) == 16
        self.model = ALGORITHMS[self.algorithm].load(model_path)
        self.pose = None
        self.heading = 0.0
        self.velocity = np.zeros(3 if self.flying else 2, dtype=np.float32)
        self.last_position = None
        self.last_pose_time = 0.0
        self.ranges = np.ones(5, dtype=np.float32)
        self.last_action = np.zeros(3 if self.flying else 2, dtype=np.float32)
        self.emergency_stop = True
        topics = self.deploy["topics"]
        self.publisher = self.create_publisher(Twist, topics["command"], 10)
        self.create_subscription(PoseStamped, topics["pose"], self.on_pose, 10)
        self.create_subscription(LaserScan, topics["scan"], self.on_scan, 10)
        self.create_subscription(Bool, topics["emergencyStop"], self.on_estop, 10)
        self.create_timer(1.0 / float(self.deploy["timing"]["controlHz"]), self.control)
        self.get_logger().warning("Deep policy loaded; output remains stopped until live inputs and emergency_stop=false.")

    def on_pose(self, message: PoseStamped):
        now = time.monotonic()
        position = np.asarray([message.pose.position.x, message.pose.position.y, message.pose.position.z] if self.flying
            else [message.pose.position.x, message.pose.position.y], dtype=np.float32)
        if self.last_position is not None and now > self.last_pose_time:
            self.velocity = (position - self.last_position) / (now - self.last_pose_time)
        self.last_position = position.copy()
        self.pose = position
        q = message.pose.orientation
        self.heading = math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))
        self.last_pose_time = now

    def on_scan(self, message: LaserScan):
        if not message.ranges:
            return
        center = len(message.ranges) // 2
        indices = np.linspace(max(0, center - len(message.ranges) // 4), min(len(message.ranges) - 1, center + len(message.ranges) // 4), 5).astype(int)
        values = []
        for index in indices:
            value = float(message.ranges[index])
            values.append(min(3.0, value) / 3.0 if math.isfinite(value) and value > 0 else 1.0)
        self.ranges = np.asarray(values, dtype=np.float32)

    def on_estop(self, message: Bool):
        self.emergency_stop = bool(message.data)

    def stop(self):
        self.publisher.publish(Twist())

    def observation(self):
        resolution = float(self.deploy["map"]["resolutionM"])
        ox, oy = self.deploy["map"]["originM"]
        goal = self.course["goal"]
        gx, gy = ox + goal["x"] * resolution, oy + goal["y"] * resolution
        span = max(self.course["width"], self.course["height"]) * resolution
        if self.flying:
            gz = float(goal.get("z", self.meta.get("world", {}).get("goal", {}).get("z", 0))) * resolution
            return np.asarray([
                (gx - self.pose[0]) / span, (gy - self.pose[1]) / span, (gz - self.pose[2]) / span,
                self.velocity[0], self.velocity[1], self.velocity[2], math.sin(self.heading), math.cos(self.heading),
                *self.ranges, *self.last_action,
            ], dtype=np.float32)
        return np.asarray([
            (gx - self.pose[0]) / span, (gy - self.pose[1]) / span,
            self.velocity[0], self.velocity[1], math.sin(self.heading), math.cos(self.heading),
            *self.ranges, *self.last_action,
        ], dtype=np.float32)

    def control(self):
        stale = self.pose is None or time.monotonic() - self.last_pose_time > float(self.deploy["timing"]["commandTimeoutMs"]) / 1000
        if stale or self.emergency_stop or float(np.min(self.ranges[1:4])) * 3.0 < float(self.deploy["safety"]["safeDistanceM"]):
            self.last_action[:] = 0
            self.stop()
            return
        action, _ = self.model.predict(self.observation(), deterministic=True)
        if self.algorithm == "dqn":
            commands = ([(0, 0, 0), (1, 0, 0), (0.4, 1, 0), (0.4, -1, 0), (-0.4, 0, 0), (0, 0, 1), (0, 0, -1)]
                if self.flying else [(0, 0), (1, 0), (0.4, 1), (0.4, -1), (-0.4, 0)])
            values = commands[int(action)]
        else:
            values = tuple(float(value) for value in action)
        linear, angular = values[:2]
        vertical = values[2] if self.flying else 0.0
        self.last_action[:] = values
        command = Twist()
        command.linear.x = max(-0.35, linear) * float(self.deploy["safety"]["maxLinearMps"])
        command.angular.z = angular * float(self.deploy["safety"]["maxAngularRadps"])
        command.linear.z = vertical * float(self.deploy["safety"]["maxLinearMps"])
        self.publisher.publish(command)


def main():
    if len(sys.argv) < 3:
        raise SystemExit("Usage: python ros2_sb3_policy_node.py model.zip model.metadata.json")
    metadata = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    rclpy.init()
    node = DeepPolicyNode(sys.argv[1], metadata)
    try:
        rclpy.spin(node)
    finally:
        node.stop()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
