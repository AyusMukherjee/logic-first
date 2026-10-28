/* Runs the student's generated Python against the test cases, inside the browser (Pyodide).
   The page starts this worker, sends {type:"run"}, and terminates it if a test takes too long. */
/* global loadPyodide */
let pyReady = null;

const HARNESS = String.raw`
import json, sys, io, re, traceback, contextlib

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
    def __repr__(self):
        return "ListNode(" + repr(self.val) + ")"

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
    def __repr__(self):
        return "TreeNode(" + repr(self.val) + ")"

def _lf_to_list(a):
    head = None
    for v in reversed(a):
        head = ListNode(v, head)
    return head

def _lf_from_list(h):
    if isinstance(h, list):
        return h
    out, guard = [], 0
    while h is not None and guard < 100000:
        out.append(h.val)
        h = h.next
        guard += 1
    return out

def _lf_to_tree(a):
    if not a or a[0] is None:
        return None
    root = TreeNode(a[0]); q = [root]; i = 1
    while q and i < len(a):
        n = q.pop(0)
        if i < len(a) and a[i] is not None:
            n.left = TreeNode(a[i]); q.append(n.left)
        i += 1
        if i < len(a) and a[i] is not None:
            n.right = TreeNode(a[i]); q.append(n.right)
        i += 1
    return root

def _lf_from_tree(r):
    if isinstance(r, list):
        return r
    out, q, guard = [], [r], 0
    while q and guard < 100000:
        n = q.pop(0); guard += 1
        if n is not None:
            out.append(n.val); q.append(getattr(n, "left", None)); q.append(getattr(n, "right", None))
        else:
            out.append(None)
    while out and out[-1] is None:
        out.pop()
    return out

def _lf_expand(v):
    if isinstance(v, dict) and v.get("$gen") == "spread":
        return [((i * 7919) % 50021) - 25000 for i in range(v["n"])]
    return v

def _lf_plain(v):
    if isinstance(v, (list, tuple)):
        return [_lf_plain(x) for x in v]
    if isinstance(v, (set, frozenset)):
        return sorted((_lf_plain(x) for x in v), key=lambda x: json.dumps(x))
    if isinstance(v, dict):
        return {str(k): _lf_plain(x) for k, x in v.items()}
    if isinstance(v, (bool, int, float, str)) or v is None:
        return v
    if hasattr(v, "val") and hasattr(v, "next"):
        return _lf_from_list(v)
    if hasattr(v, "val") and hasattr(v, "left"):
        return _lf_from_tree(v)
    return str(v)

def _lf_where(tb):
    line = None
    for fr in traceback.extract_tb(tb):
        if fr.filename == "solution.py":
            line = fr.lineno
    return (" (line " + str(line) + ")") if line else ""

_LF_G = {}

def _lf_load(code, name):
    global _LF_G
    _LF_G = {"__name__": "solution", "ListNode": ListNode, "TreeNode": TreeNode}
    try:
        exec(compile(code, "solution.py", "exec"), _LF_G)
    except SyntaxError as e:
        return json.dumps({"ok": False, "error": "SyntaxError on line " + str(e.lineno) + ": " + str(e.msg)})
    except BaseException as e:
        return json.dumps({"ok": False, "error": type(e).__name__ + ": " + str(e) + _lf_where(e.__traceback__)})
    snake = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
    fn = None
    for cand in (name, snake):
        f = _LF_G.get(cand)
        if callable(f) and not isinstance(f, type):
            fn = f; break
    if fn is None and isinstance(_LF_G.get("Solution"), type):
        inst = _LF_G["Solution"]()
        for cand in (name, snake):
            if callable(getattr(inst, cand, None)):
                fn = getattr(inst, cand); break
    if fn is None:
        return json.dumps({"ok": False, "error": "The Python code has no function named " + name + "."})
    _LF_G["__lf_fn"] = fn
    return json.dumps({"ok": True})

def _lf_call(args_json, ptypes_json, rtype):
    args = json.loads(args_json); ptypes = json.loads(ptypes_json)
    conv = []
    for a, t in zip(args, ptypes):
        a = _lf_expand(a)
        conv.append(_lf_to_list(a) if t == "ListNode" else _lf_to_tree(a) if t == "TreeNode" else a)
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            out = _LF_G["__lf_fn"](*conv)
        if rtype == "ListNode":
            out = _lf_from_list(out)
        elif rtype == "TreeNode":
            out = _lf_from_tree(out)
        return json.dumps({"ok": True, "out": json.dumps(_lf_plain(out)), "logs": buf.getvalue()[-600:]})
    except RecursionError:
        return json.dumps({"ok": False, "error": "RecursionError: recursion went too deep. Check your base case.", "logs": buf.getvalue()[-600:]})
    except BaseException as e:
        return json.dumps({"ok": False, "error": type(e).__name__ + ": " + str(e) + _lf_where(e.__traceback__), "logs": buf.getvalue()[-600:]})
`;

async function boot(base) {
  importScripts(base + "pyodide.js");
  const py = await loadPyodide({ indexURL: base });
  py.runPython(HARNESS);
  return py;
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type !== "run") return;
  try {
    if (!pyReady) { self.postMessage({ type: "booting" }); pyReady = boot(m.base); }
    const py = await pyReady;
    self.postMessage({ type: "ready" });
    const load = JSON.parse(py.globals.get("_lf_load")(m.code, m.fn));
    if (!load.ok) { self.postMessage({ type: "compile", error: load.error }); return; }
    const call = py.globals.get("_lf_call");
    for (let i = 0; i < m.tests.length; i++) {
      self.postMessage({ type: "start", i });
      const t0 = performance.now();
      const r = JSON.parse(call(JSON.stringify(m.tests[i]), JSON.stringify(m.ptypes), m.rtype));
      self.postMessage({ type: "result", i, ms: Math.round(performance.now() - t0), ok: r.ok, out: r.out, error: r.error, logs: r.logs || "" });
    }
    self.postMessage({ type: "done" });
  } catch (err) {
    pyReady = null;
    self.postMessage({ type: "fatal", error: String((err && err.message) || err) });
  }
};
