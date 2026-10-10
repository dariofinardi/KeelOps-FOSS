// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * KeelOps user recognition from the session cookie — for STANDALONE mode
 * (development and self-tests). Side-loaded in the core, the core's real
 * authentication takes its place (`plugin-host.ts`): this copy only serves
 * when the plugin runs on its own.
 *
 * The core stores the sha256 DIGEST of the token in `Session.id`, not the
 * token itself: the same hashing is replicated here
 * (modules/auth/session.ts, `hashToken`).
 */
import { createHash } from "node:crypto";

/** @returns {Promise<{id:string,name:string,role:string,canViewAllTimesheets:number}|null>} */
export async function sessionUser(req, db, cookieName) {
  const cookies = Object.fromEntries(
    (req.headers.cookie ?? "").split(";").map((c) => {
      const eq = c.indexOf("=");
      return eq < 0 ? [c.trim(), ""] : [c.slice(0, eq).trim(), decodeURIComponent(c.slice(eq + 1).trim())];
    }),
  );
  const token = cookies[cookieName];
  if (!token) return null;
  const hashed = createHash("sha256").update(token).digest("hex");
  const row = await db.get(`
    SELECT u.id, u.name, u.nickName, u.role, u.isActive, u.canViewAllTimesheets, u.locale
    FROM Session s JOIN User u ON u.id = s.userId
    WHERE s.id = ? AND s.expiresAt > ${db.sql.now()}`, hashed);
  if (!row || !row.isActive) return null;
  // external users (customer portal, sales monitors) stay out of the plugins
  if (row.role !== "ADMIN" && row.role !== "MEMBER") return null;
  return { id: row.id, name: row.nickName || row.name, role: row.role,
           canViewAllTimesheets: row.canViewAllTimesheets, locale: row.locale };
}
