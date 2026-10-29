export const STATUSES = ["idle", "working", "waiting", "done"] as const;

export type Status = (typeof STATUSES)[number];

export type HistoryEntry = {
  status: Status;
  doing: string;
  result: string;
  updatedAt: string;
};

export type BotRecord = {
  status: Status;
  doing: string;
  result: string;
  updatedAt: string | null;
  history: HistoryEntry[];
};

export type OfficeBot = {
  slug: string;
  name: string;
  role: string;
  accent: string;
  status: Status;
  displayStatus: Status;
  stale: boolean;
  doing: string;
  result: string;
  updatedAt: string | null;
  history: HistoryEntry[];
};

export type OfficePayload = {
  now: string;
  bots: OfficeBot[];
};

export type StatusPatch = {
  bot: string;
  status: Status;
  doing?: string;
  result?: string;
};
