import { invoke } from "@tauri-apps/api/core";

export interface HostCapability {
  commands: string[];
}

/** True inside a Tauri webview. A browser preview remains usable without host IPC. */
export function isBenchExtension(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Call a host command. The host applies the extension ACL on every invocation. */
export function invokeHost<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isBenchExtension()) {
    return Promise.reject(
      new Error("This action requires a Bench extension window."),
    );
  }
  return invoke<T>(command, args);
}

/** Read the host allow-list for affordances; this is informational, not authorization. */
export function getHostCapabilities(): Promise<HostCapability> {
  return invokeHost<HostCapability>("ext_capabilities");
}

/** Get the current plugin's private app-data directory. */
export function getExtensionDataDir(): Promise<string> {
  return invokeHost<string>("ext_data_dir");
}
