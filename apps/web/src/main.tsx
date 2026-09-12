import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import SpaApp from './SpaApp';
import './globals.css';

ReactDOM.createRoot(document.querySelector('#root')!).render(
  <React.StrictMode>
    <SpaApp />
  </React.StrictMode>,
);
