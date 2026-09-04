var XYZ_EPISODE_CHAT_CONTROLLER = (() => {
  const MAX_MESSAGES = 12;
  const TIMESTAMP_VALUE_PATTERN = /^(?:\[|【|\(|（)(?:(\d+):)?(\d+):(\d{2})(?:\]|】|\)|）)$/;
  const TIMESTAMP_TOKEN_PATTERN = /(?:\[|【|\(|（)(?:(?:\d+):)?\d+:\d{2}(?:\]|】|\)|）)/;

  function create({ getState, seekTo }) {
    const chat = { episodeId: null, messages: [], isLoading: false, streamPort: null };

    function hasTranscript() {
      return /\[\d+:\d{2}\]/.test(String(getState().currentTranscriptTimestamped || ""));
    }

    function reset() {
      chat.streamPort?.disconnect();
      chat.streamPort = null;
      chat.episodeId = getState().currentVideoId || null;
      chat.messages = [];
      chat.isLoading = false;
      setStatus("");
      render();
    }

    function clear() {
      if (chat.isLoading || !chat.messages.length) return;
      chat.messages = [];
      setStatus("");
      render();
    }

    function setStatus(message, isError = false) {
      const status = document.getElementById("episodeChatStatus");
      if (!status) return;
      status.textContent = message || "";
      status.classList.toggle("is-error", Boolean(isError));
    }

    function timestampToSeconds(value) {
      const match = String(value || "").trim().match(TIMESTAMP_VALUE_PATTERN);
      if (!match) return null;
      const hours = Number(match[1] || 0);
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      if (seconds > 59 || (match[1] && minutes > 59)) return null;
      return hours * 3600 + minutes * 60 + seconds;
    }

    function appendTimestamp(container, timestampText) {
      const timestamp = document.createElement("button");
      const seconds = timestampToSeconds(timestampText);
      timestamp.type = "button";
      timestamp.className = "episode-chat-timestamp";
      timestamp.textContent = timestampText;
      timestamp.title = seconds !== null ? `跳转至 ${timestampText}` : "跳转至对应时间点";
      timestamp.addEventListener("click", () => {
        if (seconds !== null) void seekTo(seconds);
      });
      container.append(timestamp);
    }

    function safeLink(value) {
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
      } catch {
        return "";
      }
    }

    function appendInline(container, content) {
      const text = String(content || "");
      const tokenPattern = new RegExp([
        TIMESTAMP_TOKEN_PATTERN.source,
        "`[^`\\n]+`",
        "\\[[^\\]\\n]+\\]\\([^\\s)]+\\)",
        "\\*\\*[^*\\n]+\\*\\*",
        "__[^_\\n]+__",
        "~~[^~\\n]+~~",
        "\\*[^*\\n]+\\*",
        "_[^_\\n]+_",
      ].join("|"), "g");
      let cursor = 0;
      let match;
      while ((match = tokenPattern.exec(text))) {
        const token = match[0];
        container.append(document.createTextNode(text.slice(cursor, match.index)));
        if (timestampToSeconds(token) !== null) {
          appendTimestamp(container, token);
        } else if (token.startsWith("`")) {
          const code = document.createElement("code");
          code.textContent = token.slice(1, -1);
          container.append(code);
        } else if (token.startsWith("[")) {
          const linkMatch = token.match(/^\[([^\]]+)\]\([^\s)]+\)$/);
          const href = linkMatch ? safeLink(token.slice(token.lastIndexOf("(") + 1, -1)) : "";
          if (!linkMatch || !href) {
            container.append(document.createTextNode(token));
          } else {
            const link = document.createElement("a");
            link.href = href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            appendInline(link, linkMatch[1]);
            container.append(link);
          }
        } else {
          const isBold = token.startsWith("**") || token.startsWith("__");
          const isStrike = token.startsWith("~~");
          const element = document.createElement(isBold ? "strong" : isStrike ? "s" : "em");
          const delimiterLength = isBold || isStrike ? 2 : 1;
          appendInline(element, token.slice(delimiterLength, -delimiterLength));
          container.append(element);
        }
        cursor = match.index + token.length;
      }
      container.append(document.createTextNode(text.slice(cursor)));
    }

    function tableCells(line) {
      return String(line || "").trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    }

    function isTableDivider(line) {
      return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
    }

    function isBlockStart(line, nextLine) {
      return !line.trim() || /^\s*```/.test(line) || /^#{1,4}\s+/.test(line)
        || /^\s*>/.test(line) || /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)
        || /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) || isTableDivider(nextLine);
    }

    function appendList(container, lines, startIndex, ordered) {
      const list = document.createElement(ordered ? "ol" : "ul");
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      let index = startIndex;
      while (index < lines.length) {
        const match = lines[index].match(pattern);
        if (!match) break;
        const item = document.createElement("li");
        appendInline(item, match[1]);
        list.append(item);
        index += 1;
      }
      container.append(list);
      return index;
    }

    function appendTable(container, lines, startIndex) {
      const wrapper = document.createElement("div");
      wrapper.className = "episode-chat-table-scroll";
      const table = document.createElement("table");
      const header = tableCells(lines[startIndex]);
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      header.forEach((cell) => {
        const heading = document.createElement("th");
        appendInline(heading, cell);
        headerRow.append(heading);
      });
      thead.append(headerRow);
      table.append(thead);
      const tbody = document.createElement("tbody");
      let index = startIndex + 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const row = document.createElement("tr");
        const cells = tableCells(lines[index]);
        header.forEach((_, cellIndex) => {
          const cell = document.createElement("td");
          appendInline(cell, cells[cellIndex] || "");
          row.append(cell);
        });
        tbody.append(row);
        index += 1;
      }
      table.append(tbody);
      wrapper.append(table);
      container.append(wrapper);
      return index;
    }

    function renderMarkdown(container, content) {
      const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
      let index = 0;
      while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) {
          index += 1;
          continue;
        }
        const fence = line.match(/^\s*```([^`]*)$/);
        if (fence) {
          const code = [];
          index += 1;
          while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
          if (index < lines.length) index += 1;
          const pre = document.createElement("pre");
          const codeElement = document.createElement("code");
          const language = fence[1].trim();
          if (language) codeElement.dataset.language = language;
          codeElement.textContent = code.join("\n");
          pre.append(codeElement);
          container.append(pre);
          continue;
        }
        if (index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1])) {
          index = appendTable(container, lines, index);
          continue;
        }
        const heading = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
        if (heading) {
          const title = document.createElement(`h${Math.min(6, heading[1].length + 2)}`);
          appendInline(title, heading[2]);
          container.append(title);
          index += 1;
          continue;
        }
        if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
          container.append(document.createElement("hr"));
          index += 1;
          continue;
        }
        if (/^\s*>/.test(line)) {
          const quoteLines = [];
          while (index < lines.length && /^\s*>/.test(lines[index])) quoteLines.push(lines[index++].replace(/^\s*>\s?/, ""));
          const quote = document.createElement("blockquote");
          renderMarkdown(quote, quoteLines.join("\n"));
          container.append(quote);
          continue;
        }
        if (/^\s*[-*+]\s+/.test(line)) {
          index = appendList(container, lines, index, false);
          continue;
        }
        if (/^\s*\d+[.)]\s+/.test(line)) {
          index = appendList(container, lines, index, true);
          continue;
        }
        const paragraphLines = [line];
        index += 1;
        while (index < lines.length && !isBlockStart(lines[index], lines[index + 1])) paragraphLines.push(lines[index++]);
        const paragraph = document.createElement("p");
        paragraphLines.forEach((paragraphLine, lineIndex) => {
          if (lineIndex) paragraph.append(document.createElement("br"));
          appendInline(paragraph, paragraphLine);
        });
        container.append(paragraph);
      }
    }

    function render() {
      const messages = document.getElementById("episodeChatMessages");
      const input = document.getElementById("episodeChatInput");
      const send = document.getElementById("sendEpisodeChatBtn");
      const clearButton = document.getElementById("clearEpisodeChatBtn");
      const suggestionContainer = document.getElementById("episodeChatSuggestions");
      const suggestions = document.querySelectorAll(".episode-chat-suggestion");
      if (!messages || !input || !send || !clearButton) return;
      const { currentVideoId } = getState();
      const ready = Boolean(currentVideoId && hasTranscript());
      messages.replaceChildren();
      if (!chat.messages.length) {
        const empty = document.createElement("div");
        empty.className = "episode-chat-empty";
        empty.textContent = ready
          ? "围绕本期节目的观点、案例和建议开始提问吧。回答会尽量标注可以回听的时间点。"
          : "完成本集转录后，即可围绕文字稿继续追问。";
        messages.append(empty);
      } else {
        chat.messages.forEach((message) => {
          const item = document.createElement("div");
          item.className = `episode-chat-message episode-chat-message--${message.role}${message.streaming ? " episode-chat-message--streaming" : ""}`;
          const role = document.createElement("div");
          role.className = "episode-chat-role";
          role.textContent = message.role === "user" ? "你" : "本期问答";
          const bubble = document.createElement("div");
          bubble.className = "episode-chat-bubble";
          if (message.role === "assistant") renderMarkdown(bubble, message.content);
          else bubble.textContent = message.content;
          item.append(role, bubble);
          messages.append(item);
        });
      }
      if (suggestionContainer) suggestionContainer.hidden = chat.messages.length > 0;
      input.disabled = !ready || chat.isLoading;
      send.disabled = !ready || chat.isLoading;
      clearButton.disabled = !chat.messages.length || chat.isLoading;
      suggestions.forEach((button) => { button.disabled = !ready || chat.isLoading; });
    }

    function scrollToLatest(smooth = false) {
      const messages = document.getElementById("episodeChatMessages");
      if (messages) messages.scrollTo({ top: messages.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    }

    function finalizeStream(port, requestEpisodeId, result) {
      if (chat.streamPort === port) chat.streamPort = null;
      if (requestEpisodeId !== getState().currentVideoId || chat.episodeId !== requestEpisodeId) return;
      const assistant = chat.messages.at(-1);
      if (assistant?.role === "assistant") {
        assistant.streaming = false;
        if (!assistant.content.trim()) chat.messages.pop();
      }
      chat.isLoading = false;
      setStatus(result?.transcriptWasTruncated ? "本次文字稿较长，回答仅基于已发送的部分内容。" : "");
      render();
      scrollToLatest(true);
    }

    function failStream(port, requestEpisodeId, errorMessage) {
      if (chat.streamPort === port) chat.streamPort = null;
      if (requestEpisodeId !== getState().currentVideoId || chat.episodeId !== requestEpisodeId) return;
      if (chat.messages.at(-1)?.role === "assistant") chat.messages.pop();
      chat.isLoading = false;
      setStatus(`问答失败：${errorMessage || "请稍后重试。"}`, true);
      render();
    }

    async function sendQuestion(suggestedQuestion = "") {
      if (chat.isLoading) return;
      const input = document.getElementById("episodeChatInput");
      const question = String(suggestedQuestion || input?.value || "").trim();
      if (!question) return;
      const state = getState();
      if (!state.currentVideoId || !hasTranscript()) {
        setStatus("请先完成当前单集的转录，再进行问答。", true);
        render();
        return;
      }
      const requestEpisodeId = state.currentVideoId;
      const conversation = chat.messages.slice(-MAX_MESSAGES);
      chat.episodeId = requestEpisodeId;
      chat.messages.push({ role: "user", content: question }, { role: "assistant", content: "", streaming: true });
      chat.messages = chat.messages.slice(-MAX_MESSAGES);
      chat.isLoading = true;
      if (input) input.value = "";
      setStatus("正在阅读文字稿…");
      render();
      scrollToLatest(true);
      const port = chrome.runtime.connect({ name: XYZ_DOMAIN.PORTS.EPISODE_CHAT_STREAM });
      chat.streamPort = port;
      let completed = false;
      port.onMessage.addListener((message) => {
        if (requestEpisodeId !== getState().currentVideoId || chat.episodeId !== requestEpisodeId) return;
        if (message?.type === "chunk") {
          const assistant = chat.messages.at(-1);
          if (assistant?.role !== "assistant") return;
          assistant.content += String(message.content || "");
          setStatus("正在生成回答…");
          render();
          scrollToLatest();
        } else if (message?.type === "done") {
          completed = true;
          finalizeStream(port, requestEpisodeId, message);
          port.disconnect();
        } else if (message?.type === "error") {
          completed = true;
          failStream(port, requestEpisodeId, message.error);
          port.disconnect();
        }
      });
      port.onDisconnect.addListener(() => {
        if (!completed && chat.streamPort === port) failStream(port, requestEpisodeId, "连接已中断，请重试。");
      });
      port.postMessage({
        action: XYZ_DOMAIN.ACTIONS.ASK_EPISODE_QUESTION,
        question,
        transcriptText: state.currentTranscriptTimestamped,
        videoTitle: state.currentVideoTitle,
        channelName: state.currentChannelName,
        videoDescription: state.currentVideoDescription,
        conversation,
      });
    }

    function bind() {
      document.getElementById("episodeChatForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        void sendQuestion();
      });
      document.getElementById("episodeChatInput")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void sendQuestion();
        }
      });
      document.getElementById("episodeChatSuggestions")?.addEventListener("click", (event) => {
        const button = event.target.closest(".episode-chat-suggestion");
        if (button) void sendQuestion(button.dataset.question || "");
      });
      document.getElementById("clearEpisodeChatBtn")?.addEventListener("click", clear);
    }

    return { bind, render, reset, hasTranscript, sendQuestion, timestampToSeconds, appendTimestamp };
  }

  return { create };
})();
