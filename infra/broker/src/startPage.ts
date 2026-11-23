/**
 * The one page a person with an invite sees: a box for the code, then their server. It waits
 * for the server to answer before sending them to it, since a new server takes a few seconds.
 */
export const START_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Your Majordome server</title>
<style>
  :root { color-scheme: light dark; --bg: #fdfcfa; --fg: #1c1a17; --muted: #6b665e; --line: #d9d4cb; --accent: #c2410c; }
  @media (prefers-color-scheme: dark) { :root { --bg: #151412; --fg: #f1ede6; --muted: #a39d92; --line: #3a3732; --accent: #ea7a3d; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 26rem; margin: 0 auto; padding: 4rem 1rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { color: var(--muted); margin: 0 0 1.5rem; }
  label { display: block; font-weight: 600; margin-bottom: .4rem; }
  input { width: 100%; box-sizing: border-box; padding: .6rem .7rem; font: inherit; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: .5rem; }
  button { margin-top: 1rem; padding: .6rem 1rem; font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: .5rem; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: default; }
  #status { margin-top: 1.25rem; min-height: 1.5rem; }
  #status.error { color: #dc2626; }
</style>
</head>
<body>
<main>
  <h1>Your Majordome server</h1>
  <p>Majordome looks after a server for you, so your notes and routines are there day and night. Enter your invite code to get yours.</p>
  <form id="form">
    <label for="invite">Invite code</label>
    <input id="invite" name="invite" autocomplete="off" autocapitalize="none" spellcheck="false" required>
    <button id="go" type="submit">Make my server</button>
  </form>
  <p id="status" role="status"></p>
</main>
<script>
  const form = document.getElementById("form");
  const go = document.getElementById("go");
  const status = document.getElementById("status");
  const say = (text, error) => { status.textContent = text; status.className = error ? "error" : ""; };
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    go.disabled = true;
    say("Making your server. This takes about half a minute.");
    try {
      const response = await fetch("/v1/hosted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite: document.getElementById("invite").value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "That did not work. Try again in a few minutes.");
      say("Your server is starting.");
      // A new server takes a few seconds before it answers; going there sooner shows an error.
      for (let attempt = 0; attempt < 60; attempt++) {
        const ready = await fetch("/v1/hosted/ready?name=" + encodeURIComponent(body.name), { cache: "no-store" })
          .then((answer) => answer.json())
          .then((answer) => answer.ready === true)
          .catch(() => false);
        if (ready) break;
        await wait(3000);
      }
      location.href = body.pairingUrl;
    } catch (error) {
      say(error.message, true);
      go.disabled = false;
    }
  });
</script>
</body>
</html>
`;
