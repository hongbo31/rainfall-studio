import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Context } from '../../src/renderer/context';
import TmeObservationReport from '../../src/renderer/components/TmeObservationReport';
export function renderObservationReport(observations: any[] = []) {
  const value: any = {
    data: { mode: 'production', works: [{ id: 'work-1', title: 'Fixture A', assets: { audio_A: 'audio-a' } }], assets: [{ id: 'audio-a', sha256: 'a'.repeat(64) }], tmeObservations: observations },
    selected: ['work-1'], call: () => { throw Error('SSR_MUST_NOT_CALL_CORE'); }, notify: () => {},
  };
  return renderToStaticMarkup(<Context.Provider value={value}><TmeObservationReport accountId="account-1" /></Context.Provider>);
}
