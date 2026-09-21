"""ROS 2 runtime for a DesktopFly exported embodied-policy JSON package.

Usage:
    python ros2_policy_node.py path/to/exported-policy.json

Requires ROS 2 Python packages: rclpy, geometry_msgs, sensor_msgs, std_msgs.
Test the action mapping with the robot lifted or wheels disabled, keep a
physical emergency stop available, then increase speed limits gradually.
"""

from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import rclpy
from geometry_msgs.msg import PoseStamped, Twist
from rclpy.node import Node
from sensor_msgs.msg import LaserScan
from std_msgs.msg import Bool


class PolicyRuntime:
    def __init__(self, manifest: dict):
        self.manifest = manifest
        self.neural = manifest.get("kind") == "desktop-fly-neural-rl-policy"
        self.open = manifest.get("kind") == "desktop-fly-open-rl-policy" or self.neural
        world = manifest.get("world", {})
        size = world.get("size", {})
        self.course = manifest.get("course", {"width": size.get("x", 0), "height": size.get("y", 0)})
        self.policy = manifest["policy"]
        self.config = manifest.get("config", manifest.get("experiment", {}))
        self.deploy = manifest["deployment"]
        self.volumetric = manifest.get("kind") == "desktop-fly-volumetric-policy"
        if self.neural:
            plasticity = manifest.get("plasticity", {})
            self.neural_groups = plasticity.get("groups", [])
            self.neural_n = len(self.neural_groups)
            self.neural_state = [0.0] * self.neural_n
            self.neural_base = plasticity.get("baseWeights", [])
            if len(self.neural_base) != self.neural_n * self.neural_n:
                raise ValueError("Neural policy is missing the exported connectome population matrix")
            self.neural_gain = [1.0] * (self.neural_n * self.neural_n)
            for key, value in plasticity.get("gains", {}).items():
                pre, post = (int(part) for part in key.split(":"))
                self.neural_gain[pre * self.neural_n + post] = float(value)
            self.neural_output = [self.neural_groups.index(name) for name in self.policy.get("featureOrder", [])]

    def cell(self, world_x: float, world_y: float, world_z: float = 0.0) -> tuple[int, ...] | None:
        resolution = float(self.deploy["map"]["resolutionM"])
        ox, oy = self.deploy["map"]["originM"]
        x = round((world_x - ox) / resolution)
        y = round((world_y - oy) / resolution)
        if x < 0 or y < 0 or x >= self.course["width"] or y >= self.course["height"]:
            return None
        if self.open:
            z = round(world_z / resolution)
            if z < 0 or z >= self.manifest["world"]["size"]["z"]:
                return None
            return x, y, z
        if self.volumetric:
            world = self.manifest["world"]
            z = round(world_z / resolution)
            if z < 0 or z >= world["height"]:
                return None
            return x, y, z
        return x, y

    def action(self, world_x: float, world_y: float, world_z: float = 0.0) -> dict | None:
        cell = self.cell(world_x, world_y, world_z)
        if cell is None:
            return None
        if self.open:
            if self.neural:
                return self.neural_action(cell)
            state = self.open_state(cell)
            actions = self.manifest["actions"]
            q = self.policy.get("q", {}).get(state, [0.0] * len(actions))
            q2 = self.policy.get("q2", {}).get(state, [])
            actor = self.policy.get("actor", {}).get(state, [])
            if self.config.get("algorithm") in {"ppo", "a2c", "discrete-sac"}:
                values = [(actor[i] if i < len(actor) else 0.0) + (q[i] if i < len(q) else 0.0) * 0.35 for i in range(len(actions))]
            else:
                values = [(q[i] if i < len(q) else 0.0) + ((q2[i] if i < len(q2) else 0.0) if self.config.get("algorithm") == "double-q" else 0.0) for i in range(len(actions))]
            index = max(range(len(actions)), key=lambda i: values[i])
            return self.deploy["actionSchema"][index]
        x, y = cell[:2]
        action_count = 6 if self.volumetric else 4
        if self.volumetric:
            z = cell[2]
            offset = ((z * self.manifest["world"]["depth"] + y) * self.manifest["world"]["width"] + x) * action_count
        else:
            offset = (y * self.course["width"] + x) * action_count
        if self.config["algorithm"] in {"ppo", "a2c", "discrete-sac"}:
            values = [value + self.policy["q"][i] * 0.35 for i, value in enumerate(self.policy["actor"])]
        else:
            q = self.policy["q"]
            q2 = self.policy.get("q2", [])
            values = [v + (q2[i] if i < len(q2) else 0.0) for i, v in enumerate(q)]
        index = max(range(action_count), key=lambda i: values[offset + i])
        return self.deploy["actionSchema"][index]

    def neural_action(self, cell: tuple[int, int, int]) -> dict:
        """Run the exported connectome population controller.

        This is the portable robot inference path. The desktop ecology uses the
        higher-frequency 668-neuron LIF + MaleCNS runtime; on hardware the
        robot-specific Twist adapter replaces biological muscles.
        """
        x, y, z = cell
        world = self.manifest["world"]
        size = world["size"]
        entities = [item for item in world.get("entities", []) if item.get("enabled", True)]

        def nearest(entity_type: str):
            candidates = [item["position"] for item in entities if item.get("type") == entity_type]
            if not candidates:
                return None, math.inf
            point = min(candidates, key=lambda p: abs(p["x"]-x)+abs(p["y"]-y)+abs(p.get("z", 0)-z))
            return point, abs(point["x"]-x)+abs(point["y"]-y)+abs(point.get("z", 0)-z)

        drive = [0.0] * self.neural_n

        def add_vector(point, scale):
            if point is None:
                return
            values = [(point["x"]-x)/size["x"], (x-point["x"])/size["x"],
                      (point["y"]-y)/size["y"], (y-point["y"])/size["y"],
                      (point.get("z", 0)-z)/size["z"], (z-point.get("z", 0))/size["z"]]
            for i, value in enumerate(values):
                drive[i] += max(0.0, value) * scale

        goal, _ = nearest("goal")
        food, _ = nearest("food")
        predator, predator_distance = nearest("predator")
        observations = self.manifest["experiment"].get("observations", [])
        if "goalVector" in observations:
            add_vector(goal, 1.15)
        if "foodVector" in observations:
            add_vector(food, 0.75)
        if "predatorVector" in observations and predator is not None:
            add_vector(predator, 0.45)
            closeness = max(0.0, min(1.0, 1.0-predator_distance/max(size["x"], size["y"])))
            side = "loom-left" if predator["x"] < x else "loom-right"
            drive[self.neural_groups.index(side)] += closeness * 1.4

        config = self.manifest.get("plasticity", {}).get("config", {})
        for _ in range(int(config.get("propagationSteps", 4))):
            next_state = [0.0] * self.neural_n
            for post in range(self.neural_n):
                net = drive[post] * 1.7 + 0.008
                for pre in range(self.neural_n):
                    index = pre * self.neural_n + post
                    net += self.neural_state[pre] * self.neural_base[index] * self.neural_gain[index]
                firing = max(0.0, math.tanh(net))
                next_state[post] = self.neural_state[post] * 0.42 + firing * 0.58
            self.neural_state = next_state

        features = [self.neural_state[index] for index in self.neural_output]
        actions = self.manifest["actions"]
        readout = self.policy["readout"]
        bias = self.policy["bias"]
        feature_count = len(features)
        logits = [bias[action] + sum(readout[action*feature_count+i]*value for i, value in enumerate(features))
                  for action in range(len(actions))]
        index = max(range(len(actions)), key=lambda i: logits[i])
        return self.deploy["actionSchema"][index]

    def open_state(self, cell: tuple[int, int, int]) -> str:
        """Build the same sparse observation key used by the browser trainer.

        Dynamic predator/food perception can be supplied by a downstream sensor
        adapter. The base ROS runtime uses the configured scene entities.
        """
        x, y, z = cell
        experiment = self.manifest["experiment"]
        entities = [item for item in self.manifest["world"].get("entities", []) if item.get("enabled", True)]

        def nearest(entity_type: str):
            candidates = [item for item in entities if item.get("type") == entity_type]
            if not candidates:
                return None, math.inf
            return min(candidates, key=lambda item: abs(item["position"]["x"] - x) + abs(item["position"]["y"] - y) + abs(item["position"].get("z", 0) - z)), min(
                abs(item["position"]["x"] - x) + abs(item["position"]["y"] - y) + abs(item["position"].get("z", 0) - z) for item in candidates)

        def sign(value):
            return 1 if value > 0 else -1 if value < 0 else 0

        parts = [f"{x},{y},{z}"]
        observations = experiment.get("observations", [])
        if "goalVector" in observations:
            item, distance = nearest("goal")
            position = item["position"] if item else {"x": x, "y": y, "z": z}
            parts.append(f"g{sign(position['x']-x)},{sign(position['y']-y)},{sign(position.get('z', z)-z)},{min(4, distance)}")
        if "predatorVector" in observations:
            item, distance = nearest("predator")
            position = item["position"] if item else None
            parts.append(f"p{sign(position['x']-x) if position else 0},{sign(position['y']-y) if position else 0},{min(5, distance)}")
        if "foodVector" in observations:
            item, distance = nearest("food")
            position = item["position"] if item else None
            parts.append(f"f{sign(position['x']-x) if position else 0},{sign(position['y']-y) if position else 0},{min(5, distance)}")
        if "time" in observations:
            parts.append("t0")
        return "|".join(parts)


class EmbodiedPolicyNode(Node):
    def __init__(self, manifest: dict):
        super().__init__("desktop_fly_embodied_policy")
        self.runtime = PolicyRuntime(manifest)
        deploy = manifest["deployment"]
        topics = deploy["topics"]
        self.command_timeout = float(deploy["timing"]["commandTimeoutMs"]) / 1000.0
        self.safe_distance = float(deploy["safety"]["safeDistanceM"])
        self.pose = None
        self.heading = 0.0
        self.pose_time = 0.0
        self.front_range = math.inf
        self.emergency_stop = True
        self.publisher = self.create_publisher(Twist, topics["command"], 10)
        self.create_subscription(PoseStamped, topics["pose"], self.on_pose, 10)
        self.create_subscription(LaserScan, topics["scan"], self.on_scan, 10)
        self.create_subscription(Bool, topics["emergencyStop"], self.on_emergency_stop, 10)
        self.create_timer(1.0 / float(deploy["timing"]["controlHz"]), self.control)
        self.get_logger().warning("Policy loaded. Output stays stopped until emergency_stop topic is false and pose/scan are live.")

    def on_pose(self, message: PoseStamped):
        self.pose = message.pose.position
        q = message.pose.orientation
        self.heading = math.atan2(2.0 * (q.w * q.z + q.x * q.y), 1.0 - 2.0 * (q.y * q.y + q.z * q.z))
        self.pose_time = time.monotonic()

    def on_scan(self, message: LaserScan):
        if not message.ranges:
            self.front_range = math.inf
            return
        center = len(message.ranges) // 2
        window = message.ranges[max(0, center - 4):min(len(message.ranges), center + 5)]
        finite = [value for value in window if math.isfinite(value) and value > 0]
        self.front_range = min(finite, default=math.inf)

    def on_emergency_stop(self, message: Bool):
        self.emergency_stop = bool(message.data)

    def stop(self):
        self.publisher.publish(Twist())

    def control(self):
        stale = self.pose is None or time.monotonic() - self.pose_time > self.command_timeout
        if stale or self.emergency_stop or self.front_range < self.safe_distance:
            self.stop()
            return
        action = self.runtime.action(self.pose.x, self.pose.y, self.pose.z)
        if action is None:
            self.stop()
            return
        command = Twist()
        desired_heading = float(action["desiredHeadingRad"])
        heading_error = math.atan2(math.sin(desired_heading - self.heading), math.cos(desired_heading - self.heading))
        max_linear = float(self.runtime.deploy["safety"]["maxLinearMps"])
        max_angular = float(self.runtime.deploy["safety"]["maxAngularRadps"])
        vertical = float(action.get("linearZ", 0.0))
        command.angular.z = 0.0 if vertical else max(-max_angular, min(max_angular, heading_error * 1.8))
        command.linear.x = 0.0 if vertical or abs(heading_error) > 1.25 else max_linear * max(0.0, math.cos(heading_error))
        command.linear.z = vertical * max_linear
        self.publisher.publish(command)


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python ros2_policy_node.py exported-policy.json")
    manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if "deployment" not in manifest:
        raise SystemExit("Policy JSON has no deployment profile. Export it again from the training center.")
    rclpy.init()
    node = EmbodiedPolicyNode(manifest)
    try:
        rclpy.spin(node)
    finally:
        node.stop()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
