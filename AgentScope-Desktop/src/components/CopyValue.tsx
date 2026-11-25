import { useState } from 'react';
import { Copy } from 'lucide-react';

export default function CopyValue({ label, value }: { label: string; value: string }) {
  const [feedback, setFeedback] = useState('');
  return (
    <button
      type="button"
      className="execution-icon"
      aria-label={`Sao chép ${label}`}
      title={feedback || `Sao chép ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setFeedback('Đã sao chép');
        } catch {
          setFeedback('Không thể sao chép');
        }
      }}
    >
      <Copy size={13} />
      <span className="sr-only" role="status">
        {feedback}
      </span>
    </button>
  );
}
