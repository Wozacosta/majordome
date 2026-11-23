/**
 * The one page a person with an invite sees: a box for the code, then their server. Making a
 * server takes about half a minute, so the page says which step it is on, from what the service
 * really knows, and opens the server only once it answers.
 */
export const START_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Your Majordome server</title>
<style>
  :root { color-scheme: light dark; --bg: #fdfcfa; --fg: #1c1a17; --muted: #6b665e; --line: #d9d4cb; --accent: #c2410c; --ok: #15803d; }
  @media (prefers-color-scheme: dark) { :root { --bg: #151412; --fg: #f1ede6; --muted: #a39d92; --line: #3a3732; --accent: #ea7a3d; --ok: #4ade80; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 26rem; margin: 0 auto; padding: 4rem 1rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { color: var(--muted); margin: 0 0 1.5rem; }
  label { display: block; font-weight: 600; margin-bottom: .4rem; }
  input { width: 100%; box-sizing: border-box; padding: .6rem .7rem; font: inherit; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: .5rem; }
  button { margin-top: 1rem; padding: .6rem 1rem; font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: .5rem; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: default; }
  #error { color: #dc2626; margin-top: 1.25rem; }
  #progress { display: none; }
  .bar { height: .4rem; background: var(--line); border-radius: 1rem; overflow: hidden; margin: 0 0 1.25rem; }
  .bar > div { height: 100%; width: 0; background: var(--accent); border-radius: 1rem; transition: width .4s ease; }
  ol { list-style: none; margin: 0 0 1.25rem; padding: 0; }
  li { display: flex; gap: .6rem; padding: .3rem 0; color: var(--muted); }
  li .mark { flex: none; width: 1.2rem; height: 1.5rem; display: flex; align-items: center; justify-content: center; }
  /* The step under way turns, so the page never looks stuck during the long one. */
  li.now .mark::before { content: ""; width: .85rem; height: .85rem; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: turn .8s linear infinite; }
  @keyframes turn { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { li.now .mark::before { animation: none; border-color: var(--accent); } }
  li.now { color: var(--fg); font-weight: 600; }
  li.done { color: var(--fg); }
  li.done .mark { color: var(--ok); }
  li small { display: block; font-weight: 400; color: var(--muted); }
  #note { font-size: .875rem; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Your Majordome server</h1>
  <div id="ask">
    <p>Majordome looks after a server for you, so your notes and routines are there day and night. Enter your invite code to get yours.</p>
    <form id="form">
      <label for="invite">Invite code</label>
      <input id="invite" name="invite" autocomplete="off" autocapitalize="none" spellcheck="false" required>
      <button id="go" type="submit">Make my server</button>
    </form>
    <p id="error" role="alert"></p>
  </div>
  <div id="progress">
    <p>This takes about half a minute. Keep this page open.</p>
    <div class="bar" role="progressbar" aria-label="Making your server" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0"><div id="fill"></div></div>
    <ol id="steps" aria-live="polite">
      <li data-step="made"><span class="mark" aria-hidden="true"></span><span>Making your server<small>A small computer and a disk for your notes, in Paris.</small></span></li>
      <li data-step="on"><span class="mark" aria-hidden="true"></span><span>Switching it on<small>It fetches Majordome the first time, which is the longest part.</small></span></li>
      <li data-step="ready"><span class="mark" aria-hidden="true"></span><span>Starting Majordome<small>It prepares an empty notes database and gets ready to answer.</small></span></li>
      <li data-step="open"><span class="mark" aria-hidden="true"></span><span>Opening your server<small>You arrive already signed in as its owner.</small></span></li>
    </ol>
    <p id="note" role="status"></p>
  </div>
</main>
<script>
  const ORDER = ["made", "on", "ready", "open"];
  const byId = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  // Marks every step before the current one done, and the current one as in progress.
  const show = (current) => {
    const at = ORDER.indexOf(current);
    for (const item of byId("steps").children) {
      const index = ORDER.indexOf(item.dataset.step);
      item.className = index < at ? "done" : index === at ? "now" : "";
      item.querySelector(".mark").textContent = index < at ? "\\u2713" : index === at ? "" : "\\u25CB";
    }
    byId("fill").style.width = (at / ORDER.length) * 100 + "%";
    byId("fill").parentElement.setAttribute("aria-valuenow", String(at));
  };
  byId("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    byId("go").disabled = true;
    byId("error").textContent = "";
    byId("ask").style.display = "none";
    byId("progress").style.display = "block";
    show("made");
    try {
      const response = await fetch("/v1/hosted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite: byId("invite").value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "That did not work. Try again in a few minutes.");
      show("on");
      const started = Date.now();
      let ready = false;
      while (!ready && Date.now() - started < 240000) {
        const progress = await fetch("/v1/hosted/ready?name=" + encodeURIComponent(body.name), { cache: "no-store" })
          .then((answer) => answer.json())
          .catch(() => ({}));
        ready = progress.ready === true;
        if (!ready) {
          show(progress.switchedOn === true ? "ready" : "on");
          if (Date.now() - started > 90000) byId("note").textContent = "This is taking longer than usual. Your server is made; it is still starting.";
          await wait(2500);
        }
      }
      show("open");
      if (ready) {
        location.href = body.pairingUrl;
        return;
      }
      // Never send someone to a server that does not answer: they would see an error page.
      const link = document.createElement("a");
      link.href = body.pairingUrl;
      link.textContent = "Open my server";
      byId("note").textContent = "Your server is made but has not answered yet. Wait a minute, then: ";
      byId("note").append(link);
    } catch (error) {
      byId("progress").style.display = "none";
      byId("ask").style.display = "block";
      byId("error").textContent = error.message;
      byId("go").disabled = false;
    }
  });
</script>
</body>
</html>
`;
