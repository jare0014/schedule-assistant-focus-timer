"""
test_weekly_syncer.py - Unit tests for timeblocker's weekly_syncer.py.
"""

import os
import shutil
import tempfile
import unittest

from timeblocker.weekly_syncer import sync_external_tasks_to_weekly_note


class TestWeeklySyncer(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.weekly_dir = os.path.join(self.test_dir, "02_Journal", "02_Weekly")
        os.makedirs(self.weekly_dir, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.test_dir)

    def test_sync_tasks_to_weekly_note(self):
        # 2026-10-02 is a Friday in 2026-W40
        todoist_tasks = [
            {"content": "Check into auto insurance quotes", "due": {"date": "2026-10-02"}},
            {"content": "Order replacement furnace filter", "due": {"date": "2026-10-02T14:00:00Z"}}
        ]
        google_tasks = [
            {"title": "Buy Esther science kit supplies", "due": "2026-10-02T00:00:00.000Z"}
        ]

        synced = sync_external_tasks_to_weekly_note(
            vault_root=self.test_dir,
            tasks=todoist_tasks,
            google_tasks=google_tasks,
            default_date_str="2026-10-02"
        )

        self.assertEqual(len(synced), 3)

        weekly_file = os.path.join(self.weekly_dir, "2026-W40.md")
        self.assertTrue(os.path.exists(weekly_file))

        with open(weekly_file, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("#### Friday:", content)
        self.assertIn("- [ ] Check into auto insurance quotes", content)
        self.assertIn("- [ ] Order replacement furnace filter", content)
        self.assertIn("- [ ] Buy Esther science kit supplies", content)

        # Second run: duplicate prevention check
        second_synced = sync_external_tasks_to_weekly_note(
            vault_root=self.test_dir,
            tasks=todoist_tasks,
            google_tasks=google_tasks,
            default_date_str="2026-10-02"
        )
        self.assertEqual(len(second_synced), 0, "Tasks already on weekly note must not be duplicated")

    def test_cancelled_task_not_duplicated(self):
        weekly_file = os.path.join(self.weekly_dir, "2026-W40.md")
        initial_content = (
            "---\njournal: Weekly Notes\n---\n\n"
            "### Evenings and Weekend\n"
            "#### Friday: \n"
            "- [-] Cancelled task that should not re-add\n"
        )
        with open(weekly_file, "w", encoding="utf-8") as f:
            f.write(initial_content)

        tasks = [{"content": "Cancelled task that should not re-add", "due": {"date": "2026-10-02"}}]
        synced = sync_external_tasks_to_weekly_note(
            vault_root=self.test_dir,
            tasks=tasks,
            google_tasks=[],
            default_date_str="2026-10-02"
        )
        self.assertEqual(len(synced), 0, "Cancelled tasks must not be re-added as open tasks")


if __name__ == "__main__":
    unittest.main()
