"""相关片段只在该出现的意图下生成。

用户反馈：问「总结我学得怎么样」时也甩三条不相关视频片段出来，
既干扰阅读，还白花一次 rerank 调用（200-500ms）。

规则（app/agents/chat_agent.py::_needs_video_references）：
  - 课程推荐 / 知识问答 → 需要视频片段（用户要明确找课/找讲解）
  - 学习总结 / 路径规划 / 代码助手 / 任务拆解 → 不需要
  - intent 为空 → 保守起见仍检索（认不出时可能是「有没有讲 X 的视频」）
"""

from app.agents.chat_agent import _needs_video_references


def test_course_and_qa_need_references():
    assert _needs_video_references("course-recommend") is True
    assert _needs_video_references("knowledge-qa") is True


def test_processing_intents_skip_references():
    # 这四类都是基于已有信息做加工，不该再推视频
    for intent in ("study-summary", "learning-path", "coding-helper", "task-planning"):
        assert _needs_video_references(intent) is False, intent


def test_unknown_intent_falls_back_to_generating():
    # 认不出意图时不冒进屏蔽，保持旧行为
    assert _needs_video_references(None) is True
    assert _needs_video_references("") is True
