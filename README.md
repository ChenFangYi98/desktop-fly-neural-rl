# desktop-fly-neural-rl
果蝇大脑连接组装进了三维世界
# DesktopFly Neural RL｜果蝇连接组具身强化学习实验室

> 在可编辑的三维生态中，用奖励信号训练连接组约束的果蝇神经控制器，再把模型部署到指定果蝇或 ROS 2 机器人。

<img width="1304" height="755" alt="ecosystem-brain" src="https://github.com/user-attachments/assets/6373561e-6b59-4971-8847-0760c124c7fd" />


## 项目简介

DesktopFly Neural RL 是一个面向研究、教学和原型验证的开源具身智能项目。它把三部分放在同一个可运行工程中：

- FlyWire v783 派生的 668 神经元、18,968 条有符号连接；
- MaleCNS 派生的 1,045 神经元、17,224 条运动连接；
- 可完全编辑的三维世界、强化学习任务、生态运行和模型部署。

训练不再使用 Q 表直接控制果蝇。环境观测首先进入感觉神经群，活动沿连接组传播，策略只读取下降神经元活动；奖励形成 TD 多巴胺信号，并通过“三因子学习”更新局部资格迹对应的连接组增益。

## 主要能力

- 类 Minecraft 的三维体素地图：地形、土块、食物、任务目标、出生点、危险区和天敌都可放置到任意高度。
- 完全开放的任务定义：自由组合观测、动作、奖励、惩罚和终止条件。
- 三种神经强化学习模式：三因子多巴胺学习、Connectome A2C、Connectome PPO。
- 多种天敌与等级：青蛙、蜘蛛、螳螂拥有不同的移动、伏击和捕食能力。
- 明确的模型编号和连接组指纹：可确认模型是否部署、部署到了哪只果蝇、多少突触应用了学习增益。
- 生态与大脑同屏：第一视角跟随哪只果蝇，实时大脑就显示同一只果蝇的神经活动。
- ROS 2 导出：群体连接组运行时输出 `Twist`，包含超时停车、雷达安全距离和急停接口。

<img width="1304" height="755" alt="training-studio" src="https://github.com/user-attachments/assets/c080784a-3ee9-4f97-ae9a-907f43cbec57" />


## 哪些是真实数据，哪些是工程模型

| 内容                                   | 状态                               |
| -------------------------------------- | ---------------------------------- |
| 神经元身份、位置、连接和突触计数       | 来自公开连接组数据的派生子图       |
| FlyWire 668 神经元及 18,968 条有符号边 | 真实拓扑，LIF 动力学为模型         |
| MaleCNS 1,045 神经元及 17,224 条边     | 真实拓扑，肌肉与身体动力学为模型   |
| 强化学习                               | 真实执行 TD 奖励与资格迹更新       |
| 感觉编码                               | 工程适配器，不是完整生物感受器模型 |
| 可塑性                                 | 同一神经群之间的真实边共享可塑增益 |
| 身体、飞行和机器人接口                 | 工程模型                           |

本项目不是完整数字果蝇，也不能证明获得了生物意义上的智能或意识。详细边界见 [EVALUATION.md](EVALUATION.md) 和 [架构说明](docs/ARCHITECTURE.zh-CN.md)。

## Windows 快速开始

环境要求：Windows 10/11、Node.js 20 或更高版本。

```powershell
cd windows
npm install
npm start
```

也可以直接双击：

- `一键启动果蝇实验室.vbs`：启动完整实验室；
- `启动具身训练中心.cmd`：只启动训练项目；
- `启动生态大脑观察.cmd`：只启动生态与大脑观察。

更完整的安装、故障排查和部署步骤见 [安装与使用手册](docs/INSTALL.zh-CN.md)。准备上传 GitHub 时见 [GitHub 发布说明](docs/GITHUB_PUBLISH.zh-CN.md)。

## 训练并部署一只果蝇

1. 在“世界与素材”中选择地图，或从空白场景开始。
2. 放置出生点、任务目标、食物、障碍、危险区和天敌；X/Y/Z 坐标均可编辑。
3. 在“技能规则”中选择观测和动作，添加任意数量的奖励与惩罚规则。
4. 在“强化学习”中选择算法，设置回合数、学习率、折扣因子和探索率。
5. 完成训练后记录 `DFM-日期-时间-随机码` 模型编号并导出模型。
6. 打开生态空间，选择模型文件和目标果蝇，点击部署。
7. 确认页面显示“已部署”以及应用学习增益的 LIF 突触数量。

导出模型包含世界、任务、指标、连接组指纹、群体矩阵、突触增益、下降神经元读出和机器人安全配置。

## ROS 2 机器人部署

完整说明见 [windows/deploy/README.zh-CN.md](windows/deploy/README.zh-CN.md)。最小运行方式：

```powershell
cd windows\deploy
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-robot.txt
python ros2_policy_node.py C:\path\to\DFM-model.policy.json
```

真机测试前必须校准坐标和单位，支起驱动轮或断开执行器验证动作方向，并使用独立硬件急停。不要在人、动物或开放道路附近进行首次测试。

## 测试

```powershell
cd windows
npm test
npm run trainingpagesmoke
npm run ecosystemsmoke
npm run deploymentflowsmoke
```

测试覆盖神经回路、行为、MaleCNS、身体动力学、三维世界、神经可塑性、模型导出和指定果蝇部署。

## 项目结构

```text
data/                    FlyWire 与 MaleCNS 派生数据及许可证
docs/                    架构、截图和公众号文章
windows/src/             神经仿真、强化学习、世界与部署核心
windows/renderer/        训练与生态界面
windows/deploy/          ROS 2 与 PyBullet 工具
windows/test/            自动化与端到端测试
*.swift                  原始 macOS DesktopFly 实现
```

## 数据、许可证与署名

- 源代码采用 [MIT License](LICENSE)。
- `data/brain_points.json` 与 `data/circuit.json` 来源于 FlyWire 派生数据，采用 **CC BY-NC 4.0**，只允许署名、非商业使用。
- MaleCNS 派生文件采用 **CC BY 4.0**。
- 详细来源、论文引用和哈希见 [data/DATA_LICENSE.md](data/DATA_LICENSE.md) 与 [data/LOCOMOTOR_PROVENANCE.md](data/LOCOMOTOR_PROVENANCE.md)。

由于仓库包含非商业数据，不能把整个仓库简单理解为“可任意商用”。商业项目应移除受限数据并自行取得相应授权。

## 参与贡献

欢迎提交问题、实验场景、传感器适配器、训练算法和机器人驱动。提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [SECURITY.md](SECURITY.md)。

## 致谢

项目建立在 DesktopFly、FlyWire、MaleCNS、Three.js、Electron 和 ROS 2 等工作之上。连接组强化学习设计参考了 FlyDoom 中“固定连接拓扑、下降神经元读出、资格迹 × 多巴胺”的研究方向，并针对桌面实时运行进行了群体化实现。
