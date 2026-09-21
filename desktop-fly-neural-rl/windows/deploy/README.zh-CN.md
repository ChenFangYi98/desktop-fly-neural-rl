# 从 3D 场景训练到现实机器人

训练中心提供两条路径：

1. 页面内连接组强化学习：地图、方块、食物、天敌、观测、动作、目标、终止条件及每条奖惩都可修改；感觉输入经过连接组群体网络，策略只读取下降神经元活动，导出包包含多巴胺三因子学习得到的突触增益。
2. PyBullet 深度强化学习：直接读取同一份开放式部署包，使用 Stable-Baselines3 的 PPO、SAC、TD3、A2C 或 DQN 进行带动力学和领域随机化的训练。

## 训练深度策略

在训练中心完成场景编辑和部署自检，然后点击“导出部署包”。在本目录执行：

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-robot.txt
python train_physics.py C:\path\to\scene.json --algorithm ppo --steps 500000
```

可用 `--render` 打开 PyBullet 画面。正式训练建议不加该参数以提高速度，并至少更换 3 个随机种子重复验证。

## ROS 2 部署

连接组神经策略（或旧式离散策略）：

```powershell
python ros2_policy_node.py C:\path\to\scene.json
```

PyBullet 深度策略：

```powershell
python ros2_sb3_policy_node.py model.zip model.metadata.json
```

默认接口是 `PoseStamped` 位姿、`LaserScan` 雷达、`Bool` 急停和 `Twist` 速度控制。话题名、地图分辨率、原点、速度上限、安全距离和超时均写入训练包。神经模型在 ROS 2 端执行导出的连接组群体矩阵、学习后的突触增益和下降神经元读出；生态页则运行更细的 668 神经元 LIF + MaleCNS。机器人本体的电机/飞控适配器取代果蝇的 MaleCNS 肌肉执行端。选择“微型无人机”时会保留上下动作并输出 `Twist.linear.z`。若任务启用了动态天敌、食物或视觉目标感知，仍需把相机检测结果接入 `sensorContract`；静态目标可直接使用导出场景实体。

## 真机前必须完成

- 校准训练地图坐标和机器人定位坐标；确认米、弧度以及坐标轴方向。
- 支起驱动轮或让腿离地，逐项验证动作方向。
- 使用独立的物理急停；软件急停不能替代硬件安全回路。
- 先在封闭、低速、无人员区域测试，再逐步提高速度。
- 采集真机失败样本，加入领域随机化范围并重新训练。

通用运行时已经覆盖平面机器人和基于速度接口的微型无人机三维控制。机械臂、相机端到端视觉、特定飞控协议以及四足关节力矩控制，仍需要根据实际硬件增加专用观测、坐标系和动作适配器；部署包中的安全上限不能替代飞控/机器人本体的硬件保护。
