/* Logic First — app logic. No build step, no dependencies. */
(function () {
  "use strict";

  const CFG = Object.assign({
    siteTitle: "Logic First", courseLabel: "", proxyUrl: "",
    apiModels: [{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" }],
    claudeChatUrl: "https://claude.ai/new"
  }, window.LF_CONFIG || {});
  const PROBLEMS = window.LF_PROBLEMS || [];
  const byId = new Map(PROBLEMS.map(p => [p.id, p]));
  const TOPICS = [...new Set(PROBLEMS.map(p => p.topic))];
  const LANGS = {
    python: { name: "Python", tag: "python" }, java: { name: "Java", tag: "java" },
    cpp: { name: "C++", tag: "cpp" }, c: { name: "C", tag: "c" }, javascript: { name: "JavaScript", tag: "javascript" }
  };
  const MODE_LABEL = { claude: "Claude: built in", proxy: "Class server", copy: "Copy & paste mode", apikey: "API key mode" };

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
    solved: "lf2:solved", tried: "lf2:tried", lang: "lf2:lang", mode: "lf2:mode", key: "lf2:apikey", model: "lf2:model", left: "lf2:left",
    draft: (id) => "lf2:draft:" + id, gen: (id) => "lf2:gen:" + id
  };
  let solved = store.get(K.solved, {});
  let tried = store.get(K.tried, {});
  let lang = LANGS[store.get(K.lang, "python")] ? store.get(K.lang, "python") : "python";

  /* ---------- value helpers (match instructor-tools/build.mjs) ---------- */
  const keyOf = (v) => { if (v === undefined) return "undefined"; const s = JSON.stringify(v); return s === undefined ? String(v) : s; };
  const normalize = (v, cmp) => {
    if (!Array.isArray(v)) return v;
    if (cmp === "sorted") return [...v].sort((a, b) => { const x = keyOf(a), y = keyOf(b); return x < y ? -1 : x > y ? 1 : 0; });
    if (cmp === "sortedDeep") return normalize(v.map(x => (Array.isArray(x) ? normalize(x, "sorted") : x)), "sorted");
    return v;
  };
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
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }
  async function copyText(text, fallbackPre) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try {
        const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); if (ok) return true;
      } catch (e2) { /* fall through */ }
      if (fallbackPre) { const d = fallbackPre.closest("details"); if (d) d.open = true; const r = document.createRange(); r.selectNodeContents(fallbackPre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      return false;
    }
  }

  /* =====================================================================
     Claude access: built in (claude.ai), class proxy, API key, or copy & paste
     ===================================================================== */
  let sampleFn = null;
  const samplePromise = (window.claude && typeof window.claude.use === "function")
    ? window.claude.use("sample").then(s => { sampleFn = s || null; return sampleFn; }).catch(() => null)
    : Promise.resolve(null);

  function availableModes() { const m = []; if (sampleFn) m.push("claude"); if (CFG.proxyUrl) m.push("proxy"); m.push("copy", "apikey"); return m; }
  function currentMode() {
    const saved = store.get(K.mode, null), av = availableModes();
    if (saved && av.includes(saved)) return saved;
    if (sampleFn) return "claude";
    if (CFG.proxyUrl) return "proxy";
    if (store.get(K.key, "")) return "apikey";
    return "copy";
  }
  function refreshChip() { $("aiChipText").textContent = MODE_LABEL[currentMode()]; }

  let ctl = null;
  const friendly = (message, extra) => Object.assign({ message }, extra || {});

  async function askClaude(prompt, purpose, onText) {
    const mode = currentMode();
    ctl = new AbortController();
    const signal = ctl.signal;

    if (mode === "claude") {
      try {
        const r = await sampleFn(prompt, {
          signal, modelTier: purpose === "hint" ? "quick" : "default", cache: purpose === "code",
          onText: onText ? ({ text }) => onText(text) : undefined
        });
        return r.text;
      } catch (e) {
        const c = e && e.code;
        if (c === "cancelled") throw friendly("Stopped.", { cancelled: true });
        if (["not_granted", "sampling_disabled", "capability_disabled", "not_declared", "capability_removed"].includes(c)) {
          sampleFn = null; store.set(K.mode, "copy"); refreshChip();
          throw friendly("Claude isn't allowed for this page, so we switched to copy & paste mode. Press the button again.");
        }
        if (c === "rate_limited") throw friendly("Too many requests right now. Wait a minute, then try again.");
        if (c === "session_expired") throw friendly("Your Claude session expired. Sign in again, then retry.");
        if (c === "refused") throw friendly("Claude declined this request. Edit your pseudocode and try again.");
        if (c === "prompt_too_large") throw friendly("Your pseudocode is too long. Shorten it and try again.");
        throw friendly("Couldn't reach Claude. Try again in a moment.");
      }
    }

    let res;
    try {
      if (mode === "proxy") {
        res = await fetch(CFG.proxyUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, purpose }), signal });
      } else if (mode === "apikey") {
        const key = store.get(K.key, "");
        if (!key) throw friendly("Add your Anthropic API key first: click the mode button in the top bar.");
        const models = CFG.apiModels || [];
        let model = store.get(K.model, models[0] && models[0].id);
        if (purpose === "hint" && models.length > 1) model = models[models.length - 1].id;
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", signal,
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify({ model, max_tokens: purpose === "code" ? 4000 : 800, messages: [{ role: "user", content: prompt }] })
        });
      } else {
        throw friendly("Copy & paste mode doesn't call Claude directly.");
      }
    } catch (e) {
      if (e && e.name === "AbortError") throw friendly("Stopped.", { cancelled: true });
      if (e && e.message && !(e instanceof TypeError)) throw e;
      throw friendly(mode === "proxy" ? "Couldn't reach the class server. Check your connection, or switch to copy & paste mode." : "Couldn't reach Claude's API. Check your connection.");
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON body */ }
    if (!res.ok) {
      const msg = data && (data.error && (data.error.message || data.error)) || "";
      if (res.status === 401) throw friendly(mode === "apikey" ? "The API key was rejected. Check it in settings." : "The class server's API key was rejected. Tell your instructor.");
      if (res.status === 429) throw friendly("Rate limit reached. Wait a minute, then try again.");
      if (res.status === 400 && /credit|billing/i.test(String(msg))) throw friendly("That API account is out of credit. Add credit at console.anthropic.com or use copy & paste mode.");
      if (res.status === 403) throw friendly(mode === "proxy" ? "The class server refused this request (wrong site address?). Tell your instructor." : "This API key isn't allowed to make this request.");
      if (res.status >= 500) throw friendly("Claude is busy right now. Try again in a moment.");
      throw friendly("Request failed" + (msg ? ": " + String(msg) : "."));
    }
    const text = mode === "proxy" ? (data && data.text) : (data && Array.isArray(data.content) ? data.content.filter(b => b.type === "text").map(b => b.text).join("") : "");
    if (!text) throw friendly("Claude sent back an empty reply. Try again.");
    if (onText) onText(text);
    return text;
  }

  /* ---------- prompts ---------- */
  const usesNodes = (p) => [p.returns, ...p.params.map(x => x[1])].some(t => t === "ListNode" || t === "TreeNode");
  const sigText = (p) => `${p.fn}(${p.params.map(([n, t]) => `${n}: ${t}`).join(", ")}) -> ${p.returns}`;
  function problemBlock(p) {
    const ex = p.tests.slice(0, 2).map(t => `  ${fmtArgs(p, t.args)}  ->  ${expectedText(t)}`).join("\n");
    return `PROBLEM: ${p.title}\n${p.text}\n${p.notes.length ? "Notes: " + p.notes.join(" ") + "\n" : ""}Function: ${sigText(p)}\nExamples:\n${ex}`;
  }
  function translatePrompt(p, pc, lg) {
    const names = p.params.map(x => x[0]).join(", ");
    const struct = usesNodes(p) ? " ListNode has fields val and next; TreeNode has fields val, left and right. In JavaScript these classes already exist as ListNode(val, next) and TreeNode(val, left, right): use them and do not declare them." : "";
    const other = lg !== "javascript";
    return `You are the code generator for a coding-practice site. Students write ONLY the algorithm as pseudocode; you write the code.

${problemBlock(p)}

STUDENT PSEUDOCODE:
"""
${pc}
"""

Rules:
1. Translate the student's logic faithfully, step by step. Do NOT fix mistakes, do NOT switch to a different algorithm, and do NOT add edge-case handling they did not describe. If their logic is wrong, the code must be wrong in the same way, because tests run on your code to grade THEIR logic.
2. Fill in only mechanical details: syntax, declarations, the obvious data structure for a named concept ("a set", "a map", "a queue"), and loop bounds that are clearly implied.
3. Where a step is ambiguous, pick the most literal reasonable reading and list it under ASSUMPTIONS. If the pseudocode is empty, unrelated to this problem, or too vague to translate, write one ASSUMPTIONS line explaining why and output no code blocks.
4. The JavaScript must be one function declaration named ${p.fn} with parameters (${names}). Put helpers inside it. No imports, input/output, console.log or test code.${struct}${other ? `
5. Then write the same logic in ${LANGS[lg].name}: idiomatic and readable, with a short comment above each major step that echoes the student's wording, and types that match the signature.` : ""}

Reply in exactly this format and nothing else:

ASSUMPTIONS:
- (one short line each, or "- none")

\`\`\`javascript
(the JavaScript function)
\`\`\`${other ? `

\`\`\`${LANGS[lg].tag}
(the ${LANGS[lg].name} version)
\`\`\`` : ""}`;
  }
  function hintPrompt(p, pc) {
    return `A student is practising algorithms by writing pseudocode.

${problemBlock(p)}

${pc ? `Their current draft:\n"""\n${pc}\n"""\n\n` : "They have not written anything yet.\n\n"}Give ONE short hint, at most two sentences, that nudges them toward the key idea${pc ? " or the next fix their draft needs" : ""}. Do not write pseudocode or code, and do not reveal the full algorithm. Plain text only.`;
  }
  function reviewPrompt(p, pc) {
    const rows = run.rows;
    const fails = rows.filter(r => !r.pass).slice(0, 3);
    const results = fails.length
      ? `Passed ${rows.length - rows.filter(r => !r.pass).length} of ${rows.length} tests. Failing cases:\n` + fails.map(r => `- input ${clip(r.input, 400)} | expected ${clip(r.expected, 200)} | got ${r.error ? "an error: " + r.error : clip(r.got, 200)}`).join("\n")
      : `All ${rows.length} tests passed.`;
    return `You are a friendly algorithms tutor. A student wrote pseudocode, it was translated literally into JavaScript, and tests were run.

${problemBlock(p)}

STUDENT PSEUDOCODE:
"""
${pc}
"""

GENERATED JAVASCRIPT:
${gen ? gen.js : "(none)"}

TEST RESULTS:
${results}

Write feedback in under 150 words, plain text, no headings or markdown.
- If tests failed: name the flaw in their LOGIC, trace one failing input briefly to show where it goes wrong, and say what to reconsider without writing the corrected solution. If the failure was caused by the translation rather than their logic, say so plainly.
- If all passed: give the time and space complexity of their approach and one improvement or edge case worth thinking about.`;
  }

  function parseReply(text) {
    const blocks = [];
    const re = /```([^\n`]*)\n([\s\S]*?)```/g; let m;
    while ((m = re.exec(text))) blocks.push({ tag: m[1].trim().toLowerCase(), body: m[2].replace(/\s+$/, "") });
    const jsTags = ["js", "javascript", "node", "jsx", "mjs"];
    let js = blocks.find(b => jsTags.includes(b.tag));
    let other = blocks.find(b => b !== js && b.tag && !jsTags.includes(b.tag)) || null;
    if (!js) { const untagged = blocks.find(b => !b.tag && /function\s+\w+\s*\(/.test(b.body)); if (untagged) js = untagged; }
    if (!js && !blocks.length && /function\s+\w+\s*\(/.test(text)) js = { body: text.trim() };
    const assumptions = [];
    const am = text.match(/ASSUMPTIONS:\s*\n([\s\S]*?)(?:```|$)/i);
    if (am) am[1].split("\n").forEach(l => { if (/^\s*[-*•]/.test(l)) { const t = l.replace(/^\s*[-*•]\s*/, "").trim(); if (t && !/^\(?none\)?\.?$/i.test(t)) assumptions.push(t); } });
    if (!js && !assumptions.length && text.trim()) assumptions.push(clip(text.trim(), 400));
    return { js: js ? js.body : "", code: other ? other.body : "", assumptions: assumptions.slice(0, 6) };
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
      (fDiff === "All" || p.diff === fDiff) &&
      (fTopic === "All" || p.topic === fTopic) &&
      (fStatus === "All" || (fStatus === "solved" ? !!solved[p.id] : !solved[p.id])) &&
      (!fQ || (p.title + " " + p.topic + " " + p.n).toLowerCase().includes(fQ)));
  }
  function renderList() {
    const rows = filtered();
    $("ptbody").innerHTML = rows.map(p => {
      const st = solved[p.id] ? "done" : tried[p.id] ? "tried" : "";
      const stLabel = solved[p.id] ? "Solved" : tried[p.id] ? "Attempted" : "Not started";
      return `<tr data-id="${p.id}"><td><span class="st-dot ${st}" role="img" aria-label="${stLabel}" title="${stLabel}"></span></td><td class="num">${p.n}</td><td><a href="#${p.id}">${esc(p.title)}</a></td><td class="topic">${esc(p.topic)}</td><td><span class="diff ${p.diff}">${p.diff}</span></td></tr>`;
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
     PROBLEM
     ===================================================================== */
  let cur = null, gen = null, run = null, worker = null, codeView = "lang", pendingLang = null, pendingPrompt = "", fbPromptText = "";

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
      <p class="fine" style="margin-top:18px">Your logic is checked against ${p.tests.length} test cases. The first two are shown above.</p>`;
    $("desc").scrollTop = 0;
  }

  function showProblem(id) {
    const p = byId.get(id);
    abortAll();
    cur = p;
    $("view-home").hidden = true; $("view-problem").hidden = false;
    document.title = `${p.title} · ${CFG.siteTitle}`;
    renderDesc(p);
    $("pIndex").textContent = `${p.n} of ${PROBLEMS.length}`;
    $("prevBtn").disabled = p.n === 1; $("nextBtn").disabled = p.n === PROBLEMS.length;
    $("pad").value = store.get(K.draft(id), ""); updateLines();
    gen = store.get(K.gen(id), null); run = null; codeView = "lang";
    $("status").hidden = true; $("testsWrap").hidden = true; $("testsEmpty").hidden = false;
    $("copyFlow").hidden = true; $("pasteBox").value = "";
    $("fbBox").hidden = true; $("fbCopy").hidden = true; $("fbEmpty").hidden = false;
    $("reviewBtn").disabled = true;
    setTabCount("");
    if (gen) renderCode(); else { $("codeWrap").hidden = true; $("codeEmpty").hidden = false; }
    selectTab("tests");
    window.scrollTo(0, 0);
  }

  function setStatus(msg, kind) { const s = $("status"); s.className = "status" + (kind ? " " + kind : ""); s.textContent = msg || ""; s.hidden = !msg; if (msg) $("testsEmpty").hidden = true; }
  function setTabCount(txt) { $("t-tests").innerHTML = "Test results" + (txt ? ` <span class="count">${esc(txt)}</span>` : ""); }
  function selectTab(name) {
    ["tests", "code", "feedback"].forEach(t => { $("t-" + t).setAttribute("aria-selected", t === name); $("p-" + t).hidden = t !== name; });
  }
  function setBusy(b) {
    $("goBtn").disabled = b; $("hintBtn").disabled = b; $("stopBtn").hidden = !b;
    $("reviewBtn").disabled = b || !run || !run.done;
  }
  function markTried(p) { if (!tried[p.id]) { tried[p.id] = true; store.set(K.tried, tried); } }

  function renderCode() {
    if (!gen) return;
    $("codeEmpty").hidden = true; $("codeWrap").hidden = false;
    const hasOther = !!gen.code && gen.lang !== "javascript";
    if (!hasOther) codeView = "js";
    $("c-lang").hidden = !hasOther;
    $("c-lang").textContent = hasOther ? LANGS[gen.lang].name : "";
    $("c-js").textContent = hasOther ? "JavaScript (tested)" : "JavaScript";
    $("c-lang").setAttribute("aria-selected", codeView === "lang");
    $("c-js").setAttribute("aria-selected", codeView === "js");
    $("codePre").textContent = (codeView === "js" ? gen.js : gen.code) || "(Claude did not produce code for this attempt.)";
    $("copyCodeBtn").disabled = !(codeView === "js" ? gen.js : gen.code);
    $("assumeList").innerHTML = (gen.assumptions || []).map(a => `<li>${esc(a)}</li>`).join("");
    $("assumeWrap").hidden = !(gen.assumptions || []).length;
  }

  function useReply(text, lg) {
    const p = cur;
    const r = parseReply(text);
    if (r.js.trim()) $("copyFlow").hidden = true;
    gen = { js: r.js, code: r.code, lang: lg, assumptions: r.assumptions };
    store.set(K.gen(p.id), gen);
    codeView = "lang";
    renderCode();
    if (!r.js.trim()) {
      selectTab("tests");
      setStatus("No runnable JavaScript came back, so the tests didn't run. " + (r.assumptions[0] ? "Claude said: " + r.assumptions[0] : "Make sure your pseudocode describes the whole algorithm."), "warn");
      return;
    }
    setStatus("");
    selectTab("tests");
    runTests(p, r.js);
  }

  async function generate() {
    const p = cur, pc = $("pad").value.trim();
    if (!pc) { selectTab("tests"); setStatus("Write your algorithm in the editor first.", "warn"); $("pad").focus(); return; }
    markTried(p);
    const lg = lang;
    const prompt = translatePrompt(p, pc, lg);
    if (currentMode() === "copy") {
      pendingPrompt = prompt; pendingLang = lg;
      $("promptText").textContent = prompt; $("pasteBox").value = "";
      $("copyFlow").hidden = false; $("codeEmpty").hidden = true;
      selectTab("code");
      const ok = await copyText(prompt, $("promptText"));
      toast(ok ? "Prompt copied. Paste it into Claude, then paste the reply below." : "Select the prompt text and copy it.");
      return;
    }
    killWorker();
    selectTab("tests"); $("testsWrap").hidden = true;
    setStatus("Claude is translating your steps into code. This usually takes 10 to 40 seconds.", "busy");
    setBusy(true);
    try {
      const text = await askClaude(prompt, "code");
      if (cur !== p) return;
      useReply(text, lg);
    } catch (e) {
      if (cur === p) setStatus(e.message || "Something went wrong.", e.cancelled ? "" : "err");
    } finally { if (cur === p) setBusy(false); }
  }

  function showFeedback(label, text) {
    $("fbEmpty").hidden = true; $("fbCopy").hidden = true;
    const b = $("fbBox"); b.hidden = false;
    b.innerHTML = `<span class="who">${esc(label)}</span>${esc(text)}`;
  }
  async function askForFeedback(kind) {
    const p = cur, pc = $("pad").value.trim();
    const prompt = kind === "hint" ? hintPrompt(p, pc) : reviewPrompt(p, pc);
    const label = kind === "hint" ? "Hint" : "Feedback on your logic";
    selectTab("feedback");
    if (currentMode() === "copy") {
      fbPromptText = prompt;
      $("fbEmpty").hidden = true; $("fbBox").hidden = true; $("fbCopy").hidden = false;
      $("fbPrompt").textContent = prompt;
      const ok = await copyText(prompt, $("fbPrompt"));
      toast(ok ? "Prompt copied. Paste it into Claude." : "Select the prompt text and copy it.");
      return;
    }
    showFeedback(label, "Thinking…");
    setBusy(true);
    try { await askClaude(prompt, kind, (t) => { if (cur === p) showFeedback(label, t); }); }
    catch (e) { if (cur === p) showFeedback(label, e.message || "Something went wrong."); }
    finally { if (cur === p) setBusy(false); }
  }

  /* =====================================================================
     Test runner: the generated JavaScript runs in a Web Worker with a time limit
     ===================================================================== */
  function HARNESS() {
    const LN = class ListNode { constructor(val = 0, next = null) { this.val = val; this.next = next; } };
    const TN = class TreeNode { constructor(val = 0, left = null, right = null) { this.val = val; this.left = left; this.right = right; } };
    self.ListNode = LN; self.TreeNode = TN;
    const toList = (a) => { let h = null; for (let i = a.length - 1; i >= 0; i--) h = new LN(a[i], h); return h; };
    const fromList = (h) => { if (Array.isArray(h)) return h; const a = []; let g = 0; while (h && g++ < 100000) { a.push(h.val); h = h.next; } return a; };
    const toTree = (a) => {
      if (!a.length || a[0] == null) return null;
      const root = new TN(a[0]); const q = [root]; let i = 1;
      while (q.length && i < a.length) {
        const n = q.shift();
        if (i < a.length && a[i] != null) { n.left = new TN(a[i]); q.push(n.left); } i++;
        if (i < a.length && a[i] != null) { n.right = new TN(a[i]); q.push(n.right); } i++;
      }
      return root;
    };
    const fromTree = (r) => {
      if (Array.isArray(r)) return r;
      const out = [], q = [r]; let g = 0;
      while (q.length && g++ < 100000) { const n = q.shift(); if (n) { out.push(n.val); q.push(n.left || null, n.right || null); } else out.push(null); }
      while (out.length && out[out.length - 1] == null) out.pop();
      return out;
    };
    const expand = (v) => (v && typeof v === "object" && !Array.isArray(v) && v.$gen === "spread") ? Array.from({ length: v.n }, (_, i) => ((i * 7919) % 50021) - 25000) : v;
    const toArg = (v, t) => { v = expand(v); return t === "ListNode" ? toList(v) : t === "TreeNode" ? toTree(v) : v; };
    const fromRet = (v, t) => (t === "ListNode" ? fromList(v) : t === "TreeNode" ? fromTree(v) : v);
    const keyOf = (v) => { if (v === undefined) return "undefined"; const s = JSON.stringify(v); return s === undefined ? String(v) : s; };
    const normalize = (v, cmp) => {
      if (!Array.isArray(v)) return v;
      if (cmp === "sorted") return [...v].sort((a, b) => { const x = keyOf(a), y = keyOf(b); return x < y ? -1 : x > y ? 1 : 0; });
      if (cmp === "sortedDeep") return normalize(v.map(x => (Array.isArray(x) ? normalize(x, "sorted") : x)), "sorted");
      return v;
    };
    const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
    let logs = [];
    const show = (a) => { try { return typeof a === "string" ? a : JSON.stringify(a); } catch (e) { return String(a); } };
    const log = (...a) => { if (logs.length < 10) logs.push(a.map(show).join(" ")); };
    self.console = { log, info: log, warn: log, error: log, debug: log };
    self.onmessage = (e) => {
      const { tests, ptypes, rtype, cmp, fn: fname } = e.data;
      const fn = self.__getFn && self.__getFn();
      if (typeof fn !== "function") { self.postMessage({ type: "compile", error: "The generated code has no function named " + fname + "." }); return; }
      for (let i = 0; i < tests.length; i++) {
        logs = [];
        self.postMessage({ type: "start", i });
        const t0 = performance.now();
        let got, error = null;
        try { got = fromRet(fn(...tests[i].map((a, j) => toArg(a, ptypes[j]))), rtype); }
        catch (err) { error = String((err && err.message) || err); }
        const ms = Math.round(performance.now() - t0);
        let key = null, hash = null, preview = "";
        if (!error) {
          try { const raw = keyOf(got); preview = raw.length > 300 ? raw.slice(0, 300) + "…" : raw; key = keyOf(normalize(got, cmp)); hash = fnv(key); if (key.length > 200000) key = null; }
          catch (err) { error = "Could not read the returned value."; }
        }
        self.postMessage({ type: "result", i, key, hash, preview, error, ms, logs });
      }
      self.postMessage({ type: "done" });
    };
  }

  function killWorker() { if (worker) { worker.terminate(); worker = null; } }
  function abortAll() { if (ctl) { ctl.abort(); ctl = null; } killWorker(); setBusy(false); }

  function runTests(p, js) {
    killWorker();
    const rows = p.tests.map(t => ({ input: fmtArgs(p, t.args), expected: expectedText(t), got: "", error: null, pass: false, state: "wait", logs: [], ms: 0 }));
    run = { rows, done: false };
    $("testsEmpty").hidden = true; $("testsWrap").hidden = false;
    drawTests(); summarize();
    setBusy(true);

    const src = "(" + HARNESS.toString() + ")();\n" + js + `\n;self.__getFn = function () { return (typeof ${p.fn} === "function") ? ${p.fn} : undefined; };\n`;
    let url;
    try { url = URL.createObjectURL(new Blob([src], { type: "text/javascript" })); worker = new Worker(url); }
    catch (e) { setStatus("Your browser blocked the test runner, so the tests could not run.", "err"); setBusy(false); return; }
    const w = worker, LIMIT = 3000;
    let timer = null, curI = 0;
    const arm = () => { clearTimeout(timer); timer = setTimeout(onTimeout, LIMIT); };
    const finish = () => {
      clearTimeout(timer);
      if (worker === w) { w.terminate(); worker = null; }
      URL.revokeObjectURL(url);
      run.done = true; drawTests(); summarize(true); setBusy(false);
      if (rows.every(r => r.pass)) {
        if (!solved[p.id]) { solved[p.id] = true; store.set(K.solved, solved); toast("Solved! Every test passed."); renderDesc(p); }
      }
    };
    function onTimeout() {
      rows.forEach((r, i) => {
        if (r.state !== "wait" && r.state !== "running") return;
        if (i === curI) { r.state = "tle"; r.error = "Took longer than 3 seconds. Look for an infinite loop, or an approach that is too slow for this input."; }
        else r.state = "skip";
      });
      finish();
    }
    w.onmessage = (ev) => {
      if (worker !== w) return;
      const m = ev.data;
      if (m.type === "compile") { rows.forEach(r => { r.state = "skip"; }); setStatus("The generated code couldn't run: " + m.error, "err"); finish(); return; }
      if (m.type === "start") { curI = m.i; rows[m.i].state = "running"; arm(); return; }
      if (m.type === "result") {
        const r = rows[m.i], t = p.tests[m.i];
        r.ms = m.ms; r.logs = m.logs || []; r.error = m.error; r.got = m.error ? "" : m.preview;
        r.pass = !m.error && (t.expectedHash ? m.hash === t.expectedHash : m.key === keyOf(normalize(t.expected, p.cmp)));
        r.state = r.pass ? "pass" : "fail";
        drawTests(); summarize();
        return;
      }
      if (m.type === "done") finish();
    };
    w.onerror = (ev) => {
      ev.preventDefault();
      if (worker !== w) return;
      rows.forEach(r => { if (r.state === "wait" || r.state === "running") r.state = "skip"; });
      setStatus("The generated JavaScript has an error and couldn't start: " + (ev.message || "syntax error") + ". Press Generate again.", "err");
      finish();
    };
    arm();
    w.postMessage({ tests: p.tests.map(t => t.args), ptypes: p.params.map(x => x[1]), rtype: p.returns, cmp: p.cmp, fn: p.fn });
  }

  function drawTests() {
    const label = { pass: "Pass", fail: "Fail", wait: "Waiting", running: "Running…", tle: "Too slow", skip: "Not run" };
    const cls = { pass: "pass", fail: "fail", tle: "fail", wait: "wait", running: "wait", skip: "wait" };
    $("tbody").innerHTML = run.rows.map((r, i) => `
      <tr>
        <td class="n">${i + 1}</td>
        <td class="mono">${esc(clip(r.input))}</td>
        <td class="mono">${esc(clip(r.expected))}</td>
        <td class="mono">${r.error ? "—" : esc(clip(r.got || ""))}${r.error ? `<span class="sub">${esc(clip(r.error, 220))}</span>` : ""}${r.logs.length ? `<span class="sub">printed: ${esc(clip(r.logs.join(" | "), 200))}</span>` : ""}</td>
        <td><span class="res ${cls[r.state]}">${label[r.state]}</span></td>
      </tr>`).join("");
  }
  function summarize(done) {
    const n = run.rows.filter(r => r.pass).length, all = run.rows.length;
    const pill = $("tPill");
    if (!done) { pill.className = "pill"; pill.textContent = `Running · ${n}/${all}`; $("tMeta").textContent = ""; setTabCount(""); return; }
    pill.className = "pill " + (n === all ? "pass" : "fail");
    pill.textContent = n === all ? `All ${all} passed` : `${n} of ${all} passed`;
    const slow = Math.max(0, ...run.rows.map(r => r.ms || 0));
    $("tMeta").textContent = n === all ? `Slowest test: ${slow} ms` : "Open the failing rows to see where your logic differs.";
    setTabCount(`${n}/${all}`);
  }

  /* =====================================================================
     Settings modal
     ===================================================================== */
  function openModal() {
    const av = availableModes(), cm = currentMode();
    $("mode-claude").hidden = !av.includes("claude");
    $("mode-proxy").hidden = !av.includes("proxy");
    document.querySelectorAll('input[name="mode"]').forEach(r => { r.checked = r.value === cm; });
    $("apiModel").innerHTML = (CFG.apiModels || []).map(m => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join("");
    $("apiModel").value = store.get(K.model, (CFG.apiModels[0] || {}).id);
    $("apiKey").value = store.get(K.key, "");
    $("keybox").hidden = cm !== "apikey";
    $("overlay").hidden = false;
    $("closeModal").focus();
  }
  function closeModal(save) {
    if (save) {
      const sel = document.querySelector('input[name="mode"]:checked');
      if (sel) store.set(K.mode, sel.value);
      const key = $("apiKey").value.trim();
      if (key) store.set(K.key, key);
      if ($("apiModel").value) store.set(K.model, $("apiModel").value);
      if (sel && sel.value === "apikey" && !key) toast("Add an API key to use this mode.");
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
    $("lines").textContent = s;
    $("lines").scrollTop = $("pad").scrollTop;
  }
  function insertAtCursor(t, text) {
    t.focus();
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch (e) { ok = false; }
    if (!ok) { const s = t.selectionStart, e = t.selectionEnd; t.setRangeText(text, s, e, "end"); }
    t.dispatchEvent(new Event("input", { bubbles: true }));
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
    $("openClaude").href = CFG.claudeChatUrl; $("fbOpen").href = CFG.claudeChatUrl;
    $("topicSel").innerHTML = '<option value="All">All topics</option>' + TOPICS.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    $("lang").value = lang;
    const left = store.get(K.left, null); if (left) document.documentElement.style.setProperty("--left", left + "%");
    refreshChip();
    samplePromise.then(refreshChip);

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
    pad.addEventListener("input", () => { updateLines(); if (!cur) return; clearTimeout(saveT); const id = cur.id, v = pad.value; saveT = setTimeout(() => store.set(K.draft(id), v), 300); });
    pad.addEventListener("scroll", () => { $("lines").scrollTop = pad.scrollTop; });
    let escTab = false;
    pad.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { escTab = true; return; }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!$("goBtn").disabled) generate(); return; }
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
    $("lang").addEventListener("change", (e) => {
      lang = e.target.value; store.set(K.lang, lang);
      if (gen && gen.lang !== lang) toast(`Next run will also show ${LANGS[lang].name}.`);
    });

    // actions
    $("goBtn").addEventListener("click", generate);
    $("hintBtn").addEventListener("click", () => askForFeedback("hint"));
    $("reviewBtn").addEventListener("click", () => askForFeedback("review"));
    $("stopBtn").addEventListener("click", () => { if (ctl) ctl.abort(); if (worker) { killWorker(); setStatus("Stopped.", ""); setBusy(false); } });
    ["tests", "code", "feedback"].forEach(t => $("t-" + t).addEventListener("click", () => selectTab(t)));
    $("c-lang").addEventListener("click", () => { codeView = "lang"; renderCode(); });
    $("c-js").addEventListener("click", () => { codeView = "js"; renderCode(); });
    $("copyCodeBtn").addEventListener("click", async () => { const ok = await copyText($("codePre").textContent, $("codePre")); toast(ok ? "Code copied." : "Code selected. Press Ctrl/⌘ + C."); });
    $("copyPromptBtn").addEventListener("click", async () => { const ok = await copyText(pendingPrompt, $("promptText")); toast(ok ? "Prompt copied. Paste it into Claude." : "Select the prompt text and copy it."); });
    $("runPastedBtn").addEventListener("click", () => {
      const t = $("pasteBox").value.trim();
      if (!t) { toast("Paste Claude's reply first."); $("pasteBox").focus(); return; }
      useReply(t, pendingLang || lang);
    });
    $("fbCopyBtn").addEventListener("click", async () => { const ok = await copyText(fbPromptText, $("fbPrompt")); toast(ok ? "Prompt copied. Paste it into Claude." : "Select the prompt text and copy it."); });

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
    $("modes").addEventListener("change", () => { const sel = document.querySelector('input[name="mode"]:checked'); $("keybox").hidden = !sel || sel.value !== "apikey"; });
    $("closeModal").addEventListener("click", () => closeModal(false));
    $("saveModal").addEventListener("click", () => closeModal(true));
    $("overlay").addEventListener("click", (e) => { if (e.target === $("overlay")) closeModal(false); });
    $("forgetKey").addEventListener("click", () => { store.del(K.key); $("apiKey").value = ""; if (store.get(K.mode) === "apikey") store.set(K.mode, "copy"); toast("Saved key removed."); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("overlay").hidden) closeModal(false); });

    window.addEventListener("hashchange", route);
    route();
  }

  if (!PROBLEMS.length) { document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px">Problem data failed to load (js/problems.js).</p>'); return; }
  init();
})();
