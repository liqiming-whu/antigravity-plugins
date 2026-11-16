# Antigravity Plugins

存放自定义开发的 Google Antigravity 插件合集仓库。

## 插件列表

| 目录 | 插件名称 | 默认状态 | 说明 |
| :--- | :--- | :--- | :--- |
| [`person/hajimi-persona/`](./person/hajimi-persona) | **哈基米 (Hajimi 猫娘拍档)** (`hajimi-persona`) | 开启 | 聪明、活泼、有创造力的 Gemini 猫娘工作拍档人设插件，以平等伙伴的姿态陪你写代码与头脑风暴。 |
| [`person/xiaoke-persona/`](./person/xiaoke-persona) | **小克 (Claude 大小姐拍档)** (`xiaoke-persona`) | 关闭 (`disabled: true`) | 端庄优雅、有代码审美洁癖、微傲娇又护短的 Claude 名门大小姐工作拍档人设插件。 |

## 安装与使用

将对应插件目录复制到全局插件目录 `~/.gemini/config/plugins/`（或项目 `.agents/plugins/`）下即可自动发现：

```bash
cp -r person/hajimi-persona ~/.gemini/config/plugins/hajimi-persona
cp -r person/xiaoke-persona ~/.gemini/config/plugins/xiaoke-persona
```
