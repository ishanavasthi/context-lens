import { defineManifest } from '@crxjs/vite-plugin';
import { version } from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'ContextLens',
  version,
  permissions: ['tabs', 'storage', 'activeTab', 'scripting', 'alarms', 'idle', 'webNavigation'],
  host_permissions: ['<all_urls>'],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/content-script.ts'],
      run_at: 'document_idle',
    },
  ],
  action: {
    default_popup: 'src/popup/index.html',
  },
  options_page: 'src/options/index.html',
  web_accessible_resources: [
    {
      resources: ['src/transparency/index.html'],
      matches: ['<all_urls>'],
    },
    {
      resources: ['src/timeline/index.html'],
      matches: ['<all_urls>'],
    },
  ],
});
