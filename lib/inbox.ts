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

export function inboxUrl(
  clinic?: string, status?: InboxStatus, thread?: string, notice?: string, page = 1, channel?: InboxChannel, assignment?: InboxAssignment,
) {
  const params = new URLSearchParams();
  if (clinic) params.set("clinic", clinic);
  if (status) params.set("status", status);
  if (thread) params.set("thread", thread);
  if (page > 1) params.set("page", String(page));
  if (notice) params.set("notice", notice);
  if (channel) params.set("channel", channel);
  if (status !== "closed" && assignment) params.set("assignment", assignment);
  return params.size ? "/caixa?" + params : "/caixa";
}
