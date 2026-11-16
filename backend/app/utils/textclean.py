"""文本清洗：去掉字幕里混进来的推广内容。

## 为什么要在展示层做

视频字幕是外部来源（下载的课程、录屏），讲师会在讲解中间插广告：
「关注微信公众号 xxx」「加 V 领取资料」「www.itjc8.com」。

这些东西有两个害处：
  1. 检索片段展示给用户时，一段 200 字里有 80 字是广告，可读性很差
  2. 做 embedding 时，广告词会稀释语义（一块 565 字里有 3 处广告，
     向量就被拉偏了）

**只清洗展示层，不改原始数据**：字幕原文留着，万一哪天要重新分块、
或者要审计来源，原文还在。改数据是不可逆的，清洗是可逆的。

## 规则的取舍

宁可漏，不可错。这些正则只打「高置信度的广告特征」：
  - 明确的域名（itjc8.com 这类资源站）
  - 「微信/公众号/VX + 号码/ID」
  - 「加我/私聊/领取 + 联系方式」

不碰的：
  - 单独出现的数字（可能是时间、章节号）
  - 「关注」这个词本身（「关注这个变量的值」是正常技术表述）
"""

from __future__ import annotations

import re

# 常见资源站 / 引流域名。命中就把整个 URL 去掉。
_PROMO_DOMAINS = (
    r"itjc8\.com",
    r"itjc8\.cn",
    r"itxiaoniu\.com",
    r"jrj\.com\.cn",
    r"edu\.csdn\.net",
)

# 域名本身就要匹配「itjc8.com」这种，而不是「xxx.itjc8.com」，
# 所以前缀是 (?:www\.)? 而不是 [\w-]+\.
_URL_RE = re.compile(
    r"(?:https?://)\S+"
    r"|(?:www\.)?(?:" + "|".join(_PROMO_DOMAINS) + r")\S*",
    re.IGNORECASE,
)

# 字幕里的广告多是口语，识别出来是这样的：
#   「请大家关注微信更正号产品人气地私钥学员呢也可以叫微信9919179785」
# ID 部分是中文乱码，靠 [A-Za-z0-9] 匹配不到。所以改成
# 「引导动词 + 平台词 + 后面到句末的一段」，整段删掉。
# 这是有意的激进：字幕里的广告基本都在句尾，删到句号为止不会伤到正文。
_WECHAT_RE = re.compile(
    r"(?:请?大家?\s*)?(?:关注|添加|加|联系|私信)\s*(?:我的?)?\s*"
    r"(?:微信|公众号|wechat|vx|v信|威信)\s*(?:号|公号)?\s*[:：]?[^。！？!?\n]*",
    re.IGNORECASE,
)

# 「加我 QQ 123456」「领取资料加 V」「私聊我」
_CONTACT_RE = re.compile(
    r"(?:加|扫)\s*(?:我|一下)?\s*(?:qq|QQ|v|V)\s*[:：]?\s*[A-Za-z0-9_\-]{5,}"
    r"|(?:领取|获取|下载)\s*(?:资料|课件|源码|完整版).{0,12}(?:加|私聊|联系)",
)

# 手机号（11 位大陆号码）。只在这种形态下才删，避免误伤时间戳。
_PHONE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")

# UP 主套话：「请不吝点赞 订阅 转发 打赏支持明镜与点点栏目」
#
# 要求连续出现 2 个以上动作词才匹配 —— 单个「收藏」「订阅」是正常技术表述
# （「订阅这个事件」「收藏这个配置」），不能删。
_BOILERPLATE_RE = re.compile(
    r"(?:请?不吝\s*)?(?:(?:点赞|订阅|转发|打赏|投币|三连)[\s，,、]*){2,}"
    r"[^。！？!?，,\n]{0,12}",
    re.IGNORECASE,
)

# 清理后可能留下的残渣：连续空白、句首的标点
_RESIDUE_RE = re.compile(r"[，,、;；]\s*(?=[，,、;；。])|^\s*[，,、;；。]\s*")
_SPACES_RE = re.compile(r"[ \t]{2,}")


def looks_like_promo(text: str) -> bool:
    """整段是不是几乎全是广告 —— 用来决定要不要整块跳过。"""
    if not text:
        return False
    cleaned = clean_promo_text(text)
    # 去掉空白后剩不到原文 30%，基本就是广告了
    return len(cleaned.strip()) < max(1, len(text.strip())) * 0.5


def clean_promo_text(text: str) -> str:
    """去掉推广内容，保留讲解正文。

    只做删除，不做改写 —— 保持句子原样，避免把技术表述改错。
    """
    if not text:
        return text

    out = _URL_RE.sub("", text)
    out = _WECHAT_RE.sub("", out)
    out = _CONTACT_RE.sub("", out)
    out = _PHONE_RE.sub("", out)
    out = _BOILERPLATE_RE.sub("", out)
    out = _RESIDUE_RE.sub("", out)
    out = _SPACES_RE.sub(" ", out)
    return out.strip()


# ─── 视频标题清洗 ───

# 标题里的来源站标记：「xxx [itjc8.com]」「xxx【itjc8.com】」
_TITLE_SOURCE_RE = re.compile(
    r"[\[【(（]\s*(?:www\.)?(?:"
    + "|".join(_PROMO_DOMAINS)
    + r")\s*[\]】)）]",
    re.IGNORECASE,
)

# 重复导入产生的后缀：「xxx (1)」「xxx(2)」
_TITLE_DUP_SUFFIX_RE = re.compile(r"\s*[(（]\d{1,2}[)）]\s*$")


def clean_video_title(stem: str) -> str:
    """清理文件名当标题用。

    素材是从资源站下的，文件名里常带来源标记和重复后缀：

        01、01-【基础认知】AI产品经理岗位及就业规划 [itjc8.com]
        2-7 Agent落地案例：Agent如何融入企业业务中 [itjc8.com](1)

    这些标记做两件事都不好：
      - 展示时占宽度，用户扫标题要多跳过一截
      - 检索时 title 参与词法匹配，域名会被当成有效词

    只处理「高置信度」的模式，不确定的一律保留 —— 标题是用户认视频的唯一依据，
    宁可不干净也不能改错。
    """
    if not stem:
        return stem

    out = _TITLE_SOURCE_RE.sub("", stem)
    out = _TITLE_DUP_SUFFIX_RE.sub("", out)
    out = _SPACES_RE.sub(" ", out).strip()
    # 全部删光了说明原文件名只有广告标记，退回原文
    return out or stem
