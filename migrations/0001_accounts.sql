-- Better Auth 1.7.18 core schema, generated with getMigrations() from src/server/auth.ts options.
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");

-- One Google subject maps to exactly one user.
create unique index "account_provider_subject_uidx" on "account" ("providerId", "accountId");

-- Per-user cloud training log snapshot. Revision is monotonic per user and survives clearing.
create table "training_log" (
  "user_id" text not null primary key references "user" ("id") on delete cascade,
  "schema_version" integer not null,
  "revision" integer not null check ("revision" >= 1),
  "cleared" integer not null default 0 check ("cleared" in (0, 1)),
  "entry_count" integer not null check ("entry_count" >= 0 and "entry_count" <= 5000),
  "entries_json" text not null check (length("entries_json") <= 1048576),
  "created_at" integer not null,
  "updated_at" integer not null
);
