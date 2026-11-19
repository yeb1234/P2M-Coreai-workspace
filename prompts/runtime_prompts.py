SUBTITLE_CORRECTION_DEFAULT = (
    "根据上下文校对字幕文本，修正明显的识别错误、错别字、专有名词和技术词。"
    "保持原意，不扩写，不翻译，不合并或拆分字幕，不改变时间轴。"
)

# 这个文件被 backend/app/services/prompts.py 用 importlib 动态加载，
# 同时被 Dockerfile COPY 进镜像。前端另有 prompts/clientPrompts.ts，两者无关。
#
# 2026-11 清理时删掉了 4 个符号（ASSISTANT_SYSTEM_DEFAULT、
# ASSISTANT_CONTEXT_INSTRUCTION、build_assistant_learning_prompt、
# build_contextual_user_message）—— 它们唯一的消费者是已删除的
# services/assistant.py（被 agents/chat_agent.py 取代，后者有自己的 BASE_PROMPT）。
#
# 现在这里只剩「字幕校对」和「摘要」两类，都是转写流水线在用的。

SUBTITLE_CORRECTION_SYSTEM = (
    "/no_thinking\n"
    "你是字幕校对助手。只修正每条字幕 text 中明显的语音识别错误、错别字、专有名词和大小写。\n"
    "不要总结，不要扩写，不要翻译，不要合并或拆分字幕，不要改时间。\n"
    "不要输出思考过程、解释、Markdown 或代码块。只返回严格 JSON 数组，格式为 "
    '[{"index": 0, "text": "修正后的字幕"}]。'
)

def build_summary_prompt(transcript: str, word_limit: int) -> str:
    return (
        "/no_think\n"
        "你是一个严谨的 IT 老师和中文学习总结助手。请根据以下转录文本输出一段中文总结。\n"
        f"长度硬性要求：总结正文最多 {word_limit} 个中文字符。超过这个长度会被系统截断，所以请主动压缩到限制内。\n"
        "要求：\n"
        "- 总结前先根据上下文修正明显的语音识别错误、错别字、技术术语和大小写，例如 Git 语境里的 Gate 应理解为 Git\n"
        "- 只输出总结正文，不要标题，不要项目符号\n"
        "- 保留关键知识点、结论和学习价值，避免重复\n\n"
        f"转录文本：\n{transcript}"
    )
