export const BOTS = [
  { slug: "pikachu", name: "Pikachu", role: "Chief of Staff", accent: "#ffd84a" },
  { slug: "buildbot", name: "BuildBot", role: "builds apps", accent: "#7f93a6" },
  { slug: "money-kick", name: "Money Kick", role: "tracks spending", accent: "#3aaa6d" },
  { slug: "mailguard", name: "MailGuard", role: "watches Gmail", accent: "#3a6fbf" },
  { slug: "ekaceo", name: "EkaCEO", role: "Eka AI co-founder", accent: "#c9a227" },
  { slug: "x-analyst", name: "X Analyst", role: "analyzes X posts", accent: "#1c1c1c" },
  { slug: "x-content-manager", name: "X Content Manager", role: "manages X content", accent: "#7a4ea3" },
  { slug: "x-post-writer", name: "X Post Writer", role: "writes X posts", accent: "#1f8a86" },
  { slug: "dr-eggbot", name: "dr eggbot", role: "designs bots", accent: "#f0d9a0" },
  { slug: "ideaforge", name: "IdeaForge", role: "project ideas", accent: "#e07a2f" },
  { slug: "scriptsmith", name: "ScriptSmith", role: "YouTube scripts", accent: "#c4a36a" },
  { slug: "packlab", name: "PackLab", role: "titles and thumbnails", accent: "#d6457a" },
  { slug: "tubescout", name: "TubeScout", role: "YouTube ideas", accent: "#e23b3b" },
  { slug: "tubecal", name: "TubeCal", role: "upload calendar", accent: "#ff6b6b" },
] as const;

export type BotSlug = (typeof BOTS)[number]["slug"];

const SLUGS = new Set<string>(BOTS.map((bot) => bot.slug));

export function isBotSlug(value: string): value is BotSlug {
  return SLUGS.has(value);
}

export function botBySlug(slug: string) {
  return BOTS.find((bot) => bot.slug === slug);
}
