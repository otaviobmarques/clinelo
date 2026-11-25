import type { Booking } from "./agenda";
import type { InboxChannel } from "./inbox";

export type ReceptionDashboard = {
  appointments: Record<Booking["status"], number>;
  queue: { open: number; unassigned: number; mine: number };
  next: (Pick<Booking, "id" | "patient_name" | "professional_id" | "starts_at" | "status"> & {
    professional_name: string;
  })[];
  waiting: { id: string; subject: string; channel: InboxChannel; queued_at: string | null }[];
};

export function receptionUrl(clinic?: string) {
  return clinic ? "/painel?" + new URLSearchParams({ clinic }) : "/painel";
}
