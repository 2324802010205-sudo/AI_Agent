import { useEffect, useState } from 'react';
import { api } from '../api';

export default function SkillSource({ skillId }: { skillId: string }) {
  const [content, setContent] = useState<string>();
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    api.skillSource(skillId, signal).then(
      (result) => {
        if (!controller.signal.aborted) setContent(result.content);
      },
      (failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      },
    );
    return () => controller.abort();
  }, [skillId]);

  if (error) return <p role="alert">{error}</p>;
  if (content === undefined) return <p role="status">Đang đọc SKILL.md…</p>;
  return (
    <pre className="skill-source" aria-label="SKILL.md" tabIndex={0}>
      {content}
    </pre>
  );
}
