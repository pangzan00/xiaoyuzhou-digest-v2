/**
 * Loading State Component
 */

import React from 'react';

interface LoadingStateProps {
  title: string;
  subtitle: string;
  progress: number;
  onStop: () => void;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  title,
  subtitle,
  progress,
  onStop,
}) => {
  return (
    <div className="loading-container">
      <img
        className="loading-animation"
        src={new URL('assets/loading.webp', document.baseURI).toString()}
        alt=""
        aria-hidden="true"
      />
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
      <div className="progress-meta">{title}</div>
      <div className="loading-text">{title}</div>
      <div className="loading-subtext">{subtitle}</div>
      <button className="enhance-btn stop-transcription-btn" onClick={onStop} type="button">
        停止转录
      </button>
    </div>
  );
};

export default LoadingState;
