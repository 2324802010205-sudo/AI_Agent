import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.scrollTo = vi.fn();
