import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import crypto, { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser, ExtensionSession, isAdminRole } from "@shared/schema";

export type User = SelectUser;

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

/** Strip sensitive hash before sending a user object down to the client. */
export function publicUser(
  user: SelectUser,
  session?: { adminView?: boolean },
): Omit<SelectUser, "password"> & { adminView?: boolean } {
  const { password: _, ...safe } = user;
  const isAdmin = isAdminRole(user.role);
  const sessionAdminView =
    session && typeof session === "object" && session.adminView === true;
  return {
    ...safe,
    adminView: isAdmin && sessionAdminView,
  };
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
    const user = await storage.getUser(id);
    done(null, user);
  });

  // NOTE: There is intentionally no open "/api/register" endpoint. Account
  // creation goes through "/api/setup/initialize", which is guarded by the
  // isUserCreationAllowed / user-count check so accounts can only be created
  // during first-time setup or after an explicit database reset.

  app.post("/api/login", passport.authenticate("local"), (req, res) => {
    res.status(200).json(publicUser(req.user!, req.session));
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.sendStatus(401);
    res.json(publicUser(req.user, req.session));
  });
}

/**
 * Express middleware that requires the request be authenticated.
 *
 * Honors the DISABLE_AUTH bypass flag set in server/index.ts: when
 * DISABLE_AUTH=true (and NODE_ENV is not "production"), the bypass middleware
 * populates req.user with a mock developer account, which causes
 * req.isAuthenticated() (Passport) to return true. The production guard means
 * this bypass never weakens auth in production. Do NOT remove this bypass option.
 */
export function requireAuth(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ error: "Not authenticated" });
}

/** Express middleware gating admin-only endpoints. */
export function requireAdmin(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (!isAdminRole(req.user.role)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
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
