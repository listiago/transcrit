import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import './overlay.css';
import { App } from './App';
import { Overlay } from './Overlay';

createRoot(document.getElementById('root')!).render(location.hash === '#overlay' ? <Overlay /> : <App />);
