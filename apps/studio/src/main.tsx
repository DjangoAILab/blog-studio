import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { StudioApp } from './app/studio-app.js';
import './styles/studio.css';

const root = document.querySelector('#root');
if (!root) throw new Error('Application root is missing');
createRoot(root).render(
  <StrictMode>
    <StudioApp />
  </StrictMode>,
);
