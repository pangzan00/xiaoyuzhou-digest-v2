/**
 * Options Page React Application
 *
 * Settings page for the Xiaoyuzhou Digest extension
 */

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { normalize } from '../shared/domain';
import { DEFAULT_SETTINGS } from '../types';
import { Settings, AsrModel, DiarizationMode } from '../types';
import '../styles/options.css';

// ============================================================
// TYPES
// ============================================================

interface OptionsProps {}

// ============================================================
// STORAGE ADAPTER
// ============================================================

function createStorageAdapter(chromeApi: typeof chrome) {
  const chromeStorage = chromeApi?.storage?.local;
  const memoryStorage = new Map<string, unknown>();

  return {
    async get(keys: string | string[] | null) {
      if (chromeStorage) return chromeStorage.get(keys);
      if (keys === null) {
        return Object.fromEntries(memoryStorage.entries());
      }
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        list
          .map((key) => [key, memoryStorage.get(key)])
          .filter(([, value]) => value !== undefined)
      );
    },

    async set(items: Record<string, unknown>) {
      if (chromeStorage) return chromeStorage.set(items);
      for (const [key, value] of Object.entries(items)) {
        memoryStorage.set(key, value);
      }
    },

    async remove(keys: string | string[]) {
      if (chromeStorage) return chromeStorage.remove(keys);
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        memoryStorage.delete(key);
      }
    },

    async clear() {
      if (chromeStorage) return chromeStorage.clear();
      memoryStorage.clear();
    },
  };
}

const storage = createStorageAdapter(typeof chrome !== 'undefined' ? chrome : ({} as typeof chrome));

// ============================================================
// MAIN COMPONENT
// ============================================================

export const OptionsApp: React.FC<OptionsProps> = () => {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [loadedSettings, setLoadedSettings] = useState<Settings | null>(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [dataStatus, setDataStatus] = useState('');
  const [customizationPrompt, setCustomizationPrompt] = useState(`请把当前本地小宇宙 Digest 工作区改为使用 [PROVIDER] 提供的 [MODEL]。只在当前工作区中操作。编辑前，先确认其中包含 manifest.json，且 manifest 中的 name 是小宇宙 Digest。如果验证失败，请停止，并让我在编程 Agent 中打开小宇宙 Digest 解压后的项目文件夹。不要搜索其他文件夹，不要编辑猜测的副本，不要假设安装路径，也不要声称 Chrome 可以显示操作系统中的绝对源码路径。更新该服务的 API endpoint、请求格式和最少的 Chrome host permissions。保留用户自带密钥模式和 Chrome 本地存储。不要把 API 密钥写入源代码、提交记录、日志、截图、这段提示词或聊天；代码准备好后，请告诉我应该在哪里自行填写密钥。DeepSeek 专用的请求参数和重试逻辑继续只用于 DeepSeek。新服务的专属规则请单独处理，避免相互影响。更新 README.md、PRIVACY.md、SECURITY.md 和测试。运行 npm test、npm run check 和 npm run package。最后，说明如何重新加载已解压的扩展，并在真实小宇宙单集上测试。`);
  const [copyStatus, setCopyStatus] = useState('');

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const stored = await storage.get('xyz_settings');
      const normalized = normalize(stored['xyz_settings']);
      setSettings(normalized);
      setLoadedSettings(normalized);
    } catch (_error) {
      setSaveStatus('无法加载已保存的设置，但你仍可预览此页面。');
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveStatus('正在保存…');

    try {
      // Merge with existing keys to avoid overwriting with empty password fields
      const stored = await storage.get('xyz_settings');
      const persisted = normalize(stored['xyz_settings']);

      const existing = {
        ...loadedSettings,
        ...persisted,
        dashscopeApiKey: persisted.dashscopeApiKey || loadedSettings?.dashscopeApiKey || '',
        aiApiKey: persisted.aiApiKey || loadedSettings?.aiApiKey || '',
      };

      const newSettings = normalize({
        ...existing,
        dashscopeApiKey: settings.dashscopeApiKey || existing.dashscopeApiKey,
        asrModel: settings.asrModel,
        diarizationMode: settings.diarizationMode,
        speakerCount: settings.speakerCount,
        aiApiKey: settings.aiApiKey || existing.aiApiKey,
      });

      if (!newSettings.dashscopeApiKey) {
        setSaveStatus('请添加 DashScope API 密钥。');
        return;
      }

      if (!newSettings.aiApiKey) {
        setSaveStatus('请添加 DeepSeek API 密钥。');
        return;
      }

      await storage.set({ xyz_settings: newSettings });
      setLoadedSettings(newSettings);
      setSettings(newSettings);
      setSaveStatus('已保存。已保留现有 API 密钥，请重新打开小宇宙 Digest v2.0 以使用这些设置。');
    } catch (_error) {
      setSaveStatus('无法保存设置，请重试。');
    }
  }

  async function handleCopyCustomizationPrompt() {
    setCopyStatus('正在复制…');
    try {
      await navigator.clipboard.writeText(customizationPrompt);
      setCopyStatus('已复制编辑后的提示词。');
    } catch (_error) {
      setCopyStatus('无法复制提示词。请选中文本后手动复制。');
    }
  }

  async function handleClearCache() {
    try {
      const all = await storage.get(null);
      const keys = Object.keys(all).filter((key) => key.startsWith('digest_'));
      if (keys.length) await storage.remove(keys);
      setDataStatus(`已清除 ${keys.length} 条缓存摘要。`);
    } catch (_e) {
      setDataStatus('清除失败');
    }
  }

  async function handleClearNotes() {
    try {
      await storage.remove('xyz_notes');
      setDataStatus('已删除全部已保存的笔记。');
    } catch (_e) {
      setDataStatus('删除失败');
    }
  }

  async function handleResetAll() {
    const confirmed = confirm(
      '要从当前 Chrome 个人资料中删除 API 密钥、缓存摘要和已保存的笔记吗？'
    );
    if (!confirmed) return;

    try {
      await storage.clear();
      await loadSettings();
      setDataStatus('已删除全部小宇宙 Digest v2.0 数据。');
    } catch (_e) {
      setDataStatus('重置失败');
    }
  }

  return (
    <main className="settings-shell">
      <header>
        <div className="settings-heading-row">
          <div className="eyebrow">小宇宙 Digest v2.0</div>
        </div>
        <h1>使用你自己的 API 密钥</h1>
        <p className="lede">
          密钥仅保存在当前 Chrome 个人资料中，只会发送给阿里云 DashScope 和 DeepSeek。本开源扩展没有开发者服务器，也不使用分析服务。
        </p>
      </header>

      <form id="settingsForm" onSubmit={handleSave}>
        {/* Speech-to-Text Service */}
        <section className="card">
          <h2>语音转写服务</h2>
          <div className="provider-summary" aria-label="语音转写服务">
            <span className="provider-name">阿里云百炼 语音转写</span>
            <span className="provider-badge">小宇宙没有原生字幕，由 DashScope 转写</span>
          </div>

          <label htmlFor="dashscopeApiKey">DashScope API 密钥</label>
          <input
            id="dashscopeApiKey"
            name="dashscopeApiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="粘贴你的 DashScope 密钥"
            value={settings.dashscopeApiKey}
            onChange={(e) => setSettings({ ...settings, dashscopeApiKey: e.target.value })}
          />
          <p className="help">
            小宇宙 Digest v2.0 使用 DashScope 离线批量接口，把播客音频转成带时间戳的文字稿（下方可选择模型）。
            <a href="https://bailian.console.aliyun.com/?apiKey=1" target="_blank" rel="noreferrer">
              创建 DashScope API 密钥
            </a>
            。
          </p>

          <label htmlFor="asrModel">语音转写模型</label>
          <select
            id="asrModel"
            name="asrModel"
            value={settings.asrModel}
            onChange={(e) => setSettings({ ...settings, asrModel: e.target.value as AsrModel })}
          >
            <option value="paraformer-v2">paraformer-v2（推荐）—— 更便宜，每月 10 小时免费额度</option>
            <option value="fun-asr">fun-asr —— 旧版默认，准确率略好但更贵</option>
          </select>

          <label htmlFor="diarizationMode">说话人分离</label>
          <select
            id="diarizationMode"
            name="diarizationMode"
            value={settings.diarizationMode}
            onChange={(e) => setSettings({ ...settings, diarizationMode: e.target.value as DiarizationMode })}
          >
            <option value="auto">自动判断（推荐）—— 让 AI 从标题和简介判断是否对谈及人数</option>
            <option value="on">总是开启</option>
            <option value="off">关闭</option>
          </select>

          <label htmlFor="speakerCount">说话人数量参考值（2–100）</label>
          <input
            id="speakerCount"
            name="speakerCount"
            type="number"
            min={2}
            max={100}
            step={1}
            value={settings.speakerCount}
            onChange={(e) => setSettings({ ...settings, speakerCount: Number(e.target.value) })}
          />

          <div className="privacy-note">
            使用转写功能时，音频公网地址会发送给阿里云 DashScope 进行语音识别。请查看 DashScope 的服务条款和价格。
          </div>
        </section>

        {/* AI Service */}
        <section className="card">
          <h2>AI 服务</h2>
          <div className="provider-summary" aria-label="支持的 AI 服务">
            <span className="provider-name">DeepSeek V4 Flash</span>
            <span className="provider-badge">当前版本支持</span>
          </div>

          <label htmlFor="aiApiKey">DeepSeek API 密钥</label>
          <input
            id="aiApiKey"
            name="aiApiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="粘贴你的 DeepSeek 密钥"
            value={settings.aiApiKey}
            onChange={(e) => setSettings({ ...settings, aiApiKey: e.target.value })}
          />
          <p className="help">
            小宇宙 Digest v2.0 使用 DeepSeek V4 Flash 生成概览、讲解内容和润色笔记。
            <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">
              创建 DeepSeek API 密钥
            </a>
            。
          </p>
          <div className="privacy-note">
            使用 AI 功能时，DeepSeek 会收到转写稿及相关单集上下文。保存前请查看 DeepSeek 的服务条款和价格。
          </div>
        </section>

        {/* Save button */}
        <div className="form-actions">
          <button className="primary" type="submit">
            保存设置
          </button>
          <span id="saveStatus" role="status" aria-live="polite">
            {saveStatus}
          </span>
        </div>
      </form>

      <details className="card customization-card">
        <summary className="customization-summary">
          <span className="customization-summary-copy">
            <span className="eyebrow">本地改造</span>
            <span className="customization-title">想使用其他 AI 模型？</span>
            <span className="customization-purpose">编辑并复制一段可安全交给编程 Agent 的提示词</span>
          </span>
          <span className="agent-badge">可交给编程 Agent</span>
        </summary>
        <div className="customization-content">
          <p className="help customization-intro">你可以直接编辑提示词。复制前请把 [PROVIDER] 和 [MODEL] 替换成目标服务与模型，并且不要填写 API 密钥。</p>
          <label htmlFor="customizationPrompt">可编辑的自定义提示词</label>
          <div id="customizationPromptReminder" className="prompt-reminder" role="note">
            复制前，请先把 [PROVIDER] 和 [MODEL] 替换成你想使用的服务和模型。
          </div>
          <textarea
            id="customizationPrompt"
            rows={12}
            aria-describedby="customizationPromptReminder"
            value={customizationPrompt}
            onChange={(event) => setCustomizationPrompt(event.target.value)}
          />
          <div className="copy-actions">
            <button onClick={handleCopyCustomizationPrompt} type="button">复制编辑后的提示词</button>
            <span id="copyStatus" role="status" aria-live="polite">{copyStatus}</span>
          </div>
        </div>
      </details>

      {/* Data management */}
      <section className="card data-card">
        <h2>本地数据</h2>
        <p className="help">
          摘要、文字稿和笔记仅保存在当前 Chrome 个人资料中。你可以随时删除。
        </p>
        <div className="data-actions">
          <button onClick={handleClearCache} type="button">
            清除缓存的摘要
          </button>
          <button onClick={handleClearNotes} type="button">
            删除全部笔记
          </button>
          <button onClick={handleResetAll} className="danger" type="button">
            重置扩展数据
          </button>
        </div>
        <span id="dataStatus" role="status" aria-live="polite">
          {dataStatus}
        </span>
      </section>

      <footer>
        完整数据流说明请参阅仓库中的{' '}
        <a href="PRIVACY.md" target="_blank">
          PRIVACY.md
        </a>
        。
      </footer>
    </main>
  );
};

// Mount the app
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(
      <React.StrictMode>
        <OptionsApp />
      </React.StrictMode>
    );
  }
});

export default OptionsApp;
