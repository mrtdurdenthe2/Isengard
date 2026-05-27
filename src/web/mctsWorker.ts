import { runMcts } from "../mcts.js";
import type { CraftContext, MctsOptions } from "../index.js";

type MctsWorkerRequest = {
  type: "run";
  ctx: CraftContext;
  actionIds: string[];
  options: MctsOptions;
};

self.onmessage = (event: MessageEvent<MctsWorkerRequest>) => {
  if (event.data.type !== "run") return;
  const result = runMcts(event.data.ctx, event.data.actionIds, event.data.options);
  self.postMessage({ type: "done", result });
};
