import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import Markdown from './Markdown';

it('renders tables and code without allowing remote image requests or raw HTML', () => {
  const { container } = render(
    <Markdown>
      {
        '![tracking](https://test.invalid/pixel)\n\n<script>alert(1)</script>\n\n```python\nprint(1)\n```\n\n| Cột | Giá trị |\n| --- | --- |\n| A | 3 |'
      }
    </Markdown>,
  );
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText(/Ảnh ngoài đã ẩn/)).toBeInTheDocument();
  expect(container.querySelector('code')).toHaveTextContent('print(1)');
  expect(container.querySelector('table')).toHaveTextContent('Giá trị');
});
