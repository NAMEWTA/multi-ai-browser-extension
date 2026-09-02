import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcquisitionCompleteness, ConversationSnapshot } from "../core/acquisition/contracts";
import {
  getCurrentAcquisitionSnapshot,
  getCurrentFinalAcquisitionBody,
  saveAcquisitionSnapshot,
} from "./acquisition-snapshot-service";
import { db, type AcquisitionVerification } from "./database";

const complete: AcquisitionCompleteness = {
  state: "complete",
  capturedMessageCount: 1,
  expectedMessageCount: 1,
  capturedContentChars: 20,
  expectedContentChars: 20,
  hasBeginning: true,
  hasEnd: true,
};

function fixture(
  options: {
    conversationId?: string;
    providerMessageId?: string;
    text?: string;
    capturedAt?: number;
    completeness?: AcquisitionCompleteness;
    omitConversationId?: boolean;
  } = {},
): ConversationSnapshot {
  const providerMessageId = options.providerMessageId ?? "message-1";
  return {
    schemaVersion: 1,
    providerId: "deepseek",
    ...(options.omitConversationId
      ? {}
      : { conversationId: options.conversationId ?? "conversation-1" }),
    capturedAt: options.capturedAt ?? 1_788_246_000_000,
    messages: [
      {
        id: providerMessageId,
        role: "assistant",
        content: [
          {
            kind: "paragraph",
            text: options.text ?? "Complete answer text",
            markdown: `**${options.text ?? "Complete answer text"}**`,
          },
        ],
      },
    ],
    source: "provider-api",
    completeness: options.completeness ?? complete,
    evidence: {
      stableMessageKeys: [providerMessageId],
      signals: ["provider-count", "terminal-cursor"],
      cursor: { hasMore: false, reachedStart: true, reachedEnd: true },
      branch: {
        currentNodeId: providerMessageId,
        capturedNodeIds: [providerMessageId],
        linearized: true,
        complete: true,
      },
    },
    diagnostics: { strategyId: "deepseek-history-v2", entries: [] },
  };
}

async function save(
  snapshot: ConversationSnapshot,
  revision: number,
  verification: AcquisitionVerification = "verified",
) {
  return await saveAcquisitionSnapshot({
    turnId: "turn-1",
    panelId: "panel-1",
    providerMessageId: snapshot.messages[0]!.id,
    revision,
    adapterVersion: "deepseek-history@2",
    verification,
    snapshot,
  });
}

describe("acquisition snapshot persistence", () => {
  beforeEach(async () => {
    await db.acquisitionSnapshots.clear();
  });

  it("persists canonical acquisition metadata and the adapter envelope", async () => {
    const snapshot = fixture();
    const result = await save(snapshot, 3, "bounded");

    expect(result.inserted).toBe(true);
    expect(await db.acquisitionSnapshots.get(result.record.id)).toMatchObject({
      schemaVersion: 2,
      providerId: "deepseek",
      conversationId: "conversation-1",
      providerMessageId: "message-1",
      revision: 3,
      source: snapshot.source,
      completeness: snapshot.completeness,
      verification: "bounded",
      evidence: snapshot.evidence,
      adapterVersion: "deepseek-history@2",
      selected: true,
    });
  });

  it("persists every message in a complete conversation snapshot and selects the turn response", async () => {
    const snapshot: ConversationSnapshot = {
      ...fixture({ providerMessageId: "assistant-2" }),
      messages: [
        { id: "user-1", role: "user", content: [{ kind: "paragraph", text: "Question" }] },
        {
          id: "assistant-2",
          role: "assistant",
          content: [{ kind: "paragraph", text: "Complete answer text" }],
        },
      ],
      completeness: {
        ...complete,
        capturedMessageCount: 2,
        expectedMessageCount: 2,
      },
      evidence: {
        ...fixture().evidence,
        stableMessageKeys: ["user-1", "assistant-2"],
      },
    };

    await saveAcquisitionSnapshot({
      turnId: "turn-1",
      panelId: "panel-1",
      providerMessageId: "assistant-2",
      revision: 1,
      adapterVersion: "deepseek-history@2",
      verification: "verified",
      snapshot,
    });

    const records = await db.acquisitionSnapshots.toArray();
    expect(records).toHaveLength(2);
    expect(records.find((record) => record.providerMessageId === "user-1")?.selected).toBe(false);
    expect((await getCurrentAcquisitionSnapshot("turn-1", "panel-1"))?.providerMessageId).toBe(
      "assistant-2",
    );
  });

  it("is idempotent for provider, conversation, message and revision", async () => {
    const first = await save(fixture({ text: "first committed body" }), 2);
    const retry = await save(fixture({ text: "conflicting retry body" }), 2, "unknown");

    expect(first.inserted).toBe(true);
    expect(retry.inserted).toBe(false);
    expect(retry.record).toEqual(first.record);
    expect(await db.acquisitionSnapshots.count()).toBe(1);
    expect(retry.record.content[0]?.text).toBe("first committed body");
    expect(retry.record.verification).toBe("verified");
  });

  it("serializes concurrent retries into one immutable revision", async () => {
    const [left, right] = await Promise.all([save(fixture(), 4), save(fixture(), 4)]);

    expect([left.inserted, right.inserted].toSorted()).toEqual([false, true]);
    expect(left.record).toEqual(right.record);
    expect(await db.acquisitionSnapshots.count()).toBe(1);
  });

  it("stores every verification value without promoting it", async () => {
    const verifications = ["verified", "bounded", "partial", "unknown"] as const;
    for (const [revision, verification] of verifications.entries()) {
      await save(fixture(), revision, verification);
    }

    const records = (await db.acquisitionSnapshots.toArray()).toSorted(
      (left, right) => left.revision - right.revision,
    );
    expect(records.map((record) => record.verification)).toEqual(verifications);
  });

  it("keeps identities separate across conversations and messages", async () => {
    await save(fixture({ conversationId: "conversation-a", providerMessageId: "message-a" }), 1);
    await save(fixture({ conversationId: "conversation-b", providerMessageId: "message-a" }), 1);
    await save(fixture({ conversationId: "conversation-a", providerMessageId: "message-b" }), 1);

    expect(await db.acquisitionSnapshots.count()).toBe(3);
  });

  it("keeps the same provider revision isolated across extension turns", async () => {
    const snapshot = fixture();
    await save(snapshot, 1);
    await saveAcquisitionSnapshot({
      turnId: "turn-2",
      panelId: "panel-1",
      providerMessageId: "message-1",
      revision: 1,
      adapterVersion: "deepseek-history@2",
      verification: "verified",
      snapshot,
    });

    expect(await db.acquisitionSnapshots.count()).toBe(2);
    expect(
      (await db.acquisitionSnapshots.toArray()).map(({ turnId }) => turnId).toSorted(),
    ).toEqual(["turn-1", "turn-2"]);
  });

  it("writes through an explicit Dexie transaction", async () => {
    const transaction = vi.spyOn(db, "transaction");
    await save(fixture(), 1);

    expect(transaction).toHaveBeenCalledWith("rw", db.acquisitionSnapshots, expect.any(Function));
    transaction.mockRestore();
  });

  it("selects the greatest revision for the same provider message", async () => {
    await save(fixture({ text: "revision three", capturedAt: 300 }), 3);
    await save(fixture({ text: "revision one", capturedAt: 500 }), 1);

    const current = await getCurrentAcquisitionSnapshot("turn-1", "panel-1");
    expect(current?.revision).toBe(3);
    expect(current?.content[0]?.text).toBe("revision three");
  });

  it("returns verified and bounded complete bodies with markdown", async () => {
    for (const verification of ["verified", "bounded"] as const) {
      await db.acquisitionSnapshots.clear();
      await save(fixture({ text: `${verification} answer` }), 1, verification);

      const body = await getCurrentFinalAcquisitionBody("turn-1", "panel-1");
      expect(body).toMatchObject({
        text: `${verification} answer`,
        markdown: `**${verification} answer**`,
        snapshot: { verification },
      });
    }
  });

  it.each(["partial", "unknown"] as const)(
    "does not expose a %s verification as a final body",
    async (verification) => {
      await save(fixture(), 1, verification);
      expect(await getCurrentFinalAcquisitionBody("turn-1", "panel-1")).toBeUndefined();
    },
  );

  it("does not expose canonical partial content as a final body", async () => {
    await save(
      fixture({
        completeness: {
          ...complete,
          state: "partial",
          hasEnd: false,
        },
      }),
      1,
      "verified",
    );

    expect(await getCurrentFinalAcquisitionBody("turn-1", "panel-1")).toBeUndefined();
  });

  it("does not fall back to a stale final body when the current revision is partial", async () => {
    await save(fixture({ text: "old complete answer", capturedAt: 100 }), 1, "verified");
    await save(
      fixture({
        text: "new truncated answer",
        capturedAt: 200,
        completeness: { ...complete, state: "partial", hasEnd: false },
      }),
      2,
      "partial",
    );

    expect((await getCurrentAcquisitionSnapshot("turn-1", "panel-1"))?.revision).toBe(2);
    expect(await getCurrentFinalAcquisitionBody("turn-1", "panel-1")).toBeUndefined();
  });

  it("rejects contradictory boundary, cursor and branch evidence", async () => {
    const variants: ConversationSnapshot[] = [
      fixture({ completeness: { ...complete, hasEnd: false } }),
      {
        ...fixture(),
        evidence: {
          ...fixture().evidence,
          cursor: { hasMore: true, reachedEnd: false },
        },
      },
      {
        ...fixture(),
        evidence: {
          ...fixture().evidence,
          branch: {
            capturedNodeIds: ["message-1"],
            linearized: false,
            complete: false,
          },
        },
      },
    ];

    for (const [revision, snapshot] of variants.entries()) {
      await db.acquisitionSnapshots.clear();
      await save(snapshot, revision, "verified");
      expect(await getCurrentFinalAcquisitionBody("turn-1", "panel-1")).toBeUndefined();
    }
  });

  it("requires stable persistent identities", async () => {
    const snapshot = fixture({ omitConversationId: true });
    await expect(save(snapshot, 1)).rejects.toThrow("snapshot.conversationId must not be empty");
    expect(await db.acquisitionSnapshots.count()).toBe(0);
  });
});
