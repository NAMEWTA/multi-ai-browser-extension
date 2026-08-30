import type { ProviderId } from "../providers/contracts";

export interface RegisteredFrame {
  readonly panelId: string;
  readonly providerId: ProviderId;
  readonly tabId: number;
  readonly frameId: number;
  readonly url: string;
  readonly lastSeenAt: number;
}

export class FrameRegistry {
  private readonly byPanel = new Map<string, RegisteredFrame>();

  register(frame: RegisteredFrame): void {
    this.byPanel.set(frame.panelId, frame);
  }

  get(panelId: string): RegisteredFrame | undefined {
    return this.byPanel.get(panelId);
  }

  removeTab(tabId: number): void {
    for (const [panelId, frame] of this.byPanel) {
      if (frame.tabId === tabId) this.byPanel.delete(panelId);
    }
  }

  removeFrame(tabId: number, frameId: number): void {
    for (const [panelId, frame] of this.byPanel) {
      if (frame.tabId === tabId && frame.frameId === frameId) this.byPanel.delete(panelId);
    }
  }

  all(): readonly RegisteredFrame[] {
    return [...this.byPanel.values()];
  }
}
