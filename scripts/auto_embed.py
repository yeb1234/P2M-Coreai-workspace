"""自动续跑向量化脚本，崩了自动重试。"""
import requests
import time
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

API_BASE = "http://localhost/api/assistant"
BATCH_SIZE = 512
MAX_RETRIES = 50  # 最多重试50次（约50次*每次跑5万条=250万条够了）

def get_stats():
    try:
        r = requests.get(f"{API_BASE}/embedding-stats", timeout=10)
        return r.json()
    except:
        return None

def run_batch():
    try:
        r = requests.post(f"{API_BASE}/build-embeddings?batch_size={BATCH_SIZE}", timeout=600)
        return r.json()
    except Exception as e:
        return {"status": "error", "message": str(e)}

def main():
    retries = 0
    while retries < MAX_RETRIES:
        stats = get_stats()
        if stats:
            indexed = stats.get("indexed_embeddings", 0)
            total = stats.get("total_segments", 0)
            pct = stats.get("coverage_pct", 0)
            print(f"[{time.strftime('%H:%M:%S')}] 进度: {indexed}/{total} ({pct}%)")

            if pct >= 100:
                print("✅ 全部完成！")
                return

        print(f"[{time.strftime('%H:%M:%S')}] 开始新一轮 batch...")
        result = run_batch()
        status = result.get("status", "unknown")
        indexed = result.get("indexed", 0)

        if status == "ok":
            print(f"[{time.strftime('%H:%M:%S')}] ✅ 完成 {indexed} 条")
            retries = 0  # 成功了重置重试计数
        else:
            msg = result.get("message", "unknown error")
            print(f"[{time.strftime('%H:%M:%S')}] ❌ 失败: {msg}")
            retries += 1
            if retries < MAX_RETRIES:
                wait = min(30, retries * 5)
                print(f"[{time.strftime('%H:%M:%S')}] 等待 {wait}s 后重试 ({retries}/{MAX_RETRIES})...")
                time.sleep(wait)

        # 每轮之间休息1秒避免过于频繁
        time.sleep(1)

    print("❌ 达到最大重试次数，退出")

if __name__ == "__main__":
    main()
