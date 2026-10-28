# Logic First

Algorithm practice where you write **only the logic**. You describe your algorithm in plain pseudocode, Claude translates exactly those steps into code (Python, Java, C++, C or JavaScript), and the site runs the code against test cases in your browser.

Claude is told **not** to fix your mistakes. If your logic is wrong, the code is wrong in the same way, so passing the tests means your thinking is right.

- 168 problems, easy to medium, in 12 topics: arrays and hashing, strings, two pointers and sliding window, stacks and queues, binary search, linked lists, trees, dynamic programming, graphs, math and bits, sorting and greedy, recursion and backtracking.
- Every problem has 4 to 9 test cases, including edge cases and a few large inputs that slow algorithms can't finish in time.
- Hints and "Explain my result" feedback walk you through a failing case without handing you the answer.
- Progress and drafts are saved in your browser. Nothing is uploaded except the prompts you send to Claude.

## How students use it

1. Open the site and pick a problem, or press **Start with a random problem**.
2. Read the problem and examples on the left. Write your algorithm in the white editor on the right.
3. Press **Generate code & run tests**.
4. Read the results. Press **Explain my result** if something fails.

### Ways the site can reach Claude

Click the mode button in the top-right corner to choose.

| Mode | Cost | Setup |
|---|---|---|
| **Copy & paste with Claude.ai** (default) | Free with any Claude.ai account | None. The site gives you a prompt to paste into Claude.ai, and you paste Claude's reply back. |
| **My own Anthropic API key** | Billed to your API account | Paste a key from console.anthropic.com once. It is stored only in your browser. |
| **Class server** | Billed to the instructor | Appears automatically if the instructor configured one in `js/config.js`. |

## Publishing on GitHub Pages

1. Create a new **public** repository on GitHub, for example `logic-first`.
2. Upload everything in this folder (`index.html`, `README.md`, and the `css` and `js` folders) to the repository and commit.
3. Go to **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose the `main` branch and the `/ (root)` folder, and press **Save**.
4. After a minute or two the site is live at `https://<your-username>.github.io/logic-first/`.

To change the site name or the line under it, edit `js/config.js` on GitHub and commit.

## Files

```
index.html        page structure
css/style.css     styles (Marquette blue #003366 and gold #FFCC00)
js/config.js      site name, course label, optional class server URL
js/problems.js    generated problem bank (do not edit by hand)
js/app.js         app logic and the in-browser test runner
```

`js/problems.js` is generated from source files that contain reference solutions. Those are kept out of this repository so students can't look up the answers.
