# Free class AI server (optional, recommended)

The site already works without this: it runs a free AI model inside each student's browser. This server makes conversions faster and lets the site work on phones, school Chromebooks and older laptops, because the AI runs on Cloudflare instead of the student's computer.

**Cost: $0.** Cloudflare's Workers **Free** plan includes 10,000 AI "neurons" per day. That's very roughly 80 to 100 conversions per day for the whole class. When they run out, the server stops answering until the reset at 00:00 UTC (7 pm Central during daylight saving time, 6 pm otherwise), and the site automatically switches students to the in-browser AI. Nothing is billed on the free plan, and no credit card is needed. Don't upgrade the account to Workers Paid, because the paid plan bills for usage beyond the free amount.

## Setup (about 10 minutes)

1. Go to **dash.cloudflare.com** and sign up for a free account (email and password, no card).
2. In the left menu, open **Compute → Workers & Pages** (on some accounts just **Workers & Pages**). Click **Create**, then choose **Start with Hello World!** (or **Create Worker**).
3. Name it `logic-first-ai` and click **Deploy**.
4. Click **Edit code**. Delete everything in the editor, paste the contents of `worker.js` from this folder, and click **Deploy**.
5. Go back to the worker's page. Open the **Bindings** tab (sometimes under **Settings → Bindings**), click **Add binding**, choose **Workers AI**, set the variable name to `AI`, and save. Deploy again if it asks.
6. Copy the worker's address. It looks like `https://logic-first-ai.YOUR-NAME.workers.dev`. Open it in a browser tab. You should see `"Logic First AI server is running."`
7. In your GitHub repository, open `js/config.js`, click the pencil icon, and paste that address between the quotes on the `aiServerUrl` line:

   ```js
   aiServerUrl: "https://logic-first-ai.YOUR-NAME.workers.dev",
   ```

   Click **Commit changes**. The site updates in a minute or two.

## If something doesn't work

- **"This site is not allowed"**: the site's address isn't in `ALLOWED_ORIGINS` at the top of `worker.js`. It must be exactly `https://ayusmukherjee.github.io` (no `/logic-first`, no trailing slash) unless you use a different GitHub account.
- **"The Workers AI binding named AI is missing"**: redo step 5 and make sure the name is exactly `AI`.
- **Students see "AI: in your browser"** even though the server is set: the daily free limit may be used up. It resets at 00:00 UTC.
- **To check usage:** Cloudflare dashboard → **AI → Workers AI** shows neurons used today.
