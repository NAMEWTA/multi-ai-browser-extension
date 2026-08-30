import { z } from "zod";
import { providerIdSchema } from "./protocol";

const registeredFrameSchema = z.object({
  panelId: z.string().min(1),
  providerId: providerIdSchema,
  tabId: z.number().int().nonnegative(),
  frameId: z.number().int().nonnegative(),
  url: z.url(),
  lastSeenAt: z.number().finite(),
});

const fallbackTabSchema = z.object({
  tabId: z.number().int().nonnegative(),
  panelId: z.string().min(1),
  providerId: providerIdSchema,
});

export const runtimeSnapshotSchema = z.object({
  frames: z.array(registeredFrameSchema),
  fallbackTabs: z.array(fallbackTabSchema),
});

export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>;
