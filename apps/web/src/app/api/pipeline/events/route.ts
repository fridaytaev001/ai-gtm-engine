import { connection } from "next/server";
import { pipelineRevision } from "@/lib/pipeline";

export const maxDuration = 30;

export async function GET(request: Request) {
  await connection();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let previous: string | undefined;
      let closed = false;
      const stop = () => { closed = true; };
      request.signal.addEventListener("abort", stop, { once: true });
      try {
        const deadline = Date.now() + 23_000;
        controller.enqueue(encoder.encode("retry: 4000\n\n"));
        while (!closed && !request.signal.aborted && Date.now() < deadline) {
          const revision = await pipelineRevision();
          if (revision !== previous) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(revision)}\n\n`));
            previous = revision;
          } else controller.enqueue(encoder.encode(": heartbeat\n\n"));
          await new Promise((resolve) => setTimeout(resolve, 4000));
        }
      } catch { /* the browser reconnects after failures */ }
      finally {
        request.signal.removeEventListener("abort", stop);
        try { controller.close(); } catch { /* already cancelled */ }
      }
    },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
  } });
}
