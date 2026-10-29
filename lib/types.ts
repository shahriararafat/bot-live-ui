import type { BotSlug } from "./bots";

export const STATUSES = ["idle", "working", "waiting", "done"] as const;

export type Status = (typeof STATUSES)[number];

export const DASHBOARD_SECTIONS = ["x_growth", "x_advice", "bot_results", "spending"] as const;

export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

export type FollowerPoint = {
  date: string;
  followers: number;
};

export type TopPost = {
  text: string;
  url: string;
  views?: number;
  likes?: number;
};

export type XGrowthData = {
  followers: number;
  history: FollowerPoint[];
  topPosts: TopPost[];
};

export type XAdviceData = {
  summary: string;
  actions: string[];
};

export type BotResultEntry = {
  slug: BotSlug;
  job: string;
  recent: string[];
};

export type BotResultsData = {
  bots: BotResultEntry[];
};

export type SpendCategory = {
  name: string;
  amount: number;
};

export type SpendingData = {
  month: string;
  currency: "BDT";
  total: number;
  budget?: number;
  todaySpent?: number;
  categories: SpendCategory[];
};

export type DashboardDataMap = {
  x_growth: XGrowthData;
  x_advice: XAdviceData;
  bot_results: BotResultsData;
  spending: SpendingData;
};

export type DashboardData = DashboardDataMap[DashboardSection];

export type DashboardEntry<K extends DashboardSection = DashboardSection> = {
  data: DashboardDataMap[K];
  updatedAt: string;
};

export type DashboardState = { [K in DashboardSection]: DashboardEntry<K> | null };

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
  dashboard: DashboardState;
};

export type StatusPatch = {
  bot: string;
  status: Status;
  doing?: string;
  result?: string;
};
