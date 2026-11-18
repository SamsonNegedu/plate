/** Failure modes the sync engine reacts to differently. */
export class SyncError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "server" | "auth" | "resync" | "disabled" | "access" | "protocol",
  ) {
    super(message);
    this.name = "SyncError";
  }
}

export class NetworkError extends SyncError {
  constructor(message = "The server cannot be reached.") {
    super(message, "network");
  }
}

export class ServerError extends SyncError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message, "server");
  }
}

export class AuthError extends SyncError {
  constructor() {
    super("The session has expired.", "auth");
  }
}

export class ResyncRequired extends SyncError {
  constructor(readonly minSeq: number) {
    super("This device is too far behind and needs a snapshot.", "resync");
  }
}

export class SyncDisabled extends SyncError {
  constructor() {
    super("Sync is paused by the server.", "disabled");
  }
}

/** Cloudflare Access can answer an API call with an HTML login page instead of JSON. */
export class AccessExpired extends SyncError {
  constructor() {
    super("Sign in to continue.", "access");
  }
}

export class ProtocolError extends SyncError {
  constructor(message: string) {
    super(message, "protocol");
  }
}
