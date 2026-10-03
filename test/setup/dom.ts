/**
 * Setup for the `dom` Vitest project.
 *
 * `@testing-library/jest-dom` adds the DOM-aware matchers (`toBeInTheDocument`,
 * `toHaveTextContent`, …) that make component assertions readable. It is imported
 * for its side effects, so it registers itself on `expect`.
 *
 * Also installs the matchers' cleanup: Testing Library unmounts rendered trees
 * after each test on its own, which matters here because several hooks register
 * global listeners and timers — a leaked `setTimeout` would fire into a component
 * that no longer exists.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});