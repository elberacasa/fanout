import type { Ledger } from "../ledger/ledger.ts";
import { initialState, project, type ProjectionState } from "./state.ts";

/**
 * Keep one per ledger so polling pays only for events appended since the last read.
 * Returned states may be retained as snapshots, but callers must not mutate them: the next fold resumes there.
 */
export class LiveProjection {
  readonly #ledger: Pick<Ledger, "read">;
  #state: ProjectionState = initialState();

  constructor(ledger: Pick<Ledger, "read">) {
    this.#ledger = ledger;
  }

  current(): ProjectionState {
    this.#state = project(this.#ledger.read({ afterSeq: this.#state.lastSeq }), this.#state);
    return this.#state;
  }
}
