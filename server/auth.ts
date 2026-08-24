import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import crypto, { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser, ExtensionSession, isAdminRole } from "@shared/schema";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: {
      httpOnly: true,
      // "auto" marks the cookie Secure only on connections that are actually
      // HTTPS (`trust proxy` is on, so X-Forwarded-Proto counts). Hard-coding
      // `NODE_ENV === "production"` would set Secure on a production instance
      // served over plain HTTP, and the browser would then refuse to send the
      // cookie back — silently logging everyone out with no error to show for it.
      secure: "auto",
      sameSite: "lax",
    },
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      const user = await storage.getUserByUsername(username);
      if (!user || !(await comparePasswords(password, user.password))) {
        return done(null, false);
      } else {
        return done(null, user);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      // The account can be deleted while one of its sessions is still alive —
      // an admin removing a user does exactly that. Resolve to `false` rather
      // than `undefined`: passport reads undefined as a failure and answers
      // every subsequent request with a 500 "Failed to deserialize user out of
      // session", where `false` simply leaves the request unauthenticated and
      // bounces them to the login screen.
      done(null, user ?? false);
    } catch (err) {
      done(err);
    }
  });

  // NOTE: there is no development auth bypass. Every request authenticates for
  // real, so `req.user` is always a genuine row from the users table — which is
  // what the per-user visibility filters in server/access.ts assume.

  // NOTE: There is intentionally no open "/api/register" endpoint. Account
  // creation goes through "/api/setup/initialize", which is guarded by the
  // isUserCreationAllowed / user-count check so accounts can only be created
  // during first-time setup or after an explicit database reset.

  app.post("/api/login", passport.authenticate("local"), (req, res) => {
    res.status(200).json(publicUser(req.user!));
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(publicUser(req.user!));
  });
}

/** Express middleware that requires the request be authenticated. */
export function requireAuth(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ error: "Not authenticated" });
}

/**
 * Requires the acting user be an instance admin (§8.5). Gates user management,
 * lookup-table edits, instance settings, and the cross-user view toggle.
 */
export function requireAdmin(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
  if (!isAdminRole(req.user?.role)) return res.status(403).json({ error: "Admin only" });
  return next();
}

/** Requires the acting user be the instance super admin. */
export function requireSuperAdmin(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
  if (req.user?.role !== "super_admin") return res.status(403).json({ error: "Super admin only" });
  return next();
}

/**
 * A user row safe to send to a client. The raw row carries the scrypt password
 * hash, which must never leave the server — strip it at every boundary rather
 * than trusting each call site to remember.
 */
export function publicUser<T extends { password?: string }>(user: T): Omit<T, "password"> {
  const { password, ...rest } = user;
  return rest;
}

/** Authenticate a Chrome extension token with SHA-256 (O(1)) and legacy scrypt fallback/migration. */
export async function authenticateExtensionToken(token: string): Promise<ExtensionSession | null> {
  if (!token) return null;
  try {
    const suppliedHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = await storage.getExtensionSessionByToken(suppliedHash);

    if (session) {
      return session;
    }

    // Fallback and migration for legacy scrypt tokens
    const allSessions = await storage.getAllExtensionSessionsAllUsers();
    for (const s of allSessions) {
      if (s.sessionToken.includes(".")) {
        try {
          const [hashed, salt] = s.sessionToken.split(".");
          const hashedBuf = Buffer.from(hashed, "hex");
          const suppliedBuf = (await scryptAsync(token, salt, 64)) as Buffer;
          if (timingSafeEqual(hashedBuf, suppliedBuf)) {
            // Migrate to SHA-256
            await storage.updateExtensionSessionToken(s.id, suppliedHash);
            s.sessionToken = suppliedHash; // Update local reference
            return s;
          }
        } catch {
          continue;
        }
      }
    }
  } catch (error) {
    console.error("Error authenticating extension token:", error);
  }
  return null;
}
