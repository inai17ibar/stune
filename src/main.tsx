import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

// Capture prevents Chromium navigation everywhere without stopping sidebar imports.
for (const event of ['dragover', 'drop']) {
  window.addEventListener(event, (e) => e.preventDefault(), { capture: true });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
