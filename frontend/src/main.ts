import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { isDevMode } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';
import { AppComponent } from './app/app.component';

const Sunrich = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185',
      500: '#c82336', 600: '#a30022', 700: '#9c0b22', 800: '#881337', 900: '#4c0519', 950: '#2b0712'
    }
  }
});

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(),
    providePrimeNG({
      theme: { preset: Sunrich, options: { darkModeSelector: '.app-dark' } }
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
}).catch(err => console.error(err));
