// Hand-written types for things Zod doesn't model directly.

export type NetworkState = "connected" | "flicker" | "reconnecting" | "offline" | "roaming";

export interface IpcError {
  code:
    | "validation"
    | "unauthorized"
    | "not-found"
    | "conflict"
    | "internal"
    | "forbidden-channel"
    | "integrity-violation"
    | "host-mismatch"
    | "rate-limited";
  message: string;
}
