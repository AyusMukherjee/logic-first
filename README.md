# Logic First

Algorithm practice where you write **only the logic**. You describe your algorithm in plain pseudocode, a free AI turns exactly those steps into **Python and Java**, and you choose to **run the tests** or **rewrite your logic**.

The AI is told **not** to fix your mistakes. If your logic is wrong, the code is wrong in the same way, so passing the tests means your thinking is right.

- 168 problems, easy to medium, in 12 topics: arrays and hashing, strings, two pointers and sliding window, stacks and queues, binary search, linked lists, trees, dynamic programming, graphs, math and bits, sorting and greedy, recursion and backtracking.
- Every problem has 4 to 9 test cases, including edge cases and large inputs that slow algorithms can't finish in time.
- Tests run the generated Python right in the browser.
- Hints and "Explain my result" feedback walk you through a failing case without giving away the answer.
- Progress and drafts are saved in your browser.

## How students use it

1. Pick a problem, or press **Start with a random problem**.
2. Read the problem and examples on the left. Write your algorithm in the white editor on the right.
3. Press **Convert to code**. Your logic appears as Python and Java.
4. Press **Run tests**, or **Rewrite my logic** to change your steps.

## The AI is free

Two free AI options are built in. The site picks automatically.

| | Class AI server | AI in the browser |
|---|---|---|
| What it is | Cloudflare Workers AI, free plan | An open AI model (Qwen2.5-Coder) running on the student's own computer |
| Cost | $0. Stops for the day when the free daily amount is used up | $0. No limits |
| Setup | Instructor, once, about 10 minutes: see `ai-server/README.md` | None. One-time download (about 1.7 GB, or 0.9 GB for the Lite model) |
| Works on | Any device | Chrome or Edge on a laptop or desktop |

If the class server is set up, it's used first. If it isn't set up, or it has used today's free amount, the site uses the in-browser AI instead.

## Publishing on GitHub Pages

1. Put everything in this folder in a **public** GitHub repository.
2. **Settings → Pages → Deploy from a branch → main → / (root) → Save.**
3. The site is live at `https://<your-username>.github.io/<repository-name>/` a minute or two later.

To change the site name, the course line or the class server address, edit `js/config.js` on GitHub and commit.

## Files

```
index.html          page structure
css/style.css       styles (Marquette blue #003366 and gold #FFCC00)
js/config.js        site name, course label, class AI server URL, model choices
js/problems.js      generated problem bank (do not edit by hand)
js/app.js           app logic
js/py-worker.js     runs the Python tests in the browser (Pyodide)
js/llm-worker.js    runs the in-browser AI model (WebLLM)
ai-server/          optional free class AI server for Cloudflare, with setup steps
```

`js/problems.js` is generated from source files that contain reference solutions. Those are kept out of this repository so students can't look up the answers.
