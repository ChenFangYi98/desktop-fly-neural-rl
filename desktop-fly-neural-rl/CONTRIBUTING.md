# Contributing

感谢参与 DesktopFly Neural RL。

## 开发流程

1. 从 `main` 创建功能分支。
2. 保持 FlyWire/MaleCNS 数据来源与工程假设的明确区分。
3. 新增行为或训练算法时同时增加可重复测试。
4. 在 `windows` 目录运行：

```powershell
npm install
npm test
npm run trainingpagesmoke
npm run ecosystemsmoke
npm run deploymentflowsmoke
```

5. Pull Request 中说明修改目的、测试结果、界面变化和新的建模假设。

## 研究表述

不要把工程模型描述为完整数字果蝇、真实意识、已验证生物行为或可以无验证部署的通用机器人智能。引用连接组数据时保留数据许可证和论文署名。

## 代码约定

- 浏览器与 Node 共用的核心模块放在 `windows/src/`；
- 界面代码放在 `windows/renderer/`；
- ROS 2 与物理训练工具放在 `windows/deploy/`；
- 不提交 `node_modules`、虚拟环境、训练缓存、私钥或真实机器人凭据；
- 不在模型文件中写入访问令牌、个人路径或隐私数据。

