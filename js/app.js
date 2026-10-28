/* Logic First — app logic. No build step, no paid services.
   Pseudocode -> (free AI) -> Python + Java -> tests run on the Python in the browser (Pyodide). */
(function () {
  "use strict";

  const CFG = Object.assign({
    siteTitle: "Logic First", courseLabel: "", aiServerUrl: "",
    localModels: [{ id: "Qwen2.5-Coder-3B-Instruct", label: "Standard", size: "about 1.7 GB" }],
    webllmVersion: "0.2.85", pyodideUrl: "https://cdn.jsdelivr.net/npm/pyodide@0.29.5/"
  }, window.LF_CONFIG || {});
  const PROBLEMS = window.LF_PROBLEMS || [];
  const byId = new Map(PROBLEMS.map(p => [p.id, p]));
  const TOPICS = [...new Set(PROBLEMS.map(p => p.topic))];
  const LANG_NAME = { python: "Python", java: "Java" };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clip = (s, n = 200) => (s.length > n ? s.slice(0, n) + "…" : s);

  /* ---------- per-browser storage ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  const K = {
    solved: "lf2:solved", tried: "lf2:tried", lang: "lf3:lang", engine: "lf3:engine", model: "lf3:model", left: "lf2:left",
    serverDown: "lf3:serverDownUntil", draft: (id) => "lf2:draft:" + id, gen: (id) => "lf3:gen:" + id
  };
  let solved = store.get(K.solved, {});
  let tried = store.get(K.tried, {});
  let lang = LANG_NAME[store.get(K.lang, "python")] ? store.get(K.lang, "python") : "python";

  /* ---------- value helpers (match instructor-tools/build.mjs) ---------- */
  const keyOf = (v) => { if (v === undefined) return "undefined"; const s = JSON.stringify(v); return s === undefined ? String(v) : s; };
  const normalize = (v, cmp) => {
    if (!Array.isArray(v)) return v;
    if (cmp === "sorted") return [...v].sort((a, b) => { const x = keyOf(a), y = keyOf(b); return x < y ? -1 : x > y ? 1 : 0; });
    if (cmp === "sortedDeep") return normalize(v.map(x => (Array.isArray(x) ? normalize(x, "sorted") : x)), "sorted");
    return v;
  };
  const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
  const isGen = (v) => v && typeof v === "object" && !Array.isArray(v) && v.$gen;
  const fmtArg = (v) => (isGen(v) ? `[${v.n.toLocaleString()} generated numbers]` : keyOf(v));
  const fmtArgs = (p, args) => p.params.map(([n], i) => `${n} = ${fmtArg(args[i])}`).join(", ");
  const expectedText = (t) => ("expected" in t ? keyOf(t.expected) : t.expectedPreview);

  /* ---------- tiny markdown for problem text ---------- */
  const mdInline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
  const mdBlocks = (text) => text.split(/\n\n+/).map(b => {
    const lines = b.split("\n");
    if (lines.every(l => /^- /.test(l))) return "<ul>" + lines.map(l => `<li>${mdInline(l.slice(2))}</li>`).join("") + "</ul>";
    if (lines.every(l => /^\d+\. /.test(l))) return "<ol>" + lines.map(l => `<li>${mdInline(l.replace(/^\d+\. /, ""))}</li>`).join("") + "</ol>";
    return `<p>${lines.map(mdInline).join("<br>")}</p>`;
  }).join("");

  /* ---------- toast & clipboard ---------- */
  let toastT;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2800); }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try {
        const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok;
      } catch (e2) { return false; }
    }
  }

  /* =====================================================================
     Prompts
     ===================================================================== */
  const PY_T = { "int": "int", "int[]": "List[int]", "int[][]": "List[List[int]]", "string": "str", "string[]": "List[str]", "string[][]": "List[List[str]]", "char[][]": "List[List[str]]", "boolean": "bool", "ListNode": "Optional[ListNode]", "TreeNode": "Optional[TreeNode]" };
  const JAVA_P = { "int": "int", "int[]": "int[]", "int[][]": "int[][]", "string": "String", "string[]": "String[]", "string[][]": "String[][]", "char[][]": "char[][]", "boolean": "boolean", "ListNode": "ListNode", "TreeNode": "TreeNode" };
  const JAVA_R = Object.assign({}, JAVA_P, { "int[][]": "List<List<Integer>>", "string[]": "List<String>", "string[][]": "List<List<String>>" });
  const usesNodes = (p) => [p.returns, ...p.params.map(x => x[1])].some(t => t === "ListNode" || t === "TreeNode");
  const pySig = (p) => `def ${p.fn}(${p.params.map(([n, t]) => `${n}: ${PY_T[t] || t}`).join(", ")}) -> ${PY_T[p.returns] || p.returns}:`;
  const javaSig = (p) => `public ${JAVA_R[p.returns] || p.returns} ${p.fn}(${p.params.map(([n, t]) => `${JAVA_P[t] || t} ${n}`).join(", ")})`;

  const SYSTEM = "You convert a student's pseudocode into code, literally. Never fix their mistakes, never change their algorithm, and never add steps they did not write. Reply only in the requested format.";
  const TUTOR = "You are a friendly, concise algorithms tutor for university students.";

  function problemBrief(p) {
    const ex = p.tests.slice(0, 2).map(t => `  ${clip(fmtArgs(p, t.args), 300)}  ->  ${clip(expectedText(t), 200)}`).join("\n");
    return `PROBLEM: ${p.title}\n${p.text}\nExamples:\n${ex}`;
  }
  function convertPrompt(p, pc) {
    return `Convert the student's pseudocode into Python and Java.

${problemBrief(p)}

PYTHON SIGNATURE: ${pySig(p)}
JAVA SIGNATURE: ${javaSig(p)}   (inside class Solution)${usesNodes(p) ? "\nListNode (fields val, next) and TreeNode (fields val, left, right) classes already exist in both languages. Do not define them." : ""}

STUDENT PSEUDOCODE:
<<<
${pc}
>>>

RULES
1. Translate the pseudocode literally, step by step. Keep the student's algorithm even if it is wrong or slow. Do not fix bugs, add missing cases, or optimize. Wrong logic must give wrong code.
2. Only fill in obvious details: syntax, declarations, the data structure they named, loop bounds they clearly meant.
3. If a step is unclear, use the most literal reading and say so under NOTES.
4. If the pseudocode is empty or not about this problem, say so under NOTES and write no code.
5. Python: one top-level function with exactly that signature. You may import from typing, collections, heapq and math. No input(), no print(), no example calls.
6. Java: class Solution containing that method, with the same logic as the Python.

Reply in exactly this format:
NOTES:
- (each assumption on its own line, or "- none")
\`\`\`python
(Python code)
\`\`\`
\`\`\`java
(Java code)
\`\`\``;
  }
  function hintPrompt(p, pc) {
    return `A student is practising algorithms by writing pseudocode.

${problemBrief(p)}

${pc ? `Their current draft:\n<<<\n${pc}\n>>>\n\n` : "They have not written anything yet.\n\n"}Give ONE short hint, at most two sentences, that nudges them toward the key idea${pc ? " or the next fix their draft needs" : ""}. Do not write pseudocode or code, and do not reveal the full algorithm. Plain text only.`;
  }
  function reviewPrompt(p, pc) {
    const rows = run.rows, fails = rows.filter(r => !r.pass).slice(0, 2);
    const results = fails.length
      ? `Passed ${rows.length - rows.filter(r => !r.pass).length} of ${rows.length} tests. Failing:\n` + fails.map(r => `- input ${clip(r.input, 300)} | expected ${clip(r.expected, 150)} | got ${r.error ? "an error: " + clip(r.error, 150) : clip(r.got, 150)}`).join("\n")
      : `All ${rows.length} tests passed.`;
    return `You are a friendly algorithms tutor. A student wrote pseudocode, it was translated literally into Python, and tests were run.

${problemBrief(p)}

STUDENT PSEUDOCODE:
<<<
${pc}
>>>

PYTHON CODE:
${gen ? clip(gen.python, 2500) : "(none)"}

TEST RESULTS:
${results}

Write feedback in under 120 words, plain text, no headings.
- If tests failed: name the flaw in their LOGIC, trace one failing input briefly to show where it goes wrong, and say what to reconsider without giving the corrected solution.
- If all passed: give the time and space complexity and one edge case or improvement to think about.`;
  }

  function parseReply(text) {
    const blocks = [];
    const re = /```([^\n`]*)\n([\s\S]*?)```/g; let m;
    while ((m = re.exec(text))) blocks.push({ tag: m[1].trim().toLowerCase(), body: m[2].replace(/\s+$/, "") });
    let py = blocks.find(b => ["python", "py", "python3"].includes(b.tag));
    let java = blocks.find(b => b.tag === "java");
    if (!py) py = blocks.find(b => !b.tag && /^\s*(from|import|def)\s/m.test(b.body));
    if (!java) java = blocks.find(b => !b.tag && /class\s+Solution|public\s+\w/.test(b.body) && b !== py);
    if (!py && !blocks.length && /^\s*def\s+\w+\s*\(/m.test(text)) py = { body: text.trim() };
    const notes = [];
    const nm = text.match(/NOTES:\s*\n([\s\S]*?)(?:```|$)/i);
    if (nm) nm[1].split("\n").forEach(l => { if (/^\s*[-*•]/.test(l)) { const t = l.replace(/^\s*[-*•]\s*/, "").trim(); if (t && !/^\(?none\)?\.?$/i.test(t)) notes.push(t); } });
    if (!py && !notes.length && text.trim()) notes.push(clip(text.trim(), 400));
    return { python: py ? py.body : "", java: java ? java.body : "", notes: notes.slice(0, 6) };
  }

  /* =====================================================================
     Free AI engines: class server (Cloudflare Workers AI) and in-browser model (WebLLM)
     ===================================================================== */
  let ctl = null;
  const fail = (message, extra) => Object.assign({ message }, extra || {});
  function engineMode() { const m = store.get(K.engine, "auto"); return (m === "server" && !CFG.aiServerUrl) ? "auto" : m; }
  const serverDown = () => Date.now() < store.get(K.serverDown, 0);

  async function viaServer(prompt, purpose, signal) {
    let res;
    try {
      res = await fetch(CFG.aiServerUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, purpose, system: SYSTEM }), signal });
    } catch (e) {
      if (e && e.name === "AbortError") throw fail("Stopped.", { cancelled: true });
      throw fail("Couldn't reach the class AI server.", { fallback: true });
    }
    let data = null; try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      if (res.status === 429) throw fail("The class AI server has used today's free limit.", { fallback: true, quota: true });
      if (res.status === 403) throw fail("The class AI server doesn't accept requests from this site address.", { fallback: true });
      throw fail((data && data.error) || "The class AI server had a problem.", { fallback: true });
    }
    if (!data || !data.text) throw fail("The class AI server sent an empty reply.", { fallback: true });
    return data.text;
  }

  let webllm = null, engine = null, engineId = null, llmWorker = null, gpuInfo;
  async function gpu() {
    if (gpuInfo !== undefined) return gpuInfo;
    gpuInfo = null;
    try { if (navigator.gpu) { const a = await navigator.gpu.requestAdapter(); if (a) gpuInfo = { f16: a.features.has("shader-f16") }; } } catch (e) { gpuInfo = null; }
    return gpuInfo;
  }
  function localBase() { const ids = CFG.localModels.map(m => m.id); const s = store.get(K.model, ids[0]); return ids.includes(s) ? s : ids[0]; }
  const localInfo = (base) => CFG.localModels.find(m => m.id === base) || CFG.localModels[0];
  const localId = (base, f16) => `${base}-${f16 ? "q4f16_1" : "q4f32_1"}-MLC`;
  async function lib() { if (!webllm) webllm = await import(`https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@${CFG.webllmVersion}/+esm`); return webllm; }
  async function localState() {
    const g = await gpu();
    if (!g) return { state: "unsupported" };
    const id = localId(localBase(), g.f16);
    if (engine && engineId === id) return { state: "ready", id };
    let cached = false;
    try { cached = await (await lib()).hasModelInCache(id); } catch (e) { cached = false; }
    return { state: cached ? "cached" : "download", id };
  }
  async function ensureLocal(onProgress) {
    const st = await localState();
    if (st.state === "ready") return engine;
    if (engine) { try { await engine.unload(); } catch (e) { /* ignore */ } engine = null; }
    if (llmWorker) { llmWorker.terminate(); llmWorker = null; }
    const w = await lib();
    llmWorker = new Worker(new URL("js/llm-worker.js", document.baseURI), { type: "module" });
    try {
      engine = await w.CreateWebWorkerMLCEngine(llmWorker, st.id, { initProgressCallback: onProgress });
    } catch (e) {
      llmWorker.terminate(); llmWorker = null; engine = null;
      throw fail("The in-browser AI couldn't start (" + clip(String((e && e.message) || e), 140) + "). Try the Lite model in AI settings, or use Chrome or Edge.");
    }
    engineId = st.id;
    refreshChip();
    return engine;
  }
  async function viaLocal(prompt, purpose, signal, onText, allowDownload, ui) {
    const st = await localState();
    if (st.state === "unsupported") throw fail("This browser can't run the in-browser AI. It needs Chrome or Edge (or another browser with WebGPU) on a laptop or desktop.", { unsupported: true });
    if (st.state === "download" && !allowDownload) throw fail("", { needDownload: true });
    if (st.state !== "ready") {
      ui.busy(st.state === "download" ? "Downloading the AI model (one time only)…" : "Loading the AI model from your browser…", true);
      await ensureLocal((r) => ui.progress(r.progress, r.text));
      ui.busy(purpose === "code" ? "Converting your logic…" : "Thinking…", false);
    }
    const onAbort = () => { try { engine.interruptGenerate(); } catch (e) { /* ignore */ } };
    signal.addEventListener("abort", onAbort);
    try {
      const chunks = await engine.chat.completions.create({
        messages: [{ role: "system", content: purpose === "code" ? SYSTEM : TUTOR }, { role: "user", content: prompt }],
        temperature: 0.1, max_tokens: purpose === "code" ? 1400 : 350, stream: true
      });
      let text = "";
      for await (const c of chunks) { text += (c.choices && c.choices[0] && c.choices[0].delta && c.choices[0].delta.content) || ""; if (onText) onText(text); }
      if (signal.aborted) throw fail("Stopped.", { cancelled: true });
      return text;
    } catch (e) {
      if (signal.aborted) throw fail("Stopped.", { cancelled: true });
      if (e && (e.needDownload || e.unsupported || e.cancelled)) throw e;
      throw fail("The in-browser AI stopped: " + clip(String((e && e.message) || e), 160));
    } finally { signal.removeEventListener("abort", onAbort); }
  }

  async function askAI(prompt, purpose, opts) {
    const mode = engineMode();
    ctl = new AbortController();
    const signal = ctl.signal, ui = opts.ui;
    let serverErr = null;
    if (CFG.aiServerUrl && mode !== "local" && (mode === "server" || !serverDown())) {
      ui.busy(purpose === "code" ? "Converting your logic…" : "Thinking…", false);
      try { const t = await viaServer(prompt, purpose, signal); if (opts.onText) opts.onText(t); return t; }
      catch (e) {
        if (e.cancelled || mode === "server") throw e;
        serverErr = e;
        store.set(K.serverDown, Date.now() + (e.quota ? 60 : 10) * 60000);
        refreshChip();
      }
    }
    try { return await viaLocal(prompt, purpose, signal, opts.onText, opts.allowDownload, ui); }
    catch (e) {
      if (serverErr && !e.cancelled) e.serverNote = serverErr.message + " ";
      throw e;
    }
  }

  /* ---------- AI status chip ---------- */
  async function refreshChip() {
    const mode = engineMode();
    let txt = "AI: automatic", ok = true;
    const serverOn = CFG.aiServerUrl && mode !== "local" && (mode === "server" || !serverDown());
    if (serverOn) txt = "AI: class server";
    else {
      const st = await localState();
      if (st.state === "unsupported") { txt = CFG.aiServerUrl ? "AI: server busy" : "AI: not available"; ok = false; }
      else if (st.state === "download") txt = "AI: in browser (not downloaded)";
      else txt = "AI: in your browser";
    }
    $("aiChipText").textContent = txt;
    $("aiDot").className = "dot " + (ok ? "ok" : "off");
  }

  /* =====================================================================
     HOME
     ===================================================================== */
  let fDiff = "All", fTopic = "All", fStatus = "All", fQ = "";
  function renderStats() {
    const total = PROBLEMS.length, done = PROBLEMS.filter(p => solved[p.id]).length;
    const e = PROBLEMS.filter(p => p.diff === "Easy"), m = PROBLEMS.filter(p => p.diff === "Medium");
    const ed = e.filter(p => solved[p.id]).length, md = m.filter(p => solved[p.id]).length;
    $("pcSolved").textContent = done; $("pcTotal").textContent = total;
    $("pcEasy").textContent = `${ed}/${e.length}`; $("pcMed").textContent = `${md}/${m.length}`;
    $("barEasy").style.width = (e.length ? (100 * ed) / e.length : 0) + "%";
    $("barMed").style.width = (m.length ? (100 * md) / m.length : 0) + "%";
  }
  function renderTopicStrip() {
    const chip = (t, n) => `<button class="tchip" data-topic="${esc(t)}" aria-pressed="${fTopic === t}">${esc(t === "All" ? "All topics" : t)}<span>${n}</span></button>`;
    $("topicStrip").innerHTML = chip("All", PROBLEMS.length) + TOPICS.map(t => chip(t, PROBLEMS.filter(p => p.topic === t).length)).join("");
  }
  function filtered() {
    return PROBLEMS.filter(p =>
      (fDiff === "All" || p.diff === fDiff) && (fTopic === "All" || p.topic === fTopic) &&
      (fStatus === "All" || (fStatus === "solved" ? !!solved[p.id] : !solved[p.id])) &&
      (!fQ || (p.title + " " + p.topic + " " + p.n).toLowerCase().includes(fQ)));
  }
  function renderList() {
    const rows = filtered();
    $("ptbody").innerHTML = rows.map(p => {
      const st = solved[p.id] ? "done" : tried[p.id] ? "tried" : "";
      const lbl = solved[p.id] ? "Solved" : tried[p.id] ? "Attempted" : "Not started";
      return `<tr data-id="${p.id}"><td><span class="st-dot ${st}" role="img" aria-label="${lbl}" title="${lbl}"></span></td><td class="num">${p.n}</td><td><a href="#${p.id}">${esc(p.title)}</a></td><td class="topic">${esc(p.topic)}</td><td><span class="diff ${p.diff}">${p.diff}</span></td></tr>`;
    }).join("");
    $("emptyList").hidden = rows.length > 0;
  }
  function showHome() {
    abortAll();
    $("view-problem").hidden = true; $("view-home").hidden = false;
    document.title = CFG.siteTitle;
    renderStats(); renderTopicStrip(); renderList();
  }

  /* =====================================================================
     PROBLEM PAGE
     ===================================================================== */
  let cur = null, gen = null, run = null, pending = null, lastPrompt = "";

  function renderDesc(p) {
    const params = p.params.map(([n, t]) => `${esc(n)}: ${esc(t)}`).join(", ");
    const exs = p.tests.slice(0, 2).map((t, i) => `
      <div class="ex"><h3>Example ${i + 1}</h3><dl>
        <dt>Input</dt><dd>${esc(clip(fmtArgs(p, t.args), 400))}</dd>
        <dt>Output</dt><dd>${esc(clip(expectedText(t), 400))}</dd>
      </dl></div>`).join("");
    const struct = usesNodes(p) ? `<div class="struct-note"><b>About the input format.</b> Linked lists and trees are written as arrays here. A list <code>[1,2,3]</code> means 1 → 2 → 3. A tree is listed level by level, with <code>null</code> for a missing child. Your function receives real nodes: a ListNode has <code>val</code> and <code>next</code>; a TreeNode has <code>val</code>, <code>left</code> and <code>right</code>.</div>` : "";
    $("desc").innerHTML = `
      <div class="desc-meta"><span class="diff ${p.diff}">${p.diff}</span><span class="topic-tag">${esc(p.topic)}</span>${solved[p.id] ? '<span class="solved-tag">Solved</span>' : ""}</div>
      <h1><span class="pn">${p.n}.</span>${esc(p.title)}</h1>
      ${mdBlocks(p.text)}
      <div class="sig"><span class="k">function</span> ${esc(p.fn)}(${params}) <span class="k">→</span> ${esc(p.returns)}</div>
      <span class="mini-label">Examples</span>
      <div class="examples">${exs}</div>
      ${p.notes.length ? `<span class="mini-label">Notes</span><ul class="notes">${p.notes.map(n => `<li>${mdInline(n)}</li>`).join("")}</ul>` : ""}
      ${struct}
      <p class="fine" style="margin-top:18px">Your code is checked against ${p.tests.length} test cases. The first two are shown above.</p>`;
    $("desc").scrollTop = 0;
  }

  function showProblem(id) {
    const p = byId.get(id);
    abortAll();
    cur = p; run = null; pending = null;
    $("view-home").hidden = true; $("view-problem").hidden = false;
    document.title = `${p.title} · ${CFG.siteTitle}`;
    renderDesc(p);
    $("pIndex").textContent = `${p.n} of ${PROBLEMS.length}`;
    $("prevBtn").disabled = p.n === 1; $("nextBtn").disabled = p.n === PROBLEMS.length;
    $("pad").value = store.get(K.draft(id), ""); updateLines();
    gen = store.get(K.gen(id), null);
    aiUI.hide();
    $("testCard").hidden = true; $("fbCard").hidden = true;
    if (gen && gen.python) renderCode(); else $("codeCard").hidden = true;
    updateStartNote();
    window.scrollTo(0, 0);
  }

  function updateStartNote() { $("startNote").hidden = !$("codeCard").hidden || !$("testCard").hidden || !$("fbCard").hidden || !$("aiCard").hidden; }
  function setBusy(b) {
    $("convertBtn").disabled = b; $("hintBtn").disabled = b; $("stopBtn").hidden = !b;
    $("runBtn").disabled = b; $("reviewBtn").disabled = b || !run || !run.done;
  }
  function markTried(p) { if (!tried[p.id]) { tried[p.id] = true; store.set(K.tried, tried); } }
  function setLang(l) {
    lang = l; store.set(K.lang, l);
    document.querySelectorAll(".langseg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.lang === l));
    if (gen) renderCode();
  }

  /* ---------- AI card UI ---------- */
  const aiUI = {
    show(part) { ["aiBusy", "aiDownload", "aiNone"].forEach(x => { $(x).hidden = x !== part; }); $("aiError").hidden = true; $("aiCard").hidden = false; updateStartNote(); },
    busy(text, withProgress) {
      this.show("aiBusy"); $("aiBusyText").textContent = text;
      $("aiProgWrap").hidden = !withProgress; if (withProgress) $("aiProg").style.width = "0%";
      $("aiStream").hidden = true; $("aiStream").textContent = "";
    },
    progress(frac, text) { $("aiProgWrap").hidden = false; $("aiProg").style.width = Math.round((frac || 0) * 100) + "%"; if (text) $("aiBusyText").textContent = clip(text.replace(/\s+/g, " "), 140); },
    stream(text) { const s = $("aiStream"); s.hidden = false; s.textContent = text.slice(-1200); s.scrollTop = s.scrollHeight; },
    download() {
      const info = localInfo(localBase());
      $("dlSize").textContent = info.size || "a large file";
      $("dlLiteBtn").hidden = CFG.localModels.length < 2 || localBase() === CFG.localModels[CFG.localModels.length - 1].id;
      this.show("aiDownload");
    },
    none(text) { this.show("aiNone"); $("aiNoneText").textContent = text; },
    error(text) { $("aiCard").hidden = false; ["aiBusy", "aiDownload", "aiNone"].forEach(x => { $(x).hidden = true; }); const e = $("aiError"); e.hidden = false; e.textContent = text; updateStartNote(); },
    hide() { $("aiCard").hidden = true; updateStartNote(); }
  };

  function handleAIError(e, action) {
    if (e.cancelled) { aiUI.hide(); return; }
    if (e.needDownload) { pending = action; aiUI.download(); return; }
    if (e.unsupported) { pending = action; aiUI.none((e.serverNote || "") + e.message + (CFG.aiServerUrl ? "" : " Your instructor can also turn on the free class AI server so it works on any device.")); return; }
    aiUI.error((e.serverNote || "") + (e.message || "Something went wrong."));
  }

  /* ---------- convert ---------- */
  async function convert(allowDownload) {
    const p = cur, pc = $("pad").value.trim();
    if (!pc) { aiUI.error("Write your algorithm in the editor first."); $("pad").focus(); return; }
    markTried(p);
    const prompt = convertPrompt(p, pc);
    lastPrompt = prompt;
    setBusy(true);
    try {
      const text = await askAI(prompt, "code", { allowDownload, ui: aiUI, onText: (t) => { if (cur === p) aiUI.stream(t); } });
      if (cur !== p) return;
      aiUI.hide();
      useReply(text, pc);
    } catch (e) { if (cur === p) handleAIError(e, "convert"); }
    finally { if (cur === p) setBusy(false); }
  }

  function useReply(text, pc) {
    const p = cur, r = parseReply(text);
    if (!r.python.trim()) {
      aiUI.error("The AI didn't return Python code" + (r.notes[0] ? ": " + r.notes[0] : ". Make sure your pseudocode describes the whole algorithm, then convert again."));
      return;
    }
    gen = { python: r.python, java: r.java, notes: r.notes, src: pc };
    store.set(K.gen(p.id), gen);
    run = null;
    $("testCard").hidden = true; $("fbCard").hidden = true;
    renderCode();
    $("codeCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderCode() {
    if (!gen) return;
    $("codeCard").hidden = false;
    $("c-python").setAttribute("aria-selected", lang === "python");
    $("c-java").setAttribute("aria-selected", lang === "java");
    const code = lang === "java" ? (gen.java || "// The AI didn't produce Java this time. Press Convert to code to try again.") : gen.python;
    $("codePre").textContent = code;
    $("runNote").textContent = lang === "java" ? "Tests run the Python version, which follows the same steps." : "Tests run this Python code.";
    $("assumeList").innerHTML = (gen.notes || []).map(a => `<li>${esc(a)}</li>`).join("");
    $("assumeWrap").hidden = !(gen.notes || []).length;
    $("staleNote").hidden = $("pad").value.trim() === (gen.src || "").trim();
    updateStartNote();
  }

  /* ---------- hint & review ---------- */
  function showFeedback(title, text) { $("fbCard").hidden = false; $("fbTitle").textContent = title; $("fbBox").textContent = text; updateStartNote(); }
  async function feedback(kind, allowDownload) {
    const p = cur, pc = $("pad").value.trim();
    if (kind === "review" && !run) return;
    const prompt = kind === "hint" ? hintPrompt(p, pc) : reviewPrompt(p, pc);
    const title = kind === "hint" ? "Hint" : "Feedback on your logic";
    lastPrompt = prompt;
    showFeedback(title, "Thinking…");
    setBusy(true);
    try {
      await askAI(prompt, kind, { allowDownload, ui: aiUI, onText: (t) => { if (cur === p) showFeedback(title, t); } });
      if (cur === p) aiUI.hide();
    } catch (e) { if (cur === p) { $("fbCard").hidden = true; handleAIError(e, kind); } }
    finally { if (cur === p) setBusy(false); }
    if (cur === p) $("fbCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function runPending(allowDownload) {
    const a = pending; pending = null;
    if (a === "convert" || !a) convert(allowDownload);
    else feedback(a, allowDownload);
  }

  /* =====================================================================
     Python test runner (Pyodide in a Web Worker)
     ===================================================================== */
  let pyw = null, running = false;
  function stopPython() { if (pyw) { pyw.terminate(); pyw = null; } running = false; }
  function abortAll() { if (ctl) { ctl.abort(); ctl = null; } if (running) stopPython(); setBusy(false); }
  function setTestStatus(msg, kind) { const s = $("testStatus"); s.className = "status" + (kind ? " " + kind : ""); s.textContent = msg || ""; s.hidden = !msg; }

  function runTests() {
    const p = cur;
    if (!gen || !gen.python) return;
    if (running) stopPython();
    const rows = p.tests.map(t => ({ input: fmtArgs(p, t.args), expected: expectedText(t), got: "", error: null, logs: "", pass: false, state: "wait", ms: 0 }));
    run = { rows, done: false };
    $("testCard").hidden = false; $("fbCard").hidden = true; updateStartNote();
    drawTests(); summarize(false);
    setTestStatus("");
    setBusy(true); running = true;
    $("testCard").scrollIntoView({ behavior: "smooth", block: "nearest" });

    if (!pyw) pyw = new Worker(new URL("js/py-worker.js", document.baseURI));
    const w = pyw, LIMIT = 5000;
    let timer = null, curI = -1;
    const arm = (ms) => { clearTimeout(timer); timer = setTimeout(onTimeout, ms); };
    const finish = () => {
      clearTimeout(timer); running = false;
      run.done = true; drawTests(); summarize(true); setBusy(false);
      if (rows.length && rows.every(r => r.pass) && !solved[p.id]) {
        solved[p.id] = true; store.set(K.solved, solved); toast("Solved! Every test passed."); renderDesc(p);
      }
    };
    function onTimeout() {
      if (curI < 0) { setTestStatus("Python took too long to start. Check your internet connection and press Run tests again.", "err"); rows.forEach(r => { r.state = "skip"; }); }
      else rows.forEach((r, i) => {
        if (r.state !== "wait" && r.state !== "running") return;
        if (i === curI) { r.state = "tle"; r.error = "Took longer than 5 seconds. Look for an infinite loop, or an approach that is too slow for this input."; }
        else r.state = "skip";
      });
      if (pyw === w) { w.terminate(); pyw = null; }
      finish();
    }
    w.onmessage = (ev) => {
      if (pyw !== w || cur !== p) return;
      const m = ev.data;
      if (m.type === "booting") { setTestStatus("Starting Python in your browser (the first run downloads about 13 MB)…", "busy"); return; }
      if (m.type === "ready") { setTestStatus(""); return; }
      if (m.type === "compile") { rows.forEach(r => { r.state = "skip"; }); setTestStatus("Your Python code didn't load: " + m.error + ". Convert again, or rewrite your logic.", "err"); finish(); return; }
      if (m.type === "fatal") { rows.forEach(r => { if (r.state === "wait" || r.state === "running") r.state = "skip"; }); setTestStatus("Python couldn't start: " + m.error, "err"); w.terminate(); pyw = null; finish(); return; }
      if (m.type === "start") { curI = m.i; rows[m.i].state = "running"; arm(LIMIT); drawTests(); return; }
      if (m.type === "result") {
        const r = rows[m.i], t = p.tests[m.i];
        r.ms = m.ms; r.logs = m.logs || "";
        if (!m.ok) { r.error = m.error; r.state = "fail"; }
        else {
          let v; try { v = JSON.parse(m.out); } catch (e) { v = m.out; }
          r.got = keyOf(v);
          const k = keyOf(normalize(v, p.cmp));
          r.pass = t.expectedHash ? fnv(k) === t.expectedHash : k === keyOf(normalize(t.expected, p.cmp));
          r.state = r.pass ? "pass" : "fail";
        }
        drawTests(); summarize(false);
        return;
      }
      if (m.type === "done") finish();
    };
    w.onerror = (ev) => {
      ev.preventDefault();
      if (pyw !== w) return;
      rows.forEach(r => { if (r.state === "wait" || r.state === "running") r.state = "skip"; });
      setTestStatus("The test runner failed to start: " + (ev.message || "unknown error"), "err");
      w.terminate(); pyw = null; finish();
    };
    arm(90000);
    w.postMessage({ type: "run", base: CFG.pyodideUrl, code: gen.python, fn: p.fn, tests: p.tests.map(t => t.args), ptypes: p.params.map(x => x[1]), rtype: p.returns });
  }

  function drawTests() {
    const label = { pass: "Pass", fail: "Fail", wait: "Waiting", running: "Running…", tle: "Too slow", skip: "Not run" };
    const cls = { pass: "pass", fail: "fail", tle: "fail", wait: "wait", running: "wait", skip: "wait" };
    $("tbody").innerHTML = run.rows.map((r, i) => `
      <tr>
        <td class="n">${i + 1}</td>
        <td class="mono">${esc(clip(r.input))}</td>
        <td class="mono">${esc(clip(r.expected))}</td>
        <td class="mono">${r.error ? "—" : esc(clip(r.got || ""))}${r.error ? `<span class="sub">${esc(clip(r.error, 240))}</span>` : ""}${r.logs ? `<span class="sub">printed: ${esc(clip(r.logs.trim(), 200))}</span>` : ""}</td>
        <td><span class="res ${cls[r.state]}">${label[r.state]}</span></td>
      </tr>`).join("");
  }
  function summarize(done) {
    const n = run.rows.filter(r => r.pass).length, all = run.rows.length, pill = $("tPill");
    if (!done) { pill.className = "pill"; pill.textContent = `Running · ${n}/${all}`; $("tMeta").textContent = ""; return; }
    pill.className = "pill " + (n === all ? "pass" : "fail");
    pill.textContent = n === all ? `All ${all} passed` : `${n} of ${all} passed`;
    const slow = Math.max(0, ...run.rows.map(r => r.ms || 0));
    $("tMeta").textContent = n === all ? `Slowest test: ${slow} ms` : "";
  }

  /* =====================================================================
     Settings modal
     ===================================================================== */
  async function openModal() {
    const mode = engineMode();
    $("engine-server").hidden = !CFG.aiServerUrl;
    document.querySelectorAll('input[name="engine"]').forEach(r => { r.checked = r.value === mode; });
    $("modelSel").innerHTML = CFG.localModels.map(m => `<option value="${esc(m.id)}">${esc(m.label)} · ${esc(m.size || "")}</option>`).join("");
    $("modelSel").value = localBase();
    $("overlay").hidden = false; $("closeModal").focus();
    const st = await localState();
    const serverTxt = CFG.aiServerUrl ? (serverDown() ? "The class AI server is busy or has used today's free limit, so the AI in your browser is being used for now." : "The class AI server is on.") : "The class AI server isn't set up, so the AI runs in your browser.";
    const localTxt = st.state === "unsupported" ? "This browser can't run the in-browser AI (it needs WebGPU: Chrome or Edge on a laptop or desktop)." : st.state === "download" ? "The in-browser AI works here. It downloads the first time you convert." : "The in-browser AI is downloaded on this device.";
    $("engineSummary").textContent = serverTxt + " " + localTxt;
    $("modelInfo").textContent = st.state === "unsupported" ? "Not available in this browser." : "Larger models translate more accurately. Each model is downloaded once and kept in this browser.";
    $("delModel").disabled = st.state === "unsupported";
  }
  function closeModal(save) {
    if (save) {
      const sel = document.querySelector('input[name="engine"]:checked');
      if (sel) store.set(K.engine, sel.value);
      if (sel && sel.value !== "local") store.del(K.serverDown);
      store.set(K.model, $("modelSel").value);
    }
    $("overlay").hidden = true;
    refreshChip();
  }

  /* =====================================================================
     Editor
     ===================================================================== */
  function updateLines() {
    const n = $("pad").value.split("\n").length;
    let s = ""; for (let i = 1; i <= n; i++) s += i + "\n";
    $("lines").textContent = s; $("lines").scrollTop = $("pad").scrollTop;
  }
  function insertAtCursor(t, text) {
    t.focus();
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch (e) { ok = false; }
    if (!ok) { t.setRangeText(text, t.selectionStart, t.selectionEnd, "end"); t.dispatchEvent(new Event("input", { bubbles: true })); }
  }

  /* =====================================================================
     Wiring
     ===================================================================== */
  function randomProblem(diff) {
    let pool = PROBLEMS.filter(p => !solved[p.id] && (!diff || p.diff === diff));
    if (!pool.length) pool = PROBLEMS;
    location.hash = pool[Math.floor(Math.random() * pool.length)].id;
  }
  function route() {
    let id = "";
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { id = ""; }
    if (id && byId.has(id)) showProblem(id); else { cur = null; showHome(); }
  }

  function init() {
    $("siteTitle").textContent = CFG.siteTitle;
    $("courseLabel").textContent = CFG.courseLabel || ""; $("courseLabel").hidden = !CFG.courseLabel;
    $("topicSel").innerHTML = '<option value="All">All topics</option>' + TOPICS.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    document.querySelectorAll(".langseg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.lang === lang));
    const left = store.get(K.left, null); if (left) document.documentElement.style.setProperty("--left", left + "%");
    refreshChip();

    // home
    $("q").addEventListener("input", (e) => { fQ = e.target.value.trim().toLowerCase(); renderList(); });
    document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
      fDiff = b.dataset.diff; document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", x === b)); renderList();
    }));
    $("topicSel").addEventListener("change", (e) => { fTopic = e.target.value; renderTopicStrip(); renderList(); });
    $("statusSel").addEventListener("change", (e) => { fStatus = e.target.value; renderList(); });
    $("topicStrip").addEventListener("click", (e) => { const b = e.target.closest("[data-topic]"); if (!b) return; fTopic = b.dataset.topic; $("topicSel").value = fTopic; renderTopicStrip(); renderList(); });
    $("ptbody").addEventListener("click", (e) => { if (e.target.closest("a")) return; const tr = e.target.closest("tr[data-id]"); if (tr) location.hash = tr.dataset.id; });
    $("startBtn").addEventListener("click", () => randomProblem("Easy"));
    $("howBtn2").addEventListener("click", openModal);
    $("navHow").addEventListener("click", openModal);
    $("aiChip").addEventListener("click", openModal);

    // problem nav
    $("prevBtn").addEventListener("click", () => { if (cur && cur.n > 1) location.hash = PROBLEMS[cur.n - 2].id; });
    $("nextBtn").addEventListener("click", () => { if (cur && cur.n < PROBLEMS.length) location.hash = PROBLEMS[cur.n].id; });
    $("randBtn").addEventListener("click", () => randomProblem());

    // editor
    const pad = $("pad");
    let saveT;
    pad.addEventListener("input", () => {
      updateLines(); if (!cur) return;
      clearTimeout(saveT); const id = cur.id, v = pad.value; saveT = setTimeout(() => store.set(K.draft(id), v), 300);
      if (gen && !$("codeCard").hidden) $("staleNote").hidden = v.trim() === (gen.src || "").trim();
    });
    pad.addEventListener("scroll", () => { $("lines").scrollTop = pad.scrollTop; });
    let escTab = false;
    pad.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { escTab = true; return; }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!$("convertBtn").disabled) convert(false); return; }
      if (e.key === "Tab" && !e.shiftKey && !escTab) { e.preventDefault(); insertAtCursor(pad, "    "); return; }
      if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
        const before = pad.value.slice(0, pad.selectionStart);
        const line = before.slice(before.lastIndexOf("\n") + 1);
        let indent = (line.match(/^[ \t]*/) || [""])[0];
        if (/:\s*$/.test(line)) indent += "    ";
        if (indent) { e.preventDefault(); insertAtCursor(pad, "\n" + indent); }
      }
      escTab = false;
    });
    document.querySelectorAll(".langseg button").forEach(b => b.addEventListener("click", () => setLang(b.dataset.lang)));
    $("c-python").addEventListener("click", () => setLang("python"));
    $("c-java").addEventListener("click", () => setLang("java"));

    // actions
    $("convertBtn").addEventListener("click", () => convert(false));
    $("hintBtn").addEventListener("click", () => feedback("hint", false));
    $("reviewBtn").addEventListener("click", () => feedback("review", false));
    $("runBtn").addEventListener("click", runTests);
    $("rewriteBtn").addEventListener("click", () => {
      $("codeCard").hidden = true; $("testCard").hidden = true; $("fbCard").hidden = true; aiUI.hide(); updateStartNote();
      const t = $("pad"); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
      t.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    $("stopBtn").addEventListener("click", () => { if (ctl) ctl.abort(); if (running) { stopPython(); setTestStatus("Stopped.", ""); if (run) { run.rows.forEach(r => { if (r.state === "wait" || r.state === "running") r.state = "skip"; }); drawTests(); summarize(true); } setBusy(false); } });
    $("copyCodeBtn").addEventListener("click", async () => { const ok = await copyText($("codePre").textContent); toast(ok ? "Code copied." : "Couldn't copy. Select the code and press Ctrl/⌘ + C."); });
    $("dlBtn").addEventListener("click", () => runPending(true));
    $("dlLiteBtn").addEventListener("click", () => { store.set(K.model, CFG.localModels[CFG.localModels.length - 1].id); refreshChip(); runPending(true); });
    $("fbCopyPrompt").addEventListener("click", async () => { const ok = await copyText(lastPrompt); toast(ok ? "Prompt copied. Paste it into Claude.ai or ChatGPT." : "Couldn't copy the prompt."); });
    $("fbUseReply").addEventListener("click", () => {
      const t = $("fbPaste").value.trim(); if (!t) { toast("Paste the AI's reply first."); return; }
      if (pending === "convert" || !pending) { aiUI.hide(); useReply(t, $("pad").value.trim()); }
      else { aiUI.hide(); showFeedback(pending === "hint" ? "Hint" : "Feedback on your logic", t); }
      $("fbPaste").value = "";
    });

    // resizable split
    const g = $("gutter");
    const setLeft = (pct) => { pct = Math.max(25, Math.min(70, pct)); document.documentElement.style.setProperty("--left", pct + "%"); store.set(K.left, Math.round(pct)); };
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault(); g.setPointerCapture(e.pointerId);
      const rect = $("split").getBoundingClientRect();
      const move = (ev) => setLeft(((ev.clientX - rect.left) / rect.width) * 100);
      const up = () => { g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); };
      g.addEventListener("pointermove", move); g.addEventListener("pointerup", up);
    });
    g.addEventListener("keydown", (e) => {
      const curPct = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--left")) || 44;
      if (e.key === "ArrowLeft") { e.preventDefault(); setLeft(curPct - 3); }
      if (e.key === "ArrowRight") { e.preventDefault(); setLeft(curPct + 3); }
    });

    // modal
    $("closeModal").addEventListener("click", () => closeModal(false));
    $("saveModal").addEventListener("click", () => closeModal(true));
    $("overlay").addEventListener("click", (e) => { if (e.target === $("overlay")) closeModal(false); });
    $("delModel").addEventListener("click", async () => {
      try {
        const w = await lib(), base = $("modelSel").value;
        if (engine) { try { await engine.unload(); } catch (e) { /* ignore */ } engine = null; engineId = null; }
        if (llmWorker) { llmWorker.terminate(); llmWorker = null; }
        await w.deleteModelAllInfoInCache(localId(base, true)).catch(() => {});
        await w.deleteModelAllInfoInCache(localId(base, false)).catch(() => {});
        toast("Downloaded model deleted from this browser."); refreshChip();
      } catch (e) { toast("Couldn't delete the model."); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("overlay").hidden) closeModal(false); });

    window.addEventListener("hashchange", route);
    route();
  }

  if (!PROBLEMS.length) { document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px">Problem data failed to load (js/problems.js).</p>'); return; }
  init();
})();
