import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Keep cleanup explicit so every component test starts with an empty DOM.
afterEach(() => {
  cleanup();
});
