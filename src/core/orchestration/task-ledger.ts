export type TaskState = "running" | "succeeded" | "failed";

export interface TaskRecord<T = unknown> {
  readonly taskId: string;
  readonly state: TaskState;
  readonly updatedAt: number;
  readonly value?: T;
  readonly error?: string;
}

export class TaskLedger<T = unknown> {
  private readonly records = new Map<string, TaskRecord<T>>();

  constructor(
    private readonly ttlMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(taskId: string): TaskRecord<T> | undefined {
    this.prune();
    return this.records.get(taskId);
  }

  start(taskId: string): TaskRecord<T> {
    const existing = this.get(taskId);
    if (existing) return existing;
    const record: TaskRecord<T> = { taskId, state: "running", updatedAt: this.now() };
    this.records.set(taskId, record);
    return record;
  }

  succeed(taskId: string, value: T): TaskRecord<T> {
    const record: TaskRecord<T> = {
      taskId,
      state: "succeeded",
      updatedAt: this.now(),
      value,
    };
    this.records.set(taskId, record);
    return record;
  }

  fail(taskId: string, error: string): TaskRecord<T> {
    const record: TaskRecord<T> = {
      taskId,
      state: "failed",
      updatedAt: this.now(),
      error,
    };
    this.records.set(taskId, record);
    return record;
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [taskId, record] of this.records) {
      if (record.updatedAt < cutoff) this.records.delete(taskId);
    }
  }
}
