#!/usr/bin/env python3
"""
定时给 Neo4j AuraDB 免费实例发个心跳，免得闲置 72 小时被自动暂停。

从环境变量读连接信息，连上去跑一句极小的查询就够了：
  export NEO4J_URI="neo4j+s://xxxx.databases.neo4j.io"
  export NEO4J_USER="neo4j"
  export NEO4J_PASSWORD="你的密码"
  python scripts/keepalive.py
"""
import os
import sys

from neo4j import GraphDatabase


def main():
    uri = os.environ.get("NEO4J_URI")
    user = os.environ.get("NEO4J_USER", "neo4j")
    pwd = os.environ.get("NEO4J_PASSWORD")
    if not uri or not pwd:
        sys.exit("请先设置环境变量 NEO4J_URI 和 NEO4J_PASSWORD")

    try:
        driver = GraphDatabase.driver(uri, auth=(user, pwd))
        driver.verify_connectivity()
        with driver.session() as session:
            session.run("RETURN 1").consume()
            count = session.run("MATCH (e:Entity) RETURN count(e) AS n").single()["n"]
        driver.close()
    except Exception as exc:
        sys.exit(f"心跳失败：{exc}")

    print(f"心跳成功，当前实体节点数：{count}")


if __name__ == "__main__":
    main()
