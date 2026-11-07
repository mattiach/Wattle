import type { CatalogEntry } from "../model-catalog";

/** Whether the runtime is absent, present but idle, or answering. */
export type RuntimeState =
  | "disabled"
  | "notInstalled"
  | "installed"
  | "running";

/** What `ai_status` reports: the runtime, and every model it knows about. */
export interface AiStatus {
  catalog: CatalogEntry[];
  /** Whether the runtime installer is running right now, whoever started it. */
  installing: boolean;
  /** The model a download started earlier is still fetching, if any. */
  pulling: string | null;
  state: RuntimeState;
  unmanaged: string[];
  version: string | null;
}
