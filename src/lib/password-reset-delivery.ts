import { randomUUID } from "node:crypto";
import { createPasswordReset } from "./auth";
import { type DatabaseClient, query, transaction } from "./db";
import { sendOwnerEmail } from "./email";

type ResetDelivery = {
  id: string;
  owner_id: string;
  email: string;
  active: boolean;
  attempt_count: number;
};

const LEASE_MINUTES = 5;
const MAX_BATCH = 10;

export async function enqueuePasswordResetDelivery(email: string) {
  return transaction(async (client) => {
    const result = await client.query<{ id: string }>(
      "select id from owners where email=? and active=true for update",
      [email],
    );
    const owner = result.rows[0];
    if (!owner) return false;
    const existing = await client.query<{ id: string }>(
      "select id from owner_password_reset_deliveries where owner_id=? and status in ('queued','processing') limit 1 for update",
      [owner.id],
    );
    if (!existing.rows[0]) {
      await client.query(
        "insert into owner_password_reset_deliveries(id,owner_id,status,available_at) values (?,?,'queued',utc_timestamp(3))",
        [randomUUID(), owner.id],
      );
    }
    return true;
  });
}

async function claimNextDelivery() {
  return transaction(async (client) => {
    const result = await client.query<ResetDelivery>(
      `select d.id,d.owner_id,d.attempt_count,o.email,o.active
         from owner_password_reset_deliveries d
         join owners o on o.id=d.owner_id
        where (d.status='queued' and d.available_at<=utc_timestamp(3))
           or (d.status='processing' and d.locked_until<=utc_timestamp(3))
        order by d.available_at,d.created_at,d.id
        limit 1 for update skip locked`,
    );
    const delivery = result.rows[0];
    if (!delivery) return null;
    await client.query(
      `update owner_password_reset_deliveries
          set status='processing',attempt_count=attempt_count+1,
              locked_until=date_add(utc_timestamp(3),interval ? minute),last_error=null
        where id=?`,
      [LEASE_MINUTES, delivery.id],
    );
    return { ...delivery, attempt_count: Number(delivery.attempt_count) + 1 };
  });
}

function resetMessage(email: string, origin: string, token: string, ttlMinutes: number) {
  const url = new URL("/admin/reset", origin);
  url.searchParams.set("token", token);
  return {
    to: email,
    subject: "Reset your Ship Print eSell owner password",
    text: [
      "A password reset was requested for your Ship Print eSell owner account.",
      "",
      `Open this link to choose a new password: ${url}`,
      "",
      `The link expires in ${ttlMinutes} minutes and can be used once.`,
      "If you did not request this, you can ignore this message and your password will stay unchanged.",
    ].join("\n"),
  };
}

async function markDelivered(id: string, providerId?: string) {
  await query(
    `update owner_password_reset_deliveries
        set status='delivered',provider_message_id=?,delivered_at=utc_timestamp(3),locked_until=null,last_error=null
      where id=? and status='processing'`,
    [providerId ?? null, id],
  );
}

async function markFailed(id: string, message: string) {
  await query(
    `update owner_password_reset_deliveries
        set status='failed',locked_until=null,last_error=?
      where id=? and status='processing'`,
    [message.slice(0, 2_000), id],
  );
}

async function reschedule(id: string, attemptCount: number, message: string) {
  const delayMinutes = Math.min(60, Math.max(1, 2 ** Math.min(attemptCount - 1, 6)));
  await query(
    `update owner_password_reset_deliveries
        set status='queued',available_at=date_add(utc_timestamp(3),interval ? minute),
            locked_until=null,last_error=?
      where id=? and status='processing'`,
    [delayMinutes, message.slice(0, 2_000), id],
  );
}

export async function processPasswordResetDeliveryQueue(appOrigin: string, limit = 1) {
  const boundedLimit = Math.min(MAX_BATCH, Math.max(1, Math.floor(limit)));
  let processed = 0;
  for (; processed < boundedLimit; processed += 1) {
    const delivery = await claimNextDelivery();
    if (!delivery) break;
    if (!delivery.active) {
      await markFailed(delivery.id, "Owner account is inactive.");
      continue;
    }
    try {
      const reset = await createPasswordReset(delivery.owner_id);
      const result = await sendOwnerEmail(resetMessage(delivery.email, appOrigin, reset.token, reset.ttlMinutes));
      if (result.status === "provider_accepted") await markDelivered(delivery.id, result.providerId);
      else await reschedule(delivery.id, delivery.attempt_count, result.error ?? `Email delivery is ${result.status}.`);
    } catch (error) {
      await reschedule(delivery.id, delivery.attempt_count, error instanceof Error ? error.message : "Unknown reset delivery error");
    }
  }
  return processed;
}

export async function countQueuedPasswordResetDeliveries(client: DatabaseClient) {
  const result = await client.query<{ count: number }>(
    "select count(*) as count from owner_password_reset_deliveries where status in ('queued','processing')",
  );
  return Number(result.rows[0]?.count ?? 0);
}
