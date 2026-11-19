"""相关片段只在该出现的时候生成。

两轮用户反馈叠加后的规则：

  第一轮：问「总结我学得怎么样」→ 甩三条不相关视频片段
  第二轮：问「那如果我想学 Python 呢」→ 推四条前端课（答非所问）

所以判定从「按意图白名单」收紧成「意图 + 问题内容双重判断」。
"""

from app.agents.chat_agent import _needs_video_references as need
from app.agents.chat_agent import _tools_for_intent


def test_course_intent_always_needs_references():
    # 用户明确要课程推荐，无论怎么问都给
    assert need("course-recommend", "有没有适合AI产品开发的课程") is True
    assert need("course-recommend", "推荐几个讲 FastAPI 的视频") is True


def test_question_answer_needs_references_for_followup_videos():
    # 正文来自通用知识，但相关片段作为回答后的延伸入口，始终准备
    assert need("question-answer", "Python的装饰器是什么") is True
    assert need("question-answer", "这个函数是什么原理") is True
    assert need("question-answer", "FastAPI 怎么用") is True


def test_question_answer_disables_retrieval_tools():
    # 不能只加前端意图：模型如果还能调 search_videos，回答会继续被视频库带跑
    assert _tools_for_intent("question-answer") == []
    assert _tools_for_intent("course-recommend")


def test_interview_question_only_recommends_video_when_asked():
    # 普通题目讲解只讲题；点「推荐相关视频」或用户明确要视频时才挂卡片
    assert need("interview-question", "这题怎么答") is False
    assert need("interview-question", "展开讲讲评分点") is False
    assert need("interview-question", "推荐相关视频") is True
    assert need("interview-question", "有没有讲这道题的课程") is True


def test_interview_question_has_bank_tools():
    names = {tool.name for tool in _tools_for_intent("interview-question")}
    assert "get_interview_question" in names
    assert "search_interview_questions" in names
    assert "search_interview_knowledge" in names
    assert "search_videos" in names
    assert "get_video_summary" in names


def test_knowledge_qa_only_when_asking_for_video():
    # 纯知识问题：模型直接回答就行，硬塞片段会让人以为答非所问
    assert need("knowledge-qa", "什么是GC算法") is False
    assert need("knowledge-qa", "为什么这里要用依赖注入") is False
    # 明确在找某个视频/课程
    assert need("knowledge-qa", "有没有视频讲过GC算法") is True
    assert need("knowledge-qa", "哪节课讲了依赖注入") is True
    assert need("knowledge-qa", "第几集讲 FastAPI") is True


def test_processing_intents_never_need_references():
    # 这四类都是基于已有信息做加工，一律不推视频
    for intent in ("study-summary", "learning-path", "coding-helper", "task-planning"):
        assert need(intent, "这里提到视频也不行吗") is False, intent


def test_unknown_intent_falls_back_to_content_check():
    # 认不出意图时不再无脑给，而是看问题里有没有「找视频」的信号
    assert need(None, "那如果我想学Python呢") is False
    assert need("", "什么是指针") is False
    assert need(None, "有讲 FastAPI 的视频吗") is True
    assert need("", "哪节课讲 React Hooks") is True
