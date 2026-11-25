export type InboxStatus = "open" | "closed";

export const inboxLabels = { open: "Em aberto", closed: "Encerrados" };

export function inboxUrl(clinic?: string, status?: InboxStatus, thread?: string, notice?: string, page = 1) {
  const params = new URLSearchParams();
  if (clinic) params.set("clinic", clinic);
  if (status) params.set("status", status);
  if (thread) params.set("thread", thread);
  if (page > 1) params.set("page", String(page));
  if (notice) params.set("notice", notice);
  return params.size ? "/caixa?" + params : "/caixa";
}
