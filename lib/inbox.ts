export type InboxStatus = "open" | "closed";
export type InboxAssignment = "mine" | "unassigned";
export type InboxChannel = "manual" | "whatsapp";

export const inboxLabels = { open: "Em aberto", closed: "Encerrados" };
export const channelLabels = { manual: "Manual", whatsapp: "WhatsApp" };

export function inboxChannel(value: unknown): InboxChannel | undefined {
  return value === "manual" || value === "whatsapp" ? value : undefined;
}

export function inboxAssignment(value: unknown): InboxAssignment | undefined {
  return value === "mine" || value === "unassigned" ? value : undefined;
}

export function inboxSearch(value: unknown): string {
  return typeof value === "string" ? Array.from(value.trim().replaceAll("\0", "")).slice(0, 120).join("") : "";
}

type InboxLocation = {
  clinic?: string;
  status?: InboxStatus;
  thread?: string;
  notice?: string;
  page?: number;
  channel?: InboxChannel;
  assignment?: InboxAssignment;
  query?: string;
  historyPage?: number;
};

export function inboxUrl({ clinic, status, thread, notice, page = 1, channel, assignment, query, historyPage = 1 }: InboxLocation = {}) {
  const params = new URLSearchParams();
  if (clinic) params.set("clinic", clinic);
  if (status) params.set("status", status);
  if (thread) params.set("thread", thread);
  if (page > 1) params.set("page", String(page));
  if (notice) params.set("notice", notice);
  if (channel) params.set("channel", channel);
  if (status !== "closed" && assignment) params.set("assignment", assignment);
  if (query) params.set("q", query);
  if (historyPage > 1) params.set("historyPage", String(historyPage));
  return params.size ? "/caixa?" + params : "/caixa";
}
