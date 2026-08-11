export type StaffForceLogoutReason = "deactivated" | "deleted";

type StaffForceLogoutHandler = (reason: StaffForceLogoutReason) => void | Promise<void>;

let handler: StaffForceLogoutHandler | null = null;

export function registerStaffForceLogoutHandler(next: StaffForceLogoutHandler | null): void {
  handler = next;
}

export function requestStaffForceLogout(reason: StaffForceLogoutReason): void {
  void handler?.(reason);
}
