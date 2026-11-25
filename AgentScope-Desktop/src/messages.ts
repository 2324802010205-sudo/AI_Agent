import type { Message } from './types';

// Replayed events and slow HTTP responses must not rewind a stream.
export function mergeMessages(
  current: Message[],
  incoming: Message[],
  conversation: string,
): Message[] {
  const map = new Map(
    current
      .filter((m) => !m.conversation_id || m.conversation_id === conversation)
      .map((m) => [m.id, m]),
  );
  for (const message of incoming) {
    if (message.conversation_id && message.conversation_id !== conversation) continue;
    const previous = map.get(message.id);
    if (!previous || (message.revision ?? 0) >= (previous.revision ?? 0))
      map.set(message.id, message);
  }
  return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
