import { describe, expect, test } from 'bun:test';
import type { Message, Part } from '@opencode-ai/sdk/v2';
import { buildProjectionCacheKey } from './turnProjectionCache';
import type { ChatMessageEntry } from './types';

const createEntry = (
    id: string = 'msg_1',
    role: 'assistant' | 'user' = 'assistant',
    text: string = 'hello',
): ChatMessageEntry => ({
    info: { id, role } as Message,
    parts: [{ id: `prt_${id}`, type: 'text', text } as Part],
});

describe('turnProjectionCache', () => {
    test('keeps the cache key stable for unchanged message and part references', () => {
        const messages = [createEntry()];

        const first = buildProjectionCacheKey('session_1', messages, false, false);
        const second = buildProjectionCacheKey('session_1', messages, false, false);

        expect(second).toBe(first);
    });

    // -------------------------------------------------------------------------
    // Fix 7 performance goal preserved: streaming text growth does NOT miss.
    // -------------------------------------------------------------------------
    test('keeps the cache key stable when only the last message part TEXT changes (streaming text growth)', () => {
        // The structural signature signs part type + id but NOT part.text.
        // Streaming text growth creates a new part object with the same type
        // and id but different text — the cache must stay hot.
        const before = [createEntry('msg_1', 'assistant', 'hel')];
        const after = [
            {
                info: before[0].info,
                parts: [{ id: 'prt_msg_1', type: 'text', text: 'hello world grown' } as Part],
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).toBe(beforeKey);
    });

    test('keeps the cache key stable when a middle message part TEXT changes', () => {
        // Interior streaming text growth also stays hot — the structural
        // signature never reads text content.
        const before = [
            createEntry('msg_1', 'user', 'question'),
            createEntry('msg_2', 'assistant', 'partial ans'),
            createEntry('msg_3', 'assistant', 'tail'),
        ];
        const after = [
            before[0],
            {
                info: before[1]!.info,
                parts: [{ id: 'prt_msg_2', type: 'text', text: 'full answer' } as Part],
            },
            before[2],
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).toBe(beforeKey);
    });

    // -------------------------------------------------------------------------
    // Blocker 2: structural changes DO miss.
    // -------------------------------------------------------------------------

    test('BLOCKER 2: cache misses when a middle message gets a new tool part (type/id change)', () => {
        // A tool part is added to a middle assistant message — this changes
        // activity segmentation and must invalidate.
        const before = [
            createEntry('msg_1', 'user', 'do the thing'),
            createEntry('msg_2', 'assistant', 'working'),
            createEntry('msg_3', 'assistant', 'tail'),
        ];
        const after = [
            before[0],
            {
                info: before[1]!.info,
                parts: [
                    { id: 'prt_msg_2', type: 'text', text: 'working' } as Part,
                    { id: 'tool_1', type: 'tool', tool: { id: 'tool_exec_1' } } as unknown as Part,
                ],
            },
            before[2],
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKER 2: cache misses when a middle assistant finish state changes', () => {
        // finish flips from undefined to 'stop' — changes stream state.
        const before = [createEntry('msg_1', 'assistant', 'partial')];
        const after = [
            {
                info: { id: 'msg_1', role: 'assistant', finish: 'stop' } as Message,
                parts: before[0].parts,
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKER 2: cache misses when a middle assistant gets an error attached (retry overlay on non-tail)', () => {
        // applyRetryOverlay attaches error to a non-末尾 assistant — the
        // structural signature signs error presence ('1' vs '0').
        const before = [
            createEntry('msg_1', 'user', 'do it'),
            createEntry('msg_2', 'assistant', 'result'), // non-tail assistant
            createEntry('msg_3', 'assistant', 'tail'),
        ];
        const after = [
            before[0],
            {
                info: {
                    ...(before[1]!.info as Record<string, unknown>),
                    error: { name: 'RetryError', message: 'retry' },
                } as unknown as Message,
                parts: before[1]!.parts,
            },
            before[2],
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKER 2: cache misses when a middle user summary.diffs changes', () => {
        // summary.diffs drives diffStats + changedFiles projection. A diff
        // arriving or counts changing must invalidate.
        const before = [
            createEntry('msg_1', 'user', 'do it'),
            createEntry('msg_2', 'assistant', 'done'),
        ];
        const after = [
            {
                info: {
                    id: 'msg_1',
                    role: 'user',
                    summary: {
                        diffs: [{ file: 'a.ts', additions: 5, deletions: 2 }],
                    },
                } as unknown as Message,
                parts: before[0]!.parts,
            },
            before[1],
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKER 2: cache misses when a user summary.diffs counts change (same files, different numbers)', () => {
        const baseUser = {
            id: 'msg_1',
            role: 'user',
            summary: {
                diffs: [{ file: 'a.ts', additions: 5, deletions: 2 }],
            },
        };
        const before: ChatMessageEntry[] = [
            { info: baseUser as unknown as Message, parts: [] },
            createEntry('msg_2', 'assistant', 'done'),
        ];
        const after: ChatMessageEntry[] = [
            {
                info: {
                    ...baseUser,
                    summary: {
                        diffs: [{ file: 'a.ts', additions: 10, deletions: 4 }],
                    },
                } as unknown as Message,
                parts: [],
            },
            before[1],
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKER 2: cache misses when a part type changes (reasoning → text transition)', () => {
        const before = [
            {
                info: { id: 'msg_1', role: 'assistant' } as Message,
                parts: [{ id: 'prt_1', type: 'reasoning', text: 'thinking' } as Part],
            },
        ];
        const after = [
            {
                info: before[0]!.info,
                parts: [{ id: 'prt_1', type: 'text', text: 'answer' } as Part],
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKER 2: cache misses when a part id changes (same type, new part replaces old)', () => {
        const before = [
            {
                info: { id: 'msg_1', role: 'assistant' } as Message,
                parts: [{ id: 'prt_old', type: 'text', text: 'old' } as Part],
            },
        ];
        const after = [
            {
                info: before[0]!.info,
                parts: [{ id: 'prt_new', type: 'text', text: 'new' } as Part],
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKER 2: cache misses when a middle message time.completed changes (stream state)', () => {
        const before = [
            createEntry('msg_1', 'user', 'do it'),
            {
                info: { id: 'msg_2', role: 'assistant', time: { completed: 0 } } as Message,
                parts: [{ id: 'prt_2', type: 'text', text: 'working' } as Part],
            },
            createEntry('msg_3', 'assistant', 'tail'),
        ];
        const after = [
            before[0],
            {
                info: { id: 'msg_2', role: 'assistant', time: { completed: 12345 } } as Message,
                parts: before[1]!.parts,
            },
            before[2],
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKER 2: cache misses when a middle message role changes', () => {
        // Role change affects turn grouping boundaries.
        const before = [
            createEntry('msg_1', 'user', 'do it'),
            createEntry('msg_2', 'assistant', 'result'),
        ];
        const after = [
            before[0],
            {
                info: { id: 'msg_2', role: 'user' } as Message,
                parts: before[1]!.parts,
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKER 2: cache misses when a middle message parentID changes (turn boundary shift)', () => {
        const before = [
            createEntry('msg_1', 'user', 'do it'),
            {
                info: { id: 'msg_2', role: 'assistant', parentID: 'msg_1' } as Message,
                parts: [{ id: 'prt_2', type: 'text', text: 'ans' } as Part],
            },
        ];
        const after = [
            before[0],
            {
                info: { id: 'msg_2', role: 'assistant', parentID: 'msg_X' } as Message,
                parts: before[1]!.parts,
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('changes the cache key when a new message is appended (length grows)', () => {
        const before = [createEntry('msg_1')];
        const after = [
            createEntry('msg_1'),
            createEntry('msg_2', 'assistant', 'world'),
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('changes the cache key when the first message id changes (prepend or session switch)', () => {
        const before = [createEntry('msg_1')];
        const after = [
            createEntry('msg_0', 'user', 'start'),
            {
                info: before[0].info,
                parts: before[0].parts,
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('changes the cache key when showTextJustificationActivity or showTurnChangedFiles toggle', () => {
        const messages = [createEntry()];

        const base = buildProjectionCacheKey('session_1', messages, false, false);
        const withJustification = buildProjectionCacheKey('session_1', messages, true, false);
        const withChangedFiles = buildProjectionCacheKey('session_1', messages, false, true);

        expect(withJustification).not.toBe(base);
        expect(withChangedFiles).not.toBe(base);
    });

    test('changes the cache key when the session key differs', () => {
        const messages = [createEntry()];

        const a = buildProjectionCacheKey('session_1', messages, false, false);
        const b = buildProjectionCacheKey('session_2', messages, false, false);

        expect(b).not.toBe(a);
    });

    // -------------------------------------------------------------------------
    // Blocking 2: error content, summary body, tool name, part end time
    // -------------------------------------------------------------------------

    test('BLOCKING 2: cache misses when error message changes (same name, different message)', () => {
        const before: ChatMessageEntry[] = [
            {
                info: { id: 'msg_1', role: 'assistant', error: { name: 'RetryError', message: 'first error' } } as unknown as Message,
                parts: [{ id: 'prt_1', type: 'text', text: 'ans' } as Part],
            },
        ];
        const after: ChatMessageEntry[] = [
            {
                info: { id: 'msg_1', role: 'assistant', error: { name: 'RetryError', message: 'second error' } } as unknown as Message,
                parts: before[0]!.parts,
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKING 2: cache misses when error data.message changes', () => {
        const before: ChatMessageEntry[] = [
            {
                info: {
                    id: 'msg_1', role: 'assistant',
                    error: { name: 'SessionRetry', message: 'msg', data: { message: 'quota 1' } },
                } as unknown as Message,
                parts: [{ id: 'prt_1', type: 'text', text: 'ans' } as Part],
            },
        ];
        const after: ChatMessageEntry[] = [
            {
                info: {
                    id: 'msg_1', role: 'assistant',
                    error: { name: 'SessionRetry', message: 'msg', data: { message: 'quota 2' } },
                } as unknown as Message,
                parts: before[0]!.parts,
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKING 2: cache misses when error data.message is a string (not object)', () => {
        // applyRetryOverlay can set data.message as string in some shapes.
        const before: ChatMessageEntry[] = [
            {
                info: {
                    id: 'msg_1', role: 'assistant',
                    error: { name: 'E', message: 'm', data: 'first' },
                } as unknown as Message,
                parts: [],
            },
        ];
        const after: ChatMessageEntry[] = [
            {
                info: {
                    id: 'msg_1', role: 'assistant',
                    error: { name: 'E', message: 'm', data: 'second' },
                } as unknown as Message,
                parts: [],
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKING 2: cache misses when user summary.body changes', () => {
        const before: ChatMessageEntry[] = [
            {
                info: { id: 'msg_1', role: 'user', summary: { body: 'first summary', diffs: [] } } as unknown as Message,
                parts: [],
            },
            createEntry('msg_2', 'assistant', 'ans'),
        ];
        const after: ChatMessageEntry[] = [
            {
                info: { id: 'msg_1', role: 'user', summary: { body: 'second summary', diffs: [] } } as unknown as Message,
                parts: [],
            },
            before[1],
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKING 2: cache misses when tool part tool name changes (string tool)', () => {
        const before: ChatMessageEntry[] = [
            {
                info: { id: 'msg_1', role: 'assistant' } as Message,
                parts: [{ id: 'tool_1', type: 'tool', tool: 'bash' } as unknown as Part],
            },
        ];
        const after: ChatMessageEntry[] = [
            {
                info: before[0]!.info,
                parts: [{ id: 'tool_1', type: 'tool', tool: 'read' } as unknown as Part],
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKING 2: cache misses when tool part tool id/name changes (object tool)', () => {
        const before: ChatMessageEntry[] = [
            {
                info: { id: 'msg_1', role: 'assistant' } as Message,
                parts: [{ id: 'tool_1', type: 'tool', tool: { id: 'tool_exec_1', name: 'bash' } } as unknown as Part],
            },
        ];
        const after: ChatMessageEntry[] = [
            {
                info: before[0]!.info,
                parts: [{ id: 'tool_1', type: 'tool', tool: { id: 'tool_exec_2', name: 'bash' } } as unknown as Part],
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKING 2: cache misses when part state.time.end changes (activity endedAt)', () => {
        const before: ChatMessageEntry[] = [
            {
                info: { id: 'msg_1', role: 'assistant' } as Message,
                parts: [{
                    id: 'tool_1', type: 'tool', tool: 'bash',
                    state: { time: { end: 1000 } },
                } as unknown as Part],
            },
        ];
        const after: ChatMessageEntry[] = [
            {
                info: before[0]!.info,
                parts: [{
                    id: 'tool_1', type: 'tool', tool: 'bash',
                    state: { time: { end: 2000 } },
                } as unknown as Part],
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKING 2: cache misses when part time.end changes (no state wrapper)', () => {
        const before: ChatMessageEntry[] = [
            {
                info: { id: 'msg_1', role: 'assistant' } as Message,
                parts: [{
                    id: 'tool_1', type: 'tool', tool: 'bash',
                    time: { end: 1000 },
                } as unknown as Part],
            },
        ];
        const after: ChatMessageEntry[] = [
            {
                info: before[0]!.info,
                parts: [{
                    id: 'tool_1', type: 'tool', tool: 'bash',
                    time: { end: 3000 },
                } as unknown as Part],
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).not.toBe(beforeKey);
    });

    test('BLOCKING 2: cache still hits when only part TEXT content changes (streaming text growth preserved)', () => {
        // This preserves Fix 7's performance goal: streaming text growth
        // (same id, same type, same count, same tool, same end time — only
        // text content differs) does NOT invalidate the cache.
        const before: ChatMessageEntry[] = [
            {
                info: { id: 'msg_1', role: 'assistant' } as Message,
                parts: [{ id: 'prt_1', type: 'text', text: 'partial' } as Part],
            },
        ];
        const after: ChatMessageEntry[] = [
            {
                info: before[0]!.info,
                parts: [{ id: 'prt_1', type: 'text', text: 'full answer grown' } as Part],
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).toBe(beforeKey);
    });

    test('BLOCKING 2: cache still hits when only tool output text changes (not name/id/end)', () => {
        // part.tool.state.output is the streaming hot-path field for tool
        // parts — it grows as the tool executes. Signing it would force an
        // O(N) rebuild on every frame. Only structural fields (tool name,
        // end time) are signed.
        const before: ChatMessageEntry[] = [
            {
                info: { id: 'msg_1', role: 'assistant' } as Message,
                parts: [{
                    id: 'tool_1', type: 'tool', tool: 'bash',
                    state: { time: { end: 1000 }, status: 'completed', output: 'partial output' },
                } as unknown as Part],
            },
        ];
        const after: ChatMessageEntry[] = [
            {
                info: before[0]!.info,
                parts: [{
                    id: 'tool_1', type: 'tool', tool: 'bash',
                    state: { time: { end: 1000 }, status: 'completed', output: 'full output grown' },
                } as unknown as Part],
            },
        ];

        const beforeKey = buildProjectionCacheKey('session_1', before, false, false);
        const afterKey = buildProjectionCacheKey('session_1', after, false, false);

        expect(afterKey).toBe(beforeKey);
    });
});
