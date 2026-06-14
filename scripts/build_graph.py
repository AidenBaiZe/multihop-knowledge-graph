#!/usr/bin/env python3
"""
将 2WikiMultihopQA 的 dev.json 导入 Neo4j（AuraDB），构建知识图谱。

图模型：
  (:Entity {name})                      实体节点（evidences 中的主语 / 宾语）
  (:Entity)-[:REL {type}]->(:Entity)    关系边，关系名存在 type 属性里
  (:Question {id,type,question,answer,evidences})  问题节点
  (:Question)-[:MENTIONS]->(:Entity)    问题关联到它证据里出现的实体

使用方法：
  export NEO4J_URI="neo4j+s://xxxx.databases.neo4j.io"
  export NEO4J_USER="neo4j"
  export NEO4J_PASSWORD="你的密码"
  python scripts/build_graph.py dev.json
"""
import json
import os
import sys
import time

from neo4j import GraphDatabase

BATCH = 5000


def load_data(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_rows(data):
    """从原始数据里抽出关系边和问题两类记录。"""
    edge_rows = []
    seen_edge = set()
    q_rows = []
    for item in data:
        ev = item.get("evidences", []) or []
        ent_in_q = set()
        for triple in ev:
            if len(triple) != 3:
                continue
            s, r, o = triple
            if not s or not o or not r:
                continue
            s, o, r = s.strip(), o.strip(), r.strip()
            ent_in_q.add(s)
            ent_in_q.add(o)
            key = (s, r, o)
            if key in seen_edge:
                continue
            seen_edge.add(key)
            edge_rows.append({"s": s, "r": r, "o": o})
        q_rows.append(
            {
                "id": item["_id"],
                "type": item.get("type", ""),
                "question": item.get("question", ""),
                "answer": item.get("answer", ""),
                "evidences_json": json.dumps(ev, ensure_ascii=False),
                "facts": sorted(ent_in_q),
            }
        )
    return edge_rows, q_rows


def setup_schema(session):
    stmts = [
        "CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE",
        "CREATE CONSTRAINT question_id IF NOT EXISTS FOR (q:Question) REQUIRE q.id IS UNIQUE",
        "CREATE FULLTEXT INDEX entity_ft IF NOT EXISTS FOR (e:Entity) ON EACH [e.name]",
        "CREATE FULLTEXT INDEX question_ft IF NOT EXISTS FOR (q:Question) ON EACH [q.question, q.answer]",
    ]
    for s in stmts:
        session.run(s)
    print("约束与全文索引已就绪")


EDGE_CYPHER = """
UNWIND $rows AS row
MERGE (s:Entity {name: row.s})
MERGE (o:Entity {name: row.o})
MERGE (s)-[rel:REL {type: row.r}]->(o)
"""

QUESTION_CYPHER = """
UNWIND $rows AS row
MERGE (q:Question {id: row.id})
SET q.type = row.type,
    q.question = row.question,
    q.answer = row.answer,
    q.evidences = row.evidences_json
WITH q, row
UNWIND row.facts AS fact
MERGE (e:Entity {name: fact})
MERGE (q)-[:MENTIONS]->(e)
"""


def run_batched(session, cypher, rows, label):
    total = len(rows)
    for i in range(0, total, BATCH):
        chunk = rows[i : i + BATCH]
        session.run(cypher, rows=chunk)
        print(f"  {label}: {min(i + BATCH, total)}/{total}")


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "dev.json"
    uri = os.environ.get("NEO4J_URI")
    user = os.environ.get("NEO4J_USER", "neo4j")
    pwd = os.environ.get("NEO4J_PASSWORD")
    if not uri or not pwd:
        sys.exit("请先设置环境变量 NEO4J_URI 和 NEO4J_PASSWORD")

    print(f"读取数据：{path}")
    data = load_data(path)
    print(f"共 {len(data)} 条问答")
    edge_rows, q_rows = build_rows(data)
    print(f"待导入：关系边 {len(edge_rows)} 条，问题 {len(q_rows)} 个")

    driver = GraphDatabase.driver(uri, auth=(user, pwd))
    driver.verify_connectivity()
    print("已连接 Neo4j")

    t0 = time.time()
    with driver.session() as session:
        setup_schema(session)
        print("导入关系边……")
        run_batched(session, EDGE_CYPHER, edge_rows, "边")
        print("导入问题节点……")
        run_batched(session, QUESTION_CYPHER, q_rows, "问题")

        counts = session.run(
            "MATCH (e:Entity) WITH count(e) AS ent "
            "MATCH ()-[r:REL]->() WITH ent, count(r) AS rel "
            "MATCH (q:Question) RETURN ent, rel, count(q) AS ques"
        ).single()
        print(
            f"完成：实体 {counts['ent']}，关系 {counts['rel']}，问题 {counts['ques']}"
        )
    driver.close()
    print(f"耗时 {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
