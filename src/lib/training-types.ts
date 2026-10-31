export type TrainingProfile = {
  version: 1;
  targetSeconds: number;
  assistance: "unassisted" | "feet-supported";
  startDate: string;
  weekdays: number[];
  windowWeeks: 4 | 8 | 12;
  session: {
    mode: "simple";
    workSeconds: number;
    restSeconds: number;
    rounds: number;
    prepSeconds: 0 | 5 | 10;
  };
};

export type JourneyDraft = {
  version: 1;
  targetSeconds: number;
  holdSeconds: number;
  createdAtMs: number;
};
export type TimerConfig = {
  mode: "simple" | "emom" | "ladder" | "test";
  workSeconds: number;
  restSeconds: number;
  rounds: number;
  prepSeconds: 0 | 5 | 10;
};

export type TimerLoad = {
  requestId: string;
  config: TimerConfig;
};

export type TimerRunState = {
  phase: "idle" | "prep" | "work" | "rest" | "test" | "done";
  running: boolean;
  mode: TimerConfig["mode"];
};

export type LogEntry = {
  id: string;
  date: string;
  seconds: number;
  assistance: "unassisted" | "feet-supported";
  sets: number;
  kind?: "test";
  bar?: string;
  grip?: string;
  chalk?: boolean;
  load?: number;
  loadUnit?: "kg" | "lb";
  ended?: string;
};
