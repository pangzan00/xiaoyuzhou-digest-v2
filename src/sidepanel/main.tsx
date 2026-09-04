/**
 * Side Panel React Application Entry Point
 *
 * This is the main UI for the Xiaoyuzhou Digest extension,
 * running in the Chrome Side Panel.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../styles/index.css';

const container = document.getElementById('root');

if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
