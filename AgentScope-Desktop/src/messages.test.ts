import { expect, it } from 'vitest';
import { mergeMessages } from './messages';
import type { Message } from './types';
it('isolates conversations and preserves newer final snapshots across HTTP/WS replay', () => {
  const final: Message = {
    id: 'm1',
    conversation_id: 'a',
    role: 'assistant',
    content: 'final',
    created_at: '1',
    streaming: false,
    revision: 3,
  };
  const stale = { ...final, content: 'old', streaming: true, revision: 1 };
  const other = { ...final, id: 'm2', conversation_id: 'b', content: 'private other conversation' };
  expect(mergeMessages([final], [stale, other], 'a')).toEqual([final]);
});
