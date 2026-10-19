import React, { useState, useSyncExternalStore } from 'react';
import { currentTheme, setTheme, subscribeTheme, type Theme } from '../theme';
export default function ThemeSettings() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme);
  const [error, setError] = useState('');
  return <section className="panel theme-settings" aria-label="主题设置">
    <h2>主题</h2>
    <div className="theme-options" role="radiogroup" aria-label="界面主题">
      {([['original', '原主题'], ['white', '白色主题']] as const).map(([value, label]) =>
        <label key={value}><input type="radio" name="ui-theme" value={value} checked={theme === value}
          onChange={() => setError(setTheme(value as Theme) ? '' : '主题已应用，偏好未能保存。')} />{label}</label>)}
    </div>
    {error && <p role="status">{error}</p>}
  </section>;
}
