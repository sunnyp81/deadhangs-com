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
  voice?: boolean;
  maxTest?: { warmups: number; restSeconds: number };
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
  /** Optional body weight, always kg with one decimal place. */
  bodyweightKg?: number;
};

/** Fixed placement labels sent to GA4 as tool_source. Mirrors SOURCES in training-events.js. */
export type ToolSource = "calculator" | "plans" | "workspace" | "home" | "shared" | "embed" | "article_header" | "age_card" | "chosen_session" | "nav" | "footer" | "log_header" | "post_save" | "progress" | "your_number" | "plan_offer" | "plan_page" | "plan_success" | "calculator_result" | "pro_page" | "article";
