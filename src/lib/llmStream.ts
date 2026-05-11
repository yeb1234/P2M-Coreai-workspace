type JsonRecord = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function extractTextPart(part: unknown): string {
  if (typeof part === 'string') return part;
  if (!part || typeof part !== 'object') return '';
  const record = part as JsonRecord;
  return asString(record.text) || asString(record.content);
}

export function extractAssistantText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const data = payload as JsonRecord;

  const direct =
    asString(data.content) ||
    asString(data.response) ||
    asString(data.output_text) ||
    asString(data.text);
  if (direct) return direct;

  const message = data.message;
  if (message && typeof message === 'object') {
    const messageRecord = message as JsonRecord;
    const messageText =
      asString(messageRecord.content) ||
      asString(messageRecord.text) ||
      (Array.isArray(messageRecord.content) ? messageRecord.content.map(extractTextPart).join('') : '');
    if (messageText) return messageText;
  }

  const choices = Array.isArray(data.choices) ? data.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const choiceRecord = choice as JsonRecord;
    const delta = choiceRecord.delta;
    if (delta && typeof delta === 'object') {
      const deltaRecord = delta as JsonRecord;
      const deltaText =
        asString(deltaRecord.content) ||
        asString(deltaRecord.text) ||
        (Array.isArray(deltaRecord.content) ? deltaRecord.content.map(extractTextPart).join('') : '');
      if (deltaText) return deltaText;
    }

    const choiceMessage = choiceRecord.message;
    if (choiceMessage && typeof choiceMessage === 'object') {
      const messageRecord = choiceMessage as JsonRecord;
      const messageText =
        asString(messageRecord.content) ||
        asString(messageRecord.text) ||
        (Array.isArray(messageRecord.content) ? messageRecord.content.map(extractTextPart).join('') : '');
      if (messageText) return messageText;
    }

    const choiceText = asString(choiceRecord.text);
    if (choiceText) return choiceText;
  }

  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const itemRecord = item as JsonRecord;
    const content = Array.isArray(itemRecord.content) ? itemRecord.content : [];
    const text = content.map(extractTextPart).join('');
    if (text) return text;
  }

  return '';
}

export function hasVisibleAssistantText(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as JsonRecord;

  const direct =
    asString(data.content) ||
    asString(data.response) ||
    asString(data.output_text) ||
    asString(data.text);
  if (direct.trim()) return true;

  const message = data.message;
  if (message && typeof message === 'object') {
    const messageText = extractAssistantText({ message });
    if (messageText.trim()) return true;
  }

  const choices = Array.isArray(data.choices) ? data.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const choiceRecord = choice as JsonRecord;
    const delta = choiceRecord.delta;
    if (delta && typeof delta === 'object') {
      const deltaRecord = delta as JsonRecord;
      const deltaText =
        asString(deltaRecord.content) ||
        asString(deltaRecord.text) ||
        (Array.isArray(deltaRecord.content) ? deltaRecord.content.map(extractTextPart).join('') : '');
      if (deltaText.trim()) return true;
    }

    const choiceMessage = choiceRecord.message;
    if (choiceMessage && typeof choiceMessage === 'object') {
      const messageRecord = choiceMessage as JsonRecord;
      const messageText =
        asString(messageRecord.content) ||
        asString(messageRecord.text) ||
        (Array.isArray(messageRecord.content) ? messageRecord.content.map(extractTextPart).join('') : '');
      if (messageText.trim()) return true;
    }

    const choiceText = asString(choiceRecord.text);
    if (choiceText.trim()) return true;
  }

  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const itemRecord = item as JsonRecord;
    const content = Array.isArray(itemRecord.content) ? itemRecord.content : [];
    const text = content.map(extractTextPart).join('');
    if (text.trim()) return true;
  }

  return false;
}

export function normalizeAssistantText(text: string): string {
  return text.replace(/^\s+/, '');
}

export function parseSSELines(buffer: string): { lines: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  return { lines: lines.slice(0, -1), rest: lines.at(-1) ?? '' };
}
