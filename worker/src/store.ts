import type { Env } from "./types";

const ADMINS_KEY = "admins";
const OWNER_KEY = "owner";
const ADMIN_NAMES_KEY = "admin_names";
const SUBSCRIBERS_KEY = "subscribers";
const SUBSCRIBER_CAP = 5000; // cheksiz o'smasin - eng eskilari chetlanadi
const BROADCAST_ENABLED_KEY = "broadcast_enabled";

/** Reads the admin list from KV, seeding it from ADMIN_IDS on first use. */
export async function getAdmins(env: Env): Promise<number[]> {
  const raw = await env.BOT_KV.get(ADMINS_KEY);
  if (raw !== null) {
    return JSON.parse(raw) as number[];
  }
  const seeded = env.ADMIN_IDS.split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => parseInt(v, 10))
    .filter((v) => !Number.isNaN(v));
  if (seeded.length > 0) {
    await env.BOT_KV.put(ADMINS_KEY, JSON.stringify(seeded));
  }
  return seeded;
}

export async function isAdmin(env: Env, userId: number): Promise<boolean> {
  const admins = await getAdmins(env);
  return admins.includes(userId);
}

/** Returns false if the user was already an admin. */
export async function addAdmin(env: Env, userId: number): Promise<boolean> {
  const admins = await getAdmins(env);
  if (admins.includes(userId)) return false;
  admins.push(userId);
  await env.BOT_KV.put(ADMINS_KEY, JSON.stringify(admins));
  return true;
}

/**
 * Returns false if the user wasn't an admin, removing them would leave zero admins, or
 * they're the current owner (owner must transfer ownership before being removed).
 */
export async function removeAdmin(env: Env, userId: number): Promise<boolean> {
  const admins = await getAdmins(env);
  if (!admins.includes(userId) || admins.length <= 1) return false;
  if ((await getOwner(env)) === userId) return false;
  const next = admins.filter((id) => id !== userId);
  await env.BOT_KV.put(ADMINS_KEY, JSON.stringify(next));
  return true;
}

/**
 * Admin ID -> ism xaritasi (adminlar ro'yxatidan mustaqil saqlanadi, shunda avval ismsiz
 * qo'shilgan adminlarga ham keyinroq ism yozib qo'yish mumkin - "admins" ro'yxatini qayta
 * shakllantirishga hojat yo'q).
 */
export async function getAdminNames(env: Env): Promise<Record<number, string>> {
  const raw = await env.BOT_KV.get(ADMIN_NAMES_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<number, string>;
  } catch {
    return {};
  }
}

export async function setAdminName(env: Env, userId: number, name: string): Promise<void> {
  const names = await getAdminNames(env);
  if (name.trim()) {
    names[userId] = name.trim();
  } else {
    delete names[userId];
  }
  await env.BOT_KV.put(ADMIN_NAMES_KEY, JSON.stringify(names));
}

/** Reads the current owner (asosiy admin), seeding it from OWNER_ID on first use. */
export async function getOwner(env: Env): Promise<number> {
  const raw = await env.BOT_KV.get(OWNER_KEY);
  if (raw !== null) return parseInt(raw, 10);
  const seeded = parseInt(env.OWNER_ID, 10);
  const ownerId = !Number.isNaN(seeded) ? seeded : ((await getAdmins(env))[0] ?? 0);
  await env.BOT_KV.put(OWNER_KEY, String(ownerId));
  return ownerId;
}

export async function isOwner(env: Env, userId: number): Promise<boolean> {
  return (await getOwner(env)) === userId;
}

/** Returns false if the target isn't already an admin - ownership can only move to an existing admin. */
export async function transferOwnership(env: Env, newOwnerId: number): Promise<boolean> {
  const admins = await getAdmins(env);
  if (!admins.includes(newOwnerId)) return false;
  await env.BOT_KV.put(OWNER_KEY, String(newOwnerId));
  return true;
}

/**
 * Everyone who has ever pressed /start - not just admins. Whether they actually receive
 * ZOOM eslatmalar depends on isBroadcastEnabled() (an admin-controlled on/off switch); this
 * list just tracks who to notify IF that's turned on. Capped so it can't grow unbounded.
 */
export async function getSubscribers(env: Env): Promise<number[]> {
  const raw = await env.BOT_KV.get(SUBSCRIBERS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as number[];
  } catch {
    return [];
  }
}

export async function addSubscriber(env: Env, userId: number): Promise<void> {
  const subscribers = await getSubscribers(env);
  if (subscribers.includes(userId)) return;
  subscribers.push(userId);
  const capped = subscribers.length > SUBSCRIBER_CAP ? subscribers.slice(subscribers.length - SUBSCRIBER_CAP) : subscribers;
  await env.BOT_KV.put(SUBSCRIBERS_KEY, JSON.stringify(capped));
}

/** Master on/off switch: should ZOOM eslatmalar go out to every subscriber, or only the owner? Off by default. */
export async function isBroadcastEnabled(env: Env): Promise<boolean> {
  const raw = await env.BOT_KV.get(BROADCAST_ENABLED_KEY);
  return raw === "true";
}

export async function setBroadcastEnabled(env: Env, enabled: boolean): Promise<void> {
  await env.BOT_KV.put(BROADCAST_ENABLED_KEY, String(enabled));
}
