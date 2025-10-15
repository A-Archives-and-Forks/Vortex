/**
 * Tailwind Development Page
 * Only visible in development mode
 * Shows all Tailwind components and demos for testing
 */

import * as React from 'react';
import MainPage from '../../../views/MainPage';
import { TailwindTest } from '../../../tailwind/components/TailwindTest';
import { TypographyDemo } from '../../../tailwind/next/typography/TypographyDemo';

interface ITailwindPageProps {
  // Props passed from extension context
}

class TailwindPage extends React.Component<ITailwindPageProps> {
  public render(): JSX.Element {
    return (
      <MainPage id='page-tailwind-dev'>
        <MainPage.Body>
          <div style={{
            padding: '20px',
            overflowY: 'auto',
            height: '100%'
          }}>
            <div style={{ marginBottom: '40px' }}>
              <h3 style={{ marginBottom: '20px', fontSize: '24px', fontWeight: 'bold' }}>
                🧪 Tailwind v4 Component Testing
              </h3>
              <p style={{ marginBottom: '20px', color: '#666' }}>
                This page is only visible in development mode and provides a testing ground
                for Tailwind components adapted from the web team's "next" project.
              </p>
            </div>

            {/* Typography Demo from web team */}
            <TypographyDemo />
          </div>
        </MainPage.Body>
      </MainPage>
    );
  }
}

export default TailwindPage;
