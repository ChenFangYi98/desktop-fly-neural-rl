# GitHub 发布说明

开源压缩包已经排除 `node_modules`、缓存、日志、临时渲染文件和训练导出的个人模型。

## 使用 GitHub 网页发布

1. 登录 GitHub，点击 New repository。
2. 仓库名建议填写 `desktop-fly-neural-rl`。
3. 描述建议填写：

```text
Connectome constrained fruit fly embodied reinforcement learning lab with editable 3D ecology FlyWire MaleCNS and ROS 2 deployment
```

4. 选择 Public。
5. 不要勾选自动创建 README、许可证或 `.gitignore`，压缩包内已经包含。
6. 创建仓库后选择 uploading an existing file。
7. 解压本项目 ZIP，把解压后的全部文件拖入上传区域。
8. 提交说明填写 `Initial open source release`。
9. 上传完成后，在仓库 About 中添加主题：

```text
reinforcement-learning embodied-ai connectome drosophila flywire malecns electron threejs ros2 neuroscience
```

10. 在 Releases 中创建 `v1.1.0-neural-rl`，可同时上传原始 ZIP 作为 Source package。

## 使用 Git 命令发布

```powershell
cd desktop-fly-neural-rl
git init -b main
git add .
git commit -m "Initial open source release"
git remote add origin https://github.com/YOUR_NAME/desktop-fly-neural-rl.git
git push -u origin main
```

把 `YOUR_NAME` 替换为自己的 GitHub 用户名。推送前运行：

```powershell
git status
git diff --cached --stat
```

确认没有 `node_modules`、访问令牌、私钥、个人训练模型或本机隐私文件。

## 发布后建议

- 把 GitHub 地址加入 `README.zh-CN.md` 和微信公众号文末；
- 开启 Issues；
- 添加项目截图到仓库 Social preview；
- 在首个 Release 中说明数据许可证不是 MIT；
- 不要把 FlyWire CC BY-NC 4.0 数据用于未经授权的商业分发。

