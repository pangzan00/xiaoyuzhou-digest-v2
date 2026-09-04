/**
 * Error State Component
 */

import React from 'react';

interface ErrorStateProps {
  title: string;
  message: string;
  onRetry: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({ title, message, onRetry }) => {
  return (
    <div className="error-container">
      <img
        className="error-illustration"
        src={new URL('assets/failure-state.webp', document.baseURI).toString()}
        alt=""
        aria-hidden="true"
      />
      <div className="error-title">{title}</div>
      <div className="error-message">{message}</div>
      <button className="error-btn" onClick={onRetry}>
        重试
      </button>
    </div>
  );
};

export default ErrorState;
