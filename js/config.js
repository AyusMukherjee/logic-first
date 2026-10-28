// Site settings. Edit these, commit, and GitHub Pages updates in a minute or two.
window.LF_CONFIG = {
  // Name shown in the top bar and the browser tab.
  siteTitle: "Logic First",

  // Small line under the name, e.g. "COSC 1010 · Spring 2027". Leave "" to hide it.
  courseLabel: "Algorithm practice for Marquette students",

  // OPTIONAL class server. If you deploy proxy/cloudflare-worker.js and paste its URL here,
  // students get automatic code generation with no setup, billed to your API key.
  // Leave "" and students use copy & paste with Claude.ai (free) or their own API key.
  proxyUrl: "",

  // Models used when a student chooses "My own Anthropic API key".
  apiModels: [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (recommended)" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (faster, cheaper)" }
  ],

  // Where the "Open Claude.ai" buttons go in copy & paste mode.
  claudeChatUrl: "https://claude.ai/new"
};
