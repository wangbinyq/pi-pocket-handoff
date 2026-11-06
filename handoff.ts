/**
 * `/handoff-now [要求]`: the model writes this session's handoff brief, then the session starts a fresh context that begins with it. Nothing of this module stands in the model's context until a person runs the command: no tool, no prompt section.
 */
import {
    AssistantEntry,
    defineExtension,
    defineTask,
    LiveDoc,
    ResetEntry,
} from "@earendil-works/pi-durable";
import type { Host, Web } from "./_pocket.d.ts";

const MIN_BRIEF = 200;
const MAX_BRIEF = 20_000;

type Input = { requirement: string };
type State = { phase: "write" };

function briefOf(entry: { readonly model?: readonly object[] } | undefined): string {
    const message = entry?.model?.[0] as
        | { role?: string; content?: readonly object[] }
        | undefined;

    if (message === undefined || message.role !== "assistant" || message.content === undefined) {
        return "";
    }

    return message.content
        .flatMap((part) => {
            const text = part as { type?: string; text?: string };

            return text.type === "text" && typeof text.text === "string" ? [text.text] : [];
        })
        .join("\n")
        .trim();
}

function briefTask(host: Host) {
    return defineTask<Input, State, null>({
        name: "handoff.brief",
        version: 1,
        initial: () => ({ phase: "write" }),
        phases: {
            write: async (task, runtime, context) => {
                const handle = await runtime.conversation(runtime.conversationId, context);

                if (handle === undefined) {
                    host.notice("error", "handoff: the session is gone.", runtime.conversationId);
                    await runtime.commit(
                        () => ({ status: "terminal", outcome: { status: "failed", error: { message: "the session is gone" } } }),
                        context,
                    );
                    return;
                }

                const ask = [
                    "Write the handoff brief for this session, now, as your whole answer.",
                    "The next context will contain nothing else, so write what a fresh session needs to continue without re-reading anything: Goal; Constraints (the rules to keep); Decisions with their reasons; Rejected approaches and why; Files involved; Open questions; Next step; Verification (what was run and its result).",
                    "Output the brief itself only: no greeting, no tool calls, no code fence around it.",
                ];

                if (task.input.requirement !== "") {
                    ask.push(task.input.requirement);
                }

                const submission = await handle.submit(
                    {
                        requestId: `handoff:${runtime.taskId}`,
                        type: "input",
                        content: ask.join("\n\n"),
                        whenBusy: "reject",
                    },
                    context,
                );
                const settled = await submission.wait(context);

                if (settled.status !== "done" || settled.answer === undefined) {
                    const reason = "reason" in settled ? settled.reason : undefined;

                    host.notice(
                        "warning",
                        `handoff: Pi did not answer (${settled.status}${reason === undefined ? "" : `: ${reason}`}). Nothing was reset.`,
                        runtime.conversationId,
                    );
                    await runtime.commit(
                        () => ({ status: "terminal", outcome: { status: "failed", error: { message: settled.status } } }),
                        context,
                    );
                    return;
                }

                const brief = briefOf(await runtime.entry(AssistantEntry, settled.answer, context));

                if (brief.length < MIN_BRIEF || brief.length > MAX_BRIEF) {
                    host.notice(
                        "warning",
                        `handoff: the brief came back ${brief.length} characters (the limit is ${MIN_BRIEF} to ${MAX_BRIEF}). Nothing was reset.`,
                        runtime.conversationId,
                    );
                    await runtime.commit(
                        () => ({ status: "terminal", outcome: { status: "failed", error: { message: "brief out of range" } } }),
                        context,
                    );
                    return;
                }

                await runtime.commit(
                    async (tx) => {
                        await tx.appendEntry(ResetEntry, runtime.conversationId, {
                            head: "self",
                            model: [{ role: "user", content: brief, timestamp: Date.now() }],
                        });

                        return { status: "terminal", outcome: { status: "completed", result: null } };
                    },
                    context,
                );
            },
        },
        abort: (_task, runtime, context) =>
            runtime.commit(
                () => ({ status: "terminal", outcome: { status: "aborted" } }),
                context,
            ),
    });
}

export default function createHandoff(host: Host, web: Web) {
    const task = briefTask(host);

    web.command("handoff-now", {
        description: "Have Pi write a handoff brief, then start a fresh context from it",
        args: "[extra requirements for the brief]",
        scope: "conversation",
        handler: async (args, ctx) => {
            const live = await ctx.snapshot(LiveDoc, ctx.conversationId, ctx.context);

            if (live?.run !== undefined) {
                return {
                    type: "toast",
                    level: "warning",
                    message: "Pi is working right now. Wait for this round to end, then run /handoff-now again.",
                };
            }

            const requirement = args.trim();
            const extra =
                requirement === ""
                    ? ""
                    : `The person who asked for this handoff added a requirement: ${requirement}`;

            await ctx.commit((tx) =>
                tx.createTask(
                    task,
                    { requirement: extra },
                    { ownership: { kind: "conversation" }, conversationId: ctx.conversationId },
                ),
            );

            return {
                type: "toast",
                level: "info",
                message: "Pi is writing the handoff brief; the session switches to a fresh context when it is done.",
            };
        },
    });

    return defineExtension({ name: "handoff", tasks: [task] });
}
