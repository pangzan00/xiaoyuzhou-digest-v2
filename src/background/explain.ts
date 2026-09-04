/**
 * Explain Selection (AI-powered text explanation)
 */

import { getSettings, loadPromptSection, requestAiCompletion } from './index';

export async function handleExplainSelection(
  selectedText: string,
  transcriptContext: string,
  videoTitle: string
): Promise<{ success: boolean; explanation?: string; error?: string; message?: string }> {
  try {
    const settings = await getSettings();

    if (!settings.aiApiKey) {
      return {
        success: false,
        error: 'NO_AI_KEY',
        message: '尚未配置 DeepSeek API key。',
      };
    }

    const variables: Record<string, string> = {
      videoTitle: videoTitle || '未知标题',
      selectedText,
      transcriptContext: transcriptContext || '无',
    };

    const systemPrompt = await loadPromptSection('explain.md', 'System prompt', variables);
    const userPrompt = await loadPromptSection('explain.md', 'User prompt', variables);

    const { text: explanation } = await requestAiCompletion({
      maxTokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    return {
      success: true,
      explanation: explanation.trim(),
    };
  } catch (error) {
    console.error('Explain selection error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '讲解失败',
    };
  }
}
