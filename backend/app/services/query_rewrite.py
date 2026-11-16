"""查询改写：把用户口语化的提问整理成「适合检索」的形式。

## 为什么需要

用户提问是口语，检索库是书面课程名。两者之间的鸿沟有三个来源：

1. **口语冗余**：「那个啥，就是垃圾回收怎么弄来着」里真正有检索价值的只有
   「垃圾回收」。剩下的词会稀释向量，也会让词法通道匹配到无关文档。
2. **术语中英混用**：用户说「GC」，库里写的是「垃圾回收」；说「DOM」，
   标题是「文档对象模型」。单靠向量能勉强连上，但词法通道完全失效。
3. **意图词混入**：「帮我找一下」「我想学」这类词对内容检索毫无帮助。

实测（2026-11，hybrid_search top3）：

    「前端那个做网页交互的东西」
      原始   → 5_深度搜索_主智能体 / AG大模型全栈实践班 / 03-什么是DOM
      改写后 → 14、事件模型2 / 15、事件模型3 / 05-DOMContentLoaded

    「那个啥，就是垃圾回收怎么弄来着」
      原始   → 05-了解垃圾回收机制 / 25-JS基础-JavaScript垃圾回收01 / 10、V8引擎垃圾回收1
      改写后 → 同样命中垃圾回收（这条本身够好，改写主要是去掉噪声）

所以改写的价值不在「把好查询变更好」，而在**救回口语化查询**。

## 为什么不做 LLM 改写

检索在主链路上（聊天每问一句都要走）。调一次 LLM 要 1-2 秒，用户能感知到
「打字后半天没反应」。而规则层是纯字符串处理，<1ms。

LLM 改写（含 HyDE、Multi-Query）的方案见 `docs/retrieval-query-rewrite.md`，
需要配缓存和异步才有意义，不在本次范围。

## 设计原则

- **只删不改写**：不猜用户想搜什么，只去掉明确无信息的部分。
- **术语扩展只加不换**：保留原词，追加同义/英文，让向量和词法都能命中。
- **可关闭**：`RETRIEVAL_QUERY_REWRITE=0` 回到原始 query。
"""

from __future__ import annotations

import os
import re

ENABLED = os.getenv("RETRIEVAL_QUERY_REWRITE", "1").strip().lower() not in {
    "0",
    "false",
    "off",
    "no",
    "",
}

# ─── 1. 口语前缀 / 意图词 ───
#
# 用户原话：「查询改写第一步就是用正则把句子里口气、没用的地方截取掉，
# 然后截取关键词来做意图判断。」
#
# 所以这一层只做一件事：**剥掉不含信息的部分**。判断意图、做检索，
# 都用剥完之后的关键词，而不是原始口语。
#
# 关键实现细节：必须**迭代**剥离。一次性正则会漏掉链式口语：
#   「那个啥，就是垃圾回收怎么弄来着」
#    第一轮删「那个」→「啥，就是垃圾回收怎么弄来着」
#    此时「就是」不在开头，开头模式匹配不到
#    第二轮删「啥，」  →「就是垃圾回收怎么弄来着」
#    第三轮删「就是」  →「垃圾回收怎么弄来着」
#    第四轮删「怎么弄来着」→「垃圾回收」
# 所以循环到不再变化为止（最多 8 轮，防死循环）。
_LEADING_FILLERS = [
    r"^(?:那个|这个|呃|嗯|啊)",
    r"^(?:啥|什么)[，,、\s]*",
    r"^(?:就是|也就是说|就是说|其实是)",
    r"^(?:我想|我要|我想问|想问一下|想请教|请教一下|问一下|问下)",
    r"^(?:帮我|帮忙|麻烦)",
    r"^(?:找|查|搜|看看|看下|找找)[一下]*",
    r"^(?:一下|下)",
    r"^(?:有没有|有吗|能不能|可不可以)",
    r"^(?:好的?|那么|然后|所以)",
    r"^是(?=[^的吗呢])",   # 「我想问一下什么是闭包」剥到「是闭包」时再剥一层
]

# 句中指示代词：「前端那个做网页交互」→「前端做网页交互」。
# 它修饰名词时不含信息。只删「那个/这个」且后面紧跟非标点时生效，
# 避免把「这个函数的返回值」里的「这个」也删掉 —— 那种场景下它是主语。
_MID_DEMONSTRATIVE_RE = re.compile(r"(?:那个|这个)(?=[\u4e00-\u9fa5A-Za-z])")

# 疑问/请求尾：删词，句子主体留下
_TAIL_FILLERS = [
    r"(?:怎么弄|怎么办|怎么搞|怎么用|咋整|咋办|怎么弄来着)(?:来着|呢|啊)?$",
    r"(?:是什么|是啥|什么意思|啥意思|是什么鬼)(?:呢|啊)?$",
    r"(?:的东西|的东西啊|那种东西|之类的|什么的|啥的)$",
    r"(?:是啥|是啥来着|是什么来着|来着)$",
    r"[吧呢啊呀嘛哈喽]+$",
    r"[？?！!。.，,\s]+$",
]

# 语气词：任何位置都删（不影响语义）
_PARTICLE_RE = re.compile(r"[吧呢啊呀嘛哈喽]")

# 纯疑问词：剥完如果只剩这些，说明这句没有内容
_STOPWORD_ONLY = re.compile(
    r"^(?:这|那|什么|啥|怎么|怎样|如何|为什么|为啥|哪|哪个|哪些|多少|吗|呢|的|了|是|有|和|与|及)+$"
)


def _strip_fillers(text: str) -> str:
    """迭代剥掉口语前缀/后缀。剥到不再变化为止。"""
    out = (text or "").strip()
    for _ in range(8):
        before = out
        for pattern in _LEADING_FILLERS:
            out = re.sub(pattern, "", out, count=1).strip()
        for pattern in _TAIL_FILLERS:
            out = re.sub(pattern, "", out, count=1, flags=re.IGNORECASE).strip()
        out = _MID_DEMONSTRATIVE_RE.sub("", out)
        out = _PARTICLE_RE.sub("", out)
        out = re.sub(r"^[，,、；;\s]+", "", out)
        out = re.sub(r"[，,、；;\s]+$", "", out)
        out = re.sub(r"\s{2,}", " ", out)
        if out == before:
            break
    return out.strip(" ，,、。.！!？?；;")


# ─── 2. 术语中英对照 ───
# 只在 query 里出现中文时追加英文（反之亦然）。表不必大，
# 覆盖库里真实高频的技术词就够 —— 表越大越容易误伤。
_TERM_MAP: dict[str, str] = {
    "垃圾回收": "GC garbage collection",
    "依赖注入": "dependency injection DI",
    "面向对象": "OOP object oriented",
    "函数式": "functional programming",
    "响应式": "reactive responsive",
    "中间件": "middleware",
    "索引": "index indexing",
    "事务": "transaction",
    "锁": "lock mutex",
    "缓存": "cache caching",
    "队列": "queue",
    "消息队列": "message queue MQ",
    "负载均衡": "load balancing",
    "微服务": "microservice",
    "容器": "container docker",
    "部署": "deploy deployment",
    "虚拟环境": "virtualenv venv",
    "异常处理": "exception error handling",
    "单元测试": "unit test",
    "接口": "API interface",
    "序列化": "serialize serialization",
    "并发": "concurrency concurrent",
    "线程": "thread",
    "进程": "process",
    "内存泄漏": "memory leak",
    "原型链": "prototype chain",
    "闭包": "closure",
    "作用域": "scope",
    "事件循环": "event loop",
    "虚拟DOM": "virtual DOM",
    "组件": "component",
    "状态管理": "state management",
    "路由": "router routing",
    "打包": "bundle webpack",
    "跨域": "CORS cross origin",
    "鉴权": "authentication authorization",
    "加密": "encryption",
    "正则": "regex regular expression",
    "递归": "recursion",
    "排序": "sort sorting",
    "链表": "linked list",
    "二叉树": "binary tree",
    "动态规划": "dynamic programming DP",
}


def _expand_terms(text: str) -> str:
    """命中的中文术语追加英文/同义词。原词保留，只追加。"""
    additions: list[str] = []
    for zh, en in _TERM_MAP.items():
        if zh in text and en.split()[0].lower() not in text.lower():
            additions.append(en)
    if not additions:
        return text
    return f"{text} {' '.join(additions)}"


def extract_keywords(query: str) -> str:
    """剥掉口语后剩下的「关键词串」——用来判断意图，不用来检索。

    用户原话：「截取关键词来做意图判断」。原因很直接：

        「那个啥，就是垃圾回收怎么弄来着」→ detectIntent 看到「怎么」，
        会判成知识问答；剥完之后是「垃圾回收」，没有疑问词，
        该走的是「找内容」而不是「问概念」。

    所以意图判断应该吃这一版，而不是原始口语。
    """
    if not ENABLED:
        return (query or "").strip()
    cleaned = _strip_fillers(query)
    if not cleaned or len(cleaned) < 2:
        return (query or "").strip()
    if _STOPWORD_ONLY.match(cleaned):
        # 全是疑问词，说明这句没内容（比如「那个是啥来着」）
        return ""
    return cleaned


def rewrite_query(query: str) -> str:
    """把口语 query 整理成检索友好的形式。

    返回的字符串用于**向量与词法两路**。如果改写后比原文还短（说明原文
    全是填充词），退回原文 —— 宁可少改写，也不要变成空查询。
    """
    if not ENABLED:
        return query
    raw = (query or "").strip()
    if len(raw) <= 2:
        # 「GC」「DOM」这种极短查询：只做术语扩展，不做删词
        return _expand_terms(raw)

    cleaned = extract_keywords(raw)
    if not cleaned:
        return raw

    return _expand_terms(cleaned)
