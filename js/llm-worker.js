// Runs the free in-browser AI model (WebLLM) off the main thread so the page stays responsive.
// Keep this version in sync with webllmVersion in js/config.js.
import { WebWorkerMLCEngineHandler } from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
