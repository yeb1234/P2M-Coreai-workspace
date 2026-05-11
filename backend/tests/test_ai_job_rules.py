from types import SimpleNamespace
import unittest

from app.services.ai_job_rules import has_summary, is_ai_complete, is_batch_eligible


def video(**overrides):
    base = {
        "subtitle_path": None,
        "transcript_segments": None,
        "summary": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def job(status="completed", **overrides):
    base = {
        "status": status,
        "summary": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def payload(mode):
    return SimpleNamespace(mode=mode)


class AiJobRulesTest(unittest.TestCase):
    def test_external_job_summary_counts_as_complete(self):
        current_video = video(transcript_segments="[]")
        latest_job = job(summary="外部 LLM 总结成功")

        self.assertTrue(has_summary(current_video, latest_job))
        self.assertTrue(is_ai_complete(current_video, latest_job))

        eligible, reason = is_batch_eligible(current_video, latest_job, payload("unfinished"))
        self.assertFalse(eligible)
        self.assertEqual(reason, "complete")

    def test_unfinished_keeps_complete_video_out_of_queue(self):
        current_video = video(subtitle_path="lesson.vtt", summary="已有总结")

        eligible, reason = is_batch_eligible(current_video, None, payload("unfinished"))

        self.assertFalse(eligible)
        self.assertEqual(reason, "complete")

    def test_missing_summary_requires_subtitles(self):
        current_video = video()

        eligible, reason = is_batch_eligible(current_video, None, payload("missing_summary"))

        self.assertFalse(eligible)
        self.assertEqual(reason, "no_subtitles")

    def test_failed_only_requires_latest_failed_job(self):
        current_video = video(subtitle_path="lesson.vtt")

        eligible, reason = is_batch_eligible(current_video, job("completed"), payload("failed_only"))
        self.assertFalse(eligible)
        self.assertEqual(reason, "not_failed")

        eligible, reason = is_batch_eligible(current_video, job("failed"), payload("failed_only"))
        self.assertTrue(eligible)
        self.assertIsNone(reason)

    def test_all_mode_is_only_mode_that_ignores_active_jobs(self):
        current_video = video(subtitle_path="lesson.vtt", summary="已有总结")

        eligible, reason = is_batch_eligible(current_video, job("running"), payload("unfinished"))
        self.assertFalse(eligible)
        self.assertEqual(reason, "active_job")

        eligible, reason = is_batch_eligible(current_video, job("running"), payload("all"))
        self.assertTrue(eligible)
        self.assertIsNone(reason)


if __name__ == "__main__":
    unittest.main()
