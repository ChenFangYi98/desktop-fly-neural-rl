# 安装与使用手册

本文介绍 DesktopFly Neural RL 在 Windows 上的安装、训练、生态部署、模型导出、测试和 ROS 2 机器人运行方法。

## 一 系统要求

- Windows 10 或 Windows 11 64 位；
- Node.js 20 或更高版本；
- 建议至少 8 GB 内存；
- 支持 WebGL 2 的显卡和较新的显卡驱动；
- ROS 2 部署另外需要 Python 3.10 以上和已安装的 ROS 2 环境。

项目本身约几 MB，执行 `npm install` 后 Electron 等依赖会占用更多磁盘空间。

## 二 安装桌面程序

### 方法一 使用命令行

打开 PowerShell：

```powershell
cd C:\path\to\desktop-fly-neural-rl\windows
npm install
npm start
```

如果系统提示无法识别 `npm`，请安装 Node.js LTS，关闭并重新打开 PowerShell。

### 方法二 使用启动器

首次运行仍需在 `windows` 目录执行一次 `npm install`。之后可以直接双击：

- `一键启动果蝇实验室.vbs`：完整实验室；
- `启动具身训练中心.cmd`：独立训练页面；
- `启动生态大脑观察.cmd`：生态空间、第一视角和大脑观察页面。

## 三 训练一个神经模型

1. 进入训练中心。
2. 在左侧选择地图预设，或选择完全空白场景。
3. 使用素材库放置土块、食物、任务目标、出生点、安全区和天敌。
4. 使用编辑高度或精确坐标设置素材的 Z 高度。
5. 在技能规则中选择观测和动作。
6. 添加奖励和惩罚，并设置成功、失败与最大步数。
7. 选择三因子多巴胺学习、Connectome A2C 或 Connectome PPO。
8. 设置训练回合、学习率、折扣因子和探索率。
9. 点击开始训练果蝇大脑。

训练状态会显示回合数、平均奖励、成功率、多巴胺幅度和发生变化的连接组数量。

## 四 导出和识别模型

训练完成后点击保存模型并导出备份。文件名包含唯一模型编号：

```text
DFM-YYYYMMDD-HHMMSS-XXXX
```

模型文件扩展名为 `.policy.json`，主要包含：

- 连接组指纹和数据规模；
- 训练世界与全部任务规则；
- 群体连接矩阵与学习后突触增益；
- 下降神经元策略和价值读出；
- 训练指标；
- ROS 2 安全与话题配置。

不要手工修改神经群顺序、连接组指纹或权重数组，否则部署校验可能失败。

## 五 部署到指定果蝇

1. 打开生态空间。
2. 点击选择模型文件，或载入训练页面保存的最新模型。
3. 在下拉框中选择目标果蝇。
4. 点击部署。
5. 确认状态栏显示正确模型编号、目标果蝇编号，以及应用增益的 LIF 突触数量。
6. 选择同一只果蝇作为第一视角，观察实时大脑活动、当前动作和决策计数。

生态页面只接受 `desktop-fly-neural-rl-policy` v2 神经模型。旧 Q 表模型会被拒绝，防止误认为已经部署了神经控制器。

## 六 自定义生态世界

- 鼠标拖动平移全景，右键旋转，滚轮缩放；
- 所有素材都可以使用精确 X、Y、Z 坐标放置；
- 天敌可以选择物种和捕食等级；
- 点击对象后可以删除；
- 可增加多只果蝇，并把不同模型部署到不同个体；
- 可把训练模型自带的世界同步到生态空间。

## 七 运行自动化测试

```powershell
cd windows
npm test
npm run trainingpagesmoke
npm run ecosystemsmoke
npm run deploymentflowsmoke
```

其中 `deploymentflowsmoke` 会完整验证训练、保存、载入、选择果蝇、突触映射和运行时决策。

## 八 ROS 2 部署

```powershell
cd windows\deploy
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-robot.txt
python ros2_policy_node.py C:\path\to\model.policy.json
```

运行时订阅 `PoseStamped`、`LaserScan` 和 `Bool` 急停消息，输出 `Twist`。具体话题名、坐标分辨率、速度限制和安全距离来自模型部署配置。

真机首次测试必须：

- 使用独立硬件急停；
- 限制线速度和角速度；
- 支起轮子、抬起腿或断开执行器检查方向；
- 验证定位丢失、雷达过近和命令超时时自动停车；
- 只在封闭、低速、无人员环境测试。

## 九 常见问题

### 页面黑屏或三维画面异常

更新显卡驱动，确认系统支持 WebGL 2。远程桌面环境可能禁用硬件加速。

### 训练按钮不可用

检查 `data/circuit.json` 和 `data/locomotor_circuit.json` 是否存在且完整。页面顶部应显示 668 神经元、18,968 条边和 1,045 个 MaleCNS 神经元。

### 模型无法部署

确认文件是新版神经模型，且连接组指纹和本机数据一致。旧式开放 Q 表策略不能作为果蝇大脑部署。

### 模型已部署但行为不理想

查看评估成功率、奖励趋势和碰撞次数。检查任务目标是否可达、奖励是否互相冲突、回合长度是否足够，并增加随机种子重复实验。

### npm install 失败

删除失败产生的 `windows/node_modules` 后重新执行 `npm install`，并确认网络和 Node.js 版本正常。不要把 `node_modules` 提交到 GitHub。

## 十 许可证

源代码采用 MIT License。FlyWire 派生数据采用 CC BY-NC 4.0，仅限署名、非商业使用；MaleCNS 派生数据采用 CC BY 4.0。完整条款见仓库的 `LICENSE`、`data/DATA_LICENSE.md` 和 `data/LOCOMOTOR_PROVENANCE.md`。

