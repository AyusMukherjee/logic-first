// Site settings. Edit, commit, and GitHub Pages updates in a minute or two.
window.LF_CONFIG = {
  // Name shown in the top bar and the browser tab.
  siteTitle: "Logic First",

  // Small line under the name, e.g. "COSC 1010 · Spring 2027". Leave "" to hide it.
  courseLabel: "Algorithm practice for Marquette students",

  // FREE class AI server (Cloudflare Workers AI, free plan). Paste your worker's URL here,
  // e.g. "https://logic-first-ai.yourname.workers.dev". Setup steps: ai-server/README.md.
  // Leave "" to use only the free in-browser AI.
  aiServerUrl: "",

  // Free AI that runs inside the student's browser (needs Chrome or Edge on a laptop/desktop).
  // Downloaded once, then cached. The first entry is the default.
  localModels: [
    { id: "Qwen2.5-Coder-3B-Instruct", label: "Standard (better translations)", size: "about 1.7 GB" },
    { id: "Qwen2.5-Coder-1.5B-Instruct", label: "Lite (for older computers)", size: "about 0.9 GB" }
  ],

  // Library versions loaded from the jsDelivr CDN. Change only if you know you need to.
  // If you change webllmVersion, change it in js/llm-worker.js too.
  webllmVersion: "0.2.85",
  pyodideUrl: "https://cdn.jsdelivr.net/npm/pyodide@0.29.5/"
};
