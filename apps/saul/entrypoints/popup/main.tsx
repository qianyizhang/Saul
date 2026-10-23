import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './style.css';

// Give Chrome an intrinsic popup width. Viewport-relative limits shrink-wrap it.
// A popup document opened as a tab still follows the normal responsive layout.
if (chrome.extension.getViews({ type: 'popup' }).includes(window)) {
  document.documentElement.classList.add('toolbar-popup');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
