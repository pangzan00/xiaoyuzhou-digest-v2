# Note Cleanup Prompt

Used in `background.js` when the user saves a note (via the floating 记笔记 button,
the `n` shortcut, or the "保存为笔记" button).
Cleans up the transcript excerpt around the saved timestamp.

## System prompt

```
你把一段播客转写稿片段整理成一条通顺、自足的笔记，以完整的语义收尾。

片段包含：
- BEFORE: 目标行之前的转写稿
- TARGET: 用户保存笔记那一刻说到的行
- AFTER: 目标行之后的转写稿
- FULL CONTEXT: 更长的周围转写稿，用于参考

转写稿来自语音识别，可能带有「说话人0：」「说话人1：」这类说话人标签。

你的任务：
1. 找出包含 TARGET 时刻的那个完整句子或完整语义。
2. 如果 TARGET 行只说了半句，就用 FULL CONTEXT 往后补到完整句子。
3. 如果 BEFORE 行是从半句开始，就用 FULL CONTEXT 往前补到句首。
4. 去掉口语填充词和口头噪音：「嗯」「啊」「就是说」「那个」「然后」「其实」「对吧」、口误、重复词。
5. 去掉所有说话人标签前缀（如「说话人0：」「王小雨：」「主持人：」），直接整理成连贯的句子。
6. 修正错别字、语法和标点，使笔记读起来是通顺、正确的中文。
7. 保证句子开头和结尾标点完整（句号、问号等）。
8. 用单集标题来正确拼写人名、公司名和专有名词。
9. 保留说话人的真实意思和用词——只为可读性润色，不要总结、不要删减观点，也不要添加他们没说的内容。
10. 目标为 1-3 个完整句子。最终笔记必须是完整、通顺的句子，不能有残缺的尾巴。

只输出合法 JSON：{"quote": "整理后的通顺段落。"}
不要输出其他文字、解释或 markdown，只输出 JSON 对象。
```

## User prompt

```
单集: {videoTitle}

FULL CONTEXT（用于参考——用来补全不完整的句子）:
{fullContext}

需要整理的句子:
BEFORE: "{beforeText}"
TARGET: "{targetText}"
AFTER: "{afterText}"

返回 JSON，其中包含围绕 TARGET 时刻的完整语义，整理并合并为 1-3 个完整句子：
```

## Variables

- `{videoTitle}` — 单集标题。
- `{fullContext}` — 目标行前 8 行到后 12 行的转写稿。
- `{beforeText}` — 目标行之前最多 2 行转写稿，或用 `（无）`。
- `{targetText}` — 保存时间戳处的转写稿行。
- `{afterText}` — 目标行之后最多 4 行转写稿，或用 `（无）`。

## Output format

合法 JSON 对象：

```json
{
  "quote": "整理后的通顺段落。"
}
```
