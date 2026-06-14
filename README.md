# 多跳知识图谱 · 查询与可视化

基于 [2WikiMultihopQA](https://github.com/Alab-NII/2wikimultihop) 数据集，用 **Neo4j 图数据库** 管理多跳问答中的实体关系，并提供一个托管在 GitHub Pages 的网页，支持多跳查询、关键词检索、简单聚类和可视化。

## 在线体验

部署后访问：`https://<用户名>.github.io/<仓库名>/`

> 网页通过浏览器端的 `neo4j-driver` 直连 Neo4j AuraDB 云实例。免费实例仅用于课程演示，闲置一段时间会自动暂停，可在 [Neo4j Console](https://console.neo4j.io) 一键恢复。
>
> 为了减少手动恢复的麻烦，仓库里加了个 [`keepalive`](.github/workflows/keepalive.yml) 定时任务，每天给数据库发一次心跳，避免它因闲置 72 小时被自动暂停。

## 数据与图模型

数据来自 `dev.json`（约 1.26 万条多跳问答）。其中的 `evidences` 字段是形如 `[主语, 关系, 宾语]` 的三元组，天然构成一张知识图谱。

| 元素 | 说明 |
| --- | --- |
| `(:Entity {name})` | 实体节点，对 `name` 建唯一约束 |
| `(:Entity)-[:REL {type}]->(:Entity)` | 关系边，关系名（如 director、mother）存在 `type` 属性 |
| `(:Question {id,type,question,answer,evidences})` | 问题节点 |
| `(:Question)-[:MENTIONS]->(:Entity)` | 问题关联到其证据涉及的实体 |

并建立两个全文索引 `entity_ft`、`question_ft` 用于检索。

## 功能

- **多跳查询**：以某实体为起点做 1–4 跳变长路径遍历；两实体间最短路径；双击节点可继续向外展开。
- **检索**：基于全文索引的实体 / 问题关键词搜索，点击即载入图谱。
- **问题证据链**：选定一个多跳问题，展示其逐跳推理链路。
- **简单聚类**：对当前子图做社区发现（标签传播）、连通分量，或按关系类型着色。
- **可视化**：力导向交互图谱 + 关系类型、问题类型分布统计图。

## 本地导入数据

1. 在 [Neo4j Console](https://console.neo4j.io) 创建一个 AuraDB Free 实例，记下连接 URI 与密码。
2. 安装依赖并导入：

```bash
pip install -r requirements.txt
export NEO4J_URI="neo4j+s://xxxx.databases.neo4j.io"
export NEO4J_USER="neo4j"
export NEO4J_PASSWORD="你的密码"
python scripts/build_graph.py dev.json
```

3. 把同一组连接信息填入 [`config.js`](config.js)，前端即可连库查询。

## 目录结构

```
index.html          页面结构
style.css           样式
app.js              查询 / 检索 / 聚类 / 可视化逻辑
config.js           Neo4j 连接配置
scripts/build_graph.py   数据导入脚本
requirements.txt    Python 依赖
```

## 技术栈

Neo4j AuraDB · neo4j-driver · vis-network · Chart.js · GitHub Pages
