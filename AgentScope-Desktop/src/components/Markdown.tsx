import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ImageOff } from 'lucide-react';

/** Untrusted assistant/Skill text must not trigger background network requests. */
export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: ({ alt }) => (
          <span className="inline-image-blocked" title="Ảnh ngoài không được tải tự động">
            <ImageOff size={13} /> Ảnh ngoài đã ẩn{alt ? ` · ${alt}` : ''}
          </span>
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
