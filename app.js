"use strict";

let driver = null;
let network = null;
const gNodes = new vis.DataSet([]);
const gEdges = new vis.DataSet([]);
const edgeSet = new Set();

const PALETTE = [
  "#6c8cff", "#46d5b3", "#ffb84d", "#ff6b6b", "#b98bff",
  "#4dd2ff", "#ff8fd0", "#9bd14d", "#ff9f6b", "#7ad1c0",
  "#c0c4ff", "#f5d36b",
];

/* ---------- 基础工具 ---------- */
function $(id) {
  return document.getElementById(id);
}

function toast(msg, isErr) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (isErr ? " err" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 3200);
}

function setStatus(state, text) {
  const dot = $("status-dot");
  dot.className = "dot" + (state ? " " + state : "");
  $("status-text").textContent = text;
}

/* ---------- 连接 ---------- */
async function connect() {
  const cfg = window.NEO4J_CONFIG || {};
  if (!cfg.uri || cfg.uri.includes("REPLACE_WITH")) {
    setStatus("err", "未配置");
    toast("请先在 config.js 填写 AuraDB 连接信息", true);
    return;
  }
  setStatus("", "连接中…");
  try {
    if (driver) await driver.close();
    driver = neo4j.driver(cfg.uri, neo4j.auth.basic(cfg.user, cfg.password), {
      maxConnectionPoolSize: 10,
    });
    await driver.verifyConnectivity();
    setStatus("ok", "已连接");
    toast("已连接到 AuraDB");
    initRelationFilter();
    loadDemo();
    initAllQuestions();
  } catch (e) {
    setStatus("err", "连接失败");
    toast("连接失败：" + (e.message || e), true);
  }
}

async function run(cypher, params) {
  if (!driver) throw new Error("尚未连接数据库");
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const res = await session.run(cypher, params || {});
    return res.records;
  } finally {
    await session.close();
  }
}

/* ---------- 图渲染 ---------- */
function ensureNetwork() {
  if (network) return;
  network = new vis.Network(
    $("graph"),
    { nodes: gNodes, edges: gEdges },
    {
      nodes: {
        shape: "dot",
        size: 14,
        color: { background: "#6c8cff", border: "#9bb0ff" },
        font: { color: "#e7e9f3", size: 13, face: "PingFang SC" },
      },
      edges: {
        arrows: { to: { enabled: true, scaleFactor: 0.5 } },
        color: { color: "#3a4068", highlight: "#6c8cff" },
        font: { color: "#9aa0c0", size: 11, strokeWidth: 0, align: "middle" },
        smooth: { type: "dynamic" },
      },
      physics: {
        stabilization: { iterations: 120 },
        barnesHut: { gravitationalConstant: -8000, springLength: 130 },
      },
      interaction: { hover: true, tooltipDelay: 120 },
    }
  );
  network.on("click", (p) => {
    if (p.nodes.length) showNodeDetail(p.nodes[0]);
    else $("node-detail").classList.add("hidden");
  });
  network.on("doubleClick", (p) => {
    if (p.nodes.length) expandNode(p.nodes[0]);
  });
}

function addNode(name, opts) {
  if (!gNodes.get(name)) {
    gNodes.add(Object.assign({ id: name, label: name }, opts || {}));
  } else if (opts) {
    gNodes.update(Object.assign({ id: name }, opts));
  }
}

function addEdge(a, b, type) {
  const id = a + "||" + type + "||" + b;
  if (edgeSet.has(id)) return;
  edgeSet.add(id);
  addNode(a);
  addNode(b);
  gEdges.add({ id, from: a, to: b, label: type, title: type });
  updateEmptyState();
}

function clearGraph() {
  gNodes.clear();
  gEdges.clear();
  edgeSet.clear();
  updateEmptyState();
}

function updateEmptyState() {
  const el = document.getElementById("graph-empty");
  if (el) el.style.display = gEdges.length ? "none" : "flex";
}

async function loadDemo() {
  if (gEdges.length) return;
  try {
    const hub = await run(
      "MATCH (e:Entity)-[r:REL]-() WITH e, count(r) AS d " +
        "ORDER BY d DESC LIMIT 1 RETURN e.name AS name, d"
    );
    if (hub.length) {
      const name = hub[0].get("name");
      const degree = hub[0].get("d").toNumber();
      let rows = await run(
        "MATCH (s:Entity {name:$name})-[r:REL]-(t) " +
          "RETURN DISTINCT startNode(r).name AS a, endNode(r).name AS b, r.type AS type LIMIT 150",
        { name }
      );
      if (rows.length < 30) {
        rows = await run(
          "MATCH p=(s:Entity {name:$name})-[:REL*1..2]-(t) " +
            "WITH relationships(p) AS rels UNWIND rels AS r " +
            "RETURN DISTINCT startNode(r).name AS a, endNode(r).name AS b, r.type AS type LIMIT 150",
          { name }
        );
      }
      if (rows.length) {
        clearGraph();
        drawEdges(rows, name, true);
        toast(`首屏：以「${name}」为中心（共 ${degree} 条关系），载入 ${rows.length} 条`);
        return;
      }
    }
  } catch (_) {}
  for (const seed of ["Polish-Russian War", "Snow White", "Wong Kar-wai"]) {
    try {
      const rows = await run(
        "MATCH p=(s:Entity {name:$name})-[:REL*1..2]-(t) " +
          "WITH relationships(p) AS rels UNWIND rels AS r " +
          "RETURN DISTINCT startNode(r).name AS a, endNode(r).name AS b, r.type AS type LIMIT 60",
        { name: seed }
      );
      if (rows.length) {
        clearGraph();
        drawEdges(rows, seed, true);
        toast("已载入示例图谱，可在左侧继续探索");
        return;
      }
    } catch (_) {}
  }
}

async function loadRandomQuestion() {
  try {
    const r = await run("MATCH (q:Question) RETURN q.id AS id ORDER BY rand() LIMIT 1");
    if (r.length) loadQuestion(r[0].get("id"));
  } catch (e) {
    toast("加载失败：" + e.message, true);
  }
}

function drawEdges(rows, focus, isHub) {
  rows.forEach((r) => addEdge(r.get("a"), r.get("b"), r.get("type")));
  if (focus) {
    if (isHub) {
      addNode(focus, {
        color: { background: "#ffb84d", border: "#ffe0a0" },
        size: 40,
        font: { color: "#fff", size: 20, face: "PingFang SC", bold: true },
        borderWidth: 3,
        shadow: { enabled: true, color: "rgba(255,184,77,0.6)", size: 24 },
      });
    } else {
      addNode(focus, { color: { background: "#46d5b3", border: "#7af0d6" }, size: 20 });
    }
  }
  ensureNetwork();
  network.fit({ animation: true });
}

/* ---------- 检索 ---------- */
function sanitizeLucene(t) {
  return t.replace(/[+\-!(){}\[\]^"~*?:\\\/]/g, " ").trim();
}

async function searchAll() {
  const term = sanitizeLucene($("search-input").value);
  const box = $("search-results");
  if (!term) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = '<div class="hint">搜索中…</div>';
  try {
    const ents = await run(
      "CALL db.index.fulltext.queryNodes('entity_ft', $q) YIELD node, score " +
        "RETURN node.name AS name, score ORDER BY score DESC LIMIT 12",
      { q: term + "~" }
    );
    const qs = await run(
      "CALL db.index.fulltext.queryNodes('question_ft', $q) YIELD node, score " +
        "RETURN node.id AS id, node.question AS question, node.answer AS answer, score " +
        "ORDER BY score DESC LIMIT 8",
      { q: term + "~" }
    );
    let html = "";
    ents.forEach((r) => {
      const n = r.get("name");
      html += `<div class="result-item" data-ent="${esc(n)}"><span class="tag">实体</span>${esc(n)}</div>`;
    });
    qs.forEach((r) => {
      const id = r.get("id");
      html += `<div class="result-item" data-q="${esc(id)}"><span class="tag">问题</span>${esc(
        r.get("question")
      )}<div class="meta">答案：${esc(r.get("answer"))}</div></div>`;
    });
    box.innerHTML = html || '<div class="hint">无结果</div>';
    box.querySelectorAll("[data-ent]").forEach((el) =>
      el.addEventListener("click", () => loadNeighborhood(el.dataset.ent, 2, ""))
    );
    box.querySelectorAll("[data-q]").forEach((el) =>
      el.addEventListener("click", () => loadQuestion(el.dataset.q))
    );
  } catch (e) {
    box.innerHTML = "";
    toast("检索失败：" + e.message, true);
  }
}

/* ---------- 全部问题（分页懒加载） ---------- */
const ALL_Q_PAGE = 50;
let allQState = { skip: 0, total: null, loading: false, done: false, observer: null };

async function loadAllQuestionsTotal() {
  try {
    const r = await run("MATCH (q:Question) RETURN count(q) AS c");
    allQState.total = r[0].get("c").toNumber();
    updateAllQCount();
  } catch (_) {}
}

function updateAllQCount() {
  const el = $("all-q-count");
  if (!el) return;
  const t = allQState.total == null ? "?" : allQState.total;
  el.textContent = `已加载 ${allQState.skip} / ${t}`;
}

async function loadMoreQuestions() {
  if (allQState.loading || allQState.done || !driver) return;
  allQState.loading = true;
  const list = $("all-q-list");
  try {
    const rows = await run(
      "MATCH (q:Question) RETURN q.id AS id, q.type AS type, q.question AS question, q.answer AS answer " +
        "ORDER BY q.id SKIP $skip LIMIT $limit",
      { skip: neo4j.int(allQState.skip), limit: neo4j.int(ALL_Q_PAGE) }
    );
    if (!rows.length) {
      allQState.done = true;
      updateAllQCount();
      return;
    }
    const frag = document.createDocumentFragment();
    rows.forEach((r) => {
      const id = r.get("id");
      const div = document.createElement("div");
      div.className = "result-item";
      div.innerHTML =
        `<span class="tag">${esc(r.get("type"))}</span>${esc(r.get("question"))}` +
        `<div class="meta">答案：${esc(r.get("answer"))}</div>`;
      div.addEventListener("click", () => loadQuestion(id));
      frag.appendChild(div);
    });
    list.appendChild(frag);
    allQState.skip += rows.length;
    if (rows.length < ALL_Q_PAGE) allQState.done = true;
    if (allQState.total != null && allQState.skip >= allQState.total) allQState.done = true;
    updateAllQCount();
  } catch (e) {
    toast("加载问题列表失败：" + e.message, true);
  } finally {
    allQState.loading = false;
  }
}

function initAllQuestions() {
  allQState = { skip: 0, total: null, loading: false, done: false, observer: null };
  const list = $("all-q-list");
  if (list) list.innerHTML = "";
  loadAllQuestionsTotal();
  loadMoreQuestions();
  const sentinel = $("all-q-sentinel");
  const root = $("all-questions");
  if (sentinel && root && "IntersectionObserver" in window) {
    allQState.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreQuestions();
      },
      { root, rootMargin: "120px" }
    );
    allQState.observer.observe(sentinel);
  } else if (root) {
    root.addEventListener("scroll", () => {
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 120) loadMoreQuestions();
    });
  }
}

/* ---------- 多跳查询 ---------- */
async function loadNeighborhood(name, hops, rel) {
  hops = Math.max(1, Math.min(4, parseInt(hops, 10) || 2));
  let where = "";
  const params = { name };
  if (rel) {
    where = "WHERE ALL(r IN relationships(p) WHERE r.type = $rel)";
    params.rel = rel;
  }
  const cypher =
    `MATCH p=(s:Entity {name:$name})-[:REL*1..${hops}]-(t) ${where} ` +
    "WITH relationships(p) AS rels UNWIND rels AS r " +
    "RETURN DISTINCT startNode(r).name AS a, endNode(r).name AS b, r.type AS type LIMIT 800";
  try {
    const rows = await run(cypher, params);
    if (!rows.length) {
      toast("未找到「" + name + "」的相关路径");
      return;
    }
    clearGraph();
    drawEdges(rows, name);
    toast(`载入 ${hops} 跳邻域，共 ${rows.length} 条关系`);
  } catch (e) {
    toast("查询失败：" + e.message, true);
  }
}

async function shortestPath() {
  const a = $("path-a").value.trim();
  const b = $("path-b").value.trim();
  if (!a || !b) return toast("请填写两个实体", true);
  const cypher =
    "MATCH (x:Entity {name:$a}),(y:Entity {name:$b}) " +
    "MATCH p=shortestPath((x)-[:REL*..6]-(y)) " +
    "WITH relationships(p) AS rels UNWIND rels AS r " +
    "RETURN startNode(r).name AS a, endNode(r).name AS b, r.type AS type";
  try {
    const rows = await run(cypher, { a, b });
    if (!rows.length) return toast("两实体间无可达路径");
    clearGraph();
    drawEdges(rows, a);
    addNode(b, { color: { background: "#ffb84d", border: "#ffd089" }, size: 20 });
    toast(`最短路径：${rows.length} 跳`);
  } catch (e) {
    toast("查询失败：" + e.message, true);
  }
}

async function expandNode(name) {
  const cypher =
    "MATCH (s:Entity {name:$name})-[r:REL]-(t) " +
    "RETURN startNode(r).name AS a, endNode(r).name AS b, r.type AS type LIMIT 60";
  try {
    const rows = await run(cypher, { name });
    rows.forEach((r) => addEdge(r.get("a"), r.get("b"), r.get("type")));
    toast(`展开「${name}」的邻居`);
  } catch (e) {
    toast("展开失败：" + e.message, true);
  }
}

/* ---------- 问题证据链 ---------- */
async function searchQuestions() {
  const term = sanitizeLucene($("q-input").value);
  const box = $("q-results");
  if (!term) return;
  box.innerHTML = '<div class="hint">搜索中…</div>';
  try {
    const qs = await run(
      "CALL db.index.fulltext.queryNodes('question_ft', $q) YIELD node, score " +
        "RETURN node.id AS id, node.question AS question, node.type AS type, node.answer AS answer " +
        "ORDER BY score DESC LIMIT 15",
      { q: term + "~" }
    );
    box.innerHTML =
      qs
        .map(
          (r) =>
            `<div class="result-item" data-q="${esc(r.get("id"))}"><span class="tag">${esc(
              r.get("type")
            )}</span>${esc(r.get("question"))}<div class="meta">答案：${esc(
              r.get("answer")
            )}</div></div>`
        )
        .join("") || '<div class="hint">无结果</div>';
    box.querySelectorAll("[data-q]").forEach((el) =>
      el.addEventListener("click", () => loadQuestion(el.dataset.q))
    );
  } catch (e) {
    toast("检索失败：" + e.message, true);
  }
}

async function loadQuestion(id) {
  const cypher =
    "MATCH (q:Question {id:$id}) " +
    "RETURN q.question AS question, q.answer AS answer, q.type AS type, q.evidences AS evidences";
  try {
    const rows = await run(cypher, { id });
    if (!rows.length) return;
    const r = rows[0];
    let evidences = [];
    try {
      evidences = JSON.parse(r.get("evidences") || "[]");
    } catch (_) {}
    clearGraph();
    evidences.forEach((tri) => {
      if (tri.length === 3) addEdge(tri[0], tri[2], tri[1]);
    });
    if (evidences.length) addNode(evidences[0][0], { color: { background: "#46d5b3", border: "#7af0d6" }, size: 20 });
    ensureNetwork();
    network.fit({ animation: true });

    const chain = evidences
      .map((t) => `<div class="chain-step"><b>${esc(t[0])}</b> —[${esc(t[1])}]→ <b>${esc(t[2])}</b></div>`)
      .join("");
    $("q-detail").innerHTML =
      `<div><span class="tag">${esc(r.get("type"))}</span>${esc(r.get("question"))}</div>` +
      `<div class="ans" style="margin-top:6px">答案：${esc(r.get("answer"))}</div>` +
      `<div class="chain"><div class="hint">多跳证据链</div>${chain}</div>`;
    toast("已展示该问题的证据链");
  } catch (e) {
    toast("加载失败：" + e.message, true);
  }
}

/* ---------- 节点详情 ---------- */
function showNodeDetail(name) {
  const conn = gEdges.get().filter((e) => e.from === name || e.to === name);
  const box = $("node-detail");
  box.innerHTML =
    `<span class="close">×</span><h3>${esc(name)}</h3>` +
    `<div class="hint">当前图中关联 ${conn.length} 条关系</div>` +
    `<button id="nd-expand">展开邻居</button>`;
  box.classList.remove("hidden");
  box.querySelector(".close").onclick = () => box.classList.add("hidden");
  $("nd-expand").onclick = () => expandNode(name);
}

/* ---------- 聚类 ---------- */
function buildAdjacency() {
  const adj = new Map();
  gNodes.getIds().forEach((id) => adj.set(id, new Set()));
  gEdges.get().forEach((e) => {
    adj.get(e.from)?.add(e.to);
    adj.get(e.to)?.add(e.from);
  });
  return adj;
}

function connectedComponents() {
  const adj = buildAdjacency();
  const label = new Map();
  let c = 0;
  adj.forEach((_, start) => {
    if (label.has(start)) return;
    const stack = [start];
    label.set(start, c);
    while (stack.length) {
      const n = stack.pop();
      adj.get(n).forEach((m) => {
        if (!label.has(m)) {
          label.set(m, c);
          stack.push(m);
        }
      });
    }
    c++;
  });
  return { label, count: c };
}

function labelPropagation() {
  const adj = buildAdjacency();
  const label = new Map();
  adj.forEach((_, id) => label.set(id, id));
  const ids = Array.from(adj.keys());
  for (let it = 0; it < 12; it++) {
    let changed = false;
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    ids.forEach((id) => {
      const cnt = new Map();
      adj.get(id).forEach((nb) => {
        const l = label.get(nb);
        cnt.set(l, (cnt.get(l) || 0) + 1);
      });
      if (!cnt.size) return;
      let best = label.get(id), bestN = -1;
      cnt.forEach((v, k) => {
        if (v > bestN) {
          bestN = v;
          best = k;
        }
      });
      if (best !== label.get(id)) {
        label.set(id, best);
        changed = true;
      }
    });
    if (!changed) break;
  }
  const uniq = Array.from(new Set(label.values()));
  const remap = new Map(uniq.map((l, i) => [l, i]));
  const out = new Map();
  label.forEach((l, id) => out.set(id, remap.get(l)));
  return { label: out, count: uniq.length };
}

function clusterByRelation() {
  const types = Array.from(new Set(gEdges.get().map((e) => e.label)));
  const remap = new Map(types.map((t, i) => [t, i]));
  gEdges.get().forEach((e) => {
    const ci = remap.get(e.label);
    gEdges.update({ id: e.id, color: { color: PALETTE[ci % PALETTE.length] } });
  });
  return { legend: types, count: types.length };
}

function runCluster() {
  if (!gNodes.length) return toast("请先载入一些图数据", true);
  const method = $("cluster-method").value;
  let info = "", legendItems = [];
  if (method === "relation") {
    const r = clusterByRelation();
    info = `按关系类型着色：${r.count} 种`;
    legendItems = r.legend.map((t, i) => [t, PALETTE[i % PALETTE.length]]);
  } else {
    const r = method === "component" ? connectedComponents() : labelPropagation();
    r.label.forEach((c, id) => {
      gNodes.update({ id, color: { background: PALETTE[c % PALETTE.length], border: "#ffffff55" } });
    });
    info = (method === "component" ? "连通分量" : "社区") + `：${r.count} 个`;
    const shown = Math.min(r.count, PALETTE.length);
    for (let i = 0; i < shown; i++) legendItems.push(["簇 " + (i + 1), PALETTE[i % PALETTE.length]]);
  }
  $("cluster-info").textContent = info;
  $("cluster-legend").innerHTML = legendItems
    .map(
      ([t, c]) =>
        `<div class="item"><span class="swatch" style="background:${c}"></span>${esc(String(t))}</div>`
    )
    .join("");
  toast(info);
}

/* ---------- 统计 ---------- */
let chartRel = null, chartQ = null;
async function loadStats() {
  try {
    const c = await run(
      "MATCH (e:Entity) WITH count(e) AS ent " +
        "MATCH ()-[r:REL]->() WITH ent, count(r) AS rel " +
        "MATCH (q:Question) RETURN ent, rel, count(q) AS ques"
    );
    const row = c[0];
    $("stat-ent").textContent = row.get("ent").toNumber();
    $("stat-rel").textContent = row.get("rel").toNumber();
    $("stat-q").textContent = row.get("ques").toNumber();

    const rel = await run(
      "MATCH ()-[r:REL]->() RETURN r.type AS type, count(*) AS c ORDER BY c DESC LIMIT 12"
    );
    drawBar("chart-rel", "关系类型 Top12", rel.map((r) => r.get("type")), rel.map((r) => r.get("c").toNumber()), "#6c8cff", chartRel, (x) => (chartRel = x));

    const qt = await run(
      "MATCH (q:Question) RETURN q.type AS type, count(*) AS c ORDER BY c DESC"
    );
    drawBar("chart-qtype", "问题类型分布", qt.map((r) => r.get("type")), qt.map((r) => r.get("c").toNumber()), "#46d5b3", chartQ, (x) => (chartQ = x));
    toast("统计已更新");
  } catch (e) {
    toast("统计失败：" + e.message, true);
  }
}

function drawBar(canvasId, title, labels, data, color, prev, setter) {
  if (prev) prev.destroy();
  const ctx = $(canvasId).getContext("2d");
  setter(
    new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: title, data, backgroundColor: color }] },
      options: {
        plugins: { legend: { labels: { color: "#9aa0c0" } }, title: { display: true, text: title, color: "#e7e9f3" } },
        scales: {
          x: { ticks: { color: "#9aa0c0", font: { size: 9 } }, grid: { color: "#2b3050" } },
          y: { ticks: { color: "#9aa0c0" }, grid: { color: "#2b3050" } },
        },
      },
    })
  );
}

/* ---------- 关系下拉 & 自动补全 ---------- */
async function initRelationFilter() {
  try {
    const rel = await run("MATCH ()-[r:REL]->() RETURN DISTINCT r.type AS type ORDER BY type");
    const sel = $("hop-rel");
    rel.forEach((r) => {
      const o = document.createElement("option");
      o.value = o.textContent = r.get("type");
      sel.appendChild(o);
    });
  } catch (_) {}
}

let acTimer = null;
async function autocomplete(term) {
  term = sanitizeLucene(term);
  if (!term || !driver) return;
  try {
    const ents = await run(
      "CALL db.index.fulltext.queryNodes('entity_ft', $q) YIELD node RETURN node.name AS name LIMIT 10",
      { q: term + "~" }
    );
    const dl = $("entity-list");
    dl.innerHTML = ents.map((r) => `<option value="${esc(r.get("name"))}">`).join("");
  } catch (_) {}
}

/* ---------- 杂项 ---------- */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function bindUI() {
  document.querySelectorAll(".tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-body").forEach((b) => b.classList.remove("active"));
      tab.classList.add("active");
      document.querySelector(`[data-body="${tab.dataset.tab}"]`).classList.add("active");
    })
  );

  $("btn-reconnect").onclick = connect;
  $("search-btn").onclick = searchAll;
  $("search-input").addEventListener("keydown", (e) => e.key === "Enter" && searchAll());
  $("hop-range").addEventListener("input", (e) => ($("hop-num").textContent = e.target.value));
  $("hop-btn").onclick = () =>
    loadNeighborhood($("hop-start").value.trim(), $("hop-range").value, $("hop-rel").value);
  $("path-btn").onclick = shortestPath;
  $("q-btn").onclick = searchQuestions;
  $("q-input").addEventListener("keydown", (e) => e.key === "Enter" && searchQuestions());
  $("cluster-btn").onclick = runCluster;
  $("stats-btn").onclick = loadStats;

  ["hop-start", "path-a", "path-b"].forEach((id) =>
    $(id).addEventListener("input", (e) => {
      clearTimeout(acTimer);
      acTimer = setTimeout(() => autocomplete(e.target.value), 220);
    })
  );

}

window.addEventListener("DOMContentLoaded", () => {
  bindUI();
  ensureNetwork();
  updateEmptyState();
  connect();
});
