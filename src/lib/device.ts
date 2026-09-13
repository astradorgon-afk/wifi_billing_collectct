/**
 * Stable per-browser device identifier, persisted in localStorage and
 * mirrored into the DB meta table so backups carry provenance.
 */

const DEVICE_KEY = "wifi-billing:device";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "unknown";
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** Mirror the device id into the meta table so backups carry provenance. */
export async function ensureDeviceMeta(): Promise<string> {
  const id = getDeviceId();
  const { run } = await import("./db/database");
  await run(
    `INSERT INTO meta (key, value) VALUES ('device_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [id],
  );
  return id;
}