import React, { useState, useSyncExternalStore } from 'react';
import { currentTheme, setTheme, subscribeTheme } from '../theme';

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme);
  const [error, setError] = useState('');
  return <div className="theme-toggle" role="group" aria-label="主题切换">
    <span aria-hidden="true">主题</span>
    {([['original', '原主题'], ['white', '白色']] as const).map(([value, label]) =>
      <button key={value} type="button" aria-pressed={theme === value}
        onClick={() => setError(setTheme(value) ? '' : '主题已应用，偏好未能保存。')}>
        {label}
      </button>)}
    {error && <span className="theme-save-error" role="status">{error}</span>}
  </div>;
}
