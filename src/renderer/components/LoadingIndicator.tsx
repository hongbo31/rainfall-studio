import React from 'react';

export default function LoadingIndicator({ label }: { label: string }) {
  return <span className="loading-indicator"><span className="loading-spinner" aria-hidden="true" />{label}</span>;
}
