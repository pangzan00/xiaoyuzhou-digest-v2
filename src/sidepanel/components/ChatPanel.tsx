/**
 * Chat Panel Component (Episode Q&A)
 */

import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { EpisodeChatMode, SuggestedQuestion } from '../../types';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  hasTranscript: boolean;
  unavailableReason: string | null;
  suggestedQuestions: SuggestedQuestion[];
  suggestionsLoading: boolean;
  suggestionsError: string | null;
  onRegenerateSuggestions: () => void;
  onSend: (question: string) => void;
  chatMode: EpisodeChatMode;
  onChatModeChange: (mode: EpisodeChatMode) => void;
  onClear: () => void;
  onSeek: (seconds: number) => void;
}

const TIMESTAMP_PATTERN = /(?:\[|【|\(|（)(?:(\d+):)?(\d+):(\d{2})\s*(?:[-–—~～至到]+\s*(?:(\d+):)?(\d+):(\d{2}))?(?:\]|】|\)|）)/g;
const TIMESTAMP_VALUE_PATTERN = /^(?:\[|【|\(|（)(?:(\d+):)?(\d+):(\d{2})\s*(?:[-–—~～至到]+\s*(?:(\d+):)?(\d+):(\d{2}))?(?:\]|】|\)|）)$/;

function timestampToSeconds(value: string): number | null {
  const match = value.trim().match(TIMESTAMP_VALUE_PATTERN);
  if (!match) return null;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isSafeInteger(hours) || !Number.isSafeInteger(minutes) || !Number.isSafeInteger(seconds)) return null;
  if (seconds > 59 || (match[1] && minutes > 59)) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

function renderAssistantMessage(content: string, onSeek: (seconds: number) => void): React.ReactNode[] {
  const message = String(content || '');
  const timestampPattern = new RegExp(TIMESTAMP_PATTERN.source, 'g');
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = timestampPattern.exec(message))) {
    const timestamp = match[0];
    const seconds = timestampToSeconds(timestamp);
    if (seconds === null) continue;

    if (match.index > cursor) nodes.push(message.slice(cursor, match.index));
    nodes.push(
      <button
        key={`${timestamp}-${match.index}`}
        className="episode-chat-timestamp"
        type="button"
        title={`跳转并播放 ${timestamp}`}
        aria-label={`跳转并播放 ${timestamp} 处的内容`}
        onClick={() => onSeek(seconds)}
      >
        {timestamp}
      </button>
    );
    cursor = match.index + timestamp.length;
  }

  if (cursor < message.length || nodes.length === 0) nodes.push(message.slice(cursor));
  return nodes;
}

/** 递归处理 Markdown 渲染结果中的文本节点，让时间戳保持可点击跳转 */
function withTimestamps(children: React.ReactNode, onSeek: (seconds: number) => void): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') return renderAssistantMessage(child, onSeek);
    if (React.isValidElement(child) && child.props.children != null) {
      return React.cloneElement(
        child as React.ReactElement<{ children?: React.ReactNode }>,
        undefined,
        withTimestamps(child.props.children, onSeek)
      );
    }
    return child;
  });
}

function buildMarkdownComponents(onSeek: (seconds: number) => void): Components {
  const textTag = (tag: keyof React.JSX.IntrinsicElements) => {
    const TextTag = tag;
    return function TextNode({ node: _node, children, ...props }: any) {
      return <TextTag {...props}>{withTimestamps(children, onSeek)}</TextTag>;
    };
  };

  return {
    p: textTag('p'),
    h1: textTag('h1'),
    h2: textTag('h2'),
    h3: textTag('h3'),
    h4: textTag('h4'),
    h5: textTag('h5'),
    h6: textTag('h6'),
    li: textTag('li'),
    td: textTag('td'),
    th: textTag('th'),
    strong: textTag('strong'),
    em: textTag('em'),
    del: textTag('del'),
    blockquote: textTag('blockquote'),
    table: function TableNode({ node: _node, children, ...props }: any) {
      return (
        <div className="episode-chat-table-scroll">
          <table {...props}>{children}</table>
        </div>
      );
    },
    a: function LinkNode({ node: _node, children, ...props }: any) {
      return (
        <a {...props} target="_blank" rel="noreferrer noopener">
          {withTimestamps(children, onSeek)}
        </a>
      );
    },
  };
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  loading,
  hasTranscript,
  unavailableReason,
  suggestedQuestions,
  suggestionsLoading,
  suggestionsError,
  onRegenerateSuggestions,
  onSend,
  chatMode,
  onChatModeChange,
  onClear,
  onSeek,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [composerExpanded, setComposerExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isUnavailable = !hasTranscript;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const submitQuestion = (question: string) => {
    if (!question.trim() || loading || isUnavailable) return;
    onSend(question.trim());
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    submitQuestion(inputValue);
    setInputValue('');
    setComposerExpanded(false);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const previousHeight = textarea.style.height;

    // 按内容测量自然高度；超过默认两行时才切换至固定的大输入框。
    textarea.style.height = 'auto';
    const exceedsCollapsedHeight = textarea.scrollHeight > 52;
    textarea.style.height = previousHeight;

    setInputValue(textarea.value);
    setComposerExpanded(exceedsCollapsedHeight);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
  };

  return (
    <div className="tab-panel active" data-panel="chat">
      <section className="episode-chat" aria-label="本期节目问答">
        <header className="episode-chat-header">
          <div className="episode-chat-brand">
            <div>
              <p className="episode-chat-eyebrow">本期文字稿</p>
              <h2 className="episode-chat-title">问答</h2>
            </div>
          </div>
          <button
            className="episode-chat-clear"
            onClick={onClear}
            disabled={messages.length === 0}
            type="button"
            title="清空当前对话"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 7h12M9 7V5.8c0-.44.36-.8.8-.8h4.4c.44 0 .8.36.8.8V7m-7.4 3v7m4.8-7v7M8 7l.7 12.1c.03.5.45.9.95.9h4.7c.5 0 .92-.4.95-.9L16 7" />
            </svg>
          </button>
        </header>

        <div className="episode-chat-messages" role="log" aria-live="polite" aria-relevant="additions text">
          {isUnavailable ? (
            <div className="episode-chat-empty">
              <p>{unavailableReason || '当前单集还没有可用于问答的带时间戳文字稿，请重新识别后再试。'}</p>
            </div>
          ) : messages.length === 0 && !loading ? (
            <div className="episode-chat-empty">
              <p>可以向这期节目的文字稿提问</p>
            </div>
          ) : null}

          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`episode-chat-message episode-chat-message--${message.role}`}>
              <div className="episode-chat-role">{message.role === 'user' ? '你' : 'Digest'}</div>
              <div className="episode-chat-bubble">
                {message.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={buildMarkdownComponents(onSeek)}>
                    {message.content}
                  </ReactMarkdown>
                ) : (
                  message.content
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="episode-chat-message episode-chat-message--assistant episode-chat-message--streaming">
              <div className="episode-chat-role">Digest</div>
              <div className="episode-chat-bubble chat-typing"><span></span><span></span><span></span></div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {!isUnavailable && messages.length === 0 && !loading && (
          <div className="episode-chat-suggestions" aria-label="你可能想问">
            <div className="episode-chat-suggestions-head">
              <p className="episode-chat-suggestions-label">你可能想问</p>
              <button
                className={`episode-chat-suggestions-refresh${suggestionsLoading ? ' is-loading' : ''}`}
                type="button"
                onClick={onRegenerateSuggestions}
                disabled={suggestionsLoading}
                title="让 AI 重新生成一批问题"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.3h-2.3" /></svg>
                {suggestionsLoading ? '生成中…' : '换一批'}
              </button>
            </div>
            {suggestionsLoading ? (
              [72, 88, 60].map((width, index) => (
                <div key={index} className="episode-chat-suggestion is-skeleton" aria-hidden="true">
                  <span>
                    <i style={{ width: `${width}%` }} />
                    <i className="is-short" style={{ width: '36%' }} />
                  </span>
                </div>
              ))
            ) : suggestionsError && suggestedQuestions.length === 0 ? (
              <p className="episode-chat-suggestions-error">
                {suggestionsError}
                <button type="button" onClick={onRegenerateSuggestions}>重试</button>
              </p>
            ) : (
              suggestedQuestions.map((suggestion) => (
                <button
                  key={suggestion.question}
                  className="episode-chat-suggestion"
                  type="button"
                  onClick={() => submitQuestion(suggestion.question)}
                  title={suggestion.question}
                >
                  <span><strong>{suggestion.question}</strong>{suggestion.reason && <small>{suggestion.reason}</small>}</span>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5" /></svg>
                </button>
              ))
            )}
          </div>
        )}

        <form className={`episode-chat-composer${composerExpanded ? ' is-expanded' : ''}`} onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="episodeChatInput">向本期节目提问</label>
          <textarea
            ref={inputRef}
            id="episodeChatInput"
            rows={2}
            maxLength={1000}
            placeholder={isUnavailable ? '完成带时间戳转录后即可提问' : '问问这期节目…'}
            enterKeyHint="send"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={loading || isUnavailable}
          />
          <div className="episode-chat-composer-footer">
            <span className={`episode-chat-context${isUnavailable ? ' is-error' : ''}`}>
              <i aria-hidden="true"></i>{isUnavailable ? '尚未关联可用文字稿' : '已关联本期文字稿'}
            </span>
            <div className="episode-chat-submit-area">
              <div className="episode-chat-mode" role="group" aria-label="回答模式">
                <button
                  className={chatMode === 'strict' ? 'is-active' : ''}
                  type="button"
                  onClick={() => onChatModeChange('strict')}
                  disabled={loading}
                  title="严谨版：仅依据本集转录稿回答"
                  aria-pressed={chatMode === 'strict'}
                >
                  严谨
                </button>
                <button
                  className={chatMode === 'open' ? 'is-active' : ''}
                  type="button"
                  onClick={() => onChatModeChange('open')}
                  disabled={loading}
                  title="开放版：以本集转录稿为主，并可补充通用知识"
                  aria-pressed={chatMode === 'open'}
                >
                  开放
                </button>
              </div>
              <span className="episode-chat-shortcut"><kbd>Enter</kbd> 发送</span>
              <button
                className="episode-chat-send"
                type="submit"
                aria-label="发送问题"
                title="发送问题"
                disabled={!inputValue.trim() || loading || isUnavailable}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5m0 0L6 9m4-4 4 4" /></svg>
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
};

export default ChatPanel;
