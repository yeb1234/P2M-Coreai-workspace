"""查询改写：口语剥离、术语扩展、指代消解。

两轮用户反馈：
  「查询改写第一步就是用正则把句子里口气没用的地方截取掉，
    然后截取关键词来做意图判断」
  「那如果我想学 Java 呢」—— 上下文依赖
"""

from app.services.lexical import extract_tokens
from app.services.query_rewrite import (
    extract_keywords,
    needs_context,
    resolve_anaphora,
    rewrite_query,
)


def test_strip_oral_fillers():
    # 链式口语要迭代剥离，一次性正则会漏
    assert extract_keywords("那个啥，就是垃圾回收怎么弄来着") == "垃圾回收"
    assert extract_keywords("我想问一下什么是闭包") == "闭包"
    assert extract_keywords("前端那个做网页交互的东西") == "前端做网页交互"


def test_term_expansion_keeps_original():
    # 只追加，不替换 —— 向量和词法都要能命中
    out = rewrite_query("垃圾回收")
    assert "垃圾回收" in out
    assert "garbage collection" in out.lower()


def test_two_char_latin_tokens_do_not_enter_content_lexical():
    """正文词法不能吃 DI 这种两字符 token。

    依赖注入的改写会追加 DI；正文层 ILIKE '%di%' 会命中 6,000+ 个块，
    把一次 29ms 的词法检索拖到约 700ms。元数据通道仍保留两字符能力。
    """
    query = "依赖注入 dependency injection DI"
    content_tokens = extract_tokens(query)
    assert "di" not in content_tokens
    assert "dependency" in content_tokens
    assert "injection" in content_tokens

    meta_tokens = extract_tokens(query, min_latin_len=2)
    assert "di" in meta_tokens


def test_needs_context_is_conservative():
    """判定必须保守。实测负优化：上一条 60 字会把当前 8 字淹没。"""
    # 有明确实体 → 不补上文
    assert needs_context("那如果我想学Java呢") is False
    assert needs_context("有没有讲依赖注入的视频") is False
    # 真指代 → 补
    assert needs_context("它是什么原理") is True
    assert needs_context("那闭包呢") is True
    assert needs_context("那它呢") is True


def test_resolve_anaphora_prefers_current():
    # 当前问题在前，上文在后
    out = resolve_anaphora("那闭包呢", "函数返回另一个函数")
    assert out.startswith("闭包")
    assert "函数" in out
    # 不需要上文时原样返回
    assert resolve_anaphora("那如果我想学Java呢", "Python 异常处理") == "那如果我想学Java呢"
    # 没有上文也不能崩
    assert resolve_anaphora("那它呢", None) == "那它呢"
