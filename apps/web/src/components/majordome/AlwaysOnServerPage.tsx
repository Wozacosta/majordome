import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import type { ReactNode } from "react";

import { useProjects } from "../../state/entities";
import { vaultBackupStatusesAtom } from "../../state/majordome";
import { CommandBlock } from "../CommandBlock";
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import { Step, Steps } from "./paper";

const COMPOSE_URL =
  "https://raw.githubusercontent.com/Wozacosta/majordome/main/deploy/docker-compose.yml";
const TAILSCALE_KEYS_URL = "https://login.tailscale.com/admin/settings/keys";
const GITHUB_ACCESS_KEY_URL =
  "https://github.com/settings/tokens/new?scopes=repo&description=Majordome%20server";

/** How to move Majordome to a rented server that never sleeps, so routines run around the clock. */
export function AlwaysOnServerPage() {
  const repoUrl = useGitHubBackupUrl();
  return (
    <MajordomeSettingsPage
      searchId="majordome-always-on"
      intro="Majordome runs on this computer, so your routines only run while it is awake. An always-on server is a small computer you rent that never sleeps. Moving there takes about 20 minutes; your notes come along through your GitHub backup."
    >
      <Steps className="mt-8">
        <Step title="Rent a small server">
          Any provider works (Hetzner, OVH, DigitalOcean…). Choose Ubuntu with at least 2 GB of
          memory, about €5 a month. Open its console, or connect to it from a terminal.
        </Step>
        <Step title="Install Docker on it">
          <CommandBlock command="curl -fsSL https://get.docker.com | sh" />
        </Step>
        <Step title="Make a Tailscale key">
          Tailscale keeps the server private: only your own devices can reach it. Make a key on{" "}
          <ExternalLink href={TAILSCALE_KEYS_URL}>Tailscale's keys page</ExternalLink>, using the
          account your phone is on.
        </Step>
        <Step title="Start Majordome there">
          Paste your key in place of the dots, then run each line:
          <CommandBlock command="mkdir majordome && cd majordome" />
          <CommandBlock command={`curl -fsSLO ${COMPOSE_URL}`} />
          <CommandBlock command='echo "TS_AUTHKEY=tskey-auth-…" > .env' />
          <CommandBlock command="docker compose up -d" />
        </Step>
        <Step title="Bring your notes">
          {repoUrl === null ? (
            <>
              Turn on{" "}
              <Link to="/settings/backup" className="underline underline-offset-2">
                Back up my brain
              </Link>{" "}
              with GitHub here first. Then copy your notes to the server:
            </>
          ) : (
            "Copy your notes from your GitHub backup to the server:"
          )}
          <CommandBlock
            command={`docker compose exec -it majordome git clone ${repoUrl ?? "https://github.com/YOUR-NAME/majordome-brain.git"} /data/brain`}
          />
          <CommandBlock command="docker compose exec majordome majord project add /data/brain" />
          <span className="block">
            GitHub asks for your username and a password: use a key from{" "}
            <ExternalLink href={GITHUB_ACCESS_KEY_URL}>this GitHub page</ExternalLink> (set it to
            expire in a day). Your usual password doesn't work there.
          </span>
        </Step>
        <Step title="Connect this computer and your phone">
          Get a one-time code:
          <CommandBlock command="docker compose exec majordome majord pair" />
          Here, open{" "}
          <Link to="/settings/connections" className="underline underline-offset-2">
            Environments
          </Link>{" "}
          and add one with the host majordome.your-tailnet.ts.net (your Tailscale address) and the
          code. On your phone, open https://majordome.your-tailnet.ts.net and enter a new code.
        </Step>
        <Step title="Finish on the server">
          On the server's Majordome: in Back up my brain, press Sign in to GitHub so it can save
          your notes back; in{" "}
          <Link to="/settings/providers" className="underline underline-offset-2">
            Providers
          </Link>
          , sign in to Claude (paste the token from{" "}
          <code className="font-mono text-xs">claude setup-token</code>, run on this computer) or
          continue with ChatGPT; then on the Feed, press Move routines here.
        </Step>
      </Steps>
    </MajordomeSettingsPage>
  );
}

function ExternalLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  );
}

/** The GitHub repository a vault here already backs up to, as a clone address. */
function useGitHubBackupUrl(): string | null {
  const projects = useProjects().filter((project) => !project.isScratch && !project.archivedAt);
  const key = JSON.stringify(projects.map((project) => [project.environmentId, project.id]));
  const statuses = useAtomValue(vaultBackupStatusesAtom(key));
  for (const result of statuses) {
    const webUrl = AsyncResult.getOrElse(result, () => null)?.remote?.webUrl;
    if (webUrl) return `${webUrl}.git`;
  }
  return null;
}
