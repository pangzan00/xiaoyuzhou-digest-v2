const XYZ_OPTIONS = (() => {
  function createStorageAdapter(chromeApi) {
    const chromeStorage = chromeApi?.storage?.local;
    const memoryStorage = new Map();

    return {
      async get(keys) {
        if (chromeStorage) return chromeStorage.get(keys);
        if (keys === null) {
          return Object.fromEntries(memoryStorage.entries());
        }
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          list
            .map((key) => [key, memoryStorage.get(key)])
            .filter(([, value]) => value !== undefined),
        );
      },

      async set(items) {
        if (chromeStorage) return chromeStorage.set(items);
        for (const [key, value] of Object.entries(items)) {
          memoryStorage.set(key, value);
        }
      },

      async remove(keys) {
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

  function initialize(root = globalThis) {
    const doc = root.document;
    const settingsApi = root.XYZ_SETTINGS;
    if (!doc || !settingsApi) return;

    const storage = createStorageAdapter(root.chrome);
    const form = doc.getElementById("settingsForm");
    const dashscopeApiKeyInput = doc.getElementById("dashscopeApiKey");
    const asrModelInput = doc.getElementById("asrModel");
    const diarizationModeInput = doc.getElementById("diarizationMode");
    const speakerCountInput = doc.getElementById("speakerCount");
    const aiApiKeyInput = doc.getElementById("aiApiKey");
    const customizationPrompt = doc.getElementById("customizationPrompt");
    const copyCustomizationPromptBtn = doc.getElementById(
      "copyCustomizationPromptBtn",
    );
    const copyStatus = doc.getElementById("copyStatus");
    const saveStatus = doc.getElementById("saveStatus");
    const dataStatus = doc.getElementById("dataStatus");
    // 保存时使用最后一次成功读取的完整配置，避免页面刚打开、异步读取尚未完成时，
    // 空密码框意外覆盖已经保存的密钥。
    let loadedSettings = null;

    async function loadSettings() {
      try {
        const stored = await storage.get(settingsApi.STORAGE_KEY);
        const settings = settingsApi.normalize(
          stored[settingsApi.STORAGE_KEY],
        );
        loadedSettings = settings;
        dashscopeApiKeyInput.value = settings.dashscopeApiKey;
        asrModelInput.value = settings.asrModel;
        diarizationModeInput.value = settings.diarizationMode;
        speakerCountInput.value = String(settings.speakerCount);
        aiApiKeyInput.value = settings.aiApiKey;
      } catch (_error) {
        setStatus(saveStatus, "无法加载已保存的设置，但你仍可预览此页面。");
      }
    }

    function setStatus(element, text) {
      element.textContent = text || "";
    }

    async function saveSettings(event) {
      event.preventDefault();
      setStatus(saveStatus, "正在保存…");

      try {
        // 密码框可能因页面尚在加载、浏览器密码策略或扩展重载而为空。
        // 保存其他设置时必须合并已持久化的密钥，绝不能把空输入覆盖成空字符串。
        const stored = await storage.get(settingsApi.STORAGE_KEY);
        const persisted = settingsApi.normalize(stored[settingsApi.STORAGE_KEY]);
        // 优先使用当前持久化内容；读取异常或尚未完成时，使用页面打开时的快照。
        // 两种来源任一持有密钥，都绝不能因为空输入框被抹掉。
        const existing = {
          ...loadedSettings,
          ...persisted,
          dashscopeApiKey: persisted.dashscopeApiKey || loadedSettings?.dashscopeApiKey || "",
          aiApiKey: persisted.aiApiKey || loadedSettings?.aiApiKey || "",
        };
        const settings = settingsApi.normalize({
          ...existing,
          dashscopeApiKey: dashscopeApiKeyInput.value.trim() || existing.dashscopeApiKey,
          asrModel: asrModelInput.value,
          diarizationMode: diarizationModeInput.value,
          speakerCount: speakerCountInput.value,
          aiApiKey: aiApiKeyInput.value.trim() || existing.aiApiKey,
        });

        if (!settings.dashscopeApiKey) {
          setStatus(saveStatus, "请添加 DashScope API 密钥。");
          return;
        }
        if (!settings.aiApiKey) {
          setStatus(saveStatus, "请添加 DeepSeek API 密钥。");
          return;
        }

        await storage.set({ [settingsApi.STORAGE_KEY]: settings });
        loadedSettings = settings;
        // 让刚保存的密钥继续显示，避免用户误以为它们没有保存。
        dashscopeApiKeyInput.value = settings.dashscopeApiKey;
        aiApiKeyInput.value = settings.aiApiKey;
        setStatus(saveStatus, "已保存。已保留现有 API 密钥，请重新打开小宇宙 Digest 以使用这些设置。");
      } catch (_error) {
        setStatus(saveStatus, "无法保存设置，请重试。");
      }
    }

    async function copyCustomizationPrompt() {
      setStatus(copyStatus, "正在复制…");
      try {
        await root.navigator.clipboard.writeText(customizationPrompt.value);
        setStatus(copyStatus, "已复制编辑后的提示词。");
      } catch (_error) {
        setStatus(copyStatus, "无法复制提示词。请选中提示词文本并手动复制。");
      }
    }

    async function clearCachedDigests() {
      const all = await storage.get(null);
      const keys = Object.keys(all).filter((key) => key.startsWith("digest_"));
      if (keys.length) await storage.remove(keys);
      setStatus(dataStatus, `已清除 ${keys.length} 条缓存摘要。`);
    }

    async function clearNotes() {
      await storage.remove("xyz_notes");
      setStatus(dataStatus, "已删除全部已保存的笔记。");
    }

    async function resetAllData() {
      const confirmed = root.confirm(
        "要从当前 Chrome 个人资料中删除 API 密钥、缓存摘要和已保存的笔记吗？",
      );
      if (!confirmed) return;

      await storage.clear();
      await loadSettings();
      setStatus(dataStatus, "已删除全部小宇宙 Digest 数据。");
    }

    form.addEventListener("submit", saveSettings);
    copyCustomizationPromptBtn.addEventListener(
      "click",
      copyCustomizationPrompt,
    );
    doc
      .getElementById("clearCacheBtn")
      .addEventListener("click", clearCachedDigests);
    doc.getElementById("clearNotesBtn").addEventListener("click", clearNotes);
    doc.getElementById("resetBtn").addEventListener("click", resetAllData);

    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", loadSettings, { once: true });
    } else {
      void loadSettings();
    }
  }

  return {
    createStorageAdapter,
    initialize,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = XYZ_OPTIONS;
}

if (typeof document !== "undefined") {
  XYZ_OPTIONS.initialize();
}
