// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type React from 'react';
import type { ActivityProvider } from '@niteowl/types';

interface ProviderLogoProps {
  provider: ActivityProvider;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function ProviderLogo({ provider, size = 28, className = '', style }: ProviderLogoProps) {
  const svgProps = {
    width: size,
    height: size,
    fill: 'currentColor',
    className,
    style,
  };

  switch (provider) {
    case 'github':
      return (
        <svg {...svgProps} viewBox="0 0 24 24" aria-label="GitHub">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
        </svg>
      );
    case 'linear':
      return (
        <svg {...svgProps} viewBox="0 0 24 24" aria-label="Linear">
          <path d="M0 12C0 5.373 5.373 0 12 0s12 5.373 12 12-5.373 12-12 12S0 18.627 0 12zm4.565 5.574l9.859-9.86a8.027 8.027 0 0 0-9.859 9.86zM5.43 18.85l10.42-10.42a8.029 8.029 0 0 1 .798 1.02L6.45 19.648a8.025 8.025 0 0 1-1.02-.798zm1.974 1.26L17.11 10.405a8.007 8.007 0 0 1 .42 1.277L8.68 20.53a8.007 8.007 0 0 1-1.277-.42zm2.531.876l8.007-8.007a8.06 8.06 0 0 1 .116 1.497 8.028 8.028 0 0 1-7.626 8.022 8.093 8.093 0 0 1-.497-.025v-.003z" />
        </svg>
      );
    case 'jira':
      return (
        <svg {...svgProps} viewBox="0 0 24 24" aria-label="Jira">
          <path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.757a5.215 5.215 0 0 0 5.214 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.762a1.005 1.005 0 0 0-1.021-1.005zM23.013 0H11.484a5.214 5.214 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24.019 12.49V1.005A1.005 1.005 0 0 0 23.013 0z" />
        </svg>
      );
    default:
      return null;
  }
}
