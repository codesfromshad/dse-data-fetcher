// Text bundled into the app at build time: the changelog and legal documents.
// The same files ship next to the .exe (tauri.conf.json → bundle.resources)
// and the installer shows the license (scripts/build-legal.ts).
import changelog from '../../CHANGELOG.md?raw';
import disclaimer from '../../legal/DISCLAIMER.txt?raw';
import eula from '../../legal/EULA.txt?raw';
import privacy from '../../legal/PRIVACY.txt?raw';
import thirdParty from '../../legal/THIRD-PARTY-NOTICES.txt?raw';
import { parseChangelog } from './changelog';

export const RELEASES = parseChangelog(changelog);

export type LegalDocId = 'eula' | 'disclaimer' | 'privacy' | 'third-party';

export interface LegalDoc {
  id: LegalDocId;
  title: string;
  description: string;
  text: string;
}

export const LEGAL_DOCS: LegalDoc[] = [
  { id: 'eula', title: 'License agreement', description: 'Terms for using this app', text: eula },
  { id: 'disclaimer', title: 'Disclaimer', description: 'About the data and what it isn’t', text: disclaimer },
  { id: 'privacy', title: 'Privacy notice', description: 'No telemetry; what connects where', text: privacy },
  { id: 'third-party', title: 'Open-source licenses', description: 'Components this app is built with', text: thirdParty },
];
