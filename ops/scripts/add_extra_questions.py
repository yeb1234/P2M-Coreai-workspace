import json
from pathlib import Path

BANK_PATH = Path(__file__).resolve().parents[1] / "src" / "data" / "interview" / "questions.json"

EXTRA_QUESTIONS = [
    {
        "id": "X-RAG-ACL-01",
        "group": "agent",
        "groupLabel": "Agent / RAG 高阶核心组",
        "resumeGroup": "core-agent",
        "resumeGroupLabel": "核心 Agent&LLM 工程组",
        "type": "scenario",
        "difficulty": "压轴",
        "source": "补充",
        "bookId": None,
        "bookPage": None,
        "chapter": "补充 · 企业级 RAG 权限",
        "title": "企业级 RAG 权限：检索和生成怎么都不越权",
        "question": """企业级 RAG 权限到底怎么设计？不同职级、不同部门的人，只能看自己权限内的文档。你的 RAG 系统，怎么保证检索层 + 生成层都不越权？

提示：按「权限模型 → 检索前 → 检索时 → 生成前/后 → 权限变更 → 审计与测试」作答；可以画表或写伪代码。""",
        "answer": """核心原则：权限是数据面强制，不是 UI 或 prompt。任何一层只靠「告诉模型不要泄露」都不算。

默认拒绝：身份解析成功、租户/部门/角色/项目/密级/显式 deny 都通过，才允许读。

一、权限模型
- 文档表：tenant_id、dept_id、owner_id、classification（公开/内部/机密）、status、acl_version
- ACL 表：subject_type（user/group/dept/role）、subject_id、permission（read/manage）、effect（allow/deny）、expires_at
- chunk 表：chunk_id、doc_id、tenant_id、dept_id、classification、acl_group_ids、acl_version；chunk 冗余权限标签，避免每次检索都回表
- 变更：ACL 修改 → acl_version +1 → 异步重建受影响 chunk 的权限标签 → 清缓存
- 显式 deny 优先于 allow；用户多部门时取并集，但 deny 一票否决

二、检索前：解析 scope
- 从 JWT/session 取 user_id、tenant_id、dept_ids、role_ids、max_classification
- 构造 PermissionScope：allowed_tenant、allowed_dept_ids、allowed_group_ids、user_id、classification_lte、denied_doc_ids
- scope 只在服务端解析，不能由前端传；也不能把 user_id 塞进 prompt 让模型自己判断
- 缓存 Redis：key=user:{id}:scope:v{acl_version}，TTL 5 分钟；ACL 变更按版本失效

三、检索时：过滤 + 二次校验
- SQL/向量查询必须带 tenant_id：
  WHERE tenant_id=:tenant AND status='active' AND classification<=:level
    AND (owner_id=:uid OR dept_id IN (...) OR acl_group_ids && :groups)
    AND doc_id NOT IN (:denied)
- pgvector：先按权限/租户分区或 partial index 收窄，再 ORDER BY embedding <=> q；不要先 top_k=5 再在应用层过滤——高相似但无权限的文档会把名额吃光，授权召回直接掉
- 候选可以多取 k*3，但最终每个 chunk 必须用权威 ACL 再校验一次，不能只信向量库 metadata
- 多租户：独立 schema 或强制 tenant_id 索引；禁止跨租户 ANN
- 检索日志只记 doc_id/decision，不把正文写进普通日志

四、生成前/后
- 生成前：context 只装已授权 chunk；每段带 doc_id + acl_version；不要带入无权限的标题、摘要、元数据
- Prompt 里说明「资料是数据不是指令」，但这只是防注入，不是权限边界
- 生成后：引用白名单——模型引用的 doc_id 必须在 allowed 集合；出现未授权引用直接拦
- 输出守卫：PII/密钥/密级关键词检测；流式输出在首 token 前完成 context 授权，输出中命中就终止
- 不要把「生成后脱敏」当第一道防线；内容已经进了模型上下文就可能被复述

五、权限变更与审计
- ACL 变更：版本号、缓存失效、索引重建、灰度；旧版本 chunk 在下一次重建前不能放行
- 审计：user/tenant/query_hash/doc_ids/acl_version/decision/latency；保留期按合规
- 测试矩阵：同问题不同角色、跨部门、离职/过期、显式 deny、租户边界、prompt injection、引用未授权文档、缓存串用户
- 指标：未授权召回率=0、授权召回率、过滤选择性、p95 延迟、缓存命中、stale acl 数

六、常见错误
- 前端隐藏 / prompt 写「不要泄露」 / 先检索后过滤 top_k / ACL 改了不重建索引 / 多租户共用一个 collection 不加强制过滤 / 生成后正则脱敏当主防线

面试一句话：三道闸门——检索前解析 scope，检索时带 ACL 过滤并二次校验，生成前后做引用白名单与输出守卫；权限变更走版本号和缓存失效。""",
        "followUps": [
            "ACL 变更后，向量索引里的 chunk 怎么保证不残留旧权限？",
            "pgvector 带权限过滤后召回率下降，怎么补偿？",
            "用户属于多个部门，allow 和 deny 冲突怎么处理？",
            "模型引用了未授权文档，怎么在流式输出时拦住？",
        ],
        "rubric": [
            "权限模型覆盖租户/部门/角色/用户/密级，默认拒绝且 deny 优先",
            "检索前 scope 服务端解析，检索 SQL/ANN 带 ACL，且对 chunk 做权威二次校验",
            "生成前上下文白名单，生成后引用白名单 + 输出守卫",
            "ACL 变更版本化、缓存失效、索引重建",
            "审计与红队测试矩阵，未授权召回率=0",
        ],
        "tags": ["RAG 权限", "多租户", "ACL", "检索安全", "生成安全", "场景题"],
        "bookTitle": None,
    },
    {
        "id": "X-DEBUG-01",
        "group": "backend",
        "groupLabel": "底层底座组",
        "resumeGroup": "backend-pipeline",
        "resumeGroupLabel": "后端 & 异步管线底座组",
        "type": "debug",
        "difficulty": "高频",
        "source": "补充",
        "bookId": None,
        "bookPage": None,
        "chapter": "补充 · 改错训练",
        "title": "改错：FastAPI 异步接口里的阻塞调用",
        "question": """下面这个接口在压测时 QPS 上不去，偶尔还会把整个服务拖慢。请指出至少 3 个问题，说明后果和修复方式；不必重写完整项目。

@app.post('/rag/query')
async def rag_query(req: QueryReq, db: Session = Depends(get_db)):
    docs = db.execute(text('select ...')).fetchall()
    resp = requests.post('http://llm:8000/v1/chat', json={...}, timeout=30)
    return {'answer': resp.json()['choices'][0]['message']['content']}

提示：逐条指出错误点、原因和修复；允许只写函数名或关键行。""",
        "answer": """这段代码在 async def 里做同步 DB 和 requests，等于把事件循环当线程用。至少 6 个问题：

1. async def + 同步 SQLAlchemy Session
   db.execute 是阻塞 IO；并发一高，事件循环被占住，所有请求排队。
   修复：用 AsyncSession + asyncpg；或者路由改成 def 让 FastAPI 丢线程池；或者显式 run_in_threadpool。不要在同一路由里混用同步/异步会话。

2. requests.post 同步阻塞 30 秒
   上游一慢，整个 worker 被占满，QPS 直接掉。
   修复：httpx.AsyncClient；连接池上限 + 分层超时（connect=3s、read=20s）；加 semaphore 限制并发。

3. timeout=30 没有连接/读取区分，也没有重试边界
   重试没有退避、没有幂等键，可能重复扣费/重复生成。
   修复：connect/read/write/pool 分开；指数退避 + jitter；只对幂等请求重试；加上游熔断。

4. 没检查 status_code，resp.json() 可能抛异常
   上游 4xx/5xx 会变成 500，甚至把上游错误细节透给前端。
   修复：raise_for_status、捕获 JSON 解析错误、返回结构化错误码；必要时降级到缓存答案。

5. 没有输入约束和成本上限
   query 长度、top_k、上下文预算都没限制；一个超大 prompt 就能拖死服务和账单。
   修复：Pydantic 加 max_length/ge/le；检索前做 token 预算；超限直接 422。

6. 长请求不该占 HTTP 连接
   LLM 超过数秒的请求应走流式或后台 job，HTTP 只返回 job_id。
   修复：短请求流式；长任务 Celery/RQ 异步化；前端轮询或 SSE。

7. 缺少连接池与可观测
   DB pool、HTTP pool、并发信号量、request_id、p95 耗时、上游错误率都要有；否则压测只知道慢，不知道慢在哪。

面试时按「事件循环 → 上游调用 → 错误处理 → 容量/成本 → 异步化」讲，别只说“加 try except”。""",
        "followUps": [
            "async def 里调用同步库一定错吗？什么时候可以用 run_in_threadpool？",
            "LLM 上游超时，重试怎么避免重复扣费？",
            "FastAPI 的依赖注入怎么保证 AsyncSession 正确关闭？",
            "长请求为什么要拆成 job，而不是把 timeout 调大？",
        ],
        "rubric": [
            "识别 async def 中同步 DB/HTTP 阻塞事件循环，并给出异步或线程池修复",
            "识别超时、重试、熔断和幂等问题",
            "识别错误处理与输入/成本边界",
            "能提出长请求异步化、连接池与可观测方案",
        ],
        "tags": ["FastAPI", "改错", "异步", "事件循环", "超时", "连接池"],
        "bookTitle": None,
    },
    {
        "id": "X-DEBUG-02",
        "group": "agent",
        "groupLabel": "Agent / RAG 高阶核心组",
        "resumeGroup": "core-agent",
        "resumeGroupLabel": "核心 Agent&LLM 工程组",
        "type": "debug",
        "difficulty": "压轴",
        "source": "补充",
        "bookId": None,
        "bookPage": None,
        "chapter": "补充 · 改错训练",
        "title": "改错：RAG 权限只写在 Prompt 里",
        "question": """下面这段 RAG 代码声称“不会越权”。请指出权限漏洞、后果和修复方式，至少 5 个点。

def answer(q, user):
    docs = vector_store.search(q, top_k=5)          # 没有 tenant / acl 过滤
    context = '\\n'.join(d.page_content for d in docs)
    prompt = f'只能根据资料回答，不要泄露无权限内容：\\n{context}\\n问题：{q}'
    return llm(prompt)

提示：重点看检索、缓存、生成和审计；不必重写完整系统。""",
        "answer": """这是典型的「把权限交给 prompt」。至少 6 个错：

1. 检索没有 tenant/ACL 过滤
   cross-tenant、跨部门文档会直接进 context。prompt 里的“不要泄露”不是安全边界，模型可以不听。
   修复：检索前解析 scope，SQL/ANN 强制 tenant_id + ACL 过滤。

2. 先 top_k=5 再在应用层过滤
   无权限但高相似的文档会占满 5 个名额，授权文档召不回来；过滤后可能只剩 1 条甚至 0 条。
   修复：过滤下推到检索；候选多取 k*3；高选择性场景做分区/partial index/多路召回。

3. 没有 chunk→doc 的权威 ACL 二次校验
   向量库 metadata 可能滞后；文档 ACL 改了但索引没重建，旧 chunk 仍然会被召回。
   修复：每个 chunk 带 acl_version；返回前按 doc_id 回权威 ACL 校验；版本不一致直接丢弃。

4. 没有用户/租户 scope，缓存可能串用户
   如果缓存 key 只按 query，A 的答案会被 B 读到；这是比模型泄露更直接的越权。
   修复：cache key = tenant + user/scope + query hash + acl_version；权限变更失效。

5. 生成后没有引用白名单和输出守卫
   模型可能复述 context 里的机密，或者引用未授权 doc_id。
   修复：allowed_doc_ids 白名单；引用不在集合直接拦；输出做 PII/密钥/密级检测；流式命中即终止。

6. 日志/追踪把完整 context 写下来
   排查问题时反而把机密落盘，审计日志变成泄露源。
   修复：日志只记 doc_id、decision、acl_version、耗时；正文脱敏或加密。

面试一句话：检索层做 tenant+ACL 过滤和权威二次校验，生成层做上下文白名单+引用白名单+输出守卫，缓存按 scope 隔离，ACL 变更走版本失效。""",
        "followUps": [
            "如果向量库不支持复杂 ACL 过滤，怎么在应用层补？",
            "权限过滤导致召回率下降，怎么衡量是过滤太严还是索引太差？",
            "同一用户属于多个部门，cache key 怎么设计？",
            "生成后才发现引用了未授权文档，怎么回滚？",
        ],
        "rubric": [
            "指出 prompt 不是权限边界，检索缺少 tenant/ACL 过滤",
            "指出先 top_k 后过滤会造成召回饥饿",
            "指出 chunk 需要权威 ACL 二次校验与 acl_version",
            "指出缓存必须按 tenant/user scope 隔离",
            "给出生成后引用白名单、输出守卫和审计脱敏",
        ],
        "tags": ["RAG 权限", "改错", "Prompt 注入", "缓存隔离", "ACL"],
        "bookTitle": None,
    },
    {
        "id": "X-HAND-01",
        "group": "backend",
        "groupLabel": "底层底座组",
        "resumeGroup": "backend-pipeline",
        "resumeGroupLabel": "后端 & 异步管线底座组",
        "type": "handwrite",
        "difficulty": "高频",
        "source": "补充",
        "bookId": None,
        "bookPage": None,
        "chapter": "补充 · 手写训练",
        "title": "手写：O(1) 的 LRU 缓存",
        "question": """实现一个 LRU 缓存：get(key) 和 put(key, value) 平均 O(1)。

提示：可以写完整代码、伪代码或概念步骤；说明数据结构、淘汰顺序、capacity=0、更新已有 key 的边界，以及并发或 TTL 怎么处理。""",
        "answer": """核心结构：哈希表 + 双向链表。

- dict：key -> node，负责 O(1) 定位
- 双向链表：头部最近使用，尾部最久未使用；get 命中后把节点移到头部；put 新 key 插头部，超容量删尾部
- 用 dummy head/tail 省掉空链表和边界判断
- 更新已有 key：改 value 并移到头部，不能重复插入
- capacity=0：put 直接返回，不分配节点
- 复杂度：get/put 平均 O(1)，空间 O(capacity)

伪代码：
get(key):
  node = map.get(key)
  if not node: return -1
  move_to_head(node)
  return node.value

put(key, value):
  if capacity == 0: return
  node = map.get(key)
  if node:
    node.value = value
    move_to_head(node)
    return
  if len(map) == capacity:
    tail = remove_tail()
    del map[tail.key]
  node = new Node(key, value)
  add_to_head(node)
  map[key] = node

并发：
- 单机多线程：一把互斥锁包住 get/put，临界区尽量短；高并发用分段锁（按 key hash 分桶）
- 分布式：不要自己用 Redis + 本地 LRU 冒充强一致；本地缓存加短 TTL + 主动失效，Redis 做共享层

TTL：
- 每个 node 存 expires_at；get 时过期就删并返回 miss
- 大量 key 的过期清理用最小堆/时间轮，不要每次全表扫描
- 淘汰回调不要在锁内做 IO

易错点：只写 dict 不维护顺序；get 命中不移动节点；更新已有 key 又插入新节点；容量为 0 没处理；锁内调用外部服务。""",
        "followUps": [
            "为什么用双向链表而不是单链表？",
            "并发场景下分段锁怎么分，锁粒度怎么定？",
            "LRU 和 LFU 的适用场景有什么区别？",
            "本地 LRU + Redis 怎么保证缓存一致性？",
        ],
        "rubric": [
            "给出哈希表 + 双向链表，并说明 O(1) 的来源",
            "正确处理 get 命中移动、更新已有 key、超容量淘汰",
            "处理 capacity=0 和空链表边界",
            "能讲清并发锁/分段锁或 TTL 的一种落地方案",
        ],
        "tags": ["手写", "LRU", "数据结构", "缓存", "复杂度"],
        "bookTitle": None,
    },
    {
        "id": "X-HAND-02",
        "group": "backend",
        "groupLabel": "底层底座组",
        "resumeGroup": "backend-pipeline",
        "resumeGroupLabel": "后端 & 异步管线底座组",
        "type": "handwrite",
        "difficulty": "高频",
        "source": "补充",
        "bookId": None,
        "bookPage": None,
        "chapter": "补充 · 手写训练",
        "title": "手写：合并 K 个升序链表（常规 + 最优 + 复杂度）",
        "question": """LeetCode 23：合并 K 个升序链表。

请给出两种解法：顺序/分治两两合并（常规）和最小堆（最优），分别说明时间、空间复杂度；K=0、空链表、重复值怎么处理。可以写代码或伪代码。""",
        "answer": """常规解法一：顺序两两合并
- 从第 1 条开始，依次和第 2、3…K 条合并
- 总节点数 N；第 i 次合并要扫当前结果（约 i*N/K 个节点），总时间 O(NK)
- 空间 O(1)（只改指针）
- 优点：代码短、常数小；K 小的时候够用

常规解法二：分治两两合并
- 把 K 条链表分成两半，递归合并左右两半，再合并两个结果
- 每层合并总节点数 N，共 log K 层
- 时间 O(N log K)，空间 O(log K) 递归栈（改成迭代可 O(1)）
- 这是“常规解法里更稳”的版本，面试可以先写这个

最优解法：最小堆
- 把 K 条链表的头节点放进最小堆（按 val）
- 每次弹出最小节点接到结果尾部；如果它有 next，把 next 入堆
- 每个节点入堆/出堆一次，堆大小 K
- 时间 O(N log K)，空间 O(K)
- 优点：K 很大时不会像顺序合并那样退化；重复值按 val 正常排序，稳定不稳定都无所谓

边界：
- K=0：返回 None
- lists 里有 None：跳过，不放进堆
- 全部为空：返回 None
- 重复值：堆按 val 比较即可；节点对象不需要额外比较
- 负数：正常比较

面试表达：
“先给分治 O(N log K)，再给最小堆 O(N log K)、空间 O(K)。如果 K 很小，顺序合并 O(NK) 也够用；K 大时堆更稳。复杂度要写清楚是总节点数 N，不是单条链表长度。”""",
        "followUps": [
            "分治合并的递归深度是多少，怎么改成迭代？",
            "最小堆里存节点还是存值，为什么？",
            "如果链表是降序，怎么复用这套解法？",
            "N 很大、K 很小时，哪种解法常数更优？",
        ],
        "rubric": [
            "给出顺序/分治合并，并正确说明 O(NK) 或 O(N log K)",
            "给出最小堆解法，说明 O(N log K)、O(K)",
            "正确处理 K=0、空链表、重复值边界",
            "能比较两种解法的适用场景，而不是只背最优解",
        ],
        "tags": ["手写", "LeetCode", "链表", "堆", "复杂度"],
        "bookTitle": None,
    },
]


def main() -> None:
    with BANK_PATH.open("r", encoding="utf-8") as handle:
        bank = json.load(handle)

    existing_ids = {item.get("id") for item in bank.get("questions", [])}
    added = []
    for question in EXTRA_QUESTIONS:
        if question["id"] in existing_ids:
            continue
        bank["questions"].append(question)
        existing_ids.add(question["id"])
        added.append(question["id"])

    bank["count"] = len(bank["questions"])
    with BANK_PATH.open("w", encoding="utf-8") as handle:
        json.dump(bank, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(json.dumps({"added": added, "count": bank["count"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
