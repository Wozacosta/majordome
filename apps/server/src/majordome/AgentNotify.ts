/**
 * Sends an agent's notification to the owner's devices, when the user asked to be told. It opens
 * the agent's thread. One per thread every 30 seconds, so an agent stuck in a loop can't flood a
 * phone.
 */

import type { ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as MajordomePush from "./MajordomePush.ts";

export const AGENT_NOTIFY_TITLE_MAX = 60;
export const AGENT_NOTIFY_MESSAGE_MAX = 300;
const MIN_INTERVAL_MS = 30_000;

export class AgentNotifyTooSoonError extends Schema.TaggedError<AgentNotifyTooSoonError>()(
  "AgentNotifyTooSoonError",
  { retryAfterSeconds: Schema.Number },
) {}

export class AgentNotify extends Context.Service<
  AgentNotify,
  {
    /** Returns how many devices accepted the notification. */
    readonly notify: (input: {
      readonly threadId: ThreadId;
      readonly title?: string | undefined;
      readonly message: string;
    }) => Effect.Effect<number, AgentNotifyTooSoonError>;
  }
>()("t3/majordome/AgentNotify") {}

const make = Effect.gen(function* () {
  const push = yield* MajordomePush.MajordomePush;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const lastSent = yield* Ref.make<ReadonlyMap<ThreadId, number>>(new Map());

  /** Claims this thread's slot, or says how long until it frees up. */
  const claim = (threadId: ThreadId, now: number) =>
    Ref.modify(lastSent, (sent): readonly [number, ReadonlyMap<ThreadId, number>] => {
      const previous = sent.get(threadId);
      if (previous !== undefined && now - previous < MIN_INTERVAL_MS) {
        return [Math.ceil((previous + MIN_INTERVAL_MS - now) / 1000), sent];
      }
      const next = new Map([...sent].filter(([, at]) => now - at < MIN_INTERVAL_MS));
      next.set(threadId, now);
      return [0, next];
    });

  const notify: AgentNotify["Service"]["notify"] = Effect.fn("AgentNotify.notify")(
    function* (input) {
      const retryAfterSeconds = yield* claim(input.threadId, yield* Clock.currentTimeMillis);
      if (retryAfterSeconds > 0) return yield* new AgentNotifyTooSoonError({ retryAfterSeconds });
      const environmentId = yield* environment.getEnvironmentId;
      return yield* push.notifyAll({
        title: input.title?.trim() || "Majordome",
        body: input.message.trim(),
        tag: `majordome:agent:${input.threadId}`,
        url: `/threads/${encodeURIComponent(environmentId)}/${encodeURIComponent(input.threadId)}`,
      });
    },
  );

  return AgentNotify.of({ notify });
});

export const layer = Layer.effect(AgentNotify, make);
