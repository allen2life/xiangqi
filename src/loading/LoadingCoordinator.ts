export type LoadingTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface LoadingTask {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  readonly required: boolean;
  readonly run: () => Promise<void>;
}

export interface LoadingTaskState {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  readonly required: boolean;
  readonly status: LoadingTaskStatus;
  readonly attempts: number;
  readonly error?: string;
}

export interface LoadingState {
  readonly tasks: readonly LoadingTaskState[];
  readonly progress: number;
  readonly running: boolean;
  readonly canContinue: boolean;
  readonly canRetry: boolean;
  readonly requiredFailures: readonly LoadingTaskState[];
  readonly optionalFailures: readonly LoadingTaskState[];
}

type TaskUpdate = Partial<Pick<LoadingTaskState, 'status' | 'attempts' | 'error'>>;

export function createLoadingState(tasks: readonly LoadingTask[]): LoadingState {
  return deriveState(tasks.map(({ id, label, weight, required }) => ({
    id,
    label,
    weight,
    required,
    status: 'pending' as const,
    attempts: 0,
  })));
}

export function updateLoadingTask(
  state: LoadingState,
  taskId: string,
  update: TaskUpdate,
): LoadingState {
  return deriveState(state.tasks.map((task) => {
    if (task.id !== taskId) return task;
    const next = { ...task, ...update };
    if (update.error === undefined) delete next.error;
    return next;
  }));
}

function deriveState(tasks: readonly LoadingTaskState[]): LoadingState {
  const totalWeight = tasks.reduce((sum, task) => sum + task.weight, 0);
  const settledWeight = tasks.reduce(
    (sum, task) => sum + (task.status === 'succeeded' || task.status === 'failed' ? task.weight : 0),
    0,
  );
  const requiredFailures = tasks.filter((task) => task.required && task.status === 'failed');
  const optionalFailures = tasks.filter((task) => !task.required && task.status === 'failed');
  const running = tasks.some((task) => task.status === 'running');
  const allSettled = tasks.every((task) => task.status === 'succeeded' || task.status === 'failed');

  return {
    tasks,
    progress: totalWeight === 0 ? 1 : settledWeight / totalWeight,
    running,
    canContinue: allSettled && requiredFailures.length === 0,
    canRetry: !running && tasks.some((task) => task.status === 'failed'),
    requiredFailures,
    optionalFailures,
  };
}

export function createOnceGuard(): () => boolean {
  let claimed = false;
  return () => {
    if (claimed) return false;
    claimed = true;
    return true;
  };
}

export class LoadingCoordinator {
  private state: LoadingState;
  private runPromise: Promise<LoadingState> | null = null;

  constructor(
    private readonly tasks: readonly LoadingTask[],
    private readonly onChange: (state: LoadingState) => void = () => undefined,
  ) {
    if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
      throw new Error('Loading task ids must be unique');
    }
    if (tasks.some((task) => task.weight <= 0 || !Number.isFinite(task.weight))) {
      throw new Error('Loading task weights must be positive finite numbers');
    }
    this.state = createLoadingState(tasks);
  }

  get snapshot(): LoadingState {
    return this.state;
  }

  run(): Promise<LoadingState> {
    return this.execute(this.tasks.filter((task) => this.taskState(task.id).status === 'pending'));
  }

  retryFailed(): Promise<LoadingState> {
    return this.execute(this.tasks.filter((task) => this.taskState(task.id).status === 'failed'));
  }

  private execute(tasks: readonly LoadingTask[]): Promise<LoadingState> {
    if (this.runPromise) return this.runPromise;
    if (tasks.length === 0) return Promise.resolve(this.state);

    this.runPromise = Promise.all(tasks.map((task) => this.executeTask(task)))
      .then(() => this.state)
      .finally(() => { this.runPromise = null; });
    return this.runPromise;
  }

  private async executeTask(task: LoadingTask): Promise<void> {
    const previous = this.taskState(task.id);
    this.setTask(task.id, { status: 'running', attempts: previous.attempts + 1, error: undefined });
    try {
      await task.run();
      this.setTask(task.id, { status: 'succeeded', error: undefined });
    } catch (error) {
      this.setTask(task.id, { status: 'failed', error: errorMessage(error) });
    }
  }

  private taskState(id: string): LoadingTaskState {
    return this.state.tasks.find((task) => task.id === id)!;
  }

  private setTask(id: string, update: TaskUpdate): void {
    this.state = updateLoadingTask(this.state, id, update);
    this.onChange(this.state);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
