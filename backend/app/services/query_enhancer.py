"""Query Enhancer: 查询改写服务。

对用户原始查询进行语义扩展，生成多个变体用于多路检索，提升召回率。
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)


# ─── 同义词 / 缩写映射表（可扩展，后续可迁移到数据库）───

SYNONYM_MAP: dict[str, list[str]] = {
    # 编程语言
    "js": ["javascript", "JS"],
    "ts": ["typescript", "TS"],
    "py": ["python", "Python"],
    "rb": ["ruby", "Ruby"],
    "go": ["golang", "Go"],
    "cpp": ["c++", "C++"],
    "csharp": ["c#", "C#", "CSharp"],
    # 框架 / 库
    "vue3": ["vue.js 3", "Vue3", "vue3"],
    "vue2": ["vue.js 2", "Vue2", "vue2"],
    "react": ["React", "react.js"],
    "ng": ["angular", "Angular"],
    "webpack": ["Webpack", "webpack5", "webpack4"],
    "vite": ["Vite", "vite.js"],
    "next": ["next.js", "Next.js", "NextJS"],
    "nuxt": ["nuxt.js", "Nuxt.js", "NuxtJS"],
    # 常见技术概念
    "爬虫": ["crawler", "spider", "scraping", "数据抓取"],
    "闭包": ["closure", "函数闭包"],
    "回调": ["callback", "回调函数"],
    "异步": ["async", "asynchronous", "异步编程"],
    "并发": ["concurrency", "并行"],
    "泛型": ["generic", "generics"],
    "装饰器": ["decorator", "decorators"],
    "中间件": ["middleware"],
    "路由": ["router", "routing"],
    "钩子": ["hook", "hooks"],
    "状态管理": ["state management", "store"],
    "虚拟DOM": ["virtual DOM", "vdom"],
    "依赖注入": ["dependency injection", "DI"],
    "数据库": ["database", "DB"],
    "缓存": ["cache", "caching"],
    "部署": ["deploy", "deployment"],
    "容器": ["container", "docker", "Docker"],
    "token": ["jwt", "JWT", "鉴权", "认证"],
    "父组件": ["父向子", "父传子", "props"],
    "子组件": ["子向父", "子传父", "emit"],
    "微服务": ["microservice", "microservices"],
    "机器学习": ["machine learning", "ML"],
    "深度学习": ["deep learning", "DL"],
    "神经网络": ["neural network"],
    "自然语言处理": ["NLP", "natural language processing"],
    "大语言模型": ["LLM", "large language model"],
    "检索增强": ["RAG", "retrieval augmented generation"],
    "向量数据库": ["vector database", "vector store"],
    "embedding": ["嵌入", "向量化"],
}


# ─── 缩写反向索引（长词 → 短缩写）───

_REVERSE_MAP: dict[str, list[str]] = {}
for _short, _longs in SYNONYM_MAP.items():
    for _long in _longs:
        _key = _long.lower()
        if _key not in _REVERSE_MAP:
            _REVERSE_MAP[_key] = []
        _REVERSE_MAP[_key].append(_short)


_ZH_QUERY_SPLIT = re.compile(
    r"(?:怎么|如何|什么|为何|为什么|哪些|哪个|一下|帮我|请问|请教|"
    r"讲解|介绍|原理|使用方法|使用|实现|配置|步骤|方法|教程|入门|详解)"
)

# 2.94 没有 jieba，用一份技术词表做最长匹配，避免“用容器起数据库和缓存”
# 这种整串中文被当成一个关键词。词表只用于查询切分，不改变 FTS 索引。
_ZH_TERMS = sorted(
    {
        "依赖注入", "闭包", "装饰器", "生成器", "迭代器", "虚拟DOM", "生命周期",
        "组件通信", "父组件", "子组件", "跨级组件", "消息队列", "微服务",
        "数据库", "索引", "缓存", "容器", "接口", "鉴权", "校验", "优化",
        "包管理器", "虚拟环境", "沙箱", "微调", "模型", "训练", "算法",
        "路由", "状态管理", "中间件", "钩子", "函数", "变量", "对象",
        "安装", "配置", "原理", "案例", "讲解", "介绍", "入门", "实战",
        "爬虫", "多线程", "多进程", "协程", "并发", "异步",
        "事务", "锁", "范式", "分库分表", "读写分离", "主从复制",
        "前端", "后端", "代码", "编程", "报错", "异常", "调试",
    }
    | {key for key in SYNONYM_MAP if re.fullmatch(r"[一-鿿]+", key)},
    key=len,
    reverse=True,
)


def _split_zh_token(token: str) -> list[str]:
    """用技术词表做最长匹配；匹配不到的残片丢弃。"""
    if not token:
        return []
    if token in _ZH_TERMS:
        return [token]
    found: list[str] = []
    index = 0
    while index < len(token):
        match = None
        for term in _ZH_TERMS:
            if token.startswith(term, index):
                match = term
                break
        if match:
            found.append(match)
            index += len(match)
        else:
            index += 1
    return found


def _tokenize(query: str) -> list[str]:
    """分词：英文按词，中文按疑问/功能词 + 技术词表切开。

    2.94 原来把一整段中文当成一个 token，导致“依赖注入怎么实现”变成
    一个 FTS/LIKE 关键词，既匹配不到“依赖注入”，也匹配不到“实现”。
    """
    raw_tokens = re.findall(r"[一-鿿]+|[a-zA-Z0-9_]+", query)
    tokens: list[str] = []
    for token in raw_tokens:
        token = token.strip()
        if not token:
            continue
        if re.fullmatch(r"[a-zA-Z0-9_]+", token):
            tokens.append(token)
            continue
        parts = _ZH_QUERY_SPLIT.split(token)
        for part in parts:
            part = part.strip().strip("的了呢吗呀是")
            if not part:
                continue
            matched = _split_zh_token(part)
            if matched:
                tokens.extend(matched)
            elif len(part) >= 2:
                tokens.append(part)
    return tokens


def expand_query(query: str, intent: str = "search") -> list[str]:
    """扩展查询词，返回多个查询变体用于多路检索。

    Args:
        query: 原始查询（已经过意图词剥离）
        intent: 意图类型（search / summary）

    Returns:
        查询变体列表，第一个是原始查询
    """
    if not query or not query.strip():
        return [query]

    variants = [query.strip()]
    tokens = _tokenize(query)

    # 1. 逐 token 查同义词表
    synonym_expansions: list[str] = []
    for token in tokens:
        key = token.lower()
        if key in SYNONYM_MAP:
            for syn in SYNONYM_MAP[key]:
                expanded = query.replace(token, syn, 1)
                if expanded not in variants:
                    synonym_expansions.append(expanded)

    # 2. 逐 token 查反向索引（长词 → 短缩写）
    for token in tokens:
        key = token.lower()
        if key in _REVERSE_MAP:
            for short in _REVERSE_MAP[key]:
                expanded = query.replace(token, short, 1)
                if expanded not in variants and expanded not in synonym_expansions:
                    synonym_expansions.append(expanded)

    # 限制变体数量，避免检索爆炸
    variants.extend(synonym_expansions[:3])

    # 3. intent 驱动的额外变体
    if intent == "summary":
        # 总结模式：去掉修饰词，保留核心主题
        core = re.sub(r'(帮我|请|能不能|可以)\s*', '', query).strip()
        if core and core not in variants:
            variants.append(core)

    logger.debug("Query variants for '%s' (intent=%s): %s", query, intent, variants)
    return variants


def extract_keywords(query: str, intent: str = "search") -> list[str]:
    """提取核心关键词，用于 FTS5 检索。

    与 strip_search_intent 不同，这里进一步提取有意义的关键词，
    过滤停用词和过于通用的词。
    """
    tokens = _tokenize(query)
    if not tokens:
        return [query.strip().lower()]

    # 停用词
    stopwords = {
        "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都",
        "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你",
        "会", "着", "没有", "看", "好", "自己", "这", "他", "她", "它",
        "什么", "怎么", "如何", "为什么", "哪", "哪个", "哪些",
        "the", "a", "an", "is", "are", "was", "were", "be", "been",
        "have", "has", "had", "do", "does", "did", "will", "would",
        "can", "could", "should", "may", "might", "to", "of", "in",
        "for", "on", "with", "at", "by", "from", "as", "into",
    }

    keywords = []
    for token in tokens:
        lower = token.lower()
        if lower in stopwords:
            continue
        if len(lower) < 2:  # 过短的 token 跳过（除非是已知缩写）
            if lower in SYNONYM_MAP:
                keywords.append(lower)
            continue
        keywords.append(lower)

    return keywords if keywords else [query.strip().lower()]
