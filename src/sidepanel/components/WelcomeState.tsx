/**
 * Welcome State Component
 */

import React from 'react';

interface WelcomeStateProps {
  onStart: () => void;
  startAvailable: boolean;
}

export const WelcomeState: React.FC<WelcomeStateProps> = ({ onStart, startAvailable }) => {
  return (
    <div className="welcome-container">
      <img
        className="welcome-illustration"
        src={new URL('assets/manual-start.png', document.baseURI).toString()}
        alt=""
        aria-hidden="true"
      />
      <div className="welcome-title">准备好学习了吗</div>
      <div className="welcome-desc">
        打开一个小宇宙单集，点击扩展图标即可获取 AI 学习摘要。
      </div>
      {startAvailable && (
        <button className="enhance-btn welcome-start-btn" onClick={onStart} type="button">
          开始获取
        </button>
      )}
    </div>
  );
};

export default WelcomeState;
