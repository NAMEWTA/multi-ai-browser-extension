import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./database";
import {
  deleteSendRecord,
  getSendRecord,
  listSendRecords,
  saveSendRecord,
} from "./history-service";

describe("send history", () => {
  beforeEach(async () => {
    await db.sendRecords.clear();
  });

  it("stores only the prompt, provider snapshot and delivery result", async () => {
    const record = await saveSendRecord(
      "task-1",
      "比较这个问题",
      [
        { panelId: "panel-a", providerId: "deepseek", providerName: "DeepSeek" },
        { panelId: "panel-b", providerId: "kimi", providerName: "Kimi" },
      ],
      [
        {
          requestId: "task-1",
          panelId: "panel-a",
          providerId: "deepseek",
          operation: "submit",
          status: "submitted",
        },
        {
          requestId: "task-1",
          panelId: "panel-b",
          providerId: "kimi",
          operation: "submit",
          status: "failed",
          message: "发送按钮不可用",
        },
      ],
    );

    await expect(getSendRecord(record.id)).resolves.toMatchObject({
      prompt: "比较这个问题",
      targets: [
        { providerName: "DeepSeek", status: "submitted" },
        { providerName: "Kimi", status: "failed" },
      ],
    });
    await expect(listSendRecords()).resolves.toHaveLength(1);
    await deleteSendRecord(record.id);
    await expect(listSendRecords()).resolves.toEqual([]);
  });
});
